import type { OutboxRecord } from "./effect-intent.ts";

// F2.7.4: outcomes "accepted-safe" aplicam quando o provider apenas ACEITOU o envio (= memoria do que o
// AGENTE enviou). Hoje so `append_assistant_turn` (a fala do agente) e accepted-safe. Tudo mais — entrega ao
// lead (mark_message_delivered), objetivo critico (activate_objective), oferta/foco/fotos/handoff/stage,
// CRM/handoff/agenda — exige DELIVERED (confirmacao externa real). Separacao rigida aprovada pelo Codex.
export const ACCEPTED_SAFE_OUTCOME_OPS: ReadonlySet<string> = new Set(["append_assistant_turn"]);

export function isCriticalForConversationState(record: OutboxRecord): boolean {
  if (
    record.kind === "handoff"
    || record.kind === "crm_write"
    || record.kind === "schedule_visit"
    || record.kind === "notify_seller"
    || record.kind === "send_media"
  ) return true;

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
