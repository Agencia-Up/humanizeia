import {
  type PedroV3ActiveScope,
  isPedroV3PilotIdentity,
} from "./pedroV3PilotGate.ts";

const MAX_RESPONSE_BYTES = 32 * 1024;
const BRIDGE_TIMEOUT_MS = 95_000;

// F2.32 (CTWA): contexto de anúncio SANITIZADO extraído do externalAdReply do Meta. É CONTEXTO (não resposta do lead);
// o v3 resolve o veículo do texto e o usa como intenção inicial. capturedAtTurn é carimbado pelo engine (aqui não).
export type PedroV3AdReferral = {
  adId: string | null;
  source: string | null;
  sourceUrl: string | null;
  title: string | null;
  body: string | null;
  greeting: string | null;
  imageUrls: string[];
};

export type PedroV3MediaContext = {
  kind: "audio" | "image" | "video" | "document" | "unknown";
  text: string | null;
  summary: string | null;
  vehicleQuery: string | null;
  vehicleType: string | null;
  confidence: number;
  transcriptionAvailable: boolean | null;
};

export type PedroV3BridgeTurn = {
  tenantId: string;
  agentId: string;
  conversationId: string;
  turnId: string;
  eventId: string;
  workerId: string;
  to: string;
  messageText: string;
  receivedAt: string;
  leadId: null;
  mediaContext?: PedroV3MediaContext;
  leadNameHint: string | null;   // ⭐SEM inv.7: pushName/notifyName do WhatsApp, SANITIZADO (hint p/ lead_name inicial; nunca autoridade)
  adReferral?: PedroV3AdReferral;   // F2.32: só quando o payload traz externalAdReply (1ª msg do anúncio)
};

export type PedroV3BridgeBuildResult =
  | { ok: true; turn: PedroV3BridgeTurn }
  | { ok: false; reason: "not_pilot_identity" | "message_id_missing" | "phone_invalid" | "text_unsupported" };

export type PedroV3DeliveryReceipt = {
  tenantId: string;
  agentId: string;
  providerMessageId: string;
  status: "delivered" | "read";
  occurredAt: string;
};

export type PedroV3ReceiptBuildResult =
  | { ok: true; receipt: PedroV3DeliveryReceipt }
  | { ok: false; reason: "not_pilot_identity" | "not_message_update" | "provider_message_id_missing" | "status_ignored" };

export type PedroV3ReceiptBridgeCallResult = {
  kind: "accepted" | "uncertain";
  httpStatus: number | null;
  serviceStatus: string | null;
};
export type PedroV3BridgeCallResult = {
  kind: "accepted" | "pre_ingest_failure" | "uncertain";
  httpStatus: number | null;
  serviceStatus: string | null;
};

function pickIncoming(payload: any): any {
  if (Array.isArray(payload?.messages) && payload.messages.length > 0) return payload.messages[0];
  if (Array.isArray(payload?.data) && payload.data.length > 0) return payload.data[0];
  return payload?.message || payload?.data || payload;
}

function firstString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function incomingMessageId(payload: any): string | null {
  const message = pickIncoming(payload);
  return firstString([
    message?.key?.id,
    message?.messageid,
    message?.messageId,
    message?.id,
    payload?.messageid,
    payload?.messageId,
    payload?.id,
    payload?.data?.key?.id,
    payload?.data?.messageid,
    payload?.data?.message?.key?.id,
    payload?.data?.message?.messageid,
  ]);
}

function incomingText(payload: any): string | null {
  const message = pickIncoming(payload);
  return firstString([
    message?.text,
    message?.body,
    message?.content,
    message?.caption,
    message?.message?.conversation,
    message?.message?.extendedTextMessage?.text,
    payload?.text,
    payload?.body,
    payload?.message?.text,
    payload?.data?.text,
    payload?.data?.message?.conversation,
    payload?.data?.message?.extendedTextMessage?.text,
  ]);
}

export function incomingRemoteJid(payload: any): string | null {
  const message = pickIncoming(payload);
  const primary = firstString([
    message?.sender_pn,
    message?.key?.remoteJid,
    message?.chatid,
    message?.sender,
    message?.from,
    payload?.sender_pn,
    payload?.remoteJid,
    payload?.chatid,
    payload?.data?.sender_pn,
    payload?.data?.key?.remoteJid,
  ]);
  if (!primary?.endsWith("@lid")) return primary;
  return firstString([
    message?.key?.remoteJidAlt,
    message?.remoteJidAlt,
    message?.sender_pn,
    payload?.remoteJidAlt,
    payload?.sender_pn,
  ]) ?? primary;
}

export function shouldBridgePedroV3Identity(kind: "lead" | "seller" | "unknown"): boolean {
  return kind !== "seller";
}

function normalizePhone(value: string | null): string | null {
  const digits = String(value ?? "").replace(/@.*$/, "").replace(/\D+/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length === 12 || digits.length === 13) return digits;
  return null;
}

// ⭐SEM inv.7: pushName/contactName do WhatsApp como HINT de nome — sanitizado (trim, sem control chars, cap 60).
// NUNCA e autoridade de nome: o v3 so o usa se passar em isRealLeadName (emoji/simbolo/placeholder nao entram).
function extractLeadNameHint(payload: any): string | null {
  const message = pickIncoming(payload);
  const raw = firstString([
    message?.pushName, message?.pushname, message?.notifyName, message?.senderName, message?.sender_name,
    payload?.pushName, payload?.pushname, payload?.data?.pushName, payload?.data?.message?.pushName,
  ]);
  if (!raw) return null;
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);
  return clean.length >= 2 ? clean : null;
}

function receivedAt(payload: any): string {
  const message = pickIncoming(payload);
  const raw = message?.messageTimestamp ?? message?.timestamp ?? payload?.messageTimestamp ?? payload?.timestamp;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    const millis = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(millis);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// F2.32 (CTWA): extrai o externalAdReply do payload (lookup em cascata — o contextInfo/adReply aparece em vários níveis
// do payload uazapi/Meta). Sanitiza os campos (aliases: greetingMessageBody/greetingMessage/greeting; sourceId/source_id/
// ad_id/sourceID; body/description; sourceUrl/source_url/sourceURL; imagens original/thumbnail/media). null se não houver
// anúncio. NÃO carrega blobs (thumbnail base64). PURO.
function firstStr(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}
export function extractAdReferral(payload: any): PedroV3AdReferral | null {
  const message = pickIncoming(payload);
  const msg = message?.message || message;
  const ext = msg?.extendedTextMessage || message?.extendedTextMessage;
  const ctxOf = (o: any) => (o && typeof o === "object" && o.contextInfo && typeof o.contextInfo === "object") ? o.contextInfo : null;
  const contextInfo = ext?.contextInfo
    || msg?.contextInfo
    || message?.contextInfo
    || ctxOf(message?.content)
    || ctxOf(msg?.content)
    || ctxOf(payload?.message?.content)
    || ctxOf(payload?.data?.message?.content)
    || payload?.contextInfo
    || {};
  const adReply = contextInfo?.externalAdReply || message?.externalAdReply || payload?.externalAdReply || payload?.data?.externalAdReply || null;
  if (!adReply || typeof adReply !== "object") return null;
  const clamp = (s: string | null, max: number): string | null => (s ? s.slice(0, max) : null);
  const greeting = clamp(firstStr(adReply.greetingMessageBody, adReply.greetingMessage, adReply.greeting), 400);
  const title = clamp(firstStr(adReply.title), 400);
  const body = clamp(firstStr(adReply.body, adReply.description), 1000);
  const sourceUrl = clamp(firstStr(adReply.sourceUrl, adReply.source_url, adReply.sourceURL), 512);
  const adId = clamp(firstStr(adReply.sourceId, adReply.source_id, adReply.ad_id, adReply.sourceID), 128);
  const source = clamp(firstStr(adReply.sourceApp, contextInfo?.conversionSource, adReply.sourceType), 64);
  const imageUrls = [
    firstStr(adReply.originalImageURL, adReply.originalImageUrl),
    firstStr(adReply.thumbnailUrl, adReply.thumbnailURL),
    firstStr(adReply.mediaUrl, adReply.mediaURL),
  ].filter((u): u is string => typeof u === "string").map((u) => u.slice(0, 512)).slice(0, 3);
  if (!adId && !title && !body && !greeting && !sourceUrl) return null;
  return { adId, source, sourceUrl, title, body, greeting, imageUrls };
}

export async function buildPedroV3BridgeTurn(input: {
  payload: any;
  tenantId: string | null | undefined;
  agentId: string | null | undefined;
  build: string;
  mediaContext?: PedroV3MediaContext | null;
  activeScopes?: readonly PedroV3ActiveScope[];
}): Promise<PedroV3BridgeBuildResult> {
  if (!isPedroV3PilotIdentity(input, input.activeScopes)) return { ok: false, reason: "not_pilot_identity" };
  const messageId = incomingMessageId(input.payload);
  if (!messageId) return { ok: false, reason: "message_id_missing" };
  const phone = normalizePhone(incomingRemoteJid(input.payload));
  if (!phone) return { ok: false, reason: "phone_invalid" };
  const text = mergeInboundLeadText(incomingText(input.payload), mediaContextLeadText(input.mediaContext));
  if (!text) return { ok: false, reason: "text_unsupported" };

  const tenantId = input.tenantId!;
  const agentId = input.agentId!;
  const eventHash = await sha256(`${tenantId}|${agentId}|${messageId}`);
  const conversationHash = await sha256(`${tenantId}|${agentId}|${phone}`);
  const adReferral = extractAdReferral(input.payload);   // F2.32 (CTWA): só na 1ª msg do anúncio; senão null.
  return {
    ok: true,
    turn: {
      tenantId,
      agentId,
      conversationId: `wa:${conversationHash}`,
      turnId: `turn:${eventHash}`,
      eventId: `uazapi:${eventHash}`,
      workerId: `edge:${input.build}`,
      to: phone,
      messageText: text.slice(0, 12_000),
      receivedAt: receivedAt(input.payload),
      leadId: null,
      leadNameHint: extractLeadNameHint(input.payload),
      ...(adReferral ? { adReferral } : {}),
      ...(input.mediaContext ? { mediaContext: input.mediaContext } : {}),
    },
  };
}

function mediaContextLeadText(context: PedroV3MediaContext | null | undefined): string | null {
  if (!context) return null;
  const detail = [context.text, context.summary, context.vehicleQuery, context.vehicleType]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" | ");
  if (detail) return `[${context.kind} recebida; contexto extraido: ${detail}]`;
  if (context.kind === "audio") return "[audio recebido sem transcricao disponivel]";
  return `[${context.kind} recebida sem descricao disponivel]`;
}

function mergeInboundLeadText(messageText: string | null, mediaText: string | null): string | null {
  if (!messageText) return mediaText;
  if (!mediaText) return messageText;
  // A caption is the lead's own instruction; extracted media context only enriches it.
  return `${messageText}\n${mediaText}`;
}

function eventType(payload: any): string {
  return String(payload?.EventType ?? payload?.eventType ?? payload?.event ?? payload?.type ?? "")
    .trim()
    .toLowerCase();
}

export function buildPedroV3DeliveryReceipt(input: {
  payload: any;
  tenantId: string | null | undefined;
  agentId: string | null | undefined;
  activeScopes?: readonly PedroV3ActiveScope[];
}): PedroV3ReceiptBuildResult {
  if (!isPedroV3PilotIdentity(input, input.activeScopes)) return { ok: false, reason: "not_pilot_identity" };
  const type = eventType(input.payload);
  if (type !== "messages_update" && type !== "message_update" && type !== "messages.update") {
    return { ok: false, reason: "not_message_update" };
  }
  const message = pickIncoming(input.payload);
  const providerMessageId = incomingMessageId(input.payload);
  if (!providerMessageId || providerMessageId.length > 240 || /\s/.test(providerMessageId)) {
    return { ok: false, reason: "provider_message_id_missing" };
  }
  const rawStatus = String(
    message?.status
      ?? message?.update?.status
      ?? input.payload?.status
      ?? input.payload?.data?.status
      ?? input.payload?.data?.message?.status
      ?? "",
  ).trim().toLowerCase();
  if (rawStatus !== "delivered" && rawStatus !== "read") {
    return { ok: false, reason: "status_ignored" };
  }
  return {
    ok: true,
    receipt: {
      tenantId: input.tenantId!,
      agentId: input.agentId!,
      providerMessageId,
      status: rawStatus,
      occurredAt: receivedAt(input.payload),
    },
  };
}
function parseServiceBody(value: unknown): {
  ingested: boolean | "unknown" | null;
  status: string | null;
  dispatched: number | null;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ingested: null, status: null, dispatched: null };
  }
  const row = value as Record<string, unknown>;
  const ingested = row.ingested === true || row.ingested === false || row.ingested === "unknown"
    ? row.ingested
    : null;
  return {
    ingested,
    status: typeof row.status === "string" ? row.status : null,
    dispatched: typeof row.dispatched === "number" && Number.isFinite(row.dispatched) ? row.dispatched : null,
  };
}

export function classifyPedroV3BridgeResponse(httpStatus: number, body: unknown): PedroV3BridgeCallResult {
  const parsed = parseServiceBody(body);
  if (parsed.ingested === false) {
    return { kind: "pre_ingest_failure", httpStatus, serviceStatus: parsed.status };
  }
  // If the v3 service proves the turn failed before any provider dispatch, the
  // bridge may safely let v2 answer. This prevents the pilot from creating a
  // silent lead while preserving the anti-double-reply rule after dispatch.
  if (parsed.ingested === true && parsed.status === "commit_failed" && parsed.dispatched === 0) {
    return { kind: "pre_ingest_failure", httpStatus, serviceStatus: parsed.status };
  }
  if (httpStatus >= 200 && httpStatus < 300 && parsed.ingested === true) {
    return { kind: "accepted", httpStatus, serviceStatus: parsed.status };
  }
  return { kind: "uncertain", httpStatus, serviceStatus: parsed.status };
}

// ── INC1 (P0 STICKY ROUTING): uma conversa JÁ ASSUMIDA pelo v3 NUNCA pode cair pro v2 no meio. O fallback pro v2 só é
//    legítimo ANTES do v3 assumir a conversa (sem routing/state) e SÓ num pre_ingest_failure PROVADO. Decisão PURA
//    (testável offline). Incidente real: o lead mandou o telefone, o v3 devolveu ingested:false (pre_ingest_failure) e o
//    bridge chamou o v2 -> saudação "Oi! Aqui é o Aloan" no meio da conversa. O routing PROVAVA que o v3 era dono. ──
export function shouldFallbackToPedroV2(input: {
  classification: PedroV3BridgeCallResult["kind"];
  hasV3Routing: boolean;
  hasV3State: boolean;
}): { fallback: boolean; reason: string } {
  // Só um pre_ingest_failure PROVADO pode deixar o v2 responder (evita lead silencioso). accepted/uncertain e os
  // estados de sucesso do v3 (duplicate/no_op/superseded chegam como accepted) NUNCA caem pro v2.
  if (input.classification !== "pre_ingest_failure") {
    return { fallback: false, reason: `v3_no_fallback_${input.classification}` };
  }
  // ...e SÓ se a conversa NUNCA foi assumida pelo v3. Routing OU state presentes = v3 é dono -> STICKY, bloqueia o v2.
  if (input.hasV3Routing || input.hasV3State) {
    return { fallback: false, reason: "v3_sticky_route_blocked_v2_fallback" };
  }
  return { fallback: true, reason: "v3_pre_ingest_failure_no_route" };
}

// Lookup do routing do v3 (o v3 grava v3_conversation_routing ao INGERIR o 1º bloco). Presença = "v3 já assumiu esta
// conversa". FAIL-SAFE contra o hijack: em erro/exceção devolve TRUE (bloqueia o v2) — coerente com "uncertain nunca
// dá double-reply"; só um resultado LIMPO sem linha (v3 nunca assumiu) libera o fallback pro v2.
export async function conversationHasV3Routing(
  client: { from: (table: string) => any },
  tenantId: string,
  conversationId: string,
): Promise<boolean> {
  try {
    const { data, error } = await client
      .from("v3_conversation_routing")
      .select("conversation_id")
      .eq("tenant_id", tenantId)
      .eq("conversation_id", conversationId)
      .limit(1)
      .maybeSingle();
    if (error) return true;
    return data != null;
  } catch {
    return true;
  }
}

// Mesmo fail-safe do routing, mas olhando o estado canônico. Isto cobre conversas antigas/parciais onde o estado existe
// mas a linha de routing está ausente por migração, bug anterior ou limpeza seletiva.
export async function conversationHasV3State(
  client: { from: (table: string) => any },
  tenantId: string,
  conversationId: string,
): Promise<boolean> {
  try {
    const { data, error } = await client
      .from("v3_conversation_state")
      .select("conversation_id")
      .eq("tenant_id", tenantId)
      .eq("conversation_id", conversationId)
      .limit(1)
      .maybeSingle();
    if (error) return true;
    return data != null;
  } catch {
    return true;
  }
}

function serviceEndpoint(raw: string, path: "/v1/pilot/turn" | "/v1/pilot/receipt"): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
    return url.toString();
  } catch {
    return null;
  }
}

export async function callPedroV3Bridge(input: {
  serviceUrl: string;
  secret: string;
  turn: PedroV3BridgeTurn;
  timeoutMs?: number;
}): Promise<PedroV3BridgeCallResult> {
  const endpoint = serviceEndpoint(input.serviceUrl, "/v1/pilot/turn");
  if (!endpoint || typeof input.secret !== "string" || input.secret.trim().length < 32) {
    return { kind: "pre_ingest_failure", httpStatus: null, serviceStatus: "bridge_config_invalid" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? BRIDGE_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.secret.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.turn),
      redirect: "error",
      signal: controller.signal,
    });
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      return { kind: "uncertain", httpStatus: response.status, serviceStatus: "response_too_large" };
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      return { kind: "uncertain", httpStatus: response.status, serviceStatus: "response_too_large" };
    }
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* resposta invalida = incerta */ }
    return classifyPedroV3BridgeResponse(response.status, body);
  } catch {
    return { kind: "uncertain", httpStatus: null, serviceStatus: "network_or_timeout" };
  } finally {
    clearTimeout(timer);
  }
}
export async function callPedroV3ReceiptBridge(input: {
  serviceUrl: string;
  secret: string;
  receipt: PedroV3DeliveryReceipt;
  timeoutMs?: number;
}): Promise<PedroV3ReceiptBridgeCallResult> {
  const endpoint = serviceEndpoint(input.serviceUrl, "/v1/pilot/receipt");
  if (!endpoint || typeof input.secret !== "string" || input.secret.trim().length < 32) {
    return { kind: "uncertain", httpStatus: null, serviceStatus: "bridge_config_invalid" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? BRIDGE_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.secret.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.receipt),
      redirect: "error",
      signal: controller.signal,
    });
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      return { kind: "uncertain", httpStatus: response.status, serviceStatus: "response_too_large" };
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      return { kind: "uncertain", httpStatus: response.status, serviceStatus: "response_too_large" };
    }
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* invalid response remains uncertain */ }
    const parsed = parseServiceBody(body);
    return response.ok
      ? { kind: "accepted", httpStatus: response.status, serviceStatus: parsed.status }
      : { kind: "uncertain", httpStatus: response.status, serviceStatus: parsed.status };
  } catch {
    return { kind: "uncertain", httpStatus: null, serviceStatus: "network_or_timeout" };
  } finally {
    clearTimeout(timer);
  }
}
