// ============================================================================
// EffectOutcomeCommit - F2.5.1.
// Receipt e efeito externo sao registrados antes do outcome conversacional.
// Se o CAS do estado falhar, o efeito permanece delivered e o reconciliador
// reaplica somente a memoria; nunca reenvia o efeito externo.
// ============================================================================
import type { Clock, Persistence } from "../domain/ports.ts";
import type { EffectPlan, EffectResult } from "../domain/decision.ts";
import { applyEffectOutcome } from "./state-reducer.ts";

export type CommitOutcomeArgs = {
  persistence: Persistence;
  clock: Clock;
  conversationId: string;
  effectId: string;
  result: EffectResult;
};

export type CommitOutcomeResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function commitEffectOutcome(args: CommitOutcomeArgs): Promise<CommitOutcomeResult> {
  const { persistence, clock, conversationId, effectId, result } = args;

  if (result.effectId !== effectId) {
    return { ok: false, reason: `mismatch de ID: result.effectId (${result.effectId}) !== effectId (${effectId})` };
  }

  const records = await persistence.listOutbox(conversationId);
  const record = records.find((item) => item.effectId === effectId);
  if (!record) return { ok: false, reason: `OutboxRecord com effectId ${effectId} nao encontrado` };

  if (result.effectId !== record.effectId) {
    return { ok: false, reason: `mismatch de ID: result.effectId (${result.effectId}) !== record.effectId (${record.effectId})` };
  }
  if (result.status === "succeeded" && result.receipt.effectId !== result.effectId) {
    return {
      ok: false,
      reason: `mismatch de ID: result.receipt.effectId (${result.receipt.effectId}) !== result.effectId (${result.effectId})`,
    };
  }
  if (record.outcomeAppliedAt != null) return { ok: true };

  const retryAt = result.status === "failed" && result.error.retryable
    ? new Date(Date.parse(clock.now()) + 30_000).toISOString()
    : null;
  const recorded = await persistence.recordOutboxResult(record, result, retryAt);
  if (!recorded.ok) return recorded;

  if (result.status !== "succeeded" || result.receipt.level !== "delivered") {
    return { ok: true };
  }

  const refreshedRecords = await persistence.listOutbox(conversationId);
  const delivered = refreshedRecords.find((item) => item.effectId === effectId);
  if (!delivered) return { ok: false, reason: "outbox desapareceu apos registrar receipt" };
  if (delivered.outcomeAppliedAt != null) return { ok: true };
  if (delivered.status !== "succeeded" || delivered.receiptLevel !== "delivered") {
    return { ok: false, reason: "receipt delivered nao persistido de forma consistente" };
  }

  const snapshot = await persistence.load(conversationId);
  if (!snapshot) return { ok: false, reason: `Estado da conversa ${conversationId} nao encontrado` };

  if (delivered.onSuccess.length === 0) {
    const committed = await persistence.commitOutboxOutcome(
      conversationId,
      effectId,
      snapshot.version,
      null,
      clock.now(),
    );
    return committed.ok ? { ok: true } : committed;
  }

  const effectPlan: EffectPlan = {
    planId: delivered.planId,
    effectId: delivered.effectId,
    kind: delivered.kind,
    order: delivered.order,
    dependsOn: delivered.dependsOn,
    onSuccess: delivered.onSuccess,
  } as EffectPlan;

  const reduced = applyEffectOutcome(snapshot.state, effectPlan, result);
  if (!reduced.ok) {
    const reason = `Reducer rejeitou: ${reduced.rejected.map((item) => item.reason).join("; ")}`;
    const failed = await persistence.failOutbox(delivered, reason, clock.now());
    return failed.ok ? { ok: false, reason } : { ok: false, reason: `${reason}; failOutbox: ${failed.reason}` };
  }

  const committed = await persistence.commitOutboxOutcome(
    conversationId,
    effectId,
    snapshot.version,
    reduced.next,
    clock.now(),
  );
  return committed.ok ? { ok: true } : committed;
}
