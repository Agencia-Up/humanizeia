import type { ConversationState, FollowupCycle } from "../domain/conversation-state.ts";
import type { OutboxRecord } from "../domain/effect-intent.ts";
import type { FollowupRules } from "./automation-rules.ts";

export type FollowupStage = 1 | 2 | 3;

export type FollowupDue = {
  anchorEffectId: string;
  anchorAt: string;
  stage: FollowupStage;
  cycle: FollowupCycle;
};

export type FollowupEvaluationReason =
  | "due"
  | "rules_disabled"
  | "lead_opted_out"
  | "state_terminal"
  | "handoff_in_flight"
  | "no_anchor"
  | "anchor_degraded"
  | "invalid_time"
  | "lead_replied_after_anchor"
  | "stage_planned"
  | "effect_pending"
  | "not_due"
  | "outside_response_schedule";

export type FollowupEvaluation = {
  readonly due: FollowupDue | null;
  readonly reason: FollowupEvaluationReason;
};

function latestOrdinaryAcceptedMessage(records: readonly OutboxRecord[]): OutboxRecord | null {
  return records
    .filter((record) => record.kind === "send_message"
      && record.status === "succeeded"
      && (record.receiptLevel === "accepted" || record.receiptLevel === "delivered")
      && !record.effectId.startsWith("followup:"))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
}

function latestAcceptedFollowupAt(records: readonly OutboxRecord[], anchorEffectId: string): number | null {
  const latest = records
    .filter((record) => record.kind === "send_message"
      && record.effectId.startsWith(`followup:${anchorEffectId}:`)
      && record.status === "succeeded"
      && (record.receiptLevel === "accepted" || record.receiptLevel === "delivered"))
    .map((record) => Date.parse(record.createdAt))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  return latest ?? null;
}

function isTechnicalFallbackAnchor(record: OutboxRecord): boolean {
  return record.onSuccess.some((mutation) => mutation.op === "append_assistant_turn"
    && mutation.effectId === record.effectId
    && mutation.turn.authoring === "technical_fallback");
}

function latestLeadAt(state: ConversationState): number {
  return (state.recentTurns ?? [])
    .filter((turn) => turn.role === "lead")
    .reduce((latest, turn) => Math.max(latest, Date.parse(turn.at) || 0), 0);
}

export function isFollowupSuspended(state: ConversationState): boolean {
  // O marcador é a autoridade durável: ele pode vir de handoff/closed OU de
  // uma despedida aceita semanticamente antes de o funil mudar de stage.
  if (state.followupSuspendedAt) {
    const suspendedAt = Date.parse(state.followupSuspendedAt);
    if (!Number.isFinite(suspendedAt)) return true;
    // Uma fala nova do lead depois da suspensão reativa a conversa. O novo
    // ciclo só poderá nascer depois da resposta a essa fala.
    return latestLeadAt(state) <= suspendedAt;
  }
  // Estados antigos sem o marcador continuam terminais por compatibilidade.
  return state.stage === "handoff" || state.stage === "closed";
}

export function evaluateFollowup(args: {
  state: ConversationState;
  outbox: readonly OutboxRecord[];
  rules: FollowupRules;
  now: string;
}): FollowupEvaluation {
  if (!args.rules.enabled) return { due: null, reason: "rules_disabled" };
  // ⭐R8 (Codex 2026-07-15): OPT-OUT DURÁVEL vence tudo. Verificado ANTES de procurar anchor e INDEPENDENTE de stage,
  // handoff, leadId ou de a transferência ser plannable. Um lead que disse "me tira da lista"/"pare de mandar" NUNCA
  // recebe T1/T2/T3, mesmo que o handoff não tenha sido planejado (leadId null / vendedor ausente — condição real em prod).
  if (args.state.optedOutAt != null) return { due: null, reason: "lead_opted_out" };
  if (isFollowupSuspended(args.state)) return { due: null, reason: "state_terminal" };
  // A saga de transferência já assumiu a conversa. Mesmo que o callback de
  // entrega do aviso ao vendedor demore, o follow-up não pode voltar a abordar
  // o lead enquanto existe handoff/notify em andamento ou concluído.
  const handoffInFlight = args.outbox.some((record) =>
    (record.kind === "handoff" || record.kind === "notify_seller")
    && record.status !== "failed"
    && record.status !== "skipped");
  if (handoffInFlight) return { due: null, reason: "handoff_in_flight" };
  const anchor = latestOrdinaryAcceptedMessage(args.outbox);
  if (!anchor) return { due: null, reason: "no_anchor" };
  // Uma falha tecnica aceita no WhatsApp nao e uma abordagem comercial e nao
  // pode iniciar T1/T2/T3. Estados/outbox antigos sem metadado preservam o
  // comportamento anterior; a regra vale somente quando a origem e conhecida.
  if (isTechnicalFallbackAnchor(anchor)) return { due: null, reason: "anchor_degraded" };
  const anchorMs = Date.parse(anchor.createdAt);
  const nowMs = Date.parse(args.now);
  // O turno do lead e a resposta do agente podem compartilhar o mesmo
  // timestamp (resolução do banco em milissegundos). Nesse caso a mensagem
  // do lead ocorreu ANTES da resposta que ancora o follow-up. Só uma mensagem
  // estritamente posterior cancela o ciclo.
  if (!Number.isFinite(anchorMs) || !Number.isFinite(nowMs)) return { due: null, reason: "invalid_time" };
  if (latestLeadAt(args.state) > anchorMs) return { due: null, reason: "lead_replied_after_anchor" };

  const previous = args.state.followupCycle;
  const cycle: FollowupCycle = previous?.anchorEffectId === anchor.effectId
    ? previous
    : { anchorEffectId: anchor.effectId, anchorAt: anchor.createdAt, sentStages: [], plannedStage: null, lastSentAt: null };
  if (cycle.plannedStage != null) return { due: null, reason: "stage_planned" };
  const hasPending = args.outbox.some((record) => record.effectId.startsWith(`followup:${anchor.effectId}:`)
    && (record.status === "pending" || record.status === "processing" || record.status === "outcome_uncertain"));
  if (hasPending) return { due: null, reason: "effect_pending" };

  const dueStages: Array<[FollowupStage, number]> = [
    [1, args.rules.t1Min], [2, args.rules.t2Min], [3, args.rules.t3Min],
  ];
  const next = dueStages.find(([stage]) => !cycle.sentStages.includes(stage));
  if (!next) return { due: null, reason: "not_due" };

  // Cada valor configurado e um intervalo operacional entre mensagens:
  // resposta comum -> T1, T1 -> T2 e T2 -> T3. Antes, todos os tres tempos
  // eram somados a mesma ancora; 5/8/9 virava uma sequencia invasiva de
  // 5 minutos, depois 3 e depois 1. `lastSentAt` e gravado apenas apos o
  // aceite real do provedor. O outbox e fallback de compatibilidade para
  // ciclos antigos que ainda nao carregavam esse marcador.
  let cadenceAnchorMs = anchorMs;
  if (next[0] !== 1) {
    const persistedLastSentAt = cycle.lastSentAt ? Date.parse(cycle.lastSentAt) : Number.NaN;
    cadenceAnchorMs = Number.isFinite(persistedLastSentAt)
      ? persistedLastSentAt
      : latestAcceptedFollowupAt(args.outbox, anchor.effectId) ?? Number.NaN;
    if (!Number.isFinite(cadenceAnchorMs)) return { due: null, reason: "invalid_time" };
  }

  return nowMs >= cadenceAnchorMs + next[1] * 60_000
    ? { due: { anchorEffectId: anchor.effectId, anchorAt: anchor.createdAt, stage: next[0], cycle }, reason: "due" }
    : { due: null, reason: "not_due" };
}

export function evaluateFollowupDue(args: {
  state: ConversationState;
  outbox: readonly OutboxRecord[];
  rules: FollowupRules;
  now: string;
}): FollowupDue | null {
  return evaluateFollowup(args).due;
}
