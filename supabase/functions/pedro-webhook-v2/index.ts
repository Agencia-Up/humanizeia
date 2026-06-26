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
import { agentUsesInstance, agentLooksLikePedro, selectActiveAgent } from "../_shared/pedro-v2/webhookRouting.ts";
import { logCtwaDiag } from "./ctwaDiag.ts";

const PEDRO_V2_BUILD = "2026-06-26-no-perder-trilho-troca-v213";

function pickIncomingMessage(payload: any): any {
  if (Array.isArray(payload?.messages) && payload.messages.length > 0) return payload.messages[0];
  if (Array.isArray(payload?.data) && payload.data.length > 0) return payload.data[0];
  return payload?.message || payload?.data || payload;
}

function isOutgoingMessage(payload: any): boolean {
  const message = pickIncomingMessage(payload);
  return message?.fromMe === true || message?.key?.fromMe === true || payload?.fromMe === true;
}

// REAÇÃO do WhatsApp (👍/❤️/😂 numa mensagem) NÃO é uma mensagem do lead — é só um "ack". O uazapi V6 manda
// como messageType "ReactionMessage" e o emoji vira "text"; tratar como texto fazia o agente ler "👍" como
// "sim" e AGIR (caso real 99146-6876: o lead reagiu e o agente TRANSFERIU). Detecta por messageType (em
// qualquer nível do payload) ou pelo objeto reaction/reactionMessage.
function isReactionMessage(payload: any): boolean {
  const m = pickIncomingMessage(payload);
  const typeStr = [
    m?.messageType, m?.type, m?.message?.messageType,
    payload?.messageType, payload?.type,
    payload?.data?.messageType, payload?.data?.type, payload?.data?.message?.messageType,
  ].map((v) => String(v || "").toLowerCase()).join(" ");
  if (typeStr.includes("reaction")) return true;
  return Boolean(
    m?.reaction || m?.message?.reactionMessage || payload?.reaction ||
    payload?.message?.reactionMessage || payload?.data?.reaction || payload?.data?.message?.reactionMessage,
  );
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

  // ── REAÇÃO (👍/❤️ etc.) -> IGNORAR (sem turno, sem resposta) ──────────────────────────────────────
  // Decisão do dono (caso 99146-6876): reação NÃO pode disparar ação. É só um "ack" do lead numa mensagem
  // nossa — não é pergunta nem pedido. Tratar como texto fazia o agente ler "👍" como "sim" e transferir.
  if (isReactionMessage(payload)) {
    console.log(`[pedro-webhook-v2] reaction ignored (no turn)`);
    return jsonResponse({ ok: true, ignored: "reaction" });
  }

  // NÃO descartar fromMe aqui — instâncias de VENDEDOR precisam capturar o que o
  // vendedor envia (auditoria). O descarte de fromMe acontece ABAIXO, escopado às
  // instâncias que NÃO são de vendedor, depois de resolver a instância.

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

  // fromMe: nas instâncias do AGENTE ignoramos os próprios envios (a IA não reage ao
  // que foi enviado pela própria linha). Nas instâncias de VENDEDOR NÃO ignoramos —
  // o ramo abaixo grava a resposta do vendedor (outgoing) p/ o gerente auditar.
  if (isOutgoingMessage(payload) && !waInstance.seller_member_id) {
    return jsonResponse({ ok: true, ignored: "from_me" });
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

  const { data: allAgents, error: agentError } = await supabase
    .from("wa_ai_agents")
    .select("*")
    .eq("user_id", waInstance.user_id);

  const agentsList = Array.isArray(allAgents) ? allAgents : [];
  const agent = selectActiveAgent(agentsList, waInstance.id);

  if (agentError || !agent) {
    console.log(`[Webhook] Nenhum agente ativo encontrado para a instância ${waInstance.id} (Carvalho copia)`);
    return jsonResponse({ ok: true, ignored: "agent_not_found_or_inactive", instance: instanceName });
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

  // FUNIL ESTRUTURADO do cliente (agent_funnel_config.bloco4) -> usado pra FORCAR as perguntas
  // obrigatorias do funil quando o LLM nao conduz (decisao do dono: "o prompt manda seguir os passos
  // e ele nao faz, temos que forcar"). Best-effort: sem config, o funil fica so no prompt.
  try {
    const { data: _fc } = await supabase.from("agent_funnel_config")
      .select("bloco4_qualificacao").eq("agent_id", agent.id).maybeSingle();
    if (_fc?.bloco4_qualificacao) (agent as any).funnel_bloco4 = _fc.bloco4_qualificacao;
  } catch (_fcErr) { /* funil estruturado é opcional */ }

  const _dryRun = payload?.dry_run === true || !isPedroV2MutationEnabled();
  const _turnInput = { payload, agent, wa_instance: waInstance, dry_run: _dryRun };

  // SAFETY NET (Maria Rosa): um turno que LANCA nunca pode sumir — registra turn_uncaught_error.
  const _logTurnError = async (turnErr: unknown) => {
    const _msg = pickIncomingMessage(payload);
    try {
      await supabase.from("pedro_v2_turn_logs").insert({
        user_id: (agent as any)?.user_id || null,
        agent_id: (agent as any)?.id || null,
        remote_jid: String(payload?.message?.sender_pn || _msg?.chatid || _msg?.sender_pn || "").slice(0, 120) || null,
        intent: null,
        next_action: "turn_uncaught_error",
        dry_run: false,
        payload: { text: String(_msg?.text || payload?.message?.text || "").slice(0, 500) },
        result: null,
        error: String((turnErr as any)?.stack || (turnErr as any)?.message || turnErr).slice(0, 4000),
      });
    } catch (_logErr) { /* nunca derruba */ }
    console.error("[pedro-webhook-v2] turn_uncaught_error", turnErr);
  };

  // ⚠️ ANTI-DROP DE MENSAGEM (lead Gilda 99175-5700 + ~20% dos leads não respondidos): o webhook AWAITAVA
  // o turno inteiro (incl. debounce de ATÉ 45s + LLM). Se o uazapi (caller) dava TIMEOUT e desconectava
  // nesse meio-tempo, o Supabase MATAVA a function -> msg salva mas turno NÃO completava, lead SEM resposta
  // (a function MORTA não dispara o safety-net acima, que só pega exceção JS). FIX=responder 200 RÁPIDO e
  // processar em EdgeRuntime.waitUntil (o Supabase mantém a function viva após o 200) -> sem timeout do
  // uazapi, sem desconexão, o turno SEMPRE completa. Dry-run segue awaited (o teste precisa do resultado).
  const _waitUntil = (globalThis as any).EdgeRuntime?.waitUntil?.bind((globalThis as any).EdgeRuntime);
  if (!_dryRun && typeof _waitUntil === "function") {
    _waitUntil(processPedroV2Turn(supabase, _turnInput).catch(_logTurnError));
    return jsonResponse({ ok: true, accepted: true, build: PEDRO_V2_BUILD });
  }

  let result;
  try {
    result = await processPedroV2Turn(supabase, _turnInput);
  } catch (turnErr) {
    await _logTurnError(turnErr);
    return jsonResponse({ ok: false, error: "turn_failed", build: PEDRO_V2_BUILD }, 200);
  }

  return jsonResponse({ ...result, build: PEDRO_V2_BUILD, gate: { reason: gate.reason } }, result.ok ? 200 : 400);
});
