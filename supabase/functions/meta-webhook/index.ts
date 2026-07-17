// ── Webhook UNICO (a nivel de App) da Cloud API oficial do Meta ───────────────
// GET  = handshake de verificacao do Meta (hub.challenge).
// POST = mensagens recebidas. Valida a assinatura (X-Hub-Signature-256), acha a
// instancia pelo phone_number_id, NORMALIZA o payload do Meta pro mesmo formato
// que o orquestrador do Pedro ja le e chama o MESMO cerebro (processPedroV2Turn /
// processSofiaTurn). Reusa cobranca + auditoria sem nada extra. UAZAPI intacta.

import {
  createServiceClient,
  isPedroV2EnabledForUser,
  isPedroV2MutationEnabled,
} from "../_shared/pedro-v2/server.ts";
import { processPedroV2Turn } from "../_shared/pedro-v2/orchestrator_20260525_photo_flow.ts";
import { processSofiaTurn } from "../_shared/sofia/orchestrator.ts";
import { selectActiveAgent } from "../_shared/pedro-v2/webhookRouting.ts";
import {
  isPedroV3ExclusiveScope,
  parsePedroV3ActiveScopes,
  PEDRO_V3_ONLY,
} from "../_shared/pedro-v2/pedroV3PilotGate.ts";

const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const META_GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

function ack(body = "EVENT_RECEIVED", status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

// App dedicado do WhatsApp (separado do app de anúncios): a assinatura do webhook
// é validada com o App Secret DESSE app.
function getAppSecret(): string {
  return (Deno.env.get("WHATSAPP_APP_SECRET") || "").trim();
}

// Confere X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(rawBody, appSecret).
async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !appSecret) return false;
  const expectedHex = header.replace(/^sha256=/i, "").trim();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computedHex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (computedHex.length !== expectedHex.length) return false;
  // Comparacao em tempo constante.
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) diff |= computedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

function metaTokenOf(instance: any): string {
  return instance?.meta_config?.access_token_encrypted || instance?.api_key_encrypted || "";
}

// Baixa a midia do Meta (id -> url -> bytes) e devolve como data URL, que o
// resolvePedroMediaContext do Pedro ja entende (visao/transcricao).
async function fetchMetaMediaDataUrl(mediaId: string, token: string): Promise<string | null> {
  try {
    const metaRes = await fetch(`${META_GRAPH_URL}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
    const meta = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok || !meta?.url) return null;
    const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!binRes.ok) return null;
    const buf = new Uint8Array(await binRes.arrayBuffer());
    let binary = "";
    for (const byte of buf) binary += String.fromCharCode(byte);
    const mime = meta.mime_type || "application/octet-stream";
    return `data:${mime};base64,${btoa(binary)}`;
  } catch (e) {
    console.warn("[meta-webhook] media fetch falhou:", (e as any)?.message || e);
    return null;
  }
}

// Converte uma mensagem do Meta no MESMO shape que o orquestrador ja le
// (messages[0] estilo UAZAPI/Baileys).
async function normalizeMetaMessage(msg: any, contactName: string | null, token: string) {
  const fromDigits = String(msg?.from || "").replace(/\D/g, "");
  const remoteJid = `${fromDigits}@s.whatsapp.net`;
  const type = String(msg?.type || "text");

  let text = "";
  let messageType = "text";
  let mediaUrl: string | null = null;
  const messageNode: Record<string, unknown> = {};

  if (type === "text") {
    text = msg?.text?.body || "";
    messageNode.conversation = text;
  } else if (type === "button") {
    text = msg?.button?.text || "";
    messageNode.conversation = text;
  } else if (type === "interactive") {
    text = msg?.interactive?.button_reply?.title || msg?.interactive?.list_reply?.title || "";
    messageNode.conversation = text;
  } else if (type === "image" || type === "audio" || type === "video" || type === "document" || type === "sticker") {
    messageType = type === "sticker" ? "image" : type;
    const node = msg?.[type] || {};
    text = node?.caption || "";
    if (node?.id) mediaUrl = await fetchMetaMediaDataUrl(node.id, token);
    if (messageType === "image") messageNode.imageMessage = { caption: text, url: mediaUrl };
    else if (messageType === "audio") messageNode.audioMessage = { url: mediaUrl };
    else if (messageType === "video") messageNode.videoMessage = { caption: text, url: mediaUrl };
    else if (messageType === "document") messageNode.documentMessage = { url: mediaUrl };
  } else {
    text = "";
  }

  // contexto de anuncio (Click-to-WhatsApp): Meta manda em msg.referral.
  const contextInfo = msg?.referral
    ? { externalAdReply: {
        title: msg.referral.headline || null,
        body: msg.referral.body || null,
        sourceUrl: msg.referral.source_url || null,
        sourceApp: msg.referral.source_type || null,
        sourceId: msg.referral.source_id || null, // ad_id REAL do anúncio (Cabine/Bloco D)
        ctwaClid: msg.referral.ctwa_clid || null,
      } }
    : undefined;

  return {
    key: { remoteJid, fromMe: false, id: msg?.id || null },
    from: remoteJid,
    chatId: remoteJid,
    fromMe: false,
    pushName: contactName,
    senderName: contactName,
    messageid: msg?.id || null,
    messageType,
    type: messageType,
    text,
    body: text,
    caption: text,
    mediaUrl,
    mimetype: type === "image" ? "image/jpeg" : undefined,
    message: messageNode,
    contextInfo,
  };
}

async function recordSellerInbox(supabase: any, waInstance: any, normMsg: any) {
  try {
    const phoneOnly = String(normMsg?.from || "").replace(/@.*$/, "").replace(/\D/g, "");
    if (!phoneOnly) return;
    const messageType = normMsg?.messageType || "text";
    let content = String(normMsg?.text || "").trim();
    if (!content) {
      content = messageType === "image" ? "[imagem recebida]"
        : messageType === "audio" ? "[áudio recebido]"
        : messageType === "video" ? "[vídeo recebido]"
        : messageType === "document" ? "[documento recebido]"
        : "[midia recebida]";
    }
    await supabase.from("wa_inbox").insert({
      user_id: waInstance.user_id,
      instance_id: waInstance.id,
      phone: phoneOnly,
      contact_name: normMsg?.pushName || null,
      direction: "incoming",
      message_type: messageType,
      content,
      media_url: normMsg?.mediaUrl || null,
      is_read: false,
      is_archived: false,
      remote_message_id: typeof normMsg?.messageid === "string" ? normMsg.messageid : null,
    });
  } catch (e) {
    console.error("[meta-webhook] [SELLER-INBOX] erro:", (e as any)?.message || e);
  }
}

async function handleInbound(supabase: any, value: any) {
  const phoneNumberId = value?.metadata?.phone_number_id;
  const messages = Array.isArray(value?.messages) ? value.messages : [];
  if (!phoneNumberId || messages.length === 0) return;

  const { data: waInstance } = await supabase
    .from("wa_instances")
    .select("*")
    .eq("provider", "meta")
    .filter("meta_config->>phone_number_id", "eq", String(phoneNumberId))
    .eq("is_active", true)
    .maybeSingle();

  if (!waInstance) {
    console.log("[meta-webhook] phone_number_id desconhecido:", phoneNumberId);
    return;
  }

  const token = metaTokenOf(waInstance);
  const contactName = value?.contacts?.[0]?.profile?.name || null;

  for (const msg of messages) {
    const normMsg = await normalizeMetaMessage(msg, contactName, token);

    // Regra dura: numero de VENDEDOR nunca e respondido pela IA (so registra inbox).
    if (waInstance.seller_member_id) {
      await recordSellerInbox(supabase, waInstance, normMsg);
      continue;
    }

    const gate = await isPedroV2EnabledForUser(supabase, waInstance.user_id);
    if (!gate.enabled) {
      console.log("[meta-webhook] pedro v2 desabilitado p/ user:", waInstance.user_id, gate.reason);
      continue;
    }

    const { data: allAgents } = await supabase
      .from("wa_ai_agents")
      .select("*")
      .eq("user_id", waInstance.user_id);
    const agent = selectActiveAgent(allAgents || [], waInstance.id);
    if (!agent) {
      console.log("[meta-webhook] nenhum agente ativo p/ user:", waInstance.user_id);
      continue;
    }

    // O entrypoint Meta ainda é um adaptador legado do v2. Até existir uma
    // ponte Meta -> v3 equivalente à ponte Uazapi, bloquear é obrigatório:
    // nunca responder um lead pelo cérebro antigo.
    if (PEDRO_V3_ONLY) {
      console.log("[meta-webhook] pedro_v2_disabled_v3_only");
      continue;
    }

    const v3Scopes = parsePedroV3ActiveScopes(Deno.env.get("PEDRO_V3_ACTIVE_SCOPES"));
    if (isPedroV3ExclusiveScope({
      tenantId: waInstance.user_id,
      agentId: agent.id,
      mode: Deno.env.get("PEDRO_V3_PILOT_MODE"),
      activeScopes: v3Scopes,
    })) {
      console.log("[meta-webhook] v3_exclusive_scope_blocked_v2_direct_entry");
      continue;
    }

    const payload = { messages: [normMsg], instanceName: waInstance.instance_name };
    const dry_run = !isPedroV2MutationEnabled();
    try {
      if (agent.agent_type === "sdr_geral") {
        await processSofiaTurn(supabase, { payload, agent, wa_instance: waInstance, dry_run });
      } else {
        await processPedroV2Turn(supabase, { payload, agent, wa_instance: waInstance, dry_run });
      }
    } catch (e) {
      console.error("[meta-webhook] turn error:", (e as any)?.message || e);
    }
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ── GET: handshake de verificacao do Meta ──
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const verifyToken = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") || "";
    if (mode === "subscribe" && verifyToken && verifyToken === expected) {
      return new Response(challenge || "", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return ack("Method not allowed", 405);

  const supabase = createServiceClient();
  const rawBody = await req.text();

  // Valida assinatura HMAC. Se invalida: responde 200 (pra Meta nao floodar retry)
  // mas NAO processa.
  const appSecret = getAppSecret();
  const validSig = await verifySignature(rawBody, req.headers.get("x-hub-signature-256"), appSecret);
  if (!validSig) {
    console.warn("[meta-webhook] assinatura invalida — ignorado");
    return ack();
  }

  let body: any = {};
  try { body = JSON.parse(rawBody); } catch { return ack(); }

  // Coleta os blocos de mensagem (ignora statuses/recibos e outros campos).
  const valuesWithMessages: any[] = [];
  for (const entry of (Array.isArray(body?.entry) ? body.entry : [])) {
    for (const change of (Array.isArray(entry?.changes) ? entry.changes : [])) {
      if (change?.field === "messages" && Array.isArray(change?.value?.messages) && change.value.messages.length > 0) {
        valuesWithMessages.push(change.value);
      }
    }
  }

  if (valuesWithMessages.length === 0) return ack(); // statuses/recibos/etc.

  // Processa em background e responde 200 rapido (Meta exige ack veloz).
  const task = (async () => {
    for (const value of valuesWithMessages) {
      try { await handleInbound(supabase, value); }
      catch (e) { console.error("[meta-webhook] handleInbound error:", (e as any)?.message || e); }
    }
  })();

  const waitUntil = (globalThis as any).EdgeRuntime?.waitUntil;
  if (typeof waitUntil === "function") {
    waitUntil.call((globalThis as any).EdgeRuntime, task);
    return ack();
  }
  await task;
  return ack();
});
