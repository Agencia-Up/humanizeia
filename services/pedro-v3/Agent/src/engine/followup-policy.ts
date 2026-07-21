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

function latestLeadAt(state: ConversationState): number {
  return (state.recentTurns ?? [])
    .filter((turn) => turn.role === "lead")
    .reduce((latest, turn) => Math.max(latest, Date.parse(turn.at) || 0), 0);
}

export function isFollowupSuspended(state: ConversationState): boolean {
  if (state.stage !== "handoff" && state.stage !== "closed") return false;
  // Estados antigos sem o marcador continuam terminais por compatibilidade.
  if (!state.followupSuspendedAt) return true;
  const suspendedAt = Date.parse(state.followupSuspendedAt);
  if (!Number.isFinite(suspendedAt)) return true;
  // Uma fala nova do lead depois da transferência reativa a conversa. O novo
  // ciclo só poderá nascer depois da resposta a essa fala.
  return latestLeadAt(state) <= suspendedAt;
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
  const due = dueStages.find(([stage, minutes]) => !cycle.sentStages.includes(stage) && nowMs >= anchorMs + minutes * 60_000);
  return due
    ? { due: { anchorEffectId: anchor.effectId, anchorAt: anchor.createdAt, stage: due[0], cycle }, reason: "due" }
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
