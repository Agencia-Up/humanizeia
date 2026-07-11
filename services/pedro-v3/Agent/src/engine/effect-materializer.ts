// ============================================================================
// EffectMaterializer - F2.1. Converte EffectPlan semantico em OutboxRecord.
// SEM provider real, SEM dispatch, SEM rede. Payload ja nasce redacted.
// ============================================================================
import type { EffectKind, EffectOutcomeMutation, EffectPlan, RenderedResponse, TurnDecision } from "../domain/decision.ts";
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
      // HF-1: sellerId NÃO existe no plano (saga resolve no dispatch). O briefing factual viaja no payload
      // (texto do estado; sem CPF por construção — cpf é SensitiveSlot ref, o valor nunca entra no estado).
      return { leadId: plan.leadId, reason: plan.reason, briefing: plan.briefing, correlationId: plan.correlationId };
    case "notify_seller":
      return { leadId: plan.leadId, reason: plan.reason, etiquetas: plan.etiquetas, correlationId: plan.correlationId };
  }
}

// F2.7.4: a fala do agente entra na memoria (recentTurns) deterministicamente — NAO depende do LLM emitir
// append_assistant_turn. Para todo send_message com texto, injeta o outcome com o texto JA renderizado
// (composed.text). Idempotente: nao duplica se ja houver um append_assistant_turn. Aplica em "accepted"
// (memoria do que o agente ENVIOU) via effect-policy; nao confunde com delivered (recepcao pelo lead).
function withAssistantTurn(plan: EffectPlan, composed: RenderedResponse, at: Iso): EffectOutcomeMutation[] {
  if (plan.kind !== "send_message") return plan.onSuccess;
  const text = typeof composed.text === "string" ? composed.text.trim() : "";
  if (text.length === 0) return plan.onSuccess;
  // O engine e a UNICA fonte do append_assistant_turn (texto = composed.text JA renderizado). Remove qualquer
  // um vindo do modelo (idempotente, sem duplicar fala) e injeta o deterministico.
  const others = plan.onSuccess.filter((o) => o.op !== "append_assistant_turn");
  return [...others, { op: "append_assistant_turn", effectId: plan.effectId, turn: { role: "agent", text, at } }];
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
    onSuccess: withAssistantTurn(plan, composed, opts.createdAt),
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
