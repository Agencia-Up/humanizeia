// ============================================================================
// cron-flush-manager-feedbacks
// ----------------------------------------------------------------------------
// Roda a cada 5 minutos via pg_cron. Pra cada master com mode='scheduled' cuja
// hora atual (America/Sao_Paulo) está dentro da janela schedule_time_start..end:
//   1. Pega feedbacks pending_send=true desse master
//   2. Pra cada um, monta a msg WhatsApp (mesmo formato do pedro-process-feedback)
//   3. Envia com delay aleatório entre delay_min_seconds e delay_max_seconds
//   4. Marca sent_to_manager_at + pending_send=false
//   5. Atualiza manager_feedback_config.last_flushed_at
//
// Idempotência: last_flushed_at evita rodar 2x na mesma janela do dia.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRIORITY_EMOJI: Record<string, string> = { low: "❄️", normal: "🌡️", high: "🔥", urgent: "🚀" };
const PRIORITY_LABEL: Record<string, string> = { low: "Frio", normal: "Morno", high: "Quente", urgent: "Pronto pra comprar" };

function buildFeedbackMessage(fb: any, lead: any, member: any): string {
  const emoji = PRIORITY_EMOJI[fb.priority] || "💬";
  const prio = PRIORITY_LABEL[fb.priority] || fb.priority;
  const leadName = lead?.lead_name || lead?.remote_jid || "Lead";
  const sellerName = member?.name || "Vendedor";
  const when = new Date(fb.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const lines: string[] = [
    `${emoji} *FEEDBACK DO VENDEDOR*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `👤 *Vendedor:* ${sellerName}`,
    `📋 *Lead:* ${leadName}`,
    `🕐 *Horário:* ${when}`,
    `🎯 *Potencial de compra:* ${prio}`,
    ``,
  ];
  if (fb.city) lines.push(`🏙️ *Cidade do cliente:* ${fb.city}`);
  if (fb.reason) { lines.push(`❌ *Motivo da não-compra:*`); lines.push(`_${fb.reason}_`); }
  if (fb.city || fb.reason) lines.push(``);
  if (fb.observations) { lines.push(`📝 *Observações:*`); lines.push(`_${fb.observations}_`); lines.push(``); }
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`_Enviado em lote pelo Pedro SDR_`);
  return lines.join("\n");
}

function pickInstance(supabase: any, sellerAuthId: string | null, agentInstanceIds: string[], agentInstanceId: string | null): Promise<any> {
  return (async () => {
    if (sellerAuthId) {
      const { data } = await supabase
        .from("wa_instances")
        .select("api_url, api_key_encrypted, instance_name")
        .eq("user_id", sellerAuthId)
        .eq("is_active", true)
        .eq("status", "connected")
        .order("health_score", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) return data;
    }
    const id = (agentInstanceIds && agentInstanceIds[0]) || agentInstanceId;
    if (!id) return null;
    const { data } = await supabase
      .from("wa_instances")
      .select("api_url, api_key_encrypted, instance_name")
      .eq("id", id)
      .maybeSingle();
    return data;
  })();
}

function isWithinWindow(nowSP: Date, startStr: string, endStr: string): boolean {
  // start/end no formato 'HH:MM:SS' ou 'HH:MM'
  const [sH, sM] = startStr.split(":").map(Number);
  const [eH, eM] = endStr.split(":").map(Number);
  const minutesNow = nowSP.getHours() * 60 + nowSP.getMinutes();
  const minutesStart = sH * 60 + sM;
  const minutesEnd = eH * 60 + eM;
  return minutesNow >= minutesStart && minutesNow <= minutesEnd;
}

function nowInSaoPaulo(): Date {
  const utc = new Date();
  // SP é UTC-3 (sem DST). Pra simplificar — Brasil aboliu DST em 2019.
  return new Date(utc.getTime() - 3 * 60 * 60_000);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function randomBetween(min: number, max: number) { return min + Math.floor(Math.random() * (max - min + 1)); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const nowSP = nowInSaoPaulo();
    const todayStr = nowSP.toISOString().slice(0, 10);

    // 1. Pega configs em modo 'scheduled' cujo horário atual está na janela
    const { data: configs } = await supabase
      .from("manager_feedback_config")
      .select("user_id, schedule_time_start, schedule_time_end, delay_min_seconds, delay_max_seconds, last_flushed_at")
      .eq("mode", "scheduled");

    const eligible = (configs || []).filter((c: any) => {
      // Dentro da janela?
      if (!isWithinWindow(nowSP, c.schedule_time_start, c.schedule_time_end)) return false;
      // Já flushou hoje? (idempotência)
      if (c.last_flushed_at) {
        const lastDay = c.last_flushed_at.slice(0, 10);
        if (lastDay === todayStr) return false;
      }
      return true;
    });

    if (eligible.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: "No eligible configs", checkedConfigs: configs?.length || 0 }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const report: any[] = [];

    for (const cfg of eligible) {
      const masterId = (cfg as any).user_id;
      const delayMin = (cfg as any).delay_min_seconds || 27;
      const delayMax = (cfg as any).delay_max_seconds || 54;

      // 2. Pega feedbacks pending desse master
      const { data: feedbacks } = await supabase
        .from("pedro_manager_feedback")
        .select("id, lead_id, member_id, content, priority, city, reason, observations, created_at")
        .eq("user_id", masterId)
        .eq("pending_send", true)
        .order("created_at", { ascending: true });

      if (!feedbacks || feedbacks.length === 0) {
        // Marca flushed mesmo sem nada — evita re-tentar a janela inteira
        await supabase.from("manager_feedback_config")
          .update({ last_flushed_at: new Date().toISOString() })
          .eq("user_id", masterId);
        report.push({ master: masterId, sent: 0, skipped: "no pending" });
        continue;
      }

      // 3. Pra cada feedback, busca lead+member+agente, monta msg, envia com delay
      let sentCount = 0;
      let failedCount = 0;
      for (let i = 0; i < feedbacks.length; i++) {
        const fb: any = feedbacks[i];
        try {
          const [{ data: lead }, { data: member }] = await Promise.all([
            supabase.from("ai_crm_leads").select("lead_name, remote_jid").eq("id", fb.lead_id).maybeSingle(),
            fb.member_id
              ? supabase.from("ai_team_members").select("id, name, agent_id, auth_user_id").eq("id", fb.member_id).maybeSingle()
              : Promise.resolve({ data: null }),
          ]);

          const agentId = (member as any)?.agent_id;
          if (!agentId) { failedCount++; continue; }

          const { data: agent } = await supabase
            .from("wa_ai_agents")
            .select("gerente_phone, instance_id, instance_ids")
            .eq("id", agentId)
            .maybeSingle();
          const gerentePhone = (agent as any)?.gerente_phone;
          if (!gerentePhone) { failedCount++; continue; }

          const instance = await pickInstance(
            supabase,
            (member as any)?.auth_user_id,
            (agent as any)?.instance_ids || [],
            (agent as any)?.instance_id,
          );
          if (!instance) { failedCount++; continue; }

          const msg = buildFeedbackMessage(fb, lead, member);
          const baseUrl = (instance.api_url || "").replace(/\/$/, "");
          const instKey = instance.api_key_encrypted || "";
          let phone = String(gerentePhone).replace(/\D/g, "");
          if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;

          const res = await fetch(`${baseUrl}/send/text`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "token": instKey, "apikey": instKey },
            body: JSON.stringify({ number: phone, text: msg }),
          });

          if (res.ok) {
            await supabase.from("pedro_manager_feedback")
              .update({ sent_to_manager_at: new Date().toISOString(), pending_send: false })
              .eq("id", fb.id);
            sentCount++;
          } else {
            failedCount++;
          }

          // Delay aleatório (anti-spam) — não delaya após o último
          if (i < feedbacks.length - 1) {
            const delaySec = randomBetween(delayMin, delayMax);
            await sleep(delaySec * 1000);
          }
        } catch (err) {
          console.error(`[cron-flush] Erro no feedback ${fb.id}:`, err);
          failedCount++;
        }
      }

      // Marca flush
      await supabase.from("manager_feedback_config")
        .update({ last_flushed_at: new Date().toISOString() })
        .eq("user_id", masterId);

      report.push({ master: masterId, sent: sentCount, failed: failedCount });
    }

    return new Response(JSON.stringify({ success: true, report }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
