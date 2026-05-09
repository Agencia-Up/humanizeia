/**
 * pedro-trigger-followup
 *
 * Verifica `pedro_followup_schedules` por agendamentos pendentes (status='pending')
 * com scheduled_at ≤ now, converte em entradas na `followup_queue` (canal WhatsApp)
 * e marca como 'sent'.
 *
 * Invocação: Supabase Cron ou n8n — a cada 5 min durante horário comercial.
 * Também pode ser chamado manualmente pelo frontend para forçar processamento.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  try {
    const now = new Date().toISOString();

    // 1. Busca agendamentos pendentes que já estão no prazo (até 20 por vez)
    const { data: schedules, error: fetchErr } = await supabase
      .from("pedro_followup_schedules")
      .select(`
        *,
        lead:ai_crm_leads(id, remote_jid),
        instance:wa_instances(id, api_url, api_key_encrypted, instance_name)
      `)
      .eq("status", "pending")
      .lte("scheduled_at", now)
      .not("instance_id", "is", null)
      .order("scheduled_at", { ascending: true })
      .limit(20);

    if (fetchErr) throw fetchErr;
    if (!schedules || schedules.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let processed = 0;
    let failed = 0;

    for (const schedule of schedules) {
      try {
        const lead     = schedule.lead;
        const instance = schedule.instance;
        if (!lead?.remote_jid || !instance?.api_url) {
          // Marca como cancelado se dados insuficientes
          await supabase
            .from("pedro_followup_schedules")
            .update({ status: "cancelled" })
            .eq("id", schedule.id);
          continue;
        }

        // 2. Extrai telefone do remote_jid (remove sufixo @s.whatsapp.net)
        const phone = lead.remote_jid.replace(/@.*$/, "").replace(/\D/g, "");

        // 3. Insere na followup_queue (processado pelo process-followup-queue)
        const { error: queueErr } = await supabase
          .from("followup_queue")
          .insert({
            user_id:          schedule.user_id,
            lead_id:          schedule.lead_id,
            instance_id:      schedule.instance_id,
            phone,
            message_content:  schedule.message_template,
            channel:          "whatsapp",
            status:           "scheduled",
            scheduled_for:    schedule.scheduled_at,
            source:           "pedro_manual_followup",
          });

        if (queueErr) throw queueErr;

        // 4. Marca agendamento como enviado
        await supabase
          .from("pedro_followup_schedules")
          .update({ status: "sent", sent_at: now })
          .eq("id", schedule.id);

        // 5. Atualiza last_followup_at no lead
        await supabase
          .from("ai_crm_leads")
          .update({ last_followup_at: now })
          .eq("id", schedule.lead_id);

        processed++;
      } catch (err) {
        console.error(`[pedro-trigger-followup] Erro no agendamento ${schedule.id}:`, err);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed, failed }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[pedro-trigger-followup] Erro geral:", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Erro interno" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
