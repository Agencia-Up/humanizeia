/**
 * pedro-trigger-followup
 *
 * Disparo MANUAL (pelo botão na tab CRM Avançado do Pedro).
 * Varre `pedro_followup_schedules` por agendamentos pendentes
 * (status='pending') com scheduled_at ≤ now e envia direto via UazAPI,
 * usando o mesmo padrão de envio do cron-lead-followup.
 *
 * Fluxo:
 *   1. Busca agendamentos pendentes
 *   2. Para cada um, envia mensagem via UazAPI (3 tentativas com fallback)
 *   3. Marca como 'sent' (sucesso) ou 'failed' (falha)
 *   4. Persiste a mensagem em wa_chat_history
 *   5. Atualiza last_followup_at no lead
 *
 * Não há cron — disparado apenas pelo botão na interface.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Mesmo helper usado por cron-lead-followup ─────────────────────────────────
async function sendUazapiTextMessage(
  baseUrl: string,
  instKey: string,
  instanceName: string,
  phoneNumber: string,
  remoteJid: string,
  text: string,
): Promise<boolean> {
  const attempts = [
    { url: `${baseUrl}/send/text`, body: { number: phoneNumber, text } },
    { url: `${baseUrl}/send/text`, body: { remoteJid, text } },
    { url: `${baseUrl}/message/sendText/${instanceName}`, body: { number: phoneNumber, text } },
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "token": instKey, "apikey": instKey },
        body: JSON.stringify(attempt.body),
      });
      if (res.ok) return true;
    } catch {
      // tenta próxima estratégia
    }
  }
  return false;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  try {
    const now    = new Date();
    const nowIso = now.toISOString();

    // 1. Busca agendamentos pendentes que já estão no prazo
    const { data: schedules, error: fetchErr } = await supabase
      .from("pedro_followup_schedules")
      .select(`
        *,
        lead:ai_crm_leads(id, remote_jid, agent_id, user_id),
        instance:wa_instances(id, api_url, api_key_encrypted, instance_name)
      `)
      .eq("status", "pending")
      .lte("scheduled_at", nowIso)
      .not("instance_id", "is", null)
      .order("scheduled_at", { ascending: true })
      .limit(20);

    if (fetchErr) throw fetchErr;

    if (!schedules || schedules.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, failed: 0 }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let processed = 0;
    let failed    = 0;

    for (const schedule of schedules) {
      try {
        const lead     = (schedule as any).lead;
        const instance = (schedule as any).instance;

        if (!lead?.remote_jid || !instance?.api_url) {
          await supabase.from("pedro_followup_schedules")
            .update({ status: "cancelled" })
            .eq("id", schedule.id);
          failed++;
          continue;
        }

        // 2. Extrai dados de envio (mesmo padrão do cron-lead-followup)
        const baseUrl  = instance.api_url.replace(/\/$/, "");
        const instKey  = instance.api_key_encrypted || "";
        const instName = instance.instance_name;
        const remoteJid   = lead.remote_jid;
        const phoneNumber = remoteJid.split("@")[0];

        // 3. Envia via UazAPI
        const sent = await sendUazapiTextMessage(
          baseUrl, instKey, instName, phoneNumber, remoteJid,
          schedule.message_template,
        );

        if (!sent) {
          await supabase.from("pedro_followup_schedules")
            .update({ status: "failed" })
            .eq("id", schedule.id);
          failed++;
          continue;
        }

        // 4. Marca como enviado
        await supabase.from("pedro_followup_schedules")
          .update({ status: "sent", sent_at: nowIso })
          .eq("id", schedule.id);

        // 5. Atualiza last_followup_at no lead + persiste no histórico de chat
        await Promise.all([
          supabase.from("ai_crm_leads")
            .update({ last_followup_at: nowIso, next_followup_at: null })
            .eq("id", schedule.lead_id),
          supabase.from("wa_chat_history").insert({
            user_id:     schedule.user_id,
            agent_id:    lead.agent_id,
            instance_id: instName,
            remote_jid:  remoteJid,
            role:        "assistant",
            content:     `[Follow-up manual] ${schedule.message_template}`,
          }),
        ]);

        processed++;
      } catch (err) {
        console.error(`[pedro-trigger-followup] Erro no agendamento ${(schedule as any).id}:`, err);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed, failed }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[pedro-trigger-followup] Erro geral:", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Erro interno" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
