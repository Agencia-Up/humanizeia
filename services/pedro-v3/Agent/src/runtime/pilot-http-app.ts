import { createHash, timingSafeEqual } from "node:crypto";
import type { PilotActiveTurnResult } from "../engine/pilot-active-root.ts";
import type { ProviderDeliveryResult } from "../engine/provider-delivery-receipt.ts";
import {
  isPedroV3ActiveScope,
  type PedroV3ActiveScope,
} from "../domain/pilot-scope.ts";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_MESSAGE_CHARS = 12_000;
const SAFE_ID = /^[a-zA-Z0-9:_@.+-]{1,240}$/;
const PHONE = /^\d{12,13}$/;

export type PilotHttpRequest = {
  readonly method: string;
  readonly pathname: string;
  readonly authorization?: string | null;
  readonly contentType?: string | null;
  readonly bodyText?: string;
};

export type PilotHttpResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

export type PilotTurnPayload = {
  readonly tenantId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly eventId: string;
  readonly workerId: string;
  readonly to: string;
  readonly messageText: string;
  readonly receivedAt: string;
  readonly leadId?: string | null;
  readonly leadNameHint?: string | null;   // ⭐SEM inv.7: hint sanitizado do bridge (pushName)
  // F2.32 (CTWA): contexto de anúncio SANITIZADO forwardado pelo bridge (só na 1ª mensagem do anúncio). Opaco (o engine
  // valida/sanitiza o shape via sanitizeAdContext).
  readonly adReferral?: unknown;
  readonly mediaContext?: unknown;
};

export interface PilotTurnRunner {
  run(payload: PilotTurnPayload): Promise<PilotActiveTurnResult>;
}

export type PilotReceiptPayload = {
  readonly tenantId: string;
  readonly agentId: string;
  readonly providerMessageId: string;
  readonly status: "delivered" | "read";
  readonly occurredAt: string;
};

export interface PilotReceiptRunner {
  applyReceipt(payload: PilotReceiptPayload): Promise<ProviderDeliveryResult>;
}

export type PilotHealthInfo = () => Readonly<Record<string, unknown>>;

export class PilotTurnRuntimeError extends Error {
  constructor(
    public readonly code: "PILOT_BOOTSTRAP_FAILED" | "PILOT_TURN_FAILED",
    public readonly ingested: boolean | "unknown",
  ) {
    super(code);
    this.name = "PilotTurnRuntimeError";
  }
}

export class PilotHttpConfigError extends Error {
  constructor(public readonly code: "BRIDGE_SECRET_INVALID") {
    super(code);
    this.name = "PilotHttpConfigError";
  }
}

function sanitizeRuntimeReason(value: unknown): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : "unknown";
  return raw
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/sk-[a-z0-9._-]+/gi, "[redacted]")
    .replace(/[a-z0-9_-]{20,}\.[a-z0-9_-]{20,}\.[a-z0-9_-]{20,}/gi, "[redacted-jwt]")
    .slice(0, 240);
}
function json(status: number, value: Record<string, unknown>): PilotHttpResponse {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(value),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function secretDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function authorized(header: string | null | undefined, expectedDigest: Buffer): boolean {
  const raw = typeof header === "string" && header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : "";
  const actual = secretDigest(raw);
  return timingSafeEqual(actual, expectedDigest);
}

function parsePayload(bodyText: string): PilotTurnPayload | null {
  if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(bodyText) as unknown;
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;

  const tenantId = readString(raw.tenantId);
  const agentId = readString(raw.agentId);
  const conversationId = readString(raw.conversationId);
  const turnId = readString(raw.turnId);
  const eventId = readString(raw.eventId);
  const workerId = readString(raw.workerId);
  const to = readString(raw.to);
  const messageText = readString(raw.messageText);
  const receivedAt = readString(raw.receivedAt);
  const leadId = raw.leadId == null ? null : readString(raw.leadId);
  const leadNameHint = raw.leadNameHint == null ? null : readString(raw.leadNameHint);

  if (!tenantId || !agentId || !conversationId || !turnId || !eventId || !workerId || !to || !messageText || !receivedAt) {
    return null;
  }
  if (![conversationId, turnId, eventId, workerId].every((value) => SAFE_ID.test(value))) return null;
  if (!PHONE.test(to) || messageText.length > MAX_MESSAGE_CHARS) return null;
  if (!Number.isFinite(Date.parse(receivedAt))) return null;
  if (leadId !== null && !SAFE_ID.test(leadId)) return null;

  // F2.32 (CTWA): adReferral opaco (só objeto simples). O engine sanitiza/clampa os campos via sanitizeAdContext.
  const adReferral = (raw.adReferral && typeof raw.adReferral === "object" && !Array.isArray(raw.adReferral)) ? raw.adReferral : undefined;
  const mediaContext = (raw.mediaContext && typeof raw.mediaContext === "object" && !Array.isArray(raw.mediaContext)) ? raw.mediaContext : undefined;

  return {
    tenantId,
    agentId,
    conversationId,
    turnId,
    eventId,
    workerId,
    to,
    messageText,
    receivedAt: new Date(receivedAt).toISOString(),
    leadId,
    leadNameHint: leadNameHint ?? null,
    ...(adReferral ? { adReferral } : {}),
    ...(mediaContext ? { mediaContext } : {}),
  };
}

function parseReceiptPayload(bodyText: string): PilotReceiptPayload | null {
  if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(bodyText) as unknown;
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const tenantId = readString(raw.tenantId);
  const agentId = readString(raw.agentId);
  const providerMessageId = readString(raw.providerMessageId);
  const occurredAt = readString(raw.occurredAt);
  const normalizedStatus = readString(raw.status)?.toLowerCase();
  if (
    !tenantId
    || !agentId
    || !providerMessageId
    || !occurredAt
    || (normalizedStatus !== "delivered" && normalizedStatus !== "read")
  ) return null;
  if (/\s/.test(providerMessageId) || providerMessageId.length > 240) return null;
  if (!Number.isFinite(Date.parse(occurredAt))) return null;
  return {
    tenantId,
    agentId,
    providerMessageId,
    status: normalizedStatus,
    occurredAt: new Date(occurredAt).toISOString(),
  };
}
export class PilotHttpApp {
  readonly #secretDigest: Buffer;

  constructor(
    secret: string,
    private readonly runner: PilotTurnRunner,
    private readonly receiptRunner?: PilotReceiptRunner,
    private readonly healthInfo?: PilotHealthInfo,
    private readonly activeScopes?: readonly PedroV3ActiveScope[],
  ) {
    if (typeof secret !== "string" || secret.trim().length < 32) {
      throw new PilotHttpConfigError("BRIDGE_SECRET_INVALID");
    }
    this.#secretDigest = secretDigest(secret.trim());
  }

  async handle(request: PilotHttpRequest): Promise<PilotHttpResponse> {
    if (request.method === "GET" && request.pathname === "/health") {
      return json(200, { ok: true, service: "pedro-v3", mode: "pilot", ...(this.healthInfo?.() ?? {}) });
    }
    if (
      request.method !== "POST"
      || (request.pathname !== "/v1/pilot/turn" && request.pathname !== "/v1/pilot/receipt")
    ) {
      return json(404, { ok: false, error: "not_found", ingested: false });
    }
    if (!authorized(request.authorization, this.#secretDigest)) {
      return json(401, { ok: false, error: "unauthorized", ingested: false });
    }
    if (!(request.contentType ?? "").toLowerCase().includes("application/json")) {
      return json(415, { ok: false, error: "content_type_invalid", ingested: false });
    }

    if (request.pathname === "/v1/pilot/receipt") {
      const receipt = parseReceiptPayload(request.bodyText ?? "");
      if (!receipt) return json(400, { ok: false, error: "receipt_payload_invalid" });
      if (!isPedroV3ActiveScope({ tenantId: receipt.tenantId, agentId: receipt.agentId }, this.activeScopes)) {
        return json(403, { ok: false, error: "pilot_scope_denied" });
      }
      if (!this.receiptRunner) return json(503, { ok: false, error: "receipt_runner_unavailable" });
      try {
        const result = await this.receiptRunner.applyReceipt(receipt);
        return json(200, { ok: true, status: result.status });
      } catch {
        return json(503, { ok: false, error: "receipt_runtime_failed" });
      }
    }
    const payload = parsePayload(request.bodyText ?? "");
    if (!payload) return json(400, { ok: false, error: "payload_invalid", ingested: false });
    if (!isPedroV3ActiveScope(payload, this.activeScopes)) {
      return json(403, { ok: false, error: "pilot_scope_denied", ingested: false });
    }

    try {
      const result = await this.runner.run(payload);
      if (result.status === "duplicate") {
        return json(200, { ok: true, status: "duplicate", ingested: true, dispatched: 0 });
      }
      if (result.status === "commit_failed") {
        return json(503, {
          ok: false,
          status: result.status,
          ingested: true,
          dispatched: result.dispatched,
          reason: result.engine.status === "commit_failed" ? sanitizeRuntimeReason(result.engine.reason) : "unknown",
        });
      }
      return json(200, {
        ok: true,
        status: result.status,
        ingested: true,
        dispatched: result.dispatched,
      });
    } catch (error) {
      if (error instanceof PilotTurnRuntimeError) {
        return json(503, { ok: false, error: error.code, ingested: error.ingested });
      }
      return json(500, { ok: false, error: "pilot_runtime_failed", ingested: "unknown" });
    }
  }
}
