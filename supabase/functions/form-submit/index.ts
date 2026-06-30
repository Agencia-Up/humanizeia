import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPedroText, resolvePedroInstance } from "../_shared/pedro-v2/uazapiSender_20260524.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PEDRO_DEFAULT_OPENER =
  "Oi {nome}! Recebemos seu cadastro aqui. Posso te ajudar a encontrar o que você procura?";

// Normaliza telefone BR para o formato do WhatsApp (55 + DDD + número).
function normalizePhoneBR(value: string | null | undefined): string {
  const digits = String(value || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return "";
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function renderOpener(template: string | null | undefined, vars: Record<string, string>): string {
  const text = (template && template.trim()) ? template : PEDRO_DEFAULT_OPENER;
  return text.replace(/\{(\w+)\}/g, (_m, key) => vars[key] ?? "");
}

// FORMULÁRIO DO PEDRO: cria o lead no motor do Pedro (ai_crm_leads) e dispara a
// abertura pela instância. Quando o lead responder, o webhook (pedro-webhook-v2,
// hoje; v3 amanhã) acha o lead por (agent_id, remote_jid) e a IA assume.
// Espelha o caminho já consolidado do meta-leadgen — só toca camada compartilhada
// (ai_crm_leads + sendPedroText), sem acoplar a nenhuma versão do cérebro.
async function handlePedroForm(
  supabase: any,
  form: any,
  lead: { name: string | null; email: string | null; phone: string | null; custom_data: Record<string, any> },
): Promise<{ ok: boolean; lead_id?: string; error?: string }> {
  const phone = normalizePhoneBR(lead.phone);
  if (!phone) throw new Error("Telefone inválido para atendimento do Pedro.");
  const remoteJid = `${phone}@s.whatsapp.net`;
  const userId = form.user_id;
  const agentId = form.agent_id;
  const nowStr = new Date().toISOString();

  // Resolve a instância de envio: a configurada no form, senão a do agente.
  const instance = await resolvePedroInstance(supabase, {
    user_id: userId,
    agent_id: agentId,
    instance_id: form.instance_id || null,
  });
  if (!instance?.id) throw new Error("Nenhuma instância WhatsApp conectada para o Pedro.");

  const baseLead: Record<string, any> = {
    user_id: userId,
    agent_id: agentId,
    instance_id: instance.id,
    lead_name: lead.name || phone,
    remote_jid: remoteJid,
    origem: "outros",
    entry_channel: "web_form",
    status_crm: "novo",
    updated_at: nowStr,
  };

  // Dedupe por (user_id, remote_jid, agent_id) — mesma chave do webhook.
  const { data: existing } = await supabase
    .from("ai_crm_leads")
    .select("id")
    .eq("user_id", userId)
    .eq("remote_jid", remoteJid)
    .eq("agent_id", agentId)
    .maybeSingle();

  let leadId: string;
  if (existing?.id) {
    await supabase.from("ai_crm_leads").update(baseLead).eq("id", existing.id);
    leadId = existing.id;
  } else {
    const { data: ins, error: insErr } = await supabase
      .from("ai_crm_leads")
      .insert({
        ...baseLead,
        status: "novo",
        ai_paused: false,
        message_count: 0,
        last_interaction_at: nowStr,
        created_at: nowStr,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;
    leadId = ins.id;
  }

  // Semeia a memória do Pedro com os dados do formulário (best-effort).
  try {
    await supabase.from("pedro_conversation_state").upsert({
      lead_id: leadId,
      agent_id: agentId,
      user_id: userId,
      state: {
        lead: { nome: lead.name || undefined, telefone: phone, email: lead.email || undefined },
        referencia: { origem_anuncio: "web_form", form_id: form.id, form_name: form.name },
        atendimento: { etapa: "formulario_recebido", ultimo_proximo_passo: "primeiro_contato_whatsapp" },
        formulario_web: lead.custom_data || {},
      },
      updated_at: nowStr,
    }, { onConflict: "lead_id,agent_id" });
  } catch (e) {
    console.error("[form-submit] seed pedro memory:", (e as Error).message);
  }

  const opener = renderOpener(form.pedro_opener_template, {
    nome: (lead.name || "").split(" ")[0] || "",
  });

  try {
    await supabase.from("wa_chat_history").insert({
      user_id: userId, agent_id: agentId, instance_id: instance.id, remote_jid: remoteJid,
      role: "system",
      content: `Lead recebido pelo formulário web "${form.name}".`,
      metadata: { source: "web_form", form_id: form.id, field_data: lead.custom_data || {} },
    });
  } catch (_e) { /* histórico é best-effort */ }

  const send = await sendPedroText(instance, { to: phone, text: opener }, { humanize: true });
  if (send?.ok) {
    try {
      await supabase.from("wa_chat_history").insert({
        user_id: userId, agent_id: agentId, instance_id: instance.id, remote_jid: remoteJid,
        role: "assistant", content: opener,
        metadata: { source: "web_form_opener", send_result: send },
      });
    } catch (_e) { /* best-effort */ }
  } else {
    console.error("[form-submit] falha ao enviar abertura do Pedro:", send?.error);
  }

  return { ok: !!send?.ok, lead_id: leadId, error: send?.ok ? undefined : (send?.error || "envio falhou") };
}

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

    // 3.5 FORMULÁRIO DO PEDRO: se o form está ligado a um agente, o lead vai para
    // o motor do Pedro (IA) — cria ai_crm_leads + abertura no WhatsApp — em vez do
    // Marcos. O cadastro nunca falha por causa do Pedro: se o envio falhar, o lead
    // já está salvo na submissão e a resposta volta com pedro.ok=false.
    if (form.agent_id && phone) {
      let pedro: { ok: boolean; lead_id?: string; error?: string };
      try {
        pedro = await handlePedroForm(supabase, form, {
          name: name || null, email: email || null, phone, custom_data: custom_data || {},
        });
      } catch (e: any) {
        console.error("[form-submit] pedro flow:", e?.message);
        pedro = { ok: false, error: e?.message || "falha no atendimento do Pedro" };
      }
      return new Response(
        JSON.stringify({
          success: true,
          submission_id: submission.id,
          redirect_url: form.redirect_url || null,
          success_message: form.success_message,
          pedro,
        }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

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
