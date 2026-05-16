/**
 * pedro-trigger-followup
 *
 * Disparo MANUAL (pelo botão na tab CRM Avançado do Pedro).
 * Varre `pedro_followup_schedules` por agendamentos pendentes
 * (status='pending') com scheduled_at ≤ now e envia via UazAPI,
 * usando o mesmo padrão de envio do wa-inbox-webhook (sendAutoReply).
 *
 * Fluxo:
 *   1. Busca agendamentos pendentes (com ou sem instance_id)
 *   2. Se sem instance_id, resolve via agente IA do lead
 *   3. Para cada um, envia mensagem via UazAPI
 *   4. Marca como 'sent' (sucesso) ou 'failed' (falha)
 *   5. Persiste a mensagem em wa_chat_history
 *   6. Atualiza last_followup_at no lead
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Envio via UazAPI (mesmo padrão do wa-inbox-webhook) ─────────────────────

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
      const errBody = await res.text().catch(() => "");
      console.error(`[followup] UazAPI send error (${attempt.url}): ${res.status} - ${errBody}`);
    } catch (err) {
      console.error(`[followup] UazAPI send exception (${attempt.url}):`, err);
    }
  }
  return false;
}

// Envia mídia (imagem, áudio, vídeo) via UazAPI V6
// Endpoint unificado: /send/media (os antigos /send/image, /send/audio, /send/video retornam 405)
async function sendUazapiMediaMessage(
  baseUrl: string,
  instKey: string,
  _instanceName: string,
  phoneNumber: string,
  remoteJid: string,
  mediaUrl: string,
  mediaType: string, // 'image' | 'audio' | 'video'
  caption?: string,
): Promise<boolean> {
  const attempts = [
    {
      url: `${baseUrl}/send/media`,
      body: { number: phoneNumber, url: mediaUrl, type: mediaType, caption: caption || "" },
    },
    {
      url: `${baseUrl}/send/media`,
      body: { number: phoneNumber, media: mediaUrl, mediatype: mediaType, caption: caption || "" },
    },
    {
      url: `${baseUrl}/send/media`,
      body: { remoteJid, url: mediaUrl, type: mediaType, caption: caption || "" },
    },
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "token": instKey, "apikey": instKey },
        body: JSON.stringify(attempt.body),
      });
      if (res.ok) return true;
      const errBody = await res.text().catch(() => "");
      console.error(`[followup] UazAPI media error (${attempt.url}): ${res.status} - ${errBody}`);
    } catch (err) {
      console.error(`[followup] UazAPI media exception (${attempt.url}):`, err);
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

    // 1. Busca TODOS os agendamentos pendentes (com ou sem instance_id)
    const { data: schedules, error: fetchErr } = await supabase
      .from("pedro_followup_schedules")
      .select(`
        *,
        lead:ai_crm_leads(id, remote_jid, agent_id, user_id)
      `)
      .eq("status", "pending")
      .lte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(30);

    if (fetchErr) throw fetchErr;

    let processed = 0;
    let failed    = 0;
    const pedroProcessedStart = processed;
    const pedroFailedStart = failed;

    // Cache de instâncias para evitar queries repetidas
    const instanceCache: Record<string, any> = {};

    for (const schedule of schedules || []) {
      try {
        const lead = (schedule as any).lead;

        if (!lead?.remote_jid) {
          await supabase.from("pedro_followup_schedules")
            .update({ status: "cancelled" })
            .eq("id", schedule.id);
          failed++;
          continue;
        }

        // 2. Resolve a instância: usa instance_id do schedule, ou busca do agente do lead
        let instance: any = null;

        if (schedule.instance_id) {
          if (instanceCache[schedule.instance_id]) {
            instance = instanceCache[schedule.instance_id];
          } else {
            const { data: inst } = await supabase
              .from("wa_instances")
              .select("id, api_url, api_key_encrypted, instance_name")
              .eq("id", schedule.instance_id)
              .single();
            instance = inst;
            if (inst) instanceCache[schedule.instance_id] = inst;
          }
        }

        // Fallback: busca instância do agente IA do lead
        if (!instance && lead.agent_id) {
          const { data: agent } = await supabase
            .from("wa_ai_agents")
            .select("instance_id, instance_ids")
            .eq("id", lead.agent_id)
            .single();

          if (agent) {
            const agentInstId = agent.instance_id
              || (Array.isArray(agent.instance_ids) && agent.instance_ids.length > 0 ? agent.instance_ids[0] : null);

            if (agentInstId && !instanceCache[agentInstId]) {
              const { data: inst } = await supabase
                .from("wa_instances")
                .select("id, api_url, api_key_encrypted, instance_name")
                .eq("id", agentInstId)
                .single();
              if (inst) instanceCache[agentInstId] = inst;
              instance = inst;
            } else if (agentInstId) {
              instance = instanceCache[agentInstId];
            }
          }
        }

        // Último fallback: busca qualquer instância ativa do user_id do lead
        if (!instance && lead.user_id) {
          const { data: fallbackInst } = await supabase
            .from("wa_instances")
            .select("id, api_url, api_key_encrypted, instance_name")
            .eq("user_id", lead.user_id)
            .eq("is_active", true)
            .limit(1)
            .single();
          if (fallbackInst) {
            instance = fallbackInst;
            instanceCache[fallbackInst.id] = fallbackInst;
          }
        }

        if (!instance?.api_url) {
          console.error(`[followup] No instance found for schedule ${schedule.id}`);
          await supabase.from("pedro_followup_schedules")
            .update({ status: "failed" })
            .eq("id", schedule.id);
          failed++;
          continue;
        }

        // 3. Extrai dados de envio
        const baseUrl     = instance.api_url.replace(/\/+$/, "");
        const instKey     = instance.api_key_encrypted || "";
        const instName    = instance.instance_name || "";
        const remoteJid   = lead.remote_jid;
        const phoneNumber = remoteJid.split("@")[0];

        // 4. Envia via UazAPI (com ou sem mídia)
        let sent = false;
        const hasMedia = schedule.media_url && schedule.media_type;

        if (hasMedia) {
          sent = await sendUazapiMediaMessage(
            baseUrl, instKey, instName, phoneNumber, remoteJid,
            schedule.media_url, schedule.media_type,
            schedule.message_template,
          );
          // Se mídia falhar, tenta enviar só texto
          if (!sent) {
            sent = await sendUazapiTextMessage(
              baseUrl, instKey, instName, phoneNumber, remoteJid,
              schedule.message_template,
            );
          }
        } else {
          sent = await sendUazapiTextMessage(
            baseUrl, instKey, instName, phoneNumber, remoteJid,
            schedule.message_template,
          );
        }

        if (!sent) {
          await supabase.from("pedro_followup_schedules")
            .update({ status: "failed" })
            .eq("id", schedule.id);
          failed++;
          continue;
        }

        // 5. Marca como enviado
        await supabase.from("pedro_followup_schedules")
          .update({ status: "sent", sent_at: nowIso })
          .eq("id", schedule.id);

        // 6. Atualiza last_followup_at no lead + persiste no histórico de chat
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

    const pedroProcessed = processed - pedroProcessedStart;
    const pedroFailed = failed - pedroFailedStart;
    const marcosProcessedStart = processed;
    const marcosFailedStart = failed;

    // Marcos: fila de follow-up somente envio. Nao conversa, nao chama IA.
    const { data: marcosSchedules, error: marcosFetchErr } = await supabase
      .from("marcos_followup_schedules")
      .select(`
        *,
        lead:crm_leads(id, name, phone, user_id, assigned_to)
      `)
      .eq("status", "pending")
      .lte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(30);

    if (marcosFetchErr) throw marcosFetchErr;

    for (const schedule of marcosSchedules || []) {
      try {
        const lead = (schedule as any).lead;
        const digits = String(lead?.phone || "").replace(/\D/g, "");

        if (!lead?.id || !digits) {
          await supabase.from("marcos_followup_schedules")
            .update({ status: "cancelled" })
            .eq("id", schedule.id);
          failed++;
          continue;
        }

        let instance: any = null;
        if (schedule.instance_id) {
          if (instanceCache[schedule.instance_id]) {
            instance = instanceCache[schedule.instance_id];
          } else {
            const { data: inst } = await supabase
              .from("wa_instances")
              .select("id, api_url, api_key_encrypted, instance_name")
              .eq("id", schedule.instance_id)
              .single();
            instance = inst;
            if (inst) instanceCache[schedule.instance_id] = inst;
          }
        }

        const sellerMemberId = schedule.member_id || lead.assigned_to || null;
        if (!instance && lead.user_id && sellerMemberId) {
          const cacheKey = `marcos-seller:${lead.user_id}:${sellerMemberId}`;
          if (instanceCache[cacheKey]) {
            instance = instanceCache[cacheKey];
          } else {
            const { data: sellerInst } = await supabase
              .from("wa_instances")
              .select("id, api_url, api_key_encrypted, instance_name")
              .eq("user_id", lead.user_id)
              .eq("seller_member_id", sellerMemberId)
              .eq("is_active", true)
              .limit(1)
              .maybeSingle();
            if (sellerInst) {
              instance = sellerInst;
              instanceCache[cacheKey] = sellerInst;
            }
          }
        }

        if (!instance && lead.user_id) {
          const cacheKey = `marcos-master:${lead.user_id}`;
          if (instanceCache[cacheKey]) {
            instance = instanceCache[cacheKey];
          } else {
            const { data: masterInst } = await supabase
              .from("wa_instances")
              .select("id, api_url, api_key_encrypted, instance_name")
              .eq("user_id", lead.user_id)
              .is("seller_member_id", null)
              .eq("is_active", true)
              .limit(1)
              .maybeSingle();
            if (masterInst) {
              instance = masterInst;
              instanceCache[cacheKey] = masterInst;
            }
          }
        }

        if (!instance?.api_url) {
          console.error(`[marcos-followup] No instance found for schedule ${schedule.id}`);
          await supabase.from("marcos_followup_schedules")
            .update({ status: "failed" })
            .eq("id", schedule.id);
          failed++;
          continue;
        }

        const baseUrl = instance.api_url.replace(/\/+$/, "");
        const instKey = instance.api_key_encrypted || "";
        const instName = instance.instance_name || "";
        const remoteJid = `${digits}@s.whatsapp.net`;

        const hasMedia = schedule.media_url && schedule.media_type;
        let sent = false;
        if (hasMedia) {
          sent = await sendUazapiMediaMessage(
            baseUrl, instKey, instName, digits, remoteJid,
            schedule.media_url, schedule.media_type,
            schedule.message_template,
          );
          if (!sent) {
            sent = await sendUazapiTextMessage(baseUrl, instKey, instName, digits, remoteJid, schedule.message_template);
          }
        } else {
          sent = await sendUazapiTextMessage(baseUrl, instKey, instName, digits, remoteJid, schedule.message_template);
        }

        if (!sent) {
          await supabase.from("marcos_followup_schedules")
            .update({ status: "failed" })
            .eq("id", schedule.id);
          failed++;
          continue;
        }

        await Promise.all([
          supabase.from("marcos_followup_schedules")
            .update({ status: "sent", sent_at: nowIso })
            .eq("id", schedule.id),
          supabase.from("wa_chat_history").insert({
            user_id: schedule.user_id,
            agent_id: null,
            instance_id: instName,
            remote_jid: remoteJid,
            role: "assistant",
            content: `[Follow-up Marcos] ${schedule.message_template}`,
          }),
        ]);

        processed++;
      } catch (err) {
        console.error(`[marcos-followup] Erro no agendamento ${(schedule as any).id}:`, err);
        failed++;
      }
    }

    const marcosProcessed = processed - marcosProcessedStart;
    const marcosFailed = failed - marcosFailedStart;

    return new Response(
      JSON.stringify({ ok: true, processed, failed, pedroProcessed, pedroFailed, marcosProcessed, marcosFailed }),
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
