import type { OutboxRecord } from "./effect-intent.ts";

// F2.7.14: append_assistant_turn and activate_objective are accepted-safe for send_message.
// They record what the agent sent/asked, not that the lead read it. Delivery and commercial
// outcomes (offer, focus, media, CRM, handoff, schedule and stage) remain delivered-only.
export const ACCEPTED_SAFE_OUTCOME_OPS: ReadonlySet<string> = new Set([
  "append_assistant_turn",
  // The provider accepted the same message that contains the question. This marks
  // what the agent asked, not that the lead read it. Delivery-sensitive outcomes
  // (offer, focus, media, CRM, handoff and scheduling) remain delivered-only.
  // Follow-up bookkeeping and handoff completion are provider-acceptance facts:
  // they record that the operational message was accepted for dispatch.
  "activate_objective",
  "mark_followup_sent",
  "mark_handoff_completed",
]);

export function isCriticalForConversationState(record: OutboxRecord): boolean {
  if (
    record.kind === "handoff"
    || record.kind === "crm_write"
    || record.kind === "schedule_visit"
    || record.kind === "send_media"
  ) return true;

  if (record.kind === "notify_seller") {
    return record.onSuccess.some((o) => !ACCEPTED_SAFE_OUTCOME_OPS.has(o.op));
  }

  // send_message so e "critico" (exige delivered) se tiver ALGUM outcome que nao seja accepted-safe.
  return record.kind === "send_message"
    && record.onSuccess.some((o) => !ACCEPTED_SAFE_OUTCOME_OPS.has(o.op));
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
