// ============================================================================
// EffectMaterializer - F2.1. Converte EffectPlan semantico em OutboxRecord.
// SEM provider real, SEM dispatch, SEM rede. Payload ja nasce redacted.
// ============================================================================
import type { EffectKind, EffectPlan, RenderedResponse, TurnDecision } from "../domain/decision.ts";
import type { OutboxRecord, ProviderCapability } from "../domain/effect-intent.ts";
import { redact } from "../domain/effect-intent.ts";
import type { Id, Iso, JsonValue } from "../domain/types.ts";

export type MaterializeEffectOptions = {
  conversationId: Id;
  createdAt: Iso;
  providerCapability?: Partial<Record<EffectKind, ProviderCapability>>;
};

const DEFAULT_CAPABILITY: Record<EffectKind, ProviderCapability> = {
  send_message: "none",
  send_media: "none",
  crm_write: "none",
  schedule_visit: "none",
  handoff: "none",
  notify_seller: "none",
};

function payloadFor(plan: EffectPlan, composed: RenderedResponse): { [k: string]: JsonValue } {
  switch (plan.kind) {
    case "send_message":
      return { text: composed.text };
    case "send_media":
      return { vehicleKey: plan.vehicleKey, photoIds: plan.photoIds };
    case "crm_write":
      return { leadId: plan.leadId, fields: plan.fields };
    case "schedule_visit":
      return { leadId: plan.leadId, slot: plan.slot };
    case "handoff":
      return { leadId: plan.leadId, sellerId: plan.sellerId };
    case "notify_seller":
      return { sellerId: plan.sellerId, reason: plan.reason };
  }
}

export function materializeEffectPlans(
  decision: TurnDecision,
  composed: RenderedResponse,
  opts: MaterializeEffectOptions,
): OutboxRecord[] {
  return decision.effectPlan.map((plan) => ({
    effectId: plan.effectId,
    conversationId: opts.conversationId,
    turnId: decision.turnId,
    planId: plan.planId,
    kind: plan.kind,
    idempotencyKey: plan.effectId,
    order: plan.order,
    dependsOn: plan.dependsOn ?? [],
    payload: redact(payloadFor(plan, composed)),
    onSuccess: plan.onSuccess,
    status: "pending",
    providerCapability: opts.providerCapability?.[plan.kind] ?? DEFAULT_CAPABILITY[plan.kind],
    receiptLevel: null,
    attempts: 0,
    nextRetryAt: null,
    providerReceipt: null,
    outcomeAppliedAt: null,
    lastError: null,
    createdAt: opts.createdAt,
    dispatchedAt: null,
  }));
}
