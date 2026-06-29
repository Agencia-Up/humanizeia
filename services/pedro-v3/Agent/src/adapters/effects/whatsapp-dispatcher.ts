import type { EffectResult, ToolError } from "../../domain/decision.ts";
import type { OutboxRecord } from "../../domain/effect-intent.ts";
import { redact } from "../../domain/effect-intent.ts";
import type { Clock } from "../../domain/ports.ts";
import type { TenantAgentRef, VehiclePhotoSource } from "../../domain/read-ports.ts";
import type { JsonValue } from "../../domain/types.ts";
import type { EffectDispatcher } from "../../engine/outbox-dispatcher.ts";

export type WhatsAppReceiptLevel = "accepted" | "delivered";

export type WhatsAppSendOk = {
  readonly ok: true;
  readonly level: WhatsAppReceiptLevel;
  readonly providerMessageId?: string;
};

export type WhatsAppSendFail = {
  readonly ok: false;
  readonly code: ToolError["code"];
  readonly message: string;
  readonly retryable: boolean;
};

export type WhatsAppSendResult = WhatsAppSendOk | WhatsAppSendFail;

export type WhatsAppTextInput = {
  readonly to: string;
  readonly text: string;
  readonly idempotencyKey: string;
};

export type WhatsAppMediaInput = {
  readonly to: string;
  readonly url: string;
  readonly photoId: string;
  readonly idempotencyKey: string;
};

export interface WhatsAppSendPort {
  sendText(input: WhatsAppTextInput): Promise<WhatsAppSendResult>;
  sendImage(input: WhatsAppMediaInput): Promise<WhatsAppSendResult>;
}

export type WhatsAppDispatcherOptions = {
  readonly ref: TenantAgentRef;
  readonly conversationId: string;
  readonly to: string;
  readonly clock: Clock;
  readonly sender: WhatsAppSendPort;
  readonly photoSource: VehiclePhotoSource;
};

function toolError(code: ToolError["code"], message: string, retryable: boolean): ToolError {
  return { code, message, retryable };
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadOf(record: OutboxRecord): Record<string, unknown> {
  const { __redacted: _ignored, ...payload } = record.payload as Record<string, unknown>;
  return payload;
}

function stringField(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringArrayField(payload: Record<string, unknown>, field: string): string[] | null {
  const value = payload[field];
  if (!Array.isArray(value)) return null;
  const out = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return out.length === value.length && out.length > 0 ? out : null;
}

function failed(record: OutboxRecord, code: ToolError["code"], message: string, retryable: boolean): EffectResult {
  return { status: "failed", effectId: record.effectId, error: toolError(code, message, retryable) };
}

function succeeded(record: OutboxRecord, level: WhatsAppReceiptLevel, at: string, providerMessageId?: string, perItem?: { photoId: string; status: "succeeded" | "failed" }[]): EffectResult {
  return {
    status: "succeeded",
    effectId: record.effectId,
    receipt: {
      effectId: record.effectId,
      level,
      at,
      providerMessageId,
      ...(perItem ? { perItem } : {}),
    },
  };
}

function uncertain(record: OutboxRecord, reason: string): EffectResult {
  return {
    status: "outcome_uncertain",
    effectId: record.effectId,
    metadata: redact({ reason } satisfies { [k: string]: JsonValue }),
  };
}

// Rotulo SEGURO de erro p/ diagnostico: nome + code (enum-like) do erro, NUNCA a mensagem (que pode
// conter token/segredo). Ex.: "SupabaseServiceGatewayError:HTTP_FAILURE" ou "Error". Sem isso, o catch
// devolvia so "sender_text_exception" e a causa do envio ficava invisivel (F2.6Q).
function safeErrLabel(error: unknown): string {
  const name = error instanceof Error && typeof error.name === "string" && error.name ? error.name : "Error";
  const codeRaw = (error as { code?: unknown } | null | undefined)?.code;
  const code = typeof codeRaw === "string" && /^[A-Za-z0-9_.:/ -]{1,80}$/.test(codeRaw) ? `:${codeRaw}` : "";
  return `${name}${code}`;
}

function combineLevels(results: readonly WhatsAppSendOk[]): WhatsAppReceiptLevel {
  return results.every((item) => item.level === "delivered") ? "delivered" : "accepted";
}

export class WhatsAppEffectDispatcher implements EffectDispatcher {
  constructor(private readonly opts: WhatsAppDispatcherOptions) {}

  async dispatch(record: OutboxRecord): Promise<EffectResult> {
    if (record.conversationId !== this.opts.conversationId) {
      return failed(record, "FORBIDDEN", "conversation_mismatch", false);
    }

    if (record.kind === "send_message") return this.dispatchText(record);
    if (record.kind === "send_media") return this.dispatchMedia(record);

    return failed(record, "FORBIDDEN", `unsupported_effect_kind:${record.kind}`, false);
  }

  private async dispatchText(record: OutboxRecord): Promise<EffectResult> {
    const payload = payloadOf(record);
    if (!isRecordObject(payload)) return failed(record, "VALIDATION", "invalid_payload", false);

    const text = stringField(payload, "text");
    if (!text) return failed(record, "VALIDATION", "missing_text", false);

    let result: WhatsAppSendResult;
    try {
      result = await this.opts.sender.sendText({
        to: this.opts.to,
        text,
        idempotencyKey: record.idempotencyKey,
      });
    } catch (error) {
      const label = safeErrLabel(error);
      console.error(JSON.stringify({ event: "pedro_v3_send_text_exception", effectId: record.effectId, label }));
      return uncertain(record, `sender_text_exception:${label}`);
    }

    if (!result.ok) return failed(record, result.code, result.message, result.retryable);
    return succeeded(record, result.level, this.opts.clock.now(), result.providerMessageId);
  }

  private async dispatchMedia(record: OutboxRecord): Promise<EffectResult> {
    const payload = payloadOf(record);
    if (!isRecordObject(payload)) return failed(record, "VALIDATION", "invalid_payload", false);

    const vehicleKey = stringField(payload, "vehicleKey");
    const photoIds = stringArrayField(payload, "photoIds");
    if (!vehicleKey || !photoIds) return failed(record, "VALIDATION", "missing_media_reference", false);

    const urls = await this.opts.photoSource.resolveUrls(this.opts.ref, vehicleKey, photoIds);
    if (urls.length !== photoIds.length) {
      return failed(record, "VALIDATION", "media_reference_not_resolvable", false);
    }

    const successes: WhatsAppSendOk[] = [];
    const perItem: { photoId: string; status: "succeeded" | "failed" }[] = [];
    for (let i = 0; i < photoIds.length; i += 1) {
      const photoId = photoIds[i];
      const url = urls[i];
      let result: WhatsAppSendResult;
      try {
        result = await this.opts.sender.sendImage({
          to: this.opts.to,
          url,
          photoId,
          idempotencyKey: `${record.idempotencyKey}:${photoId}`,
        });
      } catch (error) {
        const label = safeErrLabel(error);
        console.error(JSON.stringify({ event: "pedro_v3_send_media_exception", effectId: record.effectId, label }));
        return uncertain(record, `sender_media_exception:${label}`);
      }

      if (!result.ok) {
        perItem.push({ photoId, status: "failed" });
        if (result.retryable) return uncertain(record, "media_send_partial_retryable");
        return failed(record, result.code, result.message, false);
      }

      successes.push(result);
      perItem.push({ photoId, status: "succeeded" });
    }

    return succeeded(
      record,
      combineLevels(successes),
      this.opts.clock.now(),
      successes.map((item) => item.providerMessageId).filter(Boolean).join(",") || undefined,
      perItem,
    );
  }
}
