import type { OutboxRecord } from "../domain/effect-intent.ts";
import type { Clock, Persistence } from "../domain/ports.ts";
import { commitEffectOutcome } from "./effect-outcome-commit.ts";

export interface ProviderReceiptPersistence extends Persistence {
  findOutboxByProviderMessageId(providerMessageId: string): Promise<OutboxRecord | null>;
}

export type ProviderDeliveryReceipt = {
  readonly providerMessageId: string;
  readonly status: "delivered" | "read";
  readonly at: string;
};

export type ProviderDeliveryResult = {
  readonly status: "applied" | "duplicate" | "not_found";
  readonly effectId?: string;
};

export class ProviderDeliveryReceiptError extends Error {
  constructor(public readonly code:
    | "RECEIPT_INVALID"
    | "RECEIPT_EFFECT_KIND_INVALID"
    | "RECEIPT_COMMIT_FAILED") {
    super(code);
    this.name = "ProviderDeliveryReceiptError";
  }
}

export async function applyProviderDeliveryReceipt(input: {
  readonly persistence: ProviderReceiptPersistence;
  readonly clock: Clock;
  readonly receipt: ProviderDeliveryReceipt;
}): Promise<ProviderDeliveryResult> {
  const providerMessageId = input.receipt.providerMessageId.trim();
  if (
    providerMessageId.length < 1
    || providerMessageId.length > 240
    || !Number.isFinite(Date.parse(input.receipt.at))
  ) {
    throw new ProviderDeliveryReceiptError("RECEIPT_INVALID");
  }

  const record = await input.persistence.findOutboxByProviderMessageId(providerMessageId);
  if (!record) return { status: "not_found" };
  if (record.kind !== "send_message") {
    throw new ProviderDeliveryReceiptError("RECEIPT_EFFECT_KIND_INVALID");
  }
  if (record.receiptLevel === "delivered" && record.outcomeAppliedAt !== null) {
    return { status: "duplicate", effectId: record.effectId };
  }

  const committed = await commitEffectOutcome({
    persistence: input.persistence,
    clock: input.clock,
    conversationId: record.conversationId,
    effectId: record.effectId,
    result: {
      status: "succeeded",
      effectId: record.effectId,
      receipt: {
        effectId: record.effectId,
        level: "delivered",
        providerMessageId,
        at: new Date(input.receipt.at).toISOString(),
      },
    },
  });
  if (!committed.ok) throw new ProviderDeliveryReceiptError("RECEIPT_COMMIT_FAILED");
  return { status: "applied", effectId: record.effectId };
}