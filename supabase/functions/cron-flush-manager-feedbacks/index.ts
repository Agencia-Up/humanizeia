// ============================================================================
// cron-flush-manager-feedbacks
// ----------------------------------------------------------------------------
// Roda a cada 5 minutos via pg_cron. Pra cada master com mode='scheduled' cuja
// hora atual (America/Sao_Paulo) está dentro da janela schedule_time_start..end:
//   1. Pega feedbacks pending_send=true desse master
//   2. Pra cada um, monta a msg WhatsApp (mesmo formato do pedro-process-feedback)
//   3. Envia com delay aleatório entre delay_min_seconds e delay_max_seconds
//   4. Marca sent_to_manager_at + pending_send=false
//   5. Atualiza manager_feedback_config.last_flushed_at (SE todos sucederam)
//
// Idempotência: last_flushed_at evita rodar 2x na mesma janela do dia.
//
// FASE 4 PLANO_CORRECAO_BUGS_2026-05-27 — 4 fixes aplicados:
//   BUG-09: detecta crm_lead_id (Marcos) e busca em crm_leads (antes Marcos
//           chegava como "Lead: Lead" porque buscava só em ai_crm_leads).
//   BUG-10: failed_attempts incrementado a cada falha. Após 3 tentativas
//           sem sucesso, marca pending_send=false + failed_at=now() pra
//           parar de tentar e permitir investigação manual.
//   BUG-19: last_flushed_at só é marcado se todos feedbacks tiveram
//           outcome definitivo (enviado OU desistido após 3 tentativas).
//           Se houver falhas transitórias (network/UazAPI), cron volta a
//           tentar no próximo ciclo do dia.
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
  // BUG-09: aceita Pedro (ai_crm_leads.lead_name) ou Marcos (crm_leads.name)
  const leadName = lead?.lead_name || lead?.name || lead?.remote_jid || lead?.phone || "Lead";
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

      // 2. Pega feedbacks pending desse master (inclui crm_lead_id pra BUG-09 + failed_attempts pra BUG-10)
      const { data: feedbacks } = await supabase
        .from("pedro_manager_feedback")
        .select("id, lead_id, crm_lead_id, member_id, content, priority, city, reason, observations, created_at, failed_attempts")
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
      const MAX_FAILED_ATTEMPTS = 3; // BUG-10: limite pra parar de tentar
      let sentCount = 0;
      let failedTransientCount = 0;  // falhas transitorias (network, etc) — re-tentar no proximo ciclo
      let givenUpCount = 0;          // BUG-10: feedbacks que atingiram MAX_FAILED_ATTEMPTS, desistencia final

      // Helper: marca tentativa falha — incrementa failed_attempts e, se atingiu limite, desiste.
      // Retorna 'transient' (vai re-tentar) ou 'given-up' (parou de tentar).
      async function recordFailedAttempt(fbId: string, currentAttempts: number, reason: string): Promise<'transient' | 'given-up'> {
        const next = (currentAttempts || 0) + 1;
        if (next >= MAX_FAILED_ATTEMPTS) {
          await supabase.from("pedro_manager_feedback").update({
            failed_attempts: next,
            failed_at: new Date().toISOString(),
            pending_send: false,
          }).eq("id", fbId);
          console.error(`[cron-flush] feedback ${fbId} desistido após ${next} tentativas. Motivo última: ${reason}`);
          return 'given-up';
        } else {
          await supabase.from("pedro_manager_feedback").update({
            failed_attempts: next,
          }).eq("id", fbId);
          console.warn(`[cron-flush] feedback ${fbId} falhou tentativa ${next}/${MAX_FAILED_ATTEMPTS}. Motivo: ${reason}. Re-tentando próximo ciclo.`);
          return 'transient';
        }
      }

      for (let i = 0; i < feedbacks.length; i++) {
        const fb: any = feedbacks[i];
        try {
          // BUG-09: branch entre Pedro (lead_id → ai_crm_leads) e Marcos (crm_lead_id → crm_leads)
          let lead: any = null;
          let member: any = null;
          if (fb.crm_lead_id) {
            // Marcos
            const [{ data: marcosLead }, memberRes] = await Promise.all([
              supabase.from("crm_leads").select("name, phone").eq("id", fb.crm_lead_id).maybeSingle(),
              fb.member_id
                ? supabase.from("ai_team_members").select("id, name, agent_id, auth_user_id").eq("id", fb.member_id).maybeSingle()
                : Promise.resolve({ data: null }),
            ]);
            lead = marcosLead;
            member = (memberRes as any).data;
          } else {
            // Pedro (padrão)
            const [{ data: pedroLead }, memberRes] = await Promise.all([
              supabase.from("ai_crm_leads").select("lead_name, remote_jid").eq("id", fb.lead_id).maybeSingle(),
              fb.member_id
                ? supabase.from("ai_team_members").select("id, name, agent_id, auth_user_id").eq("id", fb.member_id).maybeSingle()
                : Promise.resolve({ data: null }),
            ]);
            lead = pedroLead;
            member = (memberRes as any).data;
          }

          // Resolve gerente: Marcos via manager_feedback_config.gerente_phone_marcos;
          // Pedro via wa_ai_agents.gerente_phone do agent do member.
          let gerentePhone: string | null = null;
          let instance: any = null;

          if (fb.crm_lead_id) {
            // Marcos: gerente vem da config do master
            const { data: marcosCfg } = await supabase
              .from("manager_feedback_config")
              .select("gerente_phone_marcos")
              .eq("user_id", masterId)
              .maybeSingle();
            gerentePhone = (marcosCfg as any)?.gerente_phone_marcos || null;

            // Instância: tenta vendedor primeiro, depois qualquer ativa do master
            instance = await pickInstance(supabase, member?.auth_user_id, [], null);
            if (!instance) {
              const { data: anyInst } = await supabase
                .from("wa_instances")
                .select("api_url, api_key_encrypted, instance_name")
                .eq("user_id", masterId)
                .eq("is_active", true)
                .eq("status", "connected")
                .order("health_score", { ascending: false })
                .limit(1)
                .maybeSingle();
              instance = anyInst;
            }
          } else {
            // Pedro
            const agentId = member?.agent_id;
            if (!agentId) {
              const status = await recordFailedAttempt(fb.id, fb.failed_attempts, "member sem agent_id");
              if (status === 'given-up') givenUpCount++; else failedTransientCount++;
              continue;
            }
            const { data: agent } = await supabase
              .from("wa_ai_agents")
              .select("gerente_phone, instance_id, instance_ids")
              .eq("id", agentId)
              .maybeSingle();
            gerentePhone = (agent as any)?.gerente_phone || null;
            instance = await pickInstance(
              supabase,
              member?.auth_user_id,
              (agent as any)?.instance_ids || [],
              (agent as any)?.instance_id,
            );
          }

          if (!gerentePhone) {
            const status = await recordFailedAttempt(fb.id, fb.failed_attempts, "gerente_phone nao configurado");
            if (status === 'given-up') givenUpCount++; else failedTransientCount++;
            continue;
          }
          if (!instance) {
            const status = await recordFailedAttempt(fb.id, fb.failed_attempts, "nenhuma instancia WhatsApp ativa");
            if (status === 'given-up') givenUpCount++; else failedTransientCount++;
            continue;
          }

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
            const status = await recordFailedAttempt(fb.id, fb.failed_attempts, `UazAPI ${res.status}`);
            if (status === 'given-up') givenUpCount++; else failedTransientCount++;
          }

          // Delay aleatório (anti-spam) — não delaya após o último
          if (i < feedbacks.length - 1) {
            const delaySec = randomBetween(delayMin, delayMax);
            await sleep(delaySec * 1000);
          }
        } catch (err: any) {
          console.error(`[cron-flush] Erro no feedback ${fb.id}:`, err);
          const status = await recordFailedAttempt(fb.id, fb.failed_attempts, err?.message || "exception");
          if (status === 'given-up') givenUpCount++; else failedTransientCount++;
        }
      }

      // BUG-19: só marcar last_flushed_at se NÃO houver falhas transitórias
      // pendentes. Givenup conta como "definitivo" (pending_send=false já),
      // então não precisa re-tentar. Se houver transient, próximo cron do
      // mesmo dia tenta de novo automaticamente.
      const hasMoreToRetry = failedTransientCount > 0;
      if (!hasMoreToRetry) {
        await supabase.from("manager_feedback_config")
          .update({ last_flushed_at: new Date().toISOString() })
          .eq("user_id", masterId);
      } else {
        console.log(`[cron-flush] master ${masterId}: ${failedTransientCount} feedbacks transitórios — não marcando last_flushed_at, próximo ciclo tenta de novo`);
      }

      report.push({
        master: masterId,
        sent: sentCount,
        failed_transient: failedTransientCount,
        given_up: givenUpCount,
        last_flushed_updated: !hasMoreToRetry,
      });
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
