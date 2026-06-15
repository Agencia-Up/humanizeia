import {
  createServiceClient,
  corsHeaders,
  isPedroV2EnabledForUser,
  isPedroV2MutationEnabled,
  jsonResponse,
  parseJson,
} from "../_shared/pedro-v2/server.ts";
import { processPedroV2Turn } from "../_shared/pedro-v2/orchestrator_20260525_photo_flow.ts";
import { processSofiaTurn } from "../_shared/sofia/orchestrator.ts";
import { logCtwaDiag } from "./ctwaDiag.ts";

const PEDRO_V2_BUILD = "2026-06-15-byok-llm-failure-alert-v115";

function agentUsesInstance(agent: any, instanceId: string): boolean {
  return agent?.instance_id === instanceId ||
    (Array.isArray(agent?.instance_ids) && agent.instance_ids.includes(instanceId)) ||
    agent?.wa_instance_id === instanceId ||
    agent?.whatsapp_instance_id === instanceId;
}

function agentLooksLikePedro(agent: any): boolean {
  const haystack = [
    agent?.name,
    agent?.agent_name,
    agent?.title,
    agent?.description,
    agent?.agent_type,
    agent?.type,
  ].filter(Boolean).join(" ").toLowerCase();

  return haystack.includes("pedro") ||
    haystack.includes("carvalho") ||
    haystack.includes("sdr") ||
    haystack.includes("pre-venda") ||
    haystack.includes("pré-venda");
}

function pickIncomingMessage(payload: any): any {
  if (Array.isArray(payload?.messages) && payload.messages.length > 0) return payload.messages[0];
  if (Array.isArray(payload?.data) && payload.data.length > 0) return payload.data[0];
  return payload?.message || payload?.data || payload;
}

function isOutgoingMessage(payload: any): boolean {
  const message = pickIncomingMessage(payload);
  return message?.fromMe === true || message?.key?.fromMe === true || payload?.fromMe === true;
}

// ── Connection/status event helpers ──────────────────────────────────────────
// UaZapi (and the legacy Evolution format) report connection state via a
// dedicated event, NOT a chat message. The v1 webhook (uazapi-webhook) handled
// this; v2 never did. Mirror v1 so a brand-new instance gets flipped to
// connected once the seller scans the QR.
function getEventType(payload: any): string {
  return String(
    payload?.EventType ||
    payload?.eventType ||
    payload?.event ||
    payload?.type ||
    "",
  ).toLowerCase();
}

function isConnectionEvent(payload: any): boolean {
  const eventType = getEventType(payload);
  if (!eventType) return false;
  return (
    eventType === "connection" ||
    eventType === "status" ||
    eventType.includes("connect") // covers "connection.update" / "connection_update"
  );
}

function extractConnectionState(payload: any): string {
  const data =
    payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? payload.data
      : {};
  return String(
    payload?.state ||
    payload?.status ||
    data?.state ||
    data?.status ||
    "",
  ).toLowerCase();
}

function extractConnectionInstanceName(payload: any): string | null {
  const candidates = [
    payload?.instance,
    payload?.instanceName,
    payload?.instance_name,
    payload?.InstanceId,
    payload?.instanceId,
    payload?.data?.instance,
    payload?.data?.instanceName,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = createServiceClient();
  const payload = await parseJson(req);

  // FASE 0 CTWA (TEMPORÁRIO): grava o payload podado na tabela ctwa_diag_capture
  // SOMENTE quando há marcador de anúncio/Click-to-WhatsApp, pra confirmar o
  // caminho EXATO do referral que o uazapi entrega. Nunca lança, nunca altera o
  // fluxo (só faz I/O em mensagem de anúncio). Remover após a Fase 1.
  await logCtwaDiag(supabase, payload);

  // ── PRESENCE (digitando/gravando): alimenta wa_lead_presence pro debounce do Pedro v2 ESPERAR
  // o lead terminar antes de responder (uazapi manda EventType="presence" com event.State =
  // composing|recording|paused|available). So edge functions leem/escrevem. Early-return — NAO e
  // mensagem. try/catch: se a tabela ainda nao existe, ignora (debounce cai no fixo). ──
  if (getEventType(payload) === "presence") {
    try {
      const ev = (payload?.event && typeof payload.event === "object") ? payload.event : {};
      const jid = String(ev?.sender_pn || ev?.Chat || ev?.chatid || ev?.Sender || "").trim();
      const state = String(ev?.State || "").toLowerCase().trim();
      const instName = String(payload?.instanceName || payload?.instance_name || payload?.instance || "").trim();
      if (jid && state && instName && ev?.IsFromMe !== true && !jid.endsWith("@g.us")) {
        await supabase.from("wa_lead_presence").upsert(
          { instance_name: instName, remote_jid: jid, state, updated_at: new Date().toISOString() },
          { onConflict: "instance_name,remote_jid" },
        );
      }
    } catch (_e) { /* tabela pode nao existir ainda; nunca bloqueia */ }
    return jsonResponse({ ok: true, event: "presence" });
  }

  // ── Connection/status events ──────────────────────────────────────────────
  // Must be handled BEFORE the message path: a brand-new instance is created
  // with is_active=false, so the message lookup (which requires is_active=true)
  // would 404 and the instance would never be marked connected. Here we look up
  // by instance_name WITHOUT the is_active filter and flip it on open/connected.
  if (isConnectionEvent(payload)) {
    const connInstanceName = extractConnectionInstanceName(payload);
    const state = extractConnectionState(payload);
    if (connInstanceName && (state === "open" || state === "connected")) {
      const { error: connError } = await supabase
        .from("wa_instances")
        .update({ is_active: true, status: "connected", updated_at: new Date().toISOString() })
        .eq("instance_name", connInstanceName);
      console.log(
        `[pedro-webhook-v2] connection event instance=${connInstanceName} state=${state} -> ${connError ? "ERROR " + connError.message : "marked connected"}`,
      );
    } else {
      console.log(
        `[pedro-webhook-v2] connection event instance=${connInstanceName ?? "?"} state=${state || "?"} -> no-op`,
      );
    }
    return jsonResponse({ ok: true, event: "connection", state: state || null });
  }

  if (isOutgoingMessage(payload)) {
    return jsonResponse({ ok: true, ignored: "from_me" });
  }

  const instanceName =
    payload?.instanceName ||
    payload?.instance_name ||
    payload?.instance ||
    payload?.data?.instanceName ||
    payload?.data?.instance ||
    null;

  if (!instanceName) return jsonResponse({ ok: false, error: "instance_missing" }, 400);

  const { data: waInstance, error: instanceError } = await supabase
    .from("wa_instances")
    .select("*")
    .eq("instance_name", instanceName)
    .eq("is_active", true)
    .maybeSingle();

  if (instanceError || !waInstance) {
    return jsonResponse({ ok: false, error: "active_instance_not_found" }, 404);
  }

  // ── HARD RULE: a seller's number is NEVER answered by the AI ────────────────
  // Only the master's configured number (the instance linked inside the AI agent)
  // may run Pedro. Seller instances always carry seller_member_id: they connect
  // and show "connected" for the seller's own manual use, but must NEVER be
  // hijacked by the AI. Without this guard the agent lookup below falls back to
  // the master's Pedro agent (agentLooksLikePedro / activeAgents[0]) and answers
  // on the seller's line. The v1 webhook (uazapi-webhook) avoids this by REQUIRING
  // .contains('instance_ids', [instance.id]); v2 lost that guard.
  // ── HARD RULE: a seller's number is NEVER answered by the AI ────────────────
  // Only the master's configured number (the instance linked inside the AI agent)
  // may run Pedro. Seller instances always carry seller_member_id: they connect
  // and show "connected" for the seller's own manual use, but must NEVER be
  // hijacked by the AI.
  //
  // FIX: Embora a IA nunca responda, precisamos registrar as mensagens que passam
  // por aqui na tabela wa_inbox para que o Inbox do Vendedor no portal funcione.
  if (waInstance.seller_member_id) {
    try {
      const inMsg = pickIncomingMessage(payload);
      
      // 1. Resolver JID real tratando LIDs de privacidade do WhatsApp
      let remoteJidRaw =
        inMsg?.key?.remoteJid || inMsg?.chatid || inMsg?.sender || inMsg?.from || payload?.chatid || "";
      
      if (String(remoteJidRaw).endsWith("@lid")) {
        const altRaw = String(
          inMsg?.key?.remoteJidAlt ||
          inMsg?.remoteJidAlt ||
          inMsg?.key?.senderPn ||
          inMsg?.senderPn ||
          payload?.remoteJidAlt ||
          payload?.senderPn ||
          ""
        );
        if (altRaw.endsWith("@s.whatsapp.net")) {
          remoteJidRaw = altRaw;
        } else {
          const altDigits = altRaw.replace(/\D/g, "");
          if (altDigits.length >= 10) {
            remoteJidRaw = `${altDigits}@s.whatsapp.net`;
          }
        }
      }

      // 2. Extrair apenas o telefone no formato DDD + número (com DDI 55)
      const phoneOnly = String(remoteJidRaw).replace(/@.*$/, "").replace(/\D/g, "");

      if (phoneOnly) {
        // 3. Identificar se a mensagem veio do vendedor (outgoing) ou do lead (incoming)
        const fromMe = inMsg?.key?.fromMe === true || inMsg?.fromMe === true;
        const direction = fromMe ? "outgoing" : "incoming";
        const isRead = fromMe; // Mensagens enviadas pelo vendedor são marcadas como lidas por padrão

        // 4. Mapear tipos de mídias e extrair URLs de anexo
        let mediaUrl: string | null = null;
        let messageType = "text";
        
        const isImage = String(inMsg?.messageType || "").toLowerCase().includes("image") || !!inMsg?.message?.imageMessage;
        const isAudio = String(inMsg?.messageType || "").toLowerCase().includes("audio") || String(inMsg?.messageType || "").toLowerCase().includes("ptt") || !!inMsg?.message?.audioMessage;
        const isVideo = String(inMsg?.messageType || "").toLowerCase().includes("video") || !!inMsg?.message?.videoMessage;
        const isDocument = String(inMsg?.messageType || "").toLowerCase().includes("document") || !!inMsg?.message?.documentMessage;

        if (isImage) {
          messageType = "image";
          mediaUrl = inMsg?.mediaUrl || inMsg?.directUrl || inMsg?.media_url || inMsg?.url || inMsg?.message?.imageMessage?.url || null;
        } else if (isAudio) {
          messageType = "audio";
          mediaUrl = inMsg?.mediaUrl || inMsg?.directUrl || inMsg?.media_url || inMsg?.url || inMsg?.message?.audioMessage?.url || null;
        } else if (isVideo) {
          messageType = "video";
          mediaUrl = inMsg?.mediaUrl || inMsg?.directUrl || inMsg?.media_url || inMsg?.url || inMsg?.message?.videoMessage?.url || null;
        } else if (isDocument) {
          messageType = "document";
          mediaUrl = inMsg?.mediaUrl || inMsg?.directUrl || inMsg?.media_url || inMsg?.url || inMsg?.message?.documentMessage?.url || null;
        }

        // 5. Extrair o conteúdo textual (com fallback descritivo para mídias sem legenda)
        const rawText =
          inMsg?.message?.conversation || 
          inMsg?.message?.extendedTextMessage?.text ||
          inMsg?.message?.imageMessage?.caption ||
          inMsg?.message?.videoMessage?.caption ||
          inMsg?.text || inMsg?.body || inMsg?.caption || inMsg?.content;

        let inboxText = "";
        if (typeof rawText === "string" && rawText.trim()) {
          inboxText = rawText.trim();
        } else {
          if (messageType === "image") inboxText = "[imagem recebida]";
          else if (messageType === "audio") inboxText = "[áudio recebido]";
          else if (messageType === "video") inboxText = "[vídeo recebido]";
          else if (messageType === "document") inboxText = "[documento recebido]";
          else inboxText = "[midia recebida]";
        }

        const inboxMsgId = inMsg?.key?.id || inMsg?.messageid || inMsg?.id || null;
        const pushNm = inMsg?.pushName || inMsg?.senderName || inMsg?.notifyName || null;

        // 6. Persistir no banco de dados (o índice único wa_inbox_remote_msg_unique evitará duplicidades)
        await supabase.from("wa_inbox").insert({
          user_id: waInstance.user_id,
          instance_id: waInstance.id,
          phone: phoneOnly,
          contact_name: pushNm,
          direction: direction,
          message_type: messageType,
          content: inboxText,
          media_url: mediaUrl,
          is_read: isRead,
          is_archived: false,
          remote_message_id: typeof inboxMsgId === "string" ? inboxMsgId : null,
        });
      }
    } catch (e) {
      console.error("[pedro-webhook-v2] [SELLER-INBOX-ONLY] erro ao gravar no wa_inbox:", (e as any)?.message || e);
    }
    
    return jsonResponse({ ok: true, ignored: "seller_instance_inbox_only", instance: instanceName });
  }

  const gate = await isPedroV2EnabledForUser(supabase, waInstance.user_id);
  if (!gate.enabled) {
    return jsonResponse({
      ok: false,
      disabled: true,
      reason: gate.reason,
      message:
        "Pedro v2 is disabled for this user. Use PEDRO_V2_ALLOWED_USER_EMAILS/IDS for controlled tests or PEDRO_V2_ENABLED for global rollout.",
    }, 423);
  }

  const { data: agents, error: agentError } = await supabase
    .from("wa_ai_agents")
    .select("*")
    .eq("user_id", waInstance.user_id)
    .eq("is_active", true);

  const activeAgents = Array.isArray(agents) ? agents : [];
  const agent =
    activeAgents.find((item) => agentUsesInstance(item, waInstance.id)) ||
    activeAgents.find(agentLooksLikePedro) ||
    activeAgents[0] ||
    null;

  if (agentError || !agent) {
    return jsonResponse({ ok: false, error: "active_agent_not_found" }, 404);
  }

  // ── Roteamento por tipo de agente ──────────────────────────────────────────
  // "SDR - Geral" (agent_type='sdr_geral') usa o cérebro da SOFIA (qualifica +
  // agenda reunião, sem BNDV). Qualquer outro tipo segue no Pedro v2 (automóveis).
  // Isolado em módulo próprio (_shared/sofia/) -> zero impacto no fluxo do Pedro.
  if (agent?.agent_type === "sdr_geral") {
    const sofiaResult = await processSofiaTurn(supabase, {
      payload,
      agent,
      wa_instance: waInstance,
      dry_run: payload?.dry_run === true || !isPedroV2MutationEnabled(),
    });
    return jsonResponse(
      { ...sofiaResult, build: PEDRO_V2_BUILD, gate: { reason: gate.reason } },
      sofiaResult.ok ? 200 : 400,
    );
  }

  const result = await processPedroV2Turn(supabase, {
    payload,
    agent,
    wa_instance: waInstance,
    dry_run: payload?.dry_run === true || !isPedroV2MutationEnabled(),
  });

  return jsonResponse({ ...result, build: PEDRO_V2_BUILD, gate: { reason: gate.reason } }, result.ok ? 200 : 400);
});
