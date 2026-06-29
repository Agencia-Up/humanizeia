import type { OutboxRecord } from "./effect-intent.ts";

export function isCriticalForConversationState(record: OutboxRecord): boolean {
  if (
    record.kind === "handoff"
    || record.kind === "crm_write"
    || record.kind === "schedule_visit"
    || record.kind === "notify_seller"
    || record.kind === "send_media"
  ) return true;

  return record.kind === "send_message" && record.onSuccess.length > 0;
}

export function requiredReceiptFor(record: OutboxRecord): "accepted" | "delivered" {
  return isCriticalForConversationState(record) ? "delivered" : "accepted";
}

export function isEffectSatisfiedForDependency(record: OutboxRecord): boolean {
  if (record.status !== "succeeded") return false;
  if (requiredReceiptFor(record) === "delivered") {
    return record.receiptLevel === "delivered" && record.outcomeAppliedAt != null;
  }
  return record.receiptLevel === "accepted" || record.receiptLevel === "delivered";
}
