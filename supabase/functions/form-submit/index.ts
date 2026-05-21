import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { form_id, name, email, phone, custom_data, utm_source, utm_campaign } = body;

    if (!form_id) throw new Error("form_id obrigatório");

    // 1. Busca configuração do formulário
    const { data: form, error: formErr } = await supabase
      .from("capture_forms")
      .select("*, sequence:followup_sequences(id, instance_id, is_active, steps:followup_sequence_steps(*))")
      .eq("id", form_id)
      .eq("is_active", true)
      .maybeSingle();

    if (formErr || !form) throw new Error("Formulário não encontrado ou inativo");

    const ip = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || null;

    // 2. Salva submissão
    const { data: submission, error: subErr } = await supabase
      .from("capture_form_submissions")
      .insert({
        form_id,
        user_id: form.user_id,
        name: name || null,
        email: email || null,
        phone: phone || null,
        custom_data: custom_data || {},
        utm_source: utm_source || null,
        utm_campaign: utm_campaign || null,
        ip_address: ip,
      })
      .select("id")
      .single();

    if (subErr) throw subErr;

    // 3. Incrementa contador do formulário
    await supabase.rpc("increment_form_submissions" as any, { form_id_param: form_id }).maybeSingle();

    // 4. Joga lead no CRM (primeiro estágio do pipeline)
    // Busca primeiro estágio — cria etapas padrão se o usuário nunca abriu o CRM
    let { data: stage } = await supabase
      .from("crm_pipeline_stages")
      .select("id")
      .eq("user_id", form.user_id)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!stage) {
      // Usuário ainda não tem etapas — cria o pipeline padrão
      const defaultStages = [
        { user_id: form.user_id, name: "Novo Lead",    color: "#6366f1", position: 0, is_default: true },
        { user_id: form.user_id, name: "Qualificado",  color: "#f59e0b", position: 1, is_default: false },
        { user_id: form.user_id, name: "Proposta",     color: "#3b82f6", position: 2, is_default: false },
        { user_id: form.user_id, name: "Negociação",   color: "#8b5cf6", position: 3, is_default: false },
        { user_id: form.user_id, name: "Fechado",      color: "#10b981", position: 4, is_default: false },
        { user_id: form.user_id, name: "Carro não disponível", color: "#f43f5e", position: 5, is_default: false },
        { user_id: form.user_id, name: "Porta",        color: "#14b8a6", position: 6, is_default: false },
      ];
      await supabase.from("crm_pipeline_stages").insert(defaultStages);
      const { data: newStage } = await supabase
        .from("crm_pipeline_stages")
        .select("id")
        .eq("user_id", form.user_id)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      stage = newStage;
    }

    if (stage) {
      const { data: lastLead } = await supabase
        .from("crm_leads")
        .select("position")
        .eq("stage_id", stage.id)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { error: leadErr } = await supabase.from("crm_leads").insert({
        user_id: form.user_id,
        stage_id: stage.id,
        name: name || "Lead sem nome",
        email: email || null,
        phone: phone || null,
        source: `form:${form.name}`,
        position: ((lastLead?.position ?? 0) + 1),
        custom_fields: custom_data || {},
      });
      if (leadErr) console.error("[form-submit] erro ao criar lead no CRM:", leadErr.message);
    }

    // 5. Salva contato na lista configurada (se houver)
    if (form.contact_list_id && phone) {
      const cleanPhone = phone.replace(/\D/g, "");

      // Verifica se o contato já existe na lista para evitar duplicatas
      const { data: existing } = await supabase
        .from("wa_contacts")
        .select("id")
        .eq("list_id", form.contact_list_id)
        .eq("phone", cleanPhone)
        .maybeSingle();

      if (!existing) {
        const { error: contactErr } = await supabase.from("wa_contacts").insert({
          user_id: form.user_id,
          list_id: form.contact_list_id,
          phone: cleanPhone,
          name: name || null,
          source: "form",
          metadata: {
            email: email || null,
            form_id,
            form_name: form.name,
            ...(custom_data || {}),
          },
        });

        if (!contactErr) {
          await supabase.rpc("increment_contact_list_count" as any, {
            list_id_param: form.contact_list_id,
          });
        } else {
          console.error("[form-submit] erro ao salvar contato na lista:", contactErr.message);
        }
      }
    }

    // 6. Enfileira mensagens de follow-up se houver sequência ativa
    const sequence = Array.isArray(form.sequence) ? form.sequence[0] : form.sequence;
    if (sequence?.is_active && phone && sequence.steps?.length > 0) {
      const instanceId = sequence.instance_id || form.instance_id;
      const cleanPhone = phone.replace(/\D/g, "");

      const steps = [...sequence.steps].sort((a: any, b: any) => a.step_order - b.step_order);
      let accumulatedHours = 0;

      let hasImmediate = false;

      for (const step of steps) {
        accumulatedHours += step.delay_hours;
        const scheduledFor = new Date(Date.now() + accumulatedHours * 60 * 60 * 1000).toISOString();
        const isImmediate = accumulatedHours === 0;
        if (isImmediate) hasImmediate = true;

        await supabase.from("followup_queue").insert({
          user_id: form.user_id,
          step_id: step.id,
          submission_id: submission.id,
          phone: cleanPhone,
          instance_id: instanceId,
          message_content: step.message_text.replace(/\{nome\}/gi, name || "").replace(/\{email\}/gi, email || ""),
          channel: "whatsapp",
          status: "scheduled",
          scheduled_for: scheduledFor,
        });
      }

      // Dispara o processador imediatamente se houver mensagem com delay 0
      // (não espera o cron de 5 min — enviada segundos após o cadastro)
      if (hasImmediate) {
        const processorUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-followup-queue`;
        fetch(processorUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: "{}",
        }).catch((err: Error) => console.error("[form-submit] trigger followup processor:", err.message));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        submission_id: submission.id,
        redirect_url: form.redirect_url || null,
        success_message: form.success_message,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[form-submit]", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
