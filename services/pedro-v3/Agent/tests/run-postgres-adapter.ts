import { createInitialState } from "../src/domain/conversation-state.ts";
import type { TurnDecision } from "../src/domain/decision.ts";
import type { DatabaseFilters, DatabaseRow, V3DatabaseGateway } from "../src/domain/database-gateway.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { OutboxRecord, TurnEventRecord } from "../src/domain/effect-intent.ts";
import type { Clock, Lease } from "../src/domain/ports.ts";
import type { JsonValue } from "../src/domain/types.ts";
import { PostgresPersistence } from "../src/adapters/persistence/postgres-store.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-06-27T15:00:00.000Z";

let ok = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    ok += 1;
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.error(`  RED ${name}${detail ? `: ${detail}` : ""}`);
  }
}

async function expectReject(name: string, fn: () => Promise<unknown>, contains: string): Promise<void> {
  try {
    await fn();
    check(name, false, "deveria rejeitar");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, message.includes(contains), message);
  }
}

class FixedClock implements Clock {
  now(): string { return NOW; }
}

type RpcCall = { name: string; args: DatabaseRow };

class ScriptedGateway implements V3DatabaseGateway {
  readonly rpcCalls: RpcCall[] = [];
  readonly oneCalls: { table: string; filters: DatabaseFilters }[] = [];
  readonly manyCalls: { table: string; filters: DatabaseFilters }[] = [];
  readonly countCalls: { table: string; filters: DatabaseFilters }[] = [];
  private readonly rpcQueues = new Map<string, JsonValue[]>();
  private readonly oneRows = new Map<string, DatabaseRow | null>();
  private readonly manyRows = new Map<string, DatabaseRow[]>();
  private readonly counts = new Map<string, number>();

  queueRpc(name: string, ...values: JsonValue[]): void {
    this.rpcQueues.set(name, [...(this.rpcQueues.get(name) ?? []), ...values]);
  }
  setOne(table: string, row: DatabaseRow | null): void { this.oneRows.set(table, row); }
  setMany(table: string, rows: DatabaseRow[]): void { this.manyRows.set(table, rows); }
  setCount(table: string, count: number): void { this.counts.set(table, count); }

  async rpc<T extends JsonValue>(name: string, args: DatabaseRow): Promise<T> {
    this.rpcCalls.push({ name, args });
    const queue = this.rpcQueues.get(name) ?? [];
    if (queue.length === 0) throw new Error(`RPC sem script: ${name}`);
    const value = queue.shift()!;
    this.rpcQueues.set(name, queue);
    return value as T;
  }

  async selectOne(table: string, filters: DatabaseFilters): Promise<DatabaseRow | null> {
    this.oneCalls.push({ table, filters });
    return this.oneRows.get(table) ?? null;
  }

  async selectMany(table: string, filters: DatabaseFilters): Promise<DatabaseRow[]> {
    this.manyCalls.push({ table, filters });
    return this.manyRows.get(table) ?? [];
  }

  async count(table: string, filters: DatabaseFilters): Promise<number> {
    this.countCalls.push({ table, filters });
    return this.counts.get(table) ?? 0;
  }
}

function store(gateway: ScriptedGateway): PostgresPersistence {
  return new PostgresPersistence(gateway, { tenantId: TENANT, clock: new FixedClock() });
}

function lease(): Lease {
  return {
    conversationId: "c1",
    owner: "worker-1",
    token: "lease-token",
    acquiredAt: NOW,
    expiresAt: "2026-06-27T15:02:00.000Z",
  };
}

function decision(): TurnDecision {
  return {
    turnId: "t1",
    action: "reply",
    target: null,
    reasonCode: "test",
    reasonSummary: "Teste contratual",
    confidence: 1,
    decisionMutations: [],
    effectPlan: [],
    responsePlan: { guidance: "Responder" },
    policyChecks: [],
  };
}

function outbox(): OutboxRecord {
  return {
    effectId: "t1:message",
    idempotencyKey: "t1:message",
    conversationId: "c1",
    turnId: "t1",
    planId: "message",
    kind: "send_message",
    payload: redact({ text: "Oi" }),
    onSuccess: [],
    order: 1,
    dependsOn: [],
    status: "pending",
    providerCapability: "none",
    receiptLevel: null,
    attempts: 0,
    nextRetryAt: null,
    providerReceipt: null,
    outcomeAppliedAt: null,
    lastError: null,
    createdAt: NOW,
    dispatchedAt: null,
  };
}

function outboxRow(record: OutboxRecord): DatabaseRow {
  return {
    effect_id: record.effectId,
    idempotency_key: record.idempotencyKey,
    conversation_id: record.conversationId,
    turn_id: record.turnId,
    plan_id: record.planId,
    kind: record.kind,
    payload: record.payload,
    on_success: record.onSuccess as unknown as JsonValue,
    effect_order: record.order,
    depends_on: record.dependsOn,
    status: record.status,
    provider_capability: record.providerCapability,
    receipt_level: record.receiptLevel,
    attempts: record.attempts,
    next_retry_at: record.nextRetryAt,
    provider_receipt: record.providerReceipt,
    outcome_applied_at: record.outcomeAppliedAt,
    terminal_at: record.terminalAt ?? null,
    last_error: record.lastError,
    created_at: record.createdAt,
    dispatched_at: record.dispatchedAt,
    processing_by: record.processingBy ?? null,
    processing_token: record.processingToken ?? null,
    processing_expires_at: record.processingExpiresAt ?? null,
  };
}
async function main(): Promise<void> {
  console.log("\n=== F2.5.0 POSTGRES ADAPTER ===");

  {
    const gateway = new ScriptedGateway();
    gateway.queueRpc("v3_ingest_inbox", true, false);
    const persistence = store(gateway);
    const record = { eventId: "e1", conversationId: "c1", raw: redact({ text: "oi" }), receivedAt: NOW };
    const first = await persistence.tryInsert(record);
    const duplicate = await persistence.tryInsert(record);
    check("ingest usa RPC e preserva dedupe", first && !duplicate);
    check(
      "ingest injeta tenant e payload redigido",
      gateway.rpcCalls[0].args.p_tenant_id === TENANT
        && (gateway.rpcCalls[0].args.p_raw as DatabaseRow).__redacted === true,
    );
  }

  {
    const gateway = new ScriptedGateway();
    gateway.queueRpc("v3_acquire_lease", [{ token: "lease-token", acquired_at: NOW, expires_at: "2026-06-27T15:02:00.000Z" }]);
    gateway.queueRpc("v3_claim_inbox_burst", ["e1", "e2"]);
    gateway.queueRpc("v3_release_lease", true);
    const persistence = store(gateway);
    const ids = await persistence.withLease("c1", "worker-1", 120000, async (activeLease) => {
      return persistence.claimBurst("c1", NOW, "worker-1", "t1", activeLease);
    });
    check("lease -> claim -> release executa em ordem", ids.length === 2 && gateway.rpcCalls.map((call) => call.name).join(",") === "v3_acquire_lease,v3_claim_inbox_burst,v3_release_lease");
    check("claim envia token do lease", gateway.rpcCalls[1].args.p_lease_token === "lease-token");
  }

  {
    const gateway = new ScriptedGateway();
    gateway.queueRpc("v3_acquire_lease", [{ token: "lease-token", acquired_at: NOW, expires_at: "2026-06-27T15:02:00.000Z" }]);
    gateway.queueRpc("v3_release_lease", true);
    const persistence = store(gateway);
    await expectReject("withLease propaga erro do callback", () => persistence.withLease("c1", "worker-1", 120000, async () => {
      throw new Error("boom");
    }), "boom");
    check("withLease libera no finally apos erro", gateway.rpcCalls.at(-1)?.name === "v3_release_lease");
  }

  {
    const gateway = new ScriptedGateway();
    const initial = createInitialState({ conversationId: "c1", tenantId: TENANT, agentId: "a1", now: NOW });
    gateway.setOne("v3_inbox", {
      event_id: "e1", conversation_id: "c1", raw: { __redacted: true, text: "oi" }, status: "claimed",
      claimed_by: "worker-1", turn_id: "t1", attempts: 1, next_retry_at: null, received_at: NOW, claimed_at: NOW,
    });
    gateway.setOne("v3_conversation_state", { conversation_id: "c1", version: 0, state: initial as unknown as JsonValue });
    gateway.setMany("v3_effect_outbox", [{
      effect_id: "t1:message", idempotency_key: "t1:message", conversation_id: "c1", turn_id: "t1",
      plan_id: "message", kind: "send_message", payload: { __redacted: true, text: "oi" }, on_success: [],
      effect_order: 1, depends_on: [], status: "pending", provider_capability: "none", receipt_level: null,
      attempts: 0, next_retry_at: null, provider_receipt: null, outcome_applied_at: null, terminal_at: null,
      last_error: null, created_at: NOW, dispatched_at: null, processing_by: null, processing_token: null,
      processing_expires_at: null,
    }]);
    gateway.setCount("v3_inbox", 3);
    const persistence = store(gateway);
    const inbox = await persistence.get("e1");
    const snapshot = await persistence.load("c1");
    const effects = await persistence.listOutbox("c1");
    const count = await persistence.pendingCount("c1");
    check("linhas snake_case viram tipos de dominio", inbox?.eventId === "e1" && snapshot?.state.agentId === "a1" && effects[0].effectId === "t1:message" && count === 3);
    check("leituras sempre filtram tenant", [...gateway.oneCalls, ...gateway.manyCalls, ...gateway.countCalls].every((call) => call.filters.tenant_id === TENANT));
  }

  {
    const gateway = new ScriptedGateway();
    gateway.queueRpc("v3_commit_turn", 1);
    const persistence = store(gateway);
    const initial = createInitialState({ conversationId: "c1", tenantId: TENANT, agentId: "a1", leadId: "lead-1", now: NOW });
    const next = { ...initial, turnNumber: 1, version: 1 };
    const event: TurnEventRecord = {
      eventId: "t1:decision", conversationId: "c1", turnId: "t1", type: "decision_final",
      payloadSchemaVersion: 1, payload: redact({ action: "reply" }), at: NOW,
    };
    const uow = persistence.begin({ lease: lease() });
    uow.casState("c1", 0, next);
    uow.appendDecision("c1", decision());
    uow.appendEvents([event]);
    uow.appendOutbox([outbox()]);
    uow.markInboxDone(["e1"], "worker-1", "t1");
    const committed = await uow.commit();
    const call = gateway.rpcCalls[0];
    check("UnitOfWork real usa uma unica RPC atomica", committed.ok && gateway.rpcCalls.length === 1 && call.name === "v3_commit_turn");
    check("commit envia CAS, lease, inbox e outbox", call.args.p_expected_version === 0 && call.args.p_lease_token === "lease-token" && Array.isArray(call.args.p_event_ids) && Array.isArray(call.args.p_outbox));
  }

  {
    const gateway = new ScriptedGateway();
    const persistence = store(gateway);
    const uow = persistence.begin();
    uow.updateOutbox(outbox());
    const result = await uow.commit();
    check("outbox generico ainda nao mapeado falha fechado", !result.ok && result.reason === "postgres_outbox_update_not_enabled_f2_5_0");
    check("falha fechada nao chama banco", gateway.rpcCalls.length === 0);
  }

  {
    const gateway = new ScriptedGateway();
    gateway.setOne("v3_inbox", {
      event_id: "e-bad", conversation_id: "c1", raw: { __redacted: false, text: "cpf" }, status: "pending",
      claimed_by: null, turn_id: null, attempts: 0, next_retry_at: null, received_at: NOW, claimed_at: null,
    });
    await expectReject("decoder rejeita payload sem redaction", () => store(gateway).get("e-bad"), "payload sem redaction");
  }

  {
    const gateway = new ScriptedGateway();
    const processing: OutboxRecord = {
      ...outbox(),
      status: "processing",
      attempts: 1,
      dispatchedAt: NOW,
      processingBy: "worker-outbox",
      processingToken: "claim-token",
      processingExpiresAt: "2026-06-27T15:01:00.000Z",
    };
    gateway.queueRpc("v3_claim_outbox_for_conversation", [outboxRow(processing)]);
    const persistence = store(gateway);
    const claimed = await persistence.claimOutbox("c1", "worker-outbox", 60_000, 10);
    const call = gateway.rpcCalls[0];
    check("claim outbox usa RPC por conversa e decodifica token", claimed.length === 1 && claimed[0].processingToken === "claim-token" && call.name === "v3_claim_outbox_for_conversation");
    check("claim outbox envia tenant, worker, ttl e limite", call.args.p_tenant_id === TENANT && call.args.p_conversation_id === "c1" && call.args.p_worker_id === "worker-outbox" && call.args.p_ttl_ms === 60_000 && call.args.p_limit === 10);

    gateway.queueRpc("v3_record_outbox_result", true);
    const recorded = await persistence.recordOutboxResult(processing, {
      status: "succeeded",
      effectId: processing.effectId,
      receipt: { effectId: processing.effectId, level: "delivered", at: NOW },
    });
    const resultCall = gateway.rpcCalls[1];
    check("result outbox carrega processing token", recorded.ok && resultCall.name === "v3_record_outbox_result" && resultCall.args.p_processing_token === "claim-token" && resultCall.args.p_receipt_level === "delivered");
  }

  {
    const gateway = new ScriptedGateway();
    gateway.queueRpc("v3_requeue_outbox_guarded", true);
    gateway.queueRpc("v3_skip_outbox_guarded", true);
    gateway.queueRpc("v3_fail_outbox_guarded", true);
    const persistence = store(gateway);
    const failedRecord: OutboxRecord = { ...outbox(), status: "failed", nextRetryAt: NOW };
    const pendingRecord = outbox();
    const acceptedRecord: OutboxRecord = { ...outbox(), status: "succeeded", receiptLevel: "accepted" };
    const requeued = await persistence.requeueOutbox(failedRecord, NOW, "retry_due");
    const skipped = await persistence.skipOutbox(pendingRecord, "dependency_failed", NOW);
    const terminal = await persistence.failOutbox(acceptedRecord, "delivery_timeout", NOW);
    check("operacoes administrativas usam somente RPCs guarded", requeued.ok && skipped.ok && terminal.ok && gateway.rpcCalls.map((call) => call.name).join(",") === "v3_requeue_outbox_guarded,v3_skip_outbox_guarded,v3_fail_outbox_guarded");
    check("guard envia status e receipt esperados", gateway.rpcCalls[0].args.p_expected_status === "failed" && gateway.rpcCalls[0].args.p_expected_receipt_level === null && gateway.rpcCalls[2].args.p_expected_status === "succeeded" && gateway.rpcCalls[2].args.p_expected_receipt_level === "accepted");
    check("guard sem processing nunca inventa token", gateway.rpcCalls.every((call) => call.args.p_processing_token === null));
  }

  {
    const gateway = new ScriptedGateway();
    gateway.queueRpc("v3_commit_effect_outcome", [{ state_version: 2, applied: true }]);
    const persistence = store(gateway);
    const initial = createInitialState({ conversationId: "c1", tenantId: TENANT, agentId: "a1", now: NOW });
    const result = await persistence.commitOutboxOutcome("c1", "t1:message", 1, { ...initial, version: 2 }, NOW);
    const call = gateway.rpcCalls[0];
    check("outcome commit decodifica versao e applied", result.ok && result.stateVersion === 2 && result.applied === true);
    check("outcome commit envia CAS e estado para RPC atomica", call.name === "v3_commit_effect_outcome" && call.args.p_expected_version === 1 && call.args.p_effect_id === "t1:message" && call.args.p_next_state != null);
  }
  {
    const gateway = new ScriptedGateway();
    const acceptedRecord: OutboxRecord = {
      ...outbox(),
      status: "succeeded",
      receiptLevel: "accepted",
      providerReceipt: { effectId: "t1:message", level: "accepted", at: NOW, providerMessageId: "3EB0ABC123" },
    };
    gateway.queueRpc("v3_find_outbox_by_provider_message_id", [outboxRow(acceptedRecord)]);
    const persistence = store(gateway);
    const found = await persistence.findOutboxByProviderMessageId("3EB0ABC123");
    check("providerMessageId usa RPC tenant-scoped", found?.effectId === acceptedRecord.effectId && gateway.rpcCalls[0].args.p_tenant_id === TENANT && gateway.rpcCalls[0].args.p_provider_message_id === "3EB0ABC123");

    gateway.queueRpc("v3_find_outbox_by_provider_message_id", [outboxRow(acceptedRecord), outboxRow({ ...acceptedRecord, effectId: "t2:message", idempotencyKey: "t2:message", turnId: "t2" })]);
    await expectReject("providerMessageId ambiguo falha fechado", () => persistence.findOutboxByProviderMessageId("3EB0ABC123"), "ambiguo");
  }
  console.log(`\n=== POSTGRES ADAPTER: ${ok} OK | ${failed} FALHA ===`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
