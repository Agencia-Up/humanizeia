/**
 * pedro-trigger-followup
 *
 * Disparo MANUAL (pelo botão na tab CRM Avançado do Pedro).
 * Varre `pedro_followup_schedules` por agendamentos pendentes
 * (status='pending') com scheduled_at ≤ now e envia via Evolution API,
 * usando o mesmo padrão de envio do wa-send-reply.
 *
 * Fluxo:
 *   1. Busca agendamentos pendentes (com ou sem instance_id)
 *   2. Se sem instance_id, resolve via agente IA do lead
 *   3. Para cada um, envia mensagem via Evolution API
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

// ── Envio via Evolution API (mesmo padrão do wa-send-reply) ─────────────────

async function sendEvolutionText(
  apiUrl: string,
  apiKey: string,
  instanceName: string,
  phoneNumber: string,
  text: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/message/sendText/${instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({ number: phoneNumber, text }),
    });
    if (res.ok) return true;
    const errBody = await res.text().catch(() => "");
    console.error(`[followup] Evolution sendText error: ${res.status} - ${errBody}`);
    return false;
  } catch (err) {
    console.error("[followup] Evolution sendText exception:", err);
    return false;
  }
}

async function sendEvolutionMedia(
  apiUrl: string,
  apiKey: string,
  instanceName: string,
  phoneNumber: string,
  mediaUrl: string,
  mediaType: string,
  caption?: string,
): Promise<boolean> {
  const endpointMap: Record<string, string> = {
    image: "sendImage",
    audio: "sendAudio",
    video: "sendVideo",
  };
  const endpoint = endpointMap[mediaType] || "sendImage";

  try {
    const res = await fetch(`${apiUrl}/message/${endpoint}/${instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({
        number: phoneNumber,
        mediatype: mediaType,
        media: mediaUrl,
        caption: caption || "",
      }),
    });
    if (res.ok) return true;
    const errBody = await res.text().catch(() => "");
    console.error(`[followup] Evolution ${endpoint} error: ${res.status} - ${errBody}`);
    return false;
  } catch (err) {
    console.error(`[followup] Evolution ${endpoint} exception:`, err);
    return false;
  }
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

    if (!schedules || schedules.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, failed: 0 }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let processed = 0;
    let failed    = 0;

    // Cache de instâncias para evitar queries repetidas
    const instanceCache: Record<string, any> = {};

    for (const schedule of schedules) {
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
          // Usa instância especificada
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

        if (!instance?.api_url || !instance?.instance_name) {
          console.error(`[followup] No instance found for schedule ${schedule.id}`);
          await supabase.from("pedro_followup_schedules")
            .update({ status: "failed" })
            .eq("id", schedule.id);
          failed++;
          continue;
        }

        // 3. Extrai dados de envio
        const baseUrl     = instance.api_url.replace(/\/+$/, "");
        const apiKey      = instance.api_key_encrypted || "";
        const instName    = instance.instance_name;
        const remoteJid   = lead.remote_jid;
        const phoneNumber = remoteJid.split("@")[0];

        // 4. Envia via Evolution API (mesmo padrão do wa-send-reply)
        let sent = false;
        const hasMedia = schedule.media_url && schedule.media_type;

        if (hasMedia) {
          sent = await sendEvolutionMedia(
            baseUrl, apiKey, instName, phoneNumber,
            schedule.media_url, schedule.media_type,
            schedule.message_template,
          );
          // Se mídia falhar, tenta enviar só texto
          if (!sent) {
            sent = await sendEvolutionText(
              baseUrl, apiKey, instName, phoneNumber,
              schedule.message_template,
            );
          }
        } else {
          sent = await sendEvolutionText(
            baseUrl, apiKey, instName, phoneNumber,
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
            content:     `[Follow-up] ${schedule.message_template}`,
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
