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
import { agentUsesInstance, agentLooksLikePedro, selectActiveAgent, shouldNamespaceConversationByInstance } from "../_shared/pedro-v2/webhookRouting.ts";
import { evaluatePedroV3PilotAgent, parsePedroV3ActiveScopes, PEDRO_V3_ONLY } from "../_shared/pedro-v2/pedroV3PilotGate.ts";
import { bridgePedroV3BeforeAck, buildPedroV3BridgeTurn, buildPedroV3DeliveryReceipt, callPedroV3Bridge, callPedroV3ReceiptBridge, enrichAdReferralWithSemanticContext, incomingRemoteJid, provisionalPedroV3MediaContext, shouldIgnorePedroInternalIdentity, type PedroV3MediaContext, type PedroV3AdReferral } from "../_shared/pedro-v2/pedroV3Bridge.ts";
import { identifyPedroContact } from "../_shared/pedro-v2/contactIdentity.ts";
import { resolveUazapiPhone, resolveUazapiText } from "../_shared/pedro-v2/phone.ts";
import { handleSellerInbound } from "../_shared/pedro-v2/transferRouter.ts";
import { classifyUazapiInboundAudience } from "../_shared/pedro-v2/inboundAudience.ts";
import { persistPrivateInboundMessage } from "../_shared/pedro-v2/persistPrivateInbound.ts";
import { ensureInactiveAgentHumanMode } from "../_shared/pedro-v2/humanOnlyInbound.ts";
import {
  executePostTransferPlan,
  resolvePostTransferPlan,
  sendLeadTransferConfirmationReceipt,
} from "../_shared/pedro-v2/postTransferOwnership.ts";
import { sendPedroText } from "../_shared/pedro-v2/uazapiSender_20260524.ts";
import { logCtwaDiag } from "./ctwaDiag.ts";
import { resolvePedroMediaContext } from "../_shared/pedro-v2/mediaContext_20260524.ts";
import { resolvePedroV3AdSemantic } from "../_shared/pedro-v2/pedroV3AdSemantic.ts";
import { isAccountGrandfathered, resolveAiKey } from "../_shared/aiKeys.ts";

const PEDRO_V2_BUILD = "2026-07-30-inactive-human-mode-v225";

function pickIncomingMessage(payload: any): any {
  if (Array.isArray(payload?.messages) && payload.messages.length > 0) return payload.messages[0];
  if (Array.isArray(payload?.data) && payload.data.length > 0) return payload.data[0];
  return payload?.message || payload?.data || payload;
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

function mayContainLeadMedia(payload: any): boolean {
  return provisionalPedroV3MediaContext(payload) != null;
}

async function resolvePedroV3InboundMediaContext(input: {
  payload: any;
  instance: any;
  userId: string | null | undefined;
  supabase: any;
}): Promise<PedroV3MediaContext | null> {
  if (!mayContainLeadMedia(input.payload)) return null;
  try {
    const allowPlatform = await isAccountGrandfathered(input.supabase, input.userId);
    const resolved = await resolveAiKey(input.supabase, input.userId, "openai", { allowPlatformFallback: allowPlatform });
    const media = await resolvePedroMediaContext(input.payload, input.instance, resolved.key || undefined);
    if (!media.has_media_context) return null;
    const kind = ["audio", "image", "video", "document"].includes(String(media.kind)) ? String(media.kind) as PedroV3MediaContext["kind"] : "unknown";
    return {
      kind,
      text: media.text || null,
      summary: media.summary || null,
      vehicleQuery: media.vehicle_query || null,
      vehicleType: media.vehicle_type || null,
      confidence: Number(media.confidence || 0),
      transcriptionAvailable: kind === "audio" ? Boolean(media.text) : null,
    };
  } catch (error) {
    console.warn("[pedro-v3-media] context_unavailable", String((error as any)?.message || error).slice(0, 160));
    return null;
  }
}

async function resolvePedroV3AdSemanticContext(input: {
  referral: PedroV3AdReferral;
  userId: string | null | undefined;
  supabase: any;
}): Promise<PedroV3AdReferral> {
  try {
    const allowPlatform = await isAccountGrandfathered(input.supabase, input.userId);
    const resolvedKey = await resolveAiKey(input.supabase, input.userId, "openai", { allowPlatformFallback: allowPlatform });
    const resolved = await resolvePedroV3AdSemantic(input.referral, resolvedKey.key || "", {
      model: Deno.env.get("PEDRO_V3_AD_VISION_MODEL") || "gpt-4.1-mini",
    });
    return enrichAdReferralWithSemanticContext(input.referral, resolved);
  } catch (error) {
    // Ad understanding enriches context but never blocks ingestion. The main
    // LLM still receives the textual referral and can continue transparently.
    console.warn("[pedro-v3-ad] semantic_context_unavailable", String((error as any)?.message || error).slice(0, 160));
    return input.referral;
  }
}

// ── Connection/status event helpers ──────────────────────────────────────────
// UaZapi (and the legacy Evolution format) report connection state via a
// dedicated event, NOT a chat message. The v1 webhook (uazapi-webhook) handled
// this; v2 never did. Mirror v1 so a brand-new instance gets flipped to
// connected once the seller scans the QR.
function extFromMime(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("3gpp") || m.includes("3gp")) return "3gp";
  if (m.includes("webm")) return "webm";
  if (m.includes("wav")) return "wav";
  if (m.includes("pdf")) return "pdf";
  return "bin";
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const bin = atob(String(base64 || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function uploadBase64ToWaMedia(
  supabase: any,
  userId: string,
  phone: string,
  base64: string,
  mimetype: string,
): Promise<string | null> {
  try {
    if (!base64) return null;
    const bytes = decodeBase64ToBytes(base64);
    if (!bytes.length) return null;
    const safePhone = String(phone || "").replace(/\D/g, "") || "lead";
    const path = `${userId}/${safePhone}/${Date.now()}-${crypto.randomUUID()}.${extFromMime(mimetype)}`;
    const { error } = await supabase.storage
      .from("wa-media")
      .upload(path, bytes, { contentType: mimetype || "application/octet-stream", upsert: true });
    if (error) {
      console.error("[pedro-webhook-v2] wa-media upload error:", error.message || error);
      return null;
    }
    const { data: pub } = supabase.storage.from("wa-media").getPublicUrl(path);
    return pub?.publicUrl || null;
  } catch (err) {
    console.error("[pedro-webhook-v2] wa-media upload threw:", err);
    return null;
  }
}

function detectMimeFromMessage(message: any, messageType: string): string {
  return String(
    message?.mimetype ||
    message?.content?.mimetype ||
    message?.message?.imageMessage?.mimetype ||
    message?.message?.audioMessage?.mimetype ||
    message?.message?.videoMessage?.mimetype ||
    message?.message?.documentMessage?.mimetype ||
    (messageType === "audio" ? "audio/ogg" : messageType === "image" ? "image/jpeg" : "application/octet-stream")
  );
}

async function rehostUazapiMediaForInbox(
  supabase: any,
  instance: any,
  instanceName: string,
  message: any,
  messageId: string | null,
  phone: string,
  messageType: string,
): Promise<string | null> {
  try {
    let base64 = message?.base64 || message?.message?.base64 || "";
    let mimetype = detectMimeFromMessage(message, messageType);

    if (!base64 && messageId) {
      const baseUrl = String(instance?.api_url || "").replace(/\/+$/, "");
      const instKey = String(instance?.api_key_encrypted || "");
      if (baseUrl && instKey) {
        const res = await fetch(`${baseUrl}/message/download?instance=${instanceName}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: instKey, token: instKey },
          body: JSON.stringify({ id: messageId, return_base64: true }),
        });
        if (res.ok) {
          const data = await res.json();
          base64 = data.base64Data || data.base64 || data.file || "";
          mimetype = data.mimetype || mimetype;
        } else {
          console.error("[pedro-webhook-v2] media download error:", res.status, await res.text());
        }
      }
    }

    if (!base64) return null;
    return await uploadBase64ToWaMedia(supabase, instance.user_id, phone, base64, mimetype);
  } catch (err) {
    console.error("[pedro-webhook-v2] media rehost threw:", err);
    return null;
  }
}

function getEventType(payload: any): string {
  return String(
    payload?.EventType ||
    payload?.eventType ||
    payload?.event ||
    payload?.type ||
    "",
  ).toLowerCase();
}

function isMessageUpdateEvent(payload: any): boolean {
  const eventType = getEventType(payload);
  return eventType === "messages_update" || eventType === "message_update" || eventType === "messages.update";
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
    } else if (
      connInstanceName &&
      (state === "close" || state === "closed" || state === "disconnected" ||
        state === "logout" || state === "logged_out" || state === "connection_closed")
    ) {
      // Queda em TEMPO REAL: antes isto era no-op e o status so caia no cron de 5min
      // (o numero ficava "connected" no banco enquanto estava morto, e o disparo
      // tentava enviar e falhava). Marca desconectado na hora. Se voltar, o evento
      // "open" acima (ou a chegada de mensagem, mais abaixo) reativa.
      const { error: connError } = await supabase
        .from("wa_instances")
        .update({ is_active: false, status: "disconnected", updated_at: new Date().toISOString() })
        .eq("instance_name", connInstanceName);
      console.log(
        `[pedro-webhook-v2] connection event instance=${connInstanceName} state=${state} -> ${connError ? "ERROR " + connError.message : "marked disconnected"}`,
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

  // Transport boundary: Pedro only serves private one-to-one chats. Uazapi's
  // canonical Message shape carries `isGroup`; JID suffixes cover legacy and
  // nested payloads. Stop before instance lookup, CRM, v2 or v3.
  const inboundAudience = classifyUazapiInboundAudience(payload);
  if (inboundAudience.kind === "group" || inboundAudience.kind === "broadcast") {
    console.log(`[pedro-webhook-v2] non_private_chat_ignored kind=${inboundAudience.kind}`);
    return jsonResponse({ ok: true, ignored: inboundAudience.kind });
  }

  // NÃO descartar fromMe aqui — instâncias de VENDEDOR precisam capturar o que o
  // vendedor envia (auditoria). O descarte de fromMe acontece ABAIXO, escopado às
  // instâncias que NÃO são de vendedor, depois de resolver a instância.

  const instanceName =
    payload?.instanceName ||
    payload?.instance_name ||
    payload?.instance?.name ||
    payload?.instance?.instanceName ||
    payload?.instance ||
    payload?.data?.instanceName ||
    payload?.data?.instance?.name ||
    payload?.data?.instance ||
    null;

  if (!instanceName) return jsonResponse({ ok: false, error: "instance_missing" }, 400);

  // Busca a instancia pelo nome. NAO exige is_active=true: se a UAZAPI esta
  // ENTREGANDO uma mensagem, o numero esta VIVO no WhatsApp — mesmo que o nosso
  // status tenha marcado "caido" por falso-negativo (cron/circuit-breaker). Antes,
  // is_active=false aqui = 404 e a mensagem do cliente era DESCARTADA (dezenas por
  // minuto nos logs). Preferimos a linha ativa; sobrou so a "caida" -> curamos o
  // status (prova de vida) e seguimos. Quem RESPONDE segue decidido pelos gates de
  // sempre mais abaixo (agente ativo / regra do vendedor) — nada muda pra numero ja
  // ativo (caminho quente identico).
  const { data: waRows, error: instanceError } = await supabase
    .from("wa_instances")
    .select("*")
    .eq("instance_name", instanceName)
    .order("is_active", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1);

  const waInstance = (waRows || [])[0];
  if (instanceError || !waInstance) {
    return jsonResponse({ ok: false, error: "active_instance_not_found" }, 404);
  }

  // Auto-cura: mensagem chegou => sessao viva. Se estava marcada caida, reativa
  // (nao mexe em 'no_credentials' = falta de chave, nao queda de sessao).
  if (waInstance.is_active !== true && waInstance.status !== "no_credentials") {
    await supabase
      .from("wa_instances")
      .update({ is_active: true, status: "connected", updated_at: new Date().toISOString() })
      .eq("id", waInstance.id);
    waInstance.is_active = true;
    waInstance.status = "connected";
    console.log(`[pedro-webhook-v2] self-heal instance=${instanceName} (mensagem recebida em instancia marcada caida) -> reativada`);
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
    // F2.6H: delivery receipts (messages_update) are status callbacks, NEVER real inbound
    // messages. Skip them on seller lines so enabling messages_update never pollutes the
    // seller inbox with empty entries (sem quebrar v2).
    if (isMessageUpdateEvent(payload)) {
      return jsonResponse({ ok: true, ignored: "message_update", build: PEDRO_V2_BUILD });
    }
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

        if (
          (messageType === "image" || messageType === "audio" || messageType === "video" || messageType === "document") &&
          typeof inboxMsgId === "string"
        ) {
          const hostedUrl = await rehostUazapiMediaForInbox(
            supabase,
            waInstance,
            String(instanceName),
            inMsg,
            inboxMsgId,
            phoneOnly,
            messageType,
          );
          if (hostedUrl) mediaUrl = hostedUrl;
        }

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

  const { data: allAgents, error: agentError } = await supabase
    .from("wa_ai_agents")
    .select("*")
    .eq("user_id", waInstance.user_id);

  const agentsList = Array.isArray(allAgents) ? allAgents : [];
  // Binding operacional da linha, independentemente de is_active. Um agente
  // inativo não responde, mas sua linha continua alimentando inbox/CRM humano.
  //
  // Nunca escolha silenciosamente entre dois agentes ligados à mesma instância:
  // isso poderia criar o lead no CRM errado. A mensagem será persistida abaixo e
  // o webhook responderá 5xx para tornar a inconsistência observável/repetível.
  const linkedAgents = agentsList.filter((a: any) => agentUsesInstance(a, waInstance.id));
  const linkedAgentBindingAmbiguous = linkedAgents.length > 1;
  const linkedAgent = linkedAgents.length === 1 ? linkedAgents[0] : null;

  // ── FASE 2: RASTREAMENTO GARANTIDO (a automação pode parar, o rastreamento não) ─
  // Persiste a mensagem privada real da linha de IA em wa_inbox, chamado UMA vez
  // ANTES de selectActiveAgent — logo antes de is_active/horário/ai_paused/despacho,
  // INCLUSIVE no caminho ativo (o rastreamento NÃO depende do serviço V3 externo).
  // Idempotente por (user_id, instance_id, remote_message_id). Nunca dispara IA,
  // resposta ou follow-up. No caminho ativo convive com o v3_inbox; a dedup da
  // timeline (wa_inbox × v3_inbox) será feita na projeção/RPC das Fases 3/4 — por
  // isso a Fase 2 NÃO deve ser implantada isolada. Retorna o resultado ao chamador.
  const persistTrack = async (tag: string) => {
    if (payload?.dry_run === true) return { status: "skipped", reason: "dry_run" } as const;
    const r = await persistPrivateInboundMessage({
      supabase,
      waInstance,
      agentsList,
      payload,
      audience: inboundAudience,
      isMessageUpdate: isMessageUpdateEvent(payload),
    });
    if (r.status === "error") {
      // Requisito 9: erro observável, nunca escondido, nunca "sucesso" sem gravar.
      console.error(
        `[pedro-webhook-v2] persist_track_failed tag=${tag} dir=${r.direction ?? "-"} msgid=${r.remote_message_id ?? "-"} instance=${waInstance.id} err=${r.error}`,
      );
    } else if (r.status !== "skipped") {
      console.log(
        `[pedro-webhook-v2] persist_track ${r.status} tag=${tag} dir=${r.direction ?? "-"} reason=${r.reason} msgid=${r.remote_message_id ?? "-"} instance=${waInstance.id}`,
      );
    }
    return r;
  };

  // ── CONFIRMACAO OPERACIONAL DO VENDEDOR (antes de selectActiveAgent) ─────────
  // Incidente 24/07 (conta WA / Wa Duda): o agente foi desativado (is_active=false)
  // com a instancia ainda conectada; os vendedores Luiz responderam "Ok" e a
  // transferencia NUNCA confirmou, porque selectActiveAgent retorna null p/ agente
  // inativo e o webhook dava return ANTES de qualquer tratamento do vendedor.
  //
  // A confirmacao do vendedor e OPERACIONAL, nao conversacional: precisa funcionar
  // mesmo com a IA pausada/agente inativo, e NUNCA pode acionar V2/V3. Reutiliza a
  // regra existente (isSellerAckText) + a saga compartilhada (confirmSellerAck) —
  // sem criar segundo parser/segunda regra. Escopo por tenant (waInstance.user_id),
  // instancia (agente vinculado, mesmo inativo, so p/ priorizacao) e vendedor (tel).
  {
    // Agente vinculado a ESTA instancia, ATIVO OU NAO — so para priorizar entre
    // linhas-irmas do mesmo vendedor. A inatividade nunca bloqueia a confirmacao.
    const sellerDecision = await handleSellerInbound(supabase, {
      user_id: waInstance.user_id,
      agent_id: linkedAgent?.id || null,
      seller_phone: resolveUazapiPhone(payload),
      seller_text: resolveUazapiText(payload),
      dry_run: payload?.dry_run === true,
    });
    if (sellerDecision.isSeller) {
      // Remetente e vendedor deste tenant -> resposta operacional, NUNCA V2/V3.
      const level = sellerDecision.route === "seller_ack_failed" ? "error" : "log";
      console[level](`[Webhook] ${sellerDecision.route} seller=${sellerDecision.seller_id ?? "?"} transfer=${sellerDecision.transfer_id ?? "-"} instance=${waInstance.id} confirmed=${sellerDecision.confirmed}`);

      // ACK OPERACIONAL AO VENDEDOR — so na PRIMEIRA confirmacao. route
      // 'seller_ack_confirmation' == confirmSellerAck achou uma pendente e confirmou
      // AGORA. "Ok" repetido cai em 'seller_ack_no_pending' e NAO reenvia (idempotente).
      // Envio pela instancia do tenant (waInstance), telefone normalizado com 55 pelo
      // sendPedroText. A falha de envio NUNCA desfaz a confirmacao ja gravada nem
      // penaliza o vendedor: apenas registra observavel. Nunca toca V2/V3.
      if (sellerDecision.route === "seller_ack_confirmation") {
        try {
          const _ackRes: any = await sendPedroText(waInstance as any, {
            to: resolveUazapiPhone(payload),
            text: "✅ Atendimento confirmado!\n\nO lead foi atribuído a você no CRM. Pode seguir com a venda.",
          });
          if (_ackRes?.ok) {
            console.log(`[Webhook] seller_ack_sent transfer=${sellerDecision.transfer_id} seller=${sellerDecision.seller_id} instance=${waInstance.id} status=${_ackRes?.status ?? "-"} attempt=${_ackRes?.attempt ?? "-"}`);
          } else {
            console.error(`[Webhook] seller_ack_send_failed transfer=${sellerDecision.transfer_id} seller=${sellerDecision.seller_id} instance=${waInstance.id} status=${_ackRes?.status ?? "-"} attempt=${_ackRes?.attempt ?? "-"}`);
          }
        } catch (_ackErr) {
          console.error(`[Webhook] seller_ack_send_error transfer=${sellerDecision.transfer_id} seller=${sellerDecision.seller_id} instance=${waInstance.id} err=${String((_ackErr as any)?.message || _ackErr).slice(0, 200)}`);
        }

        // RECIBO OPERACIONAL AO CLIENTE — nasce somente depois que a mesma saga
        // confirmou o vendedor e o fixou no CRM. Não é autoria do agente nem regra
        // de conversa. O marker usa o transfer_id: "Ok" repetido e transferências
        // antigas não duplicam a mensagem. Se o WhatsApp falhar, não marcamos e o
        // próximo inbound do lead pode tentar novamente pelo post-transfer hold.
        if (sellerDecision.transfer_id) {
          try {
            const receipt = await sendLeadTransferConfirmationReceipt({
              supabase,
              instance: waInstance,
              tenantId: waInstance.user_id,
              transferId: sellerDecision.transfer_id,
              sellerId: sellerDecision.seller_id,
              sendText: sendPedroText,
            });
            const receiptLevel = receipt.ok || receipt.status === "already_sent" ? "log" : "error";
            console[receiptLevel](`[Webhook] lead_transfer_receipt status=${receipt.status} transfer=${sellerDecision.transfer_id} seller=${sellerDecision.seller_id ?? "?"} instance=${waInstance.id}`);
          } catch (_receiptErr) {
            console.error(`[Webhook] lead_transfer_receipt_error transfer=${sellerDecision.transfer_id} seller=${sellerDecision.seller_id ?? "?"} instance=${waInstance.id} err=${String((_receiptErr as any)?.message || _receiptErr).slice(0, 200)}`);
          }
        }
      }

      return jsonResponse({
        ok: true, accepted: true, routed: sellerDecision.route,
        confirmed: sellerDecision.confirmed, transfer_id: sellerDecision.transfer_id,
        reason: sellerDecision.reason, build: PEDRO_V2_BUILD,
      });
    }
    // Nao e vendedor -> segue o fluxo normal do lead (selectActiveAgent abaixo).
  }

  // ── FASE 2: PERSISTÊNCIA GARANTIDA (ponto único, ANTES de qualquer decisão) ─────
  // Grava a mensagem privada real da linha de IA em wa_inbox ANTES de selectActiveAgent
  // / is_active / horário / ai_paused / despacho V3 — INCLUSIVE no caminho ativo. O
  // rastreamento não depende do serviço V3 externo. Vendedores já retornaram acima.
  // Inbound do cliente é sagrado: erro real de banco -> 5xx pra uazapi RE-tentar
  // (idempotente, e ANTES de qualquer despacho -> sem risco de resposta dupla). fromMe
  // é best-effort (nunca derruba). Não dispara IA, resposta nem follow-up.
  let persistResult: Awaited<ReturnType<typeof persistPrivateInboundMessage>> = {
    status: "skipped",
    reason: "not_run",
  };
  {
    persistResult = await persistTrack("pre_dispatch");
    if (persistResult.status === "error" && persistResult.direction === "incoming") {
      return jsonResponse({ ok: false, error: "inbox_persist_failed", build: PEDRO_V2_BUILD }, 500);
    }
  }

  // Não transforme falha de lookup ou configuração ambígua em HTTP 200. O
  // inbound já está seguro e idempotente no wa_inbox; o 5xx permite convergir
  // depois que banco/configuração voltar, sem responder por um agente errado.
  if (agentError) {
    console.error(
      `[pedro-webhook-v2] agent_lookup_failed tenant=${waInstance.user_id} instance=${waInstance.id} error=${agentError.message}`,
    );
    return jsonResponse({ ok: false, error: "agent_lookup_failed", build: PEDRO_V2_BUILD }, 500);
  }
  if (linkedAgentBindingAmbiguous) {
    console.error(
      `[pedro-webhook-v2] ambiguous_agent_binding tenant=${waInstance.user_id} instance=${waInstance.id} agents=${linkedAgents.map((a: any) => a.id).join(",")}`,
    );
    return jsonResponse({ ok: false, error: "ambiguous_agent_binding", build: PEDRO_V2_BUILD }, 500);
  }

  // Agente desligado = atendimento humano, não desaparecimento operacional.
  // Depois da persistência durável, garante um lead CRM pausado e vinculado à
  // conversa. A RPC é idempotente e revalida tenant/instância/agente no banco.
  // Nenhuma IA, resposta, transferência ou follow-up nasce deste caminho.
  const humanMode = await ensureInactiveAgentHumanMode(supabase, {
    persistResult,
    linkedAgent,
    instanceId: waInstance.id,
    phone: resolveUazapiPhone(payload),
  });
  if (!humanMode.ok) {
    console.error(
      `[pedro-webhook-v2] inactive_human_mode_failed tenant=${waInstance.user_id} instance=${waInstance.id} reason=${humanMode.reason} err=${humanMode.error}`,
    );
    // Não reconhecer como sucesso algo que entrou no inbox, mas ainda não
    // ganhou o CRM humano solicitado. A deduplicação da entrada torna o retry
    // seguro e convergente.
    return jsonResponse({ ok: false, error: "inactive_human_mode_failed", build: PEDRO_V2_BUILD }, 500);
  }
  if (humanMode.status === "ensured") {
    console.log(
      `[pedro-webhook-v2] inactive_human_mode_ensured tenant=${waInstance.user_id} agent=${linkedAgent?.id ?? "-"} instance=${waInstance.id} lead=${humanMode.leadId ?? "-"} created=${humanMode.created}`,
    );
  }

  const agent = selectActiveAgent(agentsList, waInstance.id);

  if (!agent) {
    // FASE 2: a mensagem JÁ foi persistida acima (rastreamento garantido). Aqui só
    // encerramos sem V2/V3 — agente inativo/ausente não responde.
    console.log(`[Webhook] Nenhum agente ativo encontrado para a instância ${waInstance.id} (Carvalho copia)`);
    return jsonResponse({ ok: true, ignored: "agent_not_found_or_inactive", instance: instanceName });
  }
  let pedroV3Scopes;
  try {
    pedroV3Scopes = parsePedroV3ActiveScopes(Deno.env.get("PEDRO_V3_ACTIVE_SCOPES"));
  } catch (error) {
    console.error(`[pedro-v3-pilot] active_scope_config_invalid reason=${String((error as Error)?.message || error)}`);
    pedroV3Scopes = [];
  }
  const pedroV3Pilot = evaluatePedroV3PilotAgent(agent, waInstance, Deno.env.get("PEDRO_V3_PILOT_MODE"), pedroV3Scopes);
  if (pedroV3Pilot.enabled) {
    console.log(
      `[pedro-v3-pilot] matched tenant=${agent.user_id} agent=${agent.id} mode=${pedroV3Pilot.mode}`,
    );
  }
  // An active v3 scope is already the explicit ownership decision for this
  // tenant+agent. It must be reachable even when the legacy v2 rollout gate is
  // disabled for the account; otherwise the old gate silently prevents v3
  // activation. Shadow/off continue to use the v2 gate below.
  const v3ExclusiveScope = pedroV3Pilot.enabled && pedroV3Pilot.mode === "active";
  if (PEDRO_V3_ONLY && !v3ExclusiveScope) {
    console.error(`[pedro-v3-only] blocked_non_v3_scope tenant=${agent.user_id} agent=${agent.id} reason=${pedroV3Pilot.reason}`);
    return jsonResponse({ ok: false, disabled: true, reason: "pedro_v2_disabled_v3_only", build: PEDRO_V2_BUILD }, 423);
  }
  const gate = v3ExclusiveScope
    ? { enabled: true, reason: "v3_exclusive_scope" }
    : await isPedroV2EnabledForUser(supabase, waInstance.user_id);
  if (!gate.enabled) {
    return jsonResponse({
      ok: false,
      disabled: true,
      reason: gate.reason,
      message:
        "Pedro v2 is disabled for this user. Use PEDRO_V2_ALLOWED_USER_EMAILS/IDS for controlled tests or PEDRO_V2_ENABLED for global rollout.",
    }, 423);
  }
  // Uazapi delivery callback. It is never a lead message and must never start a
  // v2/v3 conversational turn. Only the exact active pilot may promote receipts.
  if (isMessageUpdateEvent(payload)) {
    if (pedroV3Pilot.enabled && pedroV3Pilot.mode === "active") {
      const receipt = buildPedroV3DeliveryReceipt({
        payload,
        tenantId: (agent as any)?.user_id,
        agentId: (agent as any)?.id,
        activeScopes: pedroV3Scopes,
      });
      const receiptWaitUntil = (globalThis as any).EdgeRuntime?.waitUntil?.bind((globalThis as any).EdgeRuntime);
      if (receipt.ok && typeof receiptWaitUntil === "function") {
        const serviceUrl = Deno.env.get("PEDRO_V3_SERVICE_URL") || "";
        const bridgeSecret = Deno.env.get("PEDRO_V3_BRIDGE_SECRET") || "";
        receiptWaitUntil(callPedroV3ReceiptBridge({
          serviceUrl,
          secret: bridgeSecret,
          receipt: receipt.receipt,
        }).then((result) => {
          console.log(`[pedro-v3-receipt] result=${result.kind} status=${result.httpStatus ?? "none"}`);
        }).catch(() => {
          console.error("[pedro-v3-receipt] unexpected_uncertain");
        }));
        return jsonResponse({ ok: true, accepted: true, routed: "pedro_v3_receipt", build: PEDRO_V2_BUILD });
      }
      console.warn(`[pedro-v3-receipt] ignored reason=${receipt.ok ? "wait_until_unavailable" : receipt.reason}`);
    }
    return jsonResponse({ ok: true, ignored: "message_update", build: PEDRO_V2_BUILD });
  }

  // fromMe on the AI instance is ignored only after message_update receipts had
  // the chance to be reconciled. Seller instances were handled above.
  if (inboundAudience.kind === "self") {
    // FASE 2: fromMe já foi persistida acima (manual registrada; automática do V3
    // pulada via providerMessageId). Aqui só encerramos — fromMe nunca inicia turno.
    return jsonResponse({ ok: true, ignored: "from_me" });
  }


  // ── Roteamento por tipo de agente ──────────────────────────────────────────
  // "SDR - Geral" (agent_type='sdr_geral') usa o cérebro da SOFIA (qualifica +
  // agenda reunião, sem BNDV). Qualquer outro tipo segue no Pedro v2 (automóveis).
  // Isolado em módulo próprio (_shared/sofia/) -> zero impacto no fluxo do Pedro.
  if (agent?.agent_type === "sdr_geral" && !v3ExclusiveScope) {
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

  // A v2 mutation flag must never turn an active v3 lead into dry-run.
  const _dryRun = payload?.dry_run === true || (!v3ExclusiveScope && !isPedroV2MutationEnabled());
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

  // ANTI-DROP: o webhook não espera debounce/LLM. Também não confia a primeira
  // persistência a waitUntil, pois a tarefa pode morrer depois do HTTP 200.
  // ACK DURAVEL DO V3: debounce/LLM continuam assincronos, mas o webhook so
  // responde HTTP 200 depois que o bridge prova que o evento entrou no
  // v3_inbox. EdgeRuntime.waitUntil fica reservado a enriquecimento: perde-lo
  // pode reduzir contexto, nunca apagar o turno. Falha/timeout antes da prova
  // retorna 503; o retry usa o mesmo eventId e e idempotente.
  const _waitUntil = (globalThis as any).EdgeRuntime?.waitUntil?.bind((globalThis as any).EdgeRuntime);
  let _pilotSellerInbound = false;
  let _pilotInternalInbound = false;
  let _postTransferPlan = null;
  // Resolve internal identities for every conversational route, not only v3.
  // A connected AI line or tenant manager must never reach either engine.
  if (!_dryRun) {
    const _remoteJid = incomingRemoteJid(payload);
    if (_remoteJid) {
      const _identity = await identifyPedroContact(supabase, {
        user_id: (agent as any).user_id,
        agent_id: (agent as any).id,
        remote_jid: _remoteJid,
      });
      _pilotSellerInbound = _identity.kind === "seller";
      _pilotInternalInbound = shouldIgnorePedroInternalIdentity(_identity.kind);
      if (_pilotSellerInbound) {
        console.log("[pedro-v3-bridge] seller_identity_forwarded_to_confirmation_flow");
      } else if (_pilotInternalInbound) {
        console.log(`[pedro-v3-bridge] internal_identity_ignored kind=${_identity.kind}`);
      } else if (
        _identity.kind === "lead" &&
        pedroV3Pilot.enabled &&
        pedroV3Pilot.mode === "active"
      ) {
        _postTransferPlan = await resolvePostTransferPlan({
          supabase,
          tenantId: (agent as any).user_id,
          agentId: (agent as any).id,
          remoteJid: _remoteJid,
        });
      }
    }
  }
  if (!_dryRun && _pilotInternalInbound) {
    return jsonResponse({ ok: true, accepted: true, routed: "internal_identity_ignored", build: PEDRO_V2_BUILD });
  }
  if (!_dryRun && _postTransferPlan) {
    const executeHold = executePostTransferPlan({
      supabase,
      instance: waInstance,
      plan: _postTransferPlan,
      sendText: sendPedroText,
    }).catch((error) => {
      console.error("[pedro-v3-post-transfer] execution_failed", String((error as any)?.message || error).slice(0, 180));
    });
    // Supabase oferece waitUntil, mas a regra de silencio nao pode depender da
    // presenca dessa API. Sem ela, concluimos o efeito antes do ACK e ainda
    // encerramos aqui; em nenhum ambiente o turno escapa para a IA apos handoff.
    if (typeof _waitUntil === "function") _waitUntil(executeHold);
    else await executeHold;
    return jsonResponse({ ok: true, accepted: true, routed: "pedro_v3_post_transfer_hold", action: _postTransferPlan.action, build: PEDRO_V2_BUILD });
  }

  // Unidade 1: a confirmacao do vendedor JA foi tratada no gateway compartilhado,
  // ANTES de selectActiveAgent (handleSellerInbound). O caminho antigo aqui chamava
  // o orquestrador V2 (processPedroV2Turn) so para o seller-ack — desnecessario e
  // proibido no mundo V3-only. Mantemos apenas uma REDE DE SEGURANCA: se uma
  // identidade de vendedor ainda chegar ate aqui, NUNCA aciona o V2 nem cai para o
  // V3 — apenas encerra como interna. (O gateway ja retornou antes; isto e defesa.)
  if (!_dryRun && _pilotSellerInbound) {
    console.log("[Webhook] seller_reached_bridge_guard — ignorado (ja tratado no gateway, sem V2/V3)");
    return jsonResponse({ ok: true, accepted: true, routed: "seller_ignored_already_handled", build: PEDRO_V2_BUILD });
  }

  // ── GATE DE PAUSA DA IA (CRM + identidade oficial da conversa) ─────────────
  // Antes de despachar o lead pro V3: se a CONVERSA estiver pausada (ai_paused) ou
  // o AGENTE desligado, a IA NAO gera resposta. A mensagem do cliente NUNCA se perde
  // — e registrada no wa_inbox (aparece em Conversas). Efeitos JA enfileirados no
  // v3_effect_outbox sao responsabilidade do servico V3 externo (revalidar a pausa
  // ao reservar e antes de enviar — ver docs/v3-transfer-confirmation-spec.md).
  // Falha de decisao e fail-closed: a mensagem ja foi persistida, mas nao pode
  // seguir ao V3 sem confirmar que a automacao esta autorizada.
  //
  // O V3 e global; a pausa tambem precisa ser global. Seller ACK e operacoes
  // manuais continuam fora deste gate pela origem operacional acima.
  if (!_dryRun && !_pilotSellerInbound) {
    const _pauseTenant = (agent as any).user_id;
    const _pauseJid = incomingRemoteJid(payload);
    let _pauseLead: any = null;
    if (_pauseJid) {
      const { data } = await supabase
        .from("ai_crm_leads").select("id, ai_paused")
        .eq("user_id", _pauseTenant).eq("remote_jid", _pauseJid).maybeSingle();
      _pauseLead = data;
    }
    const { data: _pauseDecision, error: _pauseDecisionError } = await supabase.rpc("is_ai_automation_allowed_v2", {
      p_tenant: _pauseTenant,
      p_agent_id: (agent as any).id,
      p_lead_id: _pauseLead?.id ?? null,
      p_v3_conversation_id: null,
      p_instance_id: waInstance.id,
      p_phone: _pauseJid,
      p_action_kind: "v3_effect",
      p_origin: "ai",
    });
    if (_pauseDecisionError) {
      console.error(`[Webhook] ai_decision_unavailable instance=${waInstance.id} error=${_pauseDecisionError.message}`);
      return jsonResponse({ ok: true, accepted: true, routed: "ai_decision_unavailable", reason: "automation_gate_unavailable", build: PEDRO_V2_BUILD });
    }
    if (_pauseLead?.ai_paused === true || (_pauseDecision && _pauseDecision.allowed === false)) {
      // FASE 2: a mensagem JÁ foi persistida antes do selectActiveAgent. Durante a
      // pausa apenas NÃO despachamos ao V3 (sem resposta, sem follow-up).
      console.log(`[Webhook] ai_paused_no_dispatch reason=${_pauseDecision?.reason} lead=${_pauseLead?.id ?? "-"} instance=${waInstance.id}`);
      return jsonResponse({ ok: true, accepted: true, routed: "ai_paused_no_dispatch", reason: _pauseDecision?.reason ?? "paused", build: PEDRO_V2_BUILD });
    }
  }

  if (!_dryRun && !_pilotSellerInbound && pedroV3Pilot.enabled && pedroV3Pilot.mode === "active") {
    const serviceUrl = Deno.env.get("PEDRO_V3_SERVICE_URL") || "";
    const bridgeSecret = Deno.env.get("PEDRO_V3_BRIDGE_SECRET") || "";
    const provisionalMedia = provisionalPedroV3MediaContext(payload);
    const bridgeTurn = await buildPedroV3BridgeTurn({
      payload,
      tenantId: (agent as any)?.user_id,
      agentId: (agent as any)?.id,
      instanceId: waInstance.id,
      separateConversationByInstance: shouldNamespaceConversationByInstance(agent, waInstance.id),
      build: PEDRO_V2_BUILD,
      mediaContext: provisionalMedia,
      activeScopes: pedroV3Scopes,
    });
    if (!bridgeTurn.ok) {
      console.error(`[pedro-v3-only] durable_ingest_build_failed reason=${bridgeTurn.reason}`);
      return jsonResponse({
        ok: false,
        accepted: false,
        reason: `v3_${bridgeTurn.reason}`,
        build: PEDRO_V2_BUILD,
      }, 503);
    }

    const callBridge = (turn: typeof bridgeTurn.turn) => callPedroV3Bridge({
      serviceUrl,
      secret: bridgeSecret,
      turn,
      // /turn apenas grava routing + inbox. Sem prova rápida de ingestão, o
      // provedor deve repetir em vez de receber um HTTP 200 falso.
      timeoutMs: 8_000,
    });
    const needsEnrichment = provisionalMedia != null || bridgeTurn.turn.adReferral != null;
    const durable = await bridgePedroV3BeforeAck({
      turn: bridgeTurn.turn,
      call: callBridge,
      ...(needsEnrichment ? {
        enrich: async () => {
          const resolvedMedia = provisionalMedia
            ? await resolvePedroV3InboundMediaContext({
                payload,
                instance: waInstance,
                userId: (agent as any)?.user_id,
                supabase,
              })
            : null;
          const rebuilt = await buildPedroV3BridgeTurn({
            payload,
            tenantId: (agent as any)?.user_id,
            agentId: (agent as any)?.id,
            instanceId: waInstance.id,
            separateConversationByInstance: shouldNamespaceConversationByInstance(agent, waInstance.id),
            build: PEDRO_V2_BUILD,
            mediaContext: resolvedMedia ?? provisionalMedia,
            activeScopes: pedroV3Scopes,
          });
          if (!rebuilt.ok) return null;
          const enrichedTurn = rebuilt.turn.adReferral
            ? {
                ...rebuilt.turn,
                adReferral: await resolvePedroV3AdSemanticContext({
                  referral: rebuilt.turn.adReferral,
                  userId: (agent as any)?.user_id,
                  supabase,
                }),
              }
            : rebuilt.turn;
          return JSON.stringify(enrichedTurn) === JSON.stringify(bridgeTurn.turn)
            ? null
            : enrichedTurn;
        },
      } : {}),
    });

    if (durable.kind !== "accepted") {
      console.error(
        `[pedro-v3-only] durable_ingest_not_proven result=${durable.initial.kind} `
        + `status=${durable.initial.serviceStatus ?? durable.initial.httpStatus ?? "none"}`,
      );
      return jsonResponse({
        ok: false,
        accepted: false,
        reason: "v3_ingest_not_proven",
        bridge: durable.initial.kind,
        build: PEDRO_V2_BUILD,
      }, 503);
    }

    if (durable.enrichment) {
      const observeEnrichment = durable.enrichment.then((result) => {
        if (!result) return;
        const level = result.kind === "accepted" ? "log" : "warn";
        console[level](
          `[pedro-v3-bridge] enrichment_result=${result.kind} `
          + `status=${result.serviceStatus ?? result.httpStatus ?? "none"}`,
        );
      }).catch((error) => {
        console.warn("[pedro-v3-bridge] enrichment_unexpected", String((error as any)?.message || error).slice(0, 200));
      });
      if (typeof _waitUntil === "function") {
        _waitUntil(observeEnrichment);
      } else {
        // Sem waitUntil, o turno já está seguro; aguardar aqui preserva apenas
        // qualidade de contexto, não a durabilidade.
        await observeEnrichment;
      }
    }

    console.log(
      `[pedro-v3-bridge] durable_ingest=accepted status=${durable.initial.serviceStatus ?? durable.initial.httpStatus ?? "none"}`,
    );
    return jsonResponse({ ok: true, accepted: true, routed: "pedro_v3_durable", build: PEDRO_V2_BUILD });
  }
  if (!_dryRun && typeof _waitUntil === "function") {
    if (PEDRO_V3_ONLY) {
      console.error("[pedro-v3-only] legacy_dispatch_reached");
      return jsonResponse({ ok: false, accepted: false, reason: "pedro_v2_dispatch_blocked", build: PEDRO_V2_BUILD }, 503);
    }
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
