// ============================================================================
// OutboxReconciler - F2.5.1.
// Reconcilia processing stale, outcome_uncertain, accepted critico e,
// principalmente, delivered sem outcome. Nunca reenvia efeito ja entregue.
// ============================================================================
import type { Clock, Persistence } from "../domain/ports.ts";
import type { OutboxRecord } from "../domain/effect-intent.ts";
import { redact } from "../domain/effect-intent.ts";
import type { EffectReceipt } from "../domain/decision.ts";
import { commitEffectOutcome } from "./effect-outcome-commit.ts";
import type { EffectDispatcher, ReconcileResult } from "./outbox-dispatcher.ts";
import { isCriticalForConversationState, requiredReceiptFor } from "./receipt-policy.ts";

function receiptFromRecord(record: OutboxRecord): EffectReceipt | null {
  const value = record.providerReceipt;
  if (value == null || Array.isArray(value) || typeof value !== "object") return null;
  const effectId = value.effectId;
  const level = value.level;
  const at = value.at;
  if (
    effectId !== record.effectId
    || (level !== "accepted" && level !== "delivered")
    || typeof at !== "string"
  ) return null;

  const providerMessageId = typeof value.providerMessageId === "string"
    ? value.providerMessageId
    : undefined;
  const rawPerItem = value.perItem;
  const perItem = Array.isArray(rawPerItem)
    ? rawPerItem.flatMap((item) => {
        if (
          item != null
          && !Array.isArray(item)
          && typeof item === "object"
          && typeof item.photoId === "string"
          && (item.status === "succeeded" || item.status === "failed")
        ) {
          const status: "succeeded" | "failed" = item.status;
          return [{ photoId: item.photoId, status }];
        }
        return [];
      })
    : undefined;

  return { effectId, level, at, providerMessageId, perItem };
}

/**
 * Registros antigos podem ter `receipt_level` persistido sem o JSON completo
 * de `provider_receipt`. O nivel continua sendo um fato duravel do provider;
 * reconstruir o receipt minimo evita reenvio e permite reaplicar outcomes
 * accepted-safe. Nao mascaramos JSON presente e corrompido, nem inventamos o
 * resultado item-a-item de um envio multiplo de fotos.
 */
function receiptForOutcomeRepair(record: OutboxRecord): EffectReceipt | null {
  const decoded = receiptFromRecord(record);
  if (decoded) return decoded;
  if (record.providerReceipt != null) return null;
  if (record.receiptLevel !== "accepted" && record.receiptLevel !== "delivered") return null;
  if (record.onSuccess.some((mutation) =>
    mutation.op === "mark_photos_sent" && mutation.photoIds.length > 1
  )) return null;
  const at = record.terminalAt ?? record.dispatchedAt ?? record.createdAt;
  if (!at) return null;
  return { effectId: record.effectId, level: record.receiptLevel, at };
}

export class OutboxReconciler {
  constructor(
    private persistence: Persistence,
    private clock: Clock,
    private dispatcher: EffectDispatcher,
  ) {}

  async reconcileConversation(conversationId: string, maxAgeMs = 60_000, maxAttempts = 3): Promise<void> {
    const records = await this.persistence.listOutbox(conversationId);
    const now = Date.parse(this.clock.now());

    for (const record of records) {
      if (record.status === "succeeded" && record.outcomeAppliedAt == null && (
        record.receiptLevel === "delivered"
        || (record.receiptLevel === "accepted" && requiredReceiptFor(record) === "accepted")
      )) {
        await this.repairSucceededOutcome(record);
        continue;
      }

      if (record.status === "failed" && record.terminalAt == null) {
        if (record.attempts >= maxAttempts) {
          await this.fail(record, "max_attempts_exceeded_retryable_failure");
        } else if (record.nextRetryAt && Date.parse(record.nextRetryAt) <= now) {
          await this.requeue(record, "retryable_failure_due");
        }
        continue;
      }

      if (record.status === "processing" && this.processingIsStale(record, now, maxAgeMs)) {
        await this.handleStaleProcessing(record, maxAttempts);
        continue;
      }

      if (record.status === "outcome_uncertain") {
        await this.handleUncertainRecord(record, maxAttempts);
        continue;
      }

      if (
        record.status === "succeeded"
        && record.receiptLevel === "accepted"
        && record.outcomeAppliedAt == null
        && isCriticalForConversationState(record)
        && record.dispatchedAt
        && now - Date.parse(record.dispatchedAt) > maxAgeMs
      ) {
        await this.handleStaleAccepted(record);
      }
    }
  }

  private processingIsStale(record: OutboxRecord, now: number, maxAgeMs: number): boolean {
    if (record.processingExpiresAt) return Date.parse(record.processingExpiresAt) <= now;
    return record.dispatchedAt != null && now - Date.parse(record.dispatchedAt) > maxAgeMs;
  }

  private async repairSucceededOutcome(record: OutboxRecord): Promise<void> {
    const receipt = receiptForOutcomeRepair(record);
    const required = requiredReceiptFor(record);
    const meetsRequired = receipt != null && (required === "accepted" || receipt.level === "delivered");
    if (!receipt || !meetsRequired) {
      // O efeito externo ja teve sucesso. Metadado insuficiente para reparar o
      // estado nao pode rebaixar esse fato para `failed` nem liberar reenvio.
      // Mantemos o registro intacto e tornamos a inconsistência observavel.
      throw new Error(`Receipt insuficiente para reparar outcome ${record.effectId}`);
    }
    const result = await commitEffectOutcome({
      persistence: this.persistence,
      clock: this.clock,
      conversationId: record.conversationId,
      effectId: record.effectId,
      result: { status: "succeeded", effectId: record.effectId, receipt },
    });
    if (!result.ok && !result.reason.includes("outcome_cas_conflict")) {
      throw new Error(`Falha ao reparar outcome succeeded ${record.effectId}: ${result.reason}`);
    }
  }

  private async handleStaleProcessing(record: OutboxRecord, maxAttempts: number): Promise<void> {
    if (record.providerCapability === "queryable" && this.dispatcher.reconcile) {
      const reconciled = await this.tryReconcile(record);
      if (reconciled && reconciled.status !== "outcome_uncertain") {
        await this.commitReconciled(record, reconciled);
        return;
      }
    }

    if (record.providerCapability === "idempotent" || record.providerCapability === "queryable") {
      if (record.attempts < maxAttempts) {
        await this.requeue(record, "processing_stale_retry");
      } else {
        await this.fail(record, "max_attempts_exceeded_stale");
      }
      return;
    }

    const stored = await this.persistence.recordOutboxResult(record, {
      status: "outcome_uncertain",
      effectId: record.effectId,
      metadata: redact({ reason: "processing_stale_uncertain" }),
    });
    if (!stored.ok) throw new Error(`Falha ao registrar incerteza ${record.effectId}: ${stored.reason}`);
  }

  private async handleUncertainRecord(record: OutboxRecord, maxAttempts: number): Promise<void> {
    if (record.providerCapability === "idempotent") {
      if (record.attempts < maxAttempts) await this.requeue(record, "uncertain_retry");
      else await this.fail(record, "max_attempts_exceeded_uncertain");
      return;
    }

    if (record.providerCapability === "queryable" && this.dispatcher.reconcile) {
      const reconciled = await this.tryReconcile(record);
      if (reconciled && reconciled.status !== "outcome_uncertain") {
        await this.commitReconciled(record, reconciled);
        return;
      }
      if (record.attempts < maxAttempts) await this.requeue(record, "uncertain_query_still_uncertain");
      else await this.fail(record, "max_attempts_exceeded_uncertain_query");
      return;
    }

    await this.fail(record, "uncertain_dead_letter_none_capability");
  }

  private async handleStaleAccepted(record: OutboxRecord): Promise<void> {
    if (record.providerCapability === "queryable" && this.dispatcher.reconcile) {
      const reconciled = await this.tryReconcile(record);
      if (reconciled?.status === "succeeded" && reconciled.receipt.level === "delivered") {
        await this.commitReconciled(record, reconciled);
        return;
      }
    }
    await this.fail(record, "accepted_delivery_timeout");
  }

  private async tryReconcile(record: OutboxRecord): Promise<ReconcileResult | null> {
    try {
      return this.dispatcher.reconcile ? await this.dispatcher.reconcile(record) : null;
    } catch {
      return null;
    }
  }

  private async commitReconciled(record: OutboxRecord, result: Exclude<ReconcileResult, { status: "outcome_uncertain" }>): Promise<void> {
    const committed = await commitEffectOutcome({
      persistence: this.persistence,
      clock: this.clock,
      conversationId: record.conversationId,
      effectId: record.effectId,
      result: result.status === "succeeded"
        ? { status: "succeeded", effectId: record.effectId, receipt: result.receipt }
        : { status: "failed", effectId: record.effectId, error: result.error },
    });
    if (!committed.ok) throw new Error(`Falha ao persistir reconciliacao ${record.effectId}: ${committed.reason}`);
  }

  private async requeue(record: OutboxRecord, reason: string): Promise<void> {
    const result = await this.persistence.requeueOutbox(record, this.clock.now(), reason);
    if (!result.ok) throw new Error(`Falha ao reencaminhar ${record.effectId}: ${result.reason}`);
  }

  private async fail(record: OutboxRecord, reason: string): Promise<void> {
    const result = await this.persistence.failOutbox(record, reason, this.clock.now());
    if (!result.ok) throw new Error(`Falha ao terminalizar ${record.effectId}: ${result.reason}`);
  }
}
