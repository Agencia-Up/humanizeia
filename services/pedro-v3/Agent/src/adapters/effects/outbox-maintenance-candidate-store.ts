import type { V3DatabaseGateway, DatabaseFilters, DatabaseRow } from "../../domain/database-gateway.ts";
import type { TenantAgentRef } from "../../domain/read-ports.ts";

export type OutboxMaintenanceCandidate = {
  readonly conversationId: string;
  readonly toAddr: string;
  readonly instanceId: string | null;
  readonly leadId: string | null;
};

const OUTBOX_COLUMNS = [
  "conversation_id",
  "status",
  "attempts",
  "next_retry_at",
  "receipt_level",
  "required_receipt_level",
  "outcome_applied_at",
  "processing_expires_at",
  "dispatched_at",
  "created_at",
].join(",");

function stringOrNull(row: DatabaseRow, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrZero(row: DatabaseRow, key: string): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function dueAt(value: string | null, nowMs: number): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= nowMs;
}

function olderThan(value: string | null, nowMs: number, maxAgeMs: number): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && nowMs - parsed >= maxAgeMs;
}

/**
 * Decide apenas se existe manutencao operacional vencida. Nao interpreta
 * conversa, nao cria texto e nao altera o estado; o reconciliador continua
 * sendo a autoridade sobre requeue/terminalizacao/reparo.
 */
export function isOutboxMaintenanceDue(
  row: DatabaseRow,
  nowIso: string,
  maxAgeMs = 60_000,
  maxAttempts = 3,
): boolean {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return false;
  const status = stringOrNull(row, "status");

  if (status === "pending") {
    const retryAt = stringOrNull(row, "next_retry_at");
    return retryAt == null || dueAt(retryAt, nowMs);
  }
  if (status === "failed") {
    return numberOrZero(row, "attempts") >= maxAttempts
      || dueAt(stringOrNull(row, "next_retry_at"), nowMs);
  }
  if (status === "processing") {
    const expiry = stringOrNull(row, "processing_expires_at");
    return expiry != null
      ? dueAt(expiry, nowMs)
      : olderThan(
          stringOrNull(row, "dispatched_at") ?? stringOrNull(row, "created_at"),
          nowMs,
          maxAgeMs,
        );
  }
  if (status === "outcome_uncertain") return true;
  if (status !== "succeeded" || stringOrNull(row, "outcome_applied_at") != null) return false;

  if (stringOrNull(row, "receipt_level") === "delivered") return true;
  if (stringOrNull(row, "receipt_level") !== "accepted") return false;
  // Outcomes accepted-safe (por exemplo, append_assistant_turn) podem ter o
  // receipt terminal persistido e ainda perder o CAS do estado. Eles devem ser
  // reparados imediatamente, sem esperar um callback delivered que talvez nem
  // exista. Efeitos que exigem delivered seguem a janela de reconciliacao.
  return stringOrNull(row, "required_receipt_level") === "accepted"
    || (stringOrNull(row, "required_receipt_level") === "delivered"
      && olderThan(stringOrNull(row, "dispatched_at"), nowMs, maxAgeMs));
}

export class OutboxMaintenanceCandidateStore {
  constructor(private readonly gateway: V3DatabaseGateway) {}

  async list(ref: TenantAgentRef, nowIso: string, limit = 100): Promise<OutboxMaintenanceCandidate[]> {
    const statuses = ["pending", "failed", "processing", "outcome_uncertain", "succeeded"] as const;
    const dueConversationIds = new Set<string>();

    for (const status of statuses) {
      // `succeeded` pode ter terminal_at preenchido antes de o outcome ser
      // aplicado ao estado (por exemplo, receipt aceito + conflito de CAS).
      // Filtrar terminal_at=null nesse caso esconderia justamente o reparo que
      // o reconciliador precisa concluir. Para os demais estados, terminal_at
      // continua separando trabalho recuperavel de falha definitivamente
      // encerrada.
      const filters: DatabaseFilters = status === "succeeded"
        ? { tenant_id: ref.tenantId, status, outcome_applied_at: null }
        : { tenant_id: ref.tenantId, status, terminal_at: null };
      const rows = await this.gateway.selectMany("v3_effect_outbox", filters, {
        columns: OUTBOX_COLUMNS,
        order: [{ column: "created_at", ascending: true }],
        limit,
      });
      for (const row of rows) {
        const conversationId = stringOrNull(row, "conversation_id");
        if (conversationId && isOutboxMaintenanceDue(row, nowIso)) dueConversationIds.add(conversationId);
      }
    }

    const candidates: OutboxMaintenanceCandidate[] = [];
    for (const conversationId of dueConversationIds) {
      const routing = await this.gateway.selectOne("v3_conversation_routing", {
        tenant_id: ref.tenantId,
        conversation_id: conversationId,
        agent_id: ref.agentId,
      }, "to_addr,instance_id,lead_id");
      const toAddr = routing ? stringOrNull(routing, "to_addr") : null;
      if (!toAddr) continue;
      candidates.push({
        conversationId,
        toAddr,
        instanceId: routing ? stringOrNull(routing, "instance_id") : null,
        leadId: routing ? stringOrNull(routing, "lead_id") : null,
      });
    }
    return candidates.slice(0, limit);
  }
}
