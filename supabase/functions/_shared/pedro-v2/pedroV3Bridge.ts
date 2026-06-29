import {
  PEDRO_V3_PILOT_AGENT_ID,
  PEDRO_V3_PILOT_TENANT_ID,
  isPedroV3PilotIdentity,
} from "./pedroV3PilotGate.ts";

const MAX_RESPONSE_BYTES = 32 * 1024;
const BRIDGE_TIMEOUT_MS = 95_000;

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

function incomingRemoteJid(payload: any): string | null {
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

function normalizePhone(value: string | null): string | null {
  const digits = String(value ?? "").replace(/@.*$/, "").replace(/\D+/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length === 12 || digits.length === 13) return digits;
  return null;
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

export async function buildPedroV3BridgeTurn(input: {
  payload: any;
  tenantId: string | null | undefined;
  agentId: string | null | undefined;
  build: string;
}): Promise<PedroV3BridgeBuildResult> {
  if (!isPedroV3PilotIdentity(input)) return { ok: false, reason: "not_pilot_identity" };
  const messageId = incomingMessageId(input.payload);
  if (!messageId) return { ok: false, reason: "message_id_missing" };
  const phone = normalizePhone(incomingRemoteJid(input.payload));
  if (!phone) return { ok: false, reason: "phone_invalid" };
  const text = incomingText(input.payload);
  if (!text) return { ok: false, reason: "text_unsupported" };

  const eventHash = await sha256(`${PEDRO_V3_PILOT_TENANT_ID}|${PEDRO_V3_PILOT_AGENT_ID}|${messageId}`);
  const conversationHash = await sha256(`${PEDRO_V3_PILOT_TENANT_ID}|${PEDRO_V3_PILOT_AGENT_ID}|${phone}`);
  return {
    ok: true,
    turn: {
      tenantId: PEDRO_V3_PILOT_TENANT_ID,
      agentId: PEDRO_V3_PILOT_AGENT_ID,
      conversationId: `wa:${conversationHash}`,
      turnId: `turn:${eventHash}`,
      eventId: `uazapi:${eventHash}`,
      workerId: `edge:${input.build}`,
      to: phone,
      messageText: text.slice(0, 12_000),
      receivedAt: receivedAt(input.payload),
      leadId: null,
    },
  };
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
}): PedroV3ReceiptBuildResult {
  if (!isPedroV3PilotIdentity(input)) return { ok: false, reason: "not_pilot_identity" };
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
      tenantId: PEDRO_V3_PILOT_TENANT_ID,
      agentId: PEDRO_V3_PILOT_AGENT_ID,
      providerMessageId,
      status: rawStatus,
      occurredAt: receivedAt(input.payload),
    },
  };
}
function parseServiceBody(value: unknown): { ingested: boolean | "unknown" | null; status: string | null } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ingested: null, status: null };
  }
  const row = value as Record<string, unknown>;
  const ingested = row.ingested === true || row.ingested === false || row.ingested === "unknown"
    ? row.ingested
    : null;
  return { ingested, status: typeof row.status === "string" ? row.status : null };
}

export function classifyPedroV3BridgeResponse(httpStatus: number, body: unknown): PedroV3BridgeCallResult {
  const parsed = parseServiceBody(body);
  if (parsed.ingested === false) {
    return { kind: "pre_ingest_failure", httpStatus, serviceStatus: parsed.status };
  }
  if (httpStatus >= 200 && httpStatus < 300 && parsed.ingested === true) {
    return { kind: "accepted", httpStatus, serviceStatus: parsed.status };
  }
  return { kind: "uncertain", httpStatus, serviceStatus: parsed.status };
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
