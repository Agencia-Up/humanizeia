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

export function evaluateFollowupDue(args: {
  state: ConversationState;
  outbox: readonly OutboxRecord[];
  rules: FollowupRules;
  now: string;
}): FollowupDue | null {
  if (!args.rules.enabled || args.state.stage === "handoff" || args.state.stage === "closed") return null;
  // A saga de transferência já assumiu a conversa. Mesmo que o callback de
  // entrega do aviso ao vendedor demore, o follow-up não pode voltar a abordar
  // o lead enquanto existe handoff/notify em andamento ou concluído.
  const handoffInFlight = args.outbox.some((record) =>
    (record.kind === "handoff" || record.kind === "notify_seller")
    && record.status !== "failed"
    && record.status !== "skipped");
  if (handoffInFlight) return null;
  const anchor = latestOrdinaryAcceptedMessage(args.outbox);
  if (!anchor) return null;
  const anchorMs = Date.parse(anchor.createdAt);
  const nowMs = Date.parse(args.now);
  if (!Number.isFinite(anchorMs) || !Number.isFinite(nowMs) || latestLeadAt(args.state) >= anchorMs) return null;

  const previous = args.state.followupCycle;
  const cycle: FollowupCycle = previous?.anchorEffectId === anchor.effectId
    ? previous
    : { anchorEffectId: anchor.effectId, anchorAt: anchor.createdAt, sentStages: [], plannedStage: null, lastSentAt: null };
  if (cycle.plannedStage != null) return null;
  const hasPending = args.outbox.some((record) => record.effectId.startsWith(`followup:${anchor.effectId}:`)
    && (record.status === "pending" || record.status === "processing" || record.status === "outcome_uncertain"));
  if (hasPending) return null;

  const dueStages: Array<[FollowupStage, number]> = [
    [1, args.rules.t1Min], [2, args.rules.t2Min], [3, args.rules.t3Min],
  ];
  const due = dueStages.find(([stage, minutes]) => !cycle.sentStages.includes(stage) && nowMs >= anchorMs + minutes * 60_000);
  return due ? { anchorEffectId: anchor.effectId, anchorAt: anchor.createdAt, stage: due[0], cycle } : null;
}
