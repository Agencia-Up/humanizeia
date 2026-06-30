// ============================================================================
// EffectOutcomeCommit - F2.5.1.
// Receipt e efeito externo sao registrados antes do outcome conversacional.
// Se o CAS do estado falhar, o efeito permanece delivered e o reconciliador
// reaplica somente a memoria; nunca reenvia o efeito externo.
// ============================================================================
import type { Clock, Persistence } from "../domain/ports.ts";
import type { EffectPlan, EffectResult } from "../domain/decision.ts";
import { applyEffectOutcome } from "./state-reducer.ts";
import { requiredReceiptFor } from "../domain/effect-policy.ts";

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
  const retryAt = result.status === "failed" && result.error.retryable
    ? new Date(Date.parse(clock.now()) + 30_000).toISOString()
    : null;
  // F2.7.4: grava o receipt SEMPRE (mesmo se o outcome ja foi aplicado, ex.: no accepted) para que o nivel
  // suba accepted->delivered e o callback delivered/read fique registrado (rastreio de entrega). So DEPOIS
  // pula a re-aplicacao do outcome conversacional ja aplicado (idempotente).
  const recorded = await persistence.recordOutboxResult(record, result, retryAt);
  if (!recorded.ok) return recorded;
  if (record.outcomeAppliedAt != null) return { ok: true };

  if (result.status !== "succeeded") return { ok: true };
  // F2.7.4: aplica o outcome quando o receipt atinge o nivel EXIGIDO por este record. send_message cujos
  // outcomes sao todos accepted-safe (append_assistant_turn) aplica em "accepted"; o resto exige "delivered".
  const target = requiredReceiptFor(record);
  const meets = target === "accepted" || result.receipt.level === "delivered";
  if (!meets) return { ok: true };

  const refreshedRecords = await persistence.listOutbox(conversationId);
  const settled = refreshedRecords.find((item) => item.effectId === effectId);
  if (!settled) return { ok: false, reason: "outbox desapareceu apos registrar receipt" };
  if (settled.outcomeAppliedAt != null) return { ok: true };
  const settledMeets = target === "accepted"
    ? (settled.receiptLevel === "accepted" || settled.receiptLevel === "delivered")
    : settled.receiptLevel === "delivered";
  if (settled.status !== "succeeded" || !settledMeets) {
    return { ok: false, reason: `receipt (${target}) nao persistido de forma consistente` };
  }

  const snapshot = await persistence.load(conversationId);
  if (!snapshot) return { ok: false, reason: `Estado da conversa ${conversationId} nao encontrado` };

  if (settled.onSuccess.length === 0) {
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
    planId: settled.planId,
    effectId: settled.effectId,
    kind: settled.kind,
    order: settled.order,
    dependsOn: settled.dependsOn,
    onSuccess: settled.onSuccess,
  } as EffectPlan;

  const reduced = applyEffectOutcome(snapshot.state, effectPlan, result);
  if (!reduced.ok) {
    const reason = `Reducer rejeitou: ${reduced.rejected.map((item) => item.reason).join("; ")}`;
    const failed = await persistence.failOutbox(settled, reason, clock.now());
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
