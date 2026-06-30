import type { ConversationState } from "../../domain/conversation-state.ts";
import type { EffectResult, TurnDecision } from "../../domain/decision.ts";
import type { DatabaseRow, V3DatabaseGateway } from "../../domain/database-gateway.ts";
import type {
  InboxRecord,
  OutboxRecord,
  ProviderCapability,
  ReceiptLevel,
  TurnEventRecord,
} from "../../domain/effect-intent.ts";
import type {
  Clock,
  ConversationRoutingStore,
  InboxInsert,
  Lease,
  Persistence,
  SettledConversation,
  StateSnapshot,
  UnitOfWork,
  UnitOfWorkContext,
} from "../../domain/ports.ts";
import type { Id, JsonValue, Redacted } from "../../domain/types.ts";

type CommitResult = { ok: true } | { ok: false; reason: string };
type StagedCas = { conversationId: Id; expectedVersion: number; nextState: ConversationState };
type StagedDecision = { conversationId: Id; decision: TurnDecision };
type StagedInboxDone = { eventIds: Id[]; claimedBy: string; turnId: Id };

export type PostgresPersistenceConfig = {
  tenantId: Id;
  clock: Clock;
};

export class PostgresPersistenceError extends Error {
  constructor(public readonly operation: string, message: string) {
    super(`${operation}: ${message}`);
    this.name = "PostgresPersistenceError";
  }
}

function jsonValue(value: unknown): JsonValue {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value as JsonValue;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = jsonValue(item);
    }
    return out;
  }
  return String(value);
}

function requiredString(row: DatabaseRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) throw new PostgresPersistenceError("decode", `campo ${key} invalido`);
  return value;
}

function nullableString(row: DatabaseRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new PostgresPersistenceError("decode", `campo ${key} invalido`);
  return value;
}

function requiredNumber(row: DatabaseRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new PostgresPersistenceError("decode", `campo ${key} invalido`);
  return value;
}

function objectValue(row: DatabaseRow, key: string): { [key: string]: JsonValue } {
  const value = row[key];
  if (value == null || Array.isArray(value) || typeof value !== "object") {
    throw new PostgresPersistenceError("decode", `campo ${key} invalido`);
  }
  return value as { [key: string]: JsonValue };
}

function stringArray(row: DatabaseRow, key: string): string[] {
  const value = row[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new PostgresPersistenceError("decode", `campo ${key} invalido`);
  }
  return value as string[];
}

function decodeInbox(row: DatabaseRow): InboxRecord {
  const raw = objectValue(row, "raw");
  if (raw.__redacted !== true) throw new PostgresPersistenceError("decodeInbox", "payload sem redaction");
  return {
    eventId: requiredString(row, "event_id"),
    conversationId: requiredString(row, "conversation_id"),
    raw: raw as Redacted<{ [key: string]: JsonValue }>,
    status: requiredString(row, "status") as InboxRecord["status"],
    claimedBy: nullableString(row, "claimed_by"),
    turnId: nullableString(row, "turn_id"),
    attempts: requiredNumber(row, "attempts"),
    nextRetryAt: nullableString(row, "next_retry_at"),
    receivedAt: requiredString(row, "received_at"),
    claimedAt: nullableString(row, "claimed_at"),
  };
}

function decodeState(row: DatabaseRow): StateSnapshot {
  const state = objectValue(row, "state") as unknown as ConversationState;
  const version = requiredNumber(row, "version");
  if (state.conversationId !== requiredString(row, "conversation_id") || state.version !== version) {
    throw new PostgresPersistenceError("decodeState", "envelope/version divergente");
  }
  return { state, version };
}

function decodeOutbox(row: DatabaseRow): OutboxRecord {
  const payload = objectValue(row, "payload");
  if (payload.__redacted !== true) throw new PostgresPersistenceError("decodeOutbox", "payload sem redaction");
  const onSuccess = row.on_success;
  if (!Array.isArray(onSuccess)) throw new PostgresPersistenceError("decodeOutbox", "on_success invalido");
  return {
    effectId: requiredString(row, "effect_id"),
    idempotencyKey: requiredString(row, "idempotency_key"),
    conversationId: requiredString(row, "conversation_id"),
    turnId: requiredString(row, "turn_id"),
    planId: requiredString(row, "plan_id"),
    kind: requiredString(row, "kind") as OutboxRecord["kind"],
    payload: payload as Redacted<{ [key: string]: JsonValue }>,
    onSuccess: onSuccess as unknown as OutboxRecord["onSuccess"],
    order: requiredNumber(row, "effect_order"),
    dependsOn: stringArray(row, "depends_on"),
    status: requiredString(row, "status") as OutboxRecord["status"],
    providerCapability: requiredString(row, "provider_capability") as ProviderCapability,
    receiptLevel: nullableString(row, "receipt_level") as ReceiptLevel | null,
    attempts: requiredNumber(row, "attempts"),
    nextRetryAt: nullableString(row, "next_retry_at"),
    providerReceipt: row.provider_receipt ?? null,
    outcomeAppliedAt: nullableString(row, "outcome_applied_at"),
    terminalAt: nullableString(row, "terminal_at"),
    lastError: nullableString(row, "last_error"),
    createdAt: requiredString(row, "created_at"),
    dispatchedAt: nullableString(row, "dispatched_at"),
    processingBy: nullableString(row, "processing_by"),
    processingToken: nullableString(row, "processing_token"),
    processingExpiresAt: nullableString(row, "processing_expires_at"),
  };
}

class PostgresTurnUnitOfWork implements UnitOfWork {
  private cas: StagedCas | null = null;
  private events: TurnEventRecord[] = [];
  private decisions: StagedDecision[] = [];
  private outbox: OutboxRecord[] = [];
  private outboxUpdates: OutboxRecord[] = [];
  private inboxDone: StagedInboxDone | null = null;
  private committed = false;

  constructor(
    private readonly gateway: V3DatabaseGateway,
    private readonly config: PostgresPersistenceConfig,
    private readonly context: UnitOfWorkContext,
  ) {}

  casState(conversationId: Id, expectedVersion: number, nextState: ConversationState): void {
    this.cas = { conversationId, expectedVersion, nextState };
  }
  appendEvents(events: TurnEventRecord[]): void { this.events.push(...events); }
  appendDecision(conversationId: Id, decision: TurnDecision): void {
    this.decisions.push({ conversationId, decision });
  }
  appendOutbox(records: OutboxRecord[]): void { this.outbox.push(...records); }
  updateOutbox(record: OutboxRecord): void { this.outboxUpdates.push(record); }
  markInboxDone(eventIds: Id[], claimedBy: string, turnId: Id): void {
    this.inboxDone = { eventIds: [...eventIds], claimedBy, turnId };
  }

  async commit(): Promise<CommitResult> {
    if (this.committed) return { ok: false, reason: "unit of work ja finalizado" };
    this.committed = true;

    if (this.outboxUpdates.length > 0) {
      return { ok: false, reason: "postgres_outbox_update_not_enabled_f2_5_0" };
    }
    if (!this.cas || !this.inboxDone || this.decisions.length !== 1) {
      return { ok: false, reason: "postgres_turn_uow_incompleto" };
    }
    const lease = this.context.lease;
    if (!lease || lease.conversationId !== this.cas.conversationId) {
      return { ok: false, reason: "postgres_turn_uow_sem_lease" };
    }
    const stagedDecision = this.decisions[0];
    if (
      stagedDecision.conversationId !== this.cas.conversationId
      || stagedDecision.decision.turnId !== this.inboxDone.turnId
      || lease.owner !== this.inboxDone.claimedBy
    ) {
      return { ok: false, reason: "postgres_turn_uow_identidade_divergente" };
    }

    try {
      await this.gateway.rpc<JsonValue>("v3_commit_turn", {
        p_tenant_id: this.config.tenantId,
        p_conversation_id: this.cas.conversationId,
        p_agent_id: this.cas.nextState.agentId,
        p_lead_id: this.cas.nextState.leadId ?? null,
        p_turn_id: stagedDecision.decision.turnId,
        p_expected_version: this.cas.expectedVersion,
        p_next_state: jsonValue(this.cas.nextState),
        p_decision: jsonValue(stagedDecision.decision),
        p_events: jsonValue(this.events),
        p_outbox: jsonValue(this.outbox),
        p_event_ids: jsonValue(this.inboxDone.eventIds),
        p_claimed_by: this.inboxDone.claimedBy,
        p_lease_token: lease.token,
        p_now: this.config.clock.now(),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}

export class PostgresPersistence implements Persistence, ConversationRoutingStore {
  readonly capabilities = Object.freeze({ turnCommit: true, specificOutbox: true, genericOutboxUpdate: false });

  constructor(
    private readonly gateway: V3DatabaseGateway,
    private readonly config: PostgresPersistenceConfig,
  ) {}

  // ── ConversationRoutingStore (F2.7.6) ─────────────────────────────────────
  async upsertRouting(conversationId: Id, agentId: string, leadId: string | null, toAddr: string): Promise<void> {
    await this.gateway.rpc<JsonValue>("v3_upsert_conversation_routing", {
      p_tenant_id: this.config.tenantId,
      p_conversation_id: conversationId,
      p_agent_id: agentId,
      p_lead_id: leadId,
      p_to_addr: toAddr,
      p_now: this.config.clock.now(),
    });
  }

  async findSettledConversations(nowIso: string, debounceMs: number, maxWaitMs: number, limit: number): Promise<SettledConversation[]> {
    const data = await this.gateway.rpc<JsonValue>("v3_find_settled_conversations", {
      p_tenant_id: this.config.tenantId,
      p_now: nowIso,
      p_debounce_ms: debounceMs,
      p_max_ms: maxWaitMs,
      p_limit: limit,
    });
    if (!Array.isArray(data)) throw new PostgresPersistenceError("findSettledConversations", "resposta invalida");
    return data.map((item) => {
      if (item == null || Array.isArray(item) || typeof item !== "object") {
        throw new PostgresPersistenceError("findSettledConversations", "linha invalida");
      }
      const row = item as DatabaseRow;
      return {
        conversationId: requiredString(row, "conversation_id"),
        agentId: requiredString(row, "agent_id"),
        leadId: nullableString(row, "lead_id"),
        toAddr: requiredString(row, "to_addr"),
        pendingCount: requiredNumber(row, "pending_count"),
      };
    });
  }

  async tryInsert(rec: InboxInsert): Promise<boolean> {
    return this.gateway.rpc<boolean>("v3_ingest_inbox", {
      p_tenant_id: this.config.tenantId,
      p_event_id: rec.eventId,
      p_conversation_id: rec.conversationId,
      p_raw: jsonValue(rec.raw),
      p_received_at: rec.receivedAt,
    });
  }

  async acquire(conversationId: Id, owner: string, ttlMs: number): Promise<Lease | null> {
    const data = await this.gateway.rpc<JsonValue>("v3_acquire_lease", {
      p_tenant_id: this.config.tenantId,
      p_conversation_id: conversationId,
      p_owner: owner,
      p_ttl_ms: ttlMs,
      p_now: this.config.clock.now(),
    });
    if (!Array.isArray(data) || data.length === 0) return null;
    const row = data[0];
    if (row == null || Array.isArray(row) || typeof row !== "object") {
      throw new PostgresPersistenceError("acquire", "resposta invalida");
    }
    const record = row as DatabaseRow;
    return {
      conversationId,
      owner,
      token: requiredString(record, "token"),
      acquiredAt: requiredString(record, "acquired_at"),
      expiresAt: requiredString(record, "expires_at"),
    };
  }

  async renew(lease: Lease, ttlMs: number): Promise<boolean> {
    return this.gateway.rpc<boolean>("v3_renew_lease", {
      p_tenant_id: this.config.tenantId,
      p_conversation_id: lease.conversationId,
      p_owner: lease.owner,
      p_token: lease.token,
      p_ttl_ms: ttlMs,
      p_now: this.config.clock.now(),
    });
  }

  async release(lease: Lease): Promise<void> {
    await this.gateway.rpc<boolean>("v3_release_lease", {
      p_tenant_id: this.config.tenantId,
      p_conversation_id: lease.conversationId,
      p_owner: lease.owner,
      p_token: lease.token,
    });
  }

  async withLease<T>(
    conversationId: Id,
    owner: string,
    ttlMs: number,
    fn: (lease: Lease) => T | Promise<T>,
  ): Promise<T> {
    const lease = await this.acquire(conversationId, owner, ttlMs);
    if (!lease) throw new PostgresPersistenceError("withLease", "lease unavailable");
    try {
      return await fn(lease);
    } finally {
      await this.release(lease);
    }
  }

  async claimBurst(conversationId: Id, cutoff: string, claimedBy: string, turnId: Id, lease?: Lease): Promise<Id[]> {
    if (!lease || lease.conversationId !== conversationId || lease.owner !== claimedBy) {
      throw new PostgresPersistenceError("claimBurst", "lease ausente ou divergente");
    }
    const ids = await this.gateway.rpc<JsonValue>("v3_claim_inbox_burst", {
      p_tenant_id: this.config.tenantId,
      p_conversation_id: conversationId,
      p_cutoff: cutoff,
      p_claimed_by: claimedBy,
      p_turn_id: turnId,
      p_lease_token: lease.token,
      p_claim_ttl: "2 minutes",
      p_limit: 50,
      p_now: this.config.clock.now(),
    });
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      throw new PostgresPersistenceError("claimBurst", "lista de IDs invalida");
    }
    return ids as string[];
  }

  async releaseClaim(eventIds: Id[], claimedBy: string, turnId: Id): Promise<Id[]> {
    const ids = await this.gateway.rpc<JsonValue>("v3_release_inbox_claim", {
      p_tenant_id: this.config.tenantId,
      p_event_ids: jsonValue(eventIds),
      p_claimed_by: claimedBy,
      p_turn_id: turnId,
      p_error: null,
    });
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      throw new PostgresPersistenceError("releaseClaim", "lista de IDs invalida");
    }
    return ids as string[];
  }

  async get(eventId: Id): Promise<InboxRecord | null> {
    const row = await this.gateway.selectOne("v3_inbox", {
      tenant_id: this.config.tenantId,
      event_id: eventId,
    });
    return row ? decodeInbox(row) : null;
  }

  async pendingCount(conversationId: Id): Promise<number> {
    return this.gateway.count("v3_inbox", {
      tenant_id: this.config.tenantId,
      conversation_id: conversationId,
      status: "pending",
    });
  }

  async load(conversationId: Id): Promise<StateSnapshot | null> {
    const row = await this.gateway.selectOne("v3_conversation_state", {
      tenant_id: this.config.tenantId,
      conversation_id: conversationId,
    });
    return row ? decodeState(row) : null;
  }

  async listOutbox(conversationId: Id): Promise<OutboxRecord[]> {
    const rows = await this.gateway.selectMany(
      "v3_effect_outbox",
      { tenant_id: this.config.tenantId, conversation_id: conversationId },
      { order: [{ column: "effect_order" }, { column: "effect_id" }] },
    );
    return rows.map(decodeOutbox);
  }

  async claimOutbox(conversationId: Id, workerId: string, ttlMs: number, limit: number): Promise<OutboxRecord[]> {
    const data = await this.gateway.rpc<JsonValue>("v3_claim_outbox_for_conversation", {
      p_tenant_id: this.config.tenantId,
      p_conversation_id: conversationId,
      p_worker_id: workerId,
      p_ttl_ms: ttlMs,
      p_limit: limit,
      p_now: this.config.clock.now(),
    });
    if (!Array.isArray(data)) throw new PostgresPersistenceError("claimOutbox", "resposta invalida");
    return data.map((item) => {
      if (item == null || Array.isArray(item) || typeof item !== "object") {
        throw new PostgresPersistenceError("claimOutbox", "linha invalida");
      }
      return decodeOutbox(item as DatabaseRow);
    });
  }

  async recordOutboxResult(
    record: OutboxRecord,
    result: EffectResult,
    nextRetryAt: string | null = null,
  ): Promise<CommitResult> {
    try {
      const receipt = result.status === "succeeded" ? result.receipt : null;
      const mediaReceipts = result.status === "succeeded"
        ? (result.receipt.perItem ?? []).map((item) => ({
            photoId: item.photoId,
            status: item.status,
            at: result.receipt.at,
          }))
        : [];
      await this.gateway.rpc<boolean>("v3_record_outbox_result", {
        p_tenant_id: this.config.tenantId,
        p_effect_id: record.effectId,
        p_processing_token: record.processingToken ?? null,
        p_result_status: result.status,
        p_receipt_level: receipt?.level ?? null,
        p_provider_receipt: result.status === "succeeded"
          ? jsonValue(result.receipt)
          : result.status === "outcome_uncertain"
            ? jsonValue(result.metadata)
            : null,
        p_last_error: result.status === "failed" ? result.error.message : null,
        p_retryable: result.status === "failed" ? result.error.retryable : false,
        p_next_retry_at: nextRetryAt,
        p_media_receipts: jsonValue(mediaReceipts),
        p_now: this.config.clock.now(),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async requeueOutbox(record: OutboxRecord, nextRetryAt: string, reason: string): Promise<CommitResult> {
    try {
      const updated = await this.gateway.rpc<boolean>("v3_requeue_outbox_guarded", {
        p_tenant_id: this.config.tenantId,
        p_effect_id: record.effectId,
        p_expected_status: record.status,
        p_expected_receipt_level: record.receiptLevel,
        p_processing_token: record.processingToken ?? null,
        p_next_retry_at: nextRetryAt,
        p_reason: reason,
      });
      return updated ? { ok: true } : { ok: false, reason: "outbox_requeue_rejected" };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async skipOutbox(record: OutboxRecord, reason: string, at: string): Promise<CommitResult> {
    try {
      const updated = await this.gateway.rpc<boolean>("v3_skip_outbox_guarded", {
        p_tenant_id: this.config.tenantId,
        p_effect_id: record.effectId,
        p_expected_status: record.status,
        p_expected_receipt_level: record.receiptLevel,
        p_processing_token: record.processingToken ?? null,
        p_reason: reason,
        p_now: at,
      });
      return updated ? { ok: true } : { ok: false, reason: "outbox_skip_rejected" };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async failOutbox(record: OutboxRecord, reason: string, at: string): Promise<CommitResult> {
    try {
      const updated = await this.gateway.rpc<boolean>("v3_fail_outbox_guarded", {
        p_tenant_id: this.config.tenantId,
        p_effect_id: record.effectId,
        p_expected_status: record.status,
        p_expected_receipt_level: record.receiptLevel,
        p_processing_token: record.processingToken ?? null,
        p_reason: reason,
        p_now: at,
      });
      return updated ? { ok: true } : { ok: false, reason: "outbox_fail_rejected" };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async commitOutboxOutcome(
    conversationId: Id,
    effectId: Id,
    expectedVersion: number,
    nextState: ConversationState | null,
    at: string,
  ): Promise<
    | { ok: true; stateVersion: number; applied: boolean }
    | { ok: false; reason: string }
  > {
    try {
      const data = await this.gateway.rpc<JsonValue>("v3_commit_effect_outcome", {
        p_tenant_id: this.config.tenantId,
        p_conversation_id: conversationId,
        p_effect_id: effectId,
        p_expected_version: expectedVersion,
        p_next_state: nextState ? jsonValue(nextState) : null,
        p_now: at,
      });
      if (!Array.isArray(data) || data.length !== 1) {
        return { ok: false, reason: "outcome_rpc_response_invalid" };
      }
      const item = data[0];
      if (item == null || Array.isArray(item) || typeof item !== "object") {
        return { ok: false, reason: "outcome_rpc_row_invalid" };
      }
      const row = item as DatabaseRow;
      const stateVersion = requiredNumber(row, "state_version");
      const applied = row.applied;
      if (typeof applied !== "boolean") return { ok: false, reason: "outcome_rpc_applied_invalid" };
      return { ok: true, stateVersion, applied };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async findOutboxByProviderMessageId(providerMessageId: string): Promise<OutboxRecord | null> {
    const normalized = typeof providerMessageId === "string" ? providerMessageId.trim() : "";
    if (normalized.length < 1 || normalized.length > 240) {
      throw new PostgresPersistenceError("findOutboxByProviderMessageId", "provider message id invalido");
    }
    const data = await this.gateway.rpc<JsonValue>("v3_find_outbox_by_provider_message_id", {
      p_tenant_id: this.config.tenantId,
      p_provider_message_id: normalized,
    });
    if (!Array.isArray(data)) {
      throw new PostgresPersistenceError("findOutboxByProviderMessageId", "resposta invalida");
    }
    if (data.length === 0) return null;
    if (data.length !== 1) {
      throw new PostgresPersistenceError("findOutboxByProviderMessageId", "provider message id ambiguo");
    }
    const row = data[0];
    if (row == null || Array.isArray(row) || typeof row !== "object") {
      throw new PostgresPersistenceError("findOutboxByProviderMessageId", "linha invalida");
    }
    return decodeOutbox(row as DatabaseRow);
  }
  begin(context: UnitOfWorkContext = {}): UnitOfWork {
    return new PostgresTurnUnitOfWork(this.gateway, this.config, context);
  }
}
