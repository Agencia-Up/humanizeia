// ============================================================================
// OutboxDispatcher - F2.5.1.
// Claim atomico pela persistencia, EffectGate e registro idempotente de result.
// Um receipt entregue com falha de CAS nunca volta para pending.
// ============================================================================
import type { Clock, Persistence } from "../domain/ports.ts";
import type { OutboxRecord } from "../domain/effect-intent.ts";
import { redact } from "../domain/effect-intent.ts";
import type { EffectResult, EffectReceipt, ToolError } from "../domain/decision.ts";
import { commitEffectOutcome } from "./effect-outcome-commit.ts";
import { applyAcceptedPhotoActionOutcome } from "./central-engine.ts";
import { isEffectSatisfiedForDependency } from "./receipt-policy.ts";
import { sanitizeTurnError } from "../runtime/sanitize-error.ts";
import type { EffectGate } from "./effect-gate.ts";

export type ReconcileResult =
  | { status: "succeeded"; receipt: EffectReceipt }
  | { status: "failed"; error: ToolError }
  | { status: "outcome_uncertain" };

export interface EffectDispatcher {
  dispatch(record: OutboxRecord): Promise<EffectResult>;
  reconcile?(record: OutboxRecord): Promise<ReconcileResult>;
}

export class OutboxDispatcher {
  constructor(
    private persistence: Persistence,
    private clock: Clock,
    private dispatcher: EffectDispatcher,
    private effectGate: EffectGate,
    private workerId = "outbox-dispatcher",
    private claimTtlMs = 60_000,
    private batchSize = 25,
  ) {}

  async dispatchConversation(conversationId: string): Promise<number> {
    let totalDispatched = 0;

    while (true) {
      const skipped = await this.skipBlockedDependents(conversationId);
      const claimed = await this.persistence.claimOutbox(
        conversationId,
        this.workerId,
        this.claimTtlMs,
        this.batchSize,
      );

      if (claimed.length === 0) {
        if (skipped > 0) continue;
        break;
      }

      for (const record of claimed) {
        if (!this.effectGate.isActiveMode(conversationId)) {
          await this.markAsSkipped(record, "shadow_mode_gate_active");
          continue;
        }

        totalDispatched += 1;
        let result: EffectResult;
        try {
          result = await this.dispatcher.dispatch(record);
        } catch (error) {
          result = {
            status: "outcome_uncertain",
            effectId: record.effectId,
            metadata: redact({
              reason: "dispatcher_threw_unknown_outcome",
              error: error instanceof Error ? error.message : String(error),
            }),
          };
        }

        const committed = await commitEffectOutcome({
          persistence: this.persistence,
          clock: this.clock,
          conversationId,
          effectId: record.effectId,
          result,
        });
        if (!committed.ok) {
          throw new Error(`outbox result/outcome nao persistido para ${record.effectId}: ${committed.reason}`);
        }

        // R13-D/4 (audit Codex): promoção accepted-safe da WorkingMemory no receipt do send_media. NÃO ignora o
        // resultado. A mídia JÁ foi despachada — uma falha de MEMÓRIA nunca reenvia a mídia. Se a promoção falhar
        // (CAS/transiente/limite), NÃO derruba o dispatch: deixa o rastro DURÁVEL (send_media succeeded sem
        // appliedAcceptedEffectIds) p/ reconcileAcceptedPhotoOutcomes retomar (idempotente, sem redispatch), e loga
        // um diagnóstico sanitizado. No caminho handler-first (sem pendingPhotoActions) é no-op silencioso.
        if (record.kind === "send_media") {
          const promoted = await applyAcceptedPhotoActionOutcome({
            persistence: this.persistence,
            conversationId,
            effectId: record.effectId,
            result,
          });
          if (!promoted.ok) {
            console.error(JSON.stringify({
              event: "pedro_v3_wm_promotion_failed",
              conversationId,
              effectId: record.effectId,
              reason: sanitizeTurnError(promoted.reason),
            }));
          }
        }
      }
    }

    return totalDispatched;
  }

  private async skipBlockedDependents(conversationId: string): Promise<number> {
    const records = await this.persistence.listOutbox(conversationId);
    let skipped = 0;
    for (const record of records) {
      if (record.status !== "pending") continue;
      if (this.evaluateDependencies(record, records) !== "failed") continue;
      await this.markAsSkipped(record, "dependency_failed_or_skipped");
      skipped += 1;
    }
    return skipped;
  }

  private evaluateDependencies(
    record: OutboxRecord,
    allRecords: OutboxRecord[],
  ): "succeeded" | "pending" | "failed" {
    const priors = allRecords.filter(
      (candidate) => candidate.turnId === record.turnId && candidate.order < record.order,
    );
    for (const prior of priors) {
      if (prior.status === "failed" || prior.status === "skipped") return "failed";
      if (!isEffectSatisfiedForDependency(prior)) return "pending";
    }

    for (const depPlanId of record.dependsOn) {
      const dependency = allRecords.find(
        (candidate) => candidate.turnId === record.turnId && candidate.planId === depPlanId,
      );
      if (!dependency || dependency.status === "failed" || dependency.status === "skipped") return "failed";
      if (!isEffectSatisfiedForDependency(dependency)) return "pending";
    }

    return "succeeded";
  }

  private async markAsSkipped(record: OutboxRecord, reason: string): Promise<void> {
    const result = await this.persistence.skipOutbox(record, reason, this.clock.now());
    if (!result.ok) throw new Error(`Falha ao marcar ${record.effectId} como skipped: ${result.reason}`);
  }
}
