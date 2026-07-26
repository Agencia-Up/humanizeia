import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FakeClock, FakeIdGen, InMemoryPersistence } from "../src/adapters/persistence/in-memory-store.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { redact, type OutboxRecord } from "../src/domain/effect-intent.ts";
import type { EffectResult } from "../src/domain/decision.ts";
import type { DatabaseFilters, DatabaseRow, V3DatabaseGateway } from "../src/domain/database-gateway.ts";
import { InMemoryEffectGate } from "../src/engine/effect-gate.ts";
import { OutboxDispatcher, type EffectDispatcher } from "../src/engine/outbox-dispatcher.ts";
import { OutboxReconciler } from "../src/engine/reconciler.ts";
import {
  isOutboxMaintenanceDue,
  OutboxMaintenanceCandidateStore,
} from "../src/adapters/effects/outbox-maintenance-candidate-store.ts";

const NOW = "2026-07-26T15:00:00.000Z";
const TENANT = "cf55ad47-4261-4a9c-8e3c-751c3f022b86";
const AGENT = "61054aad-da4f-4ad1-b094-77b3ecfda8e3";
let ok = 0;
let fail = 0;

function check(name: string, pass: boolean, detail = ""): void {
  if (pass) {
    ok += 1;
    console.log(`  OK  ${name}`);
  } else {
    fail += 1;
    console.error(`  FALHA  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

function effect(overrides: Partial<OutboxRecord>): OutboxRecord {
  const turnId = overrides.turnId ?? "turn-augusto";
  const planId = overrides.planId ?? "message";
  const effectId = overrides.effectId ?? `${turnId}:${planId}`;
  return {
    effectId,
    idempotencyKey: effectId,
    conversationId: overrides.conversationId ?? "wa:augusto",
    turnId,
    planId,
    kind: overrides.kind ?? "send_message",
    payload: overrides.payload ?? redact({ text: "Mensagem valida autorada pela LLM." }),
    onSuccess: overrides.onSuccess ?? [],
    order: overrides.order ?? 0,
    dependsOn: overrides.dependsOn ?? [],
    status: overrides.status ?? "pending",
    providerCapability: overrides.providerCapability ?? "none",
    receiptLevel: overrides.receiptLevel ?? null,
    attempts: overrides.attempts ?? 0,
    nextRetryAt: overrides.nextRetryAt ?? null,
    providerReceipt: overrides.providerReceipt ?? null,
    outcomeAppliedAt: overrides.outcomeAppliedAt ?? null,
    terminalAt: overrides.terminalAt ?? null,
    lastError: overrides.lastError ?? null,
    processingBy: overrides.processingBy ?? null,
    processingToken: overrides.processingToken ?? null,
    processingExpiresAt: overrides.processingExpiresAt ?? null,
    createdAt: overrides.createdAt ?? NOW,
    dispatchedAt: overrides.dispatchedAt ?? null,
  };
}

console.log("\n=== F2.86 - recuperacao duravel de efeitos ===\n");

// Incidente real: a mensagem falha uma vez de modo retryable. O CRM nao pode
// ser descartado; apos a janela, a MESMA mensagem volta e libera o dependente.
{
  const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const message = effect({ planId: "message", order: 0 });
  const crm = effect({
    planId: "crm",
    kind: "crm_write",
    order: 1,
    dependsOn: ["message"],
    payload: redact({ leadId: "lead-augusto", fields: { nome: "Augusto" } }),
  });
  const unit = persistence.begin();
  unit.casState("wa:augusto", 0, createInitialState({
    conversationId: "wa:augusto",
    tenantId: TENANT,
    agentId: AGENT,
    leadId: "lead-augusto",
    now: NOW,
  }));
  unit.appendOutbox([message, crm]);
  const committed = unit.commit();
  if (!committed.ok) throw new Error(committed.reason);

  let messageCalls = 0;
  let crmCalls = 0;
  const provider: EffectDispatcher = {
    async dispatch(record): Promise<EffectResult> {
      if (record.kind === "send_message") {
        messageCalls += 1;
        if (messageCalls === 1) {
          return {
            status: "failed",
            effectId: record.effectId,
            error: { code: "UPSTREAM", message: "uazapi_transport_failure", retryable: true },
          };
        }
      } else if (record.kind === "crm_write") {
        crmCalls += 1;
      }
      return {
        status: "succeeded",
        effectId: record.effectId,
        receipt: { effectId: record.effectId, level: "delivered", at: clock.now() },
      };
    },
  };
  const gate = new InMemoryEffectGate();
  gate.setActiveMode("wa:augusto", true);
  const dispatcher = new OutboxDispatcher(persistence, clock, provider, gate, "f286");

  const first = await dispatcher.dispatchConversation("wa:augusto");
  const afterFailure = persistence.listOutbox("wa:augusto");
  check("primeira falha e registrada como retryable", first === 1
    && afterFailure[0]?.status === "failed"
    && afterFailure[0]?.terminalAt == null
    && afterFailure[0]?.nextRetryAt != null, JSON.stringify(afterFailure));
  check("CRM dependente permanece pendente durante falha transitoria",
    afterFailure[1]?.status === "pending", JSON.stringify(afterFailure[1]));
  check("CRM nao executa antes da mensagem", crmCalls === 0, String(crmCalls));

  const reconciler = new OutboxReconciler(persistence, clock, provider);
  await reconciler.reconcileConversation("wa:augusto");
  check("retry nao acontece antes da janela", persistence.listOutbox("wa:augusto")[0]?.status === "failed");

  clock.advance(31_000);
  await reconciler.reconcileConversation("wa:augusto");
  const second = await dispatcher.dispatchConversation("wa:augusto");
  const recovered = persistence.listOutbox("wa:augusto");
  check("mensagem original e recuperada sem nova mensagem do lead",
    messageCalls === 2 && recovered[0]?.status === "succeeded", JSON.stringify(recovered[0]));
  check("CRM continua depois da recuperacao", second === 2 && crmCalls === 1
    && recovered[1]?.status === "succeeded", JSON.stringify(recovered[1]));

  await reconciler.reconcileConversation("wa:augusto");
  const third = await dispatcher.dispatchConversation("wa:augusto");
  check("novo tick e idempotente: zero reenvio e zero CRM duplicado",
    third === 0 && messageCalls === 2 && crmCalls === 1,
    JSON.stringify({ third, messageCalls, crmCalls }));
}

// Receipt `accepted` tambem pode ser terminal para um send_message cujo
// outcome e apenas memoria aceita-segura. Se o receipt foi persistido e o CAS
// do estado falhou, a manutencao deve reaplicar somente o outcome: nunca
// redisparar a mensagem que o provedor ja aceitou.
{
  const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const conversationId = "wa:accepted-outcome-repair";
  const accepted = effect({
    conversationId,
    turnId: "turn-accepted",
    planId: "message",
    status: "succeeded",
    receiptLevel: "accepted",
    providerReceipt: {
      effectId: "turn-accepted:message",
      level: "accepted",
      at: NOW,
    },
    terminalAt: NOW,
    outcomeAppliedAt: null,
    onSuccess: [{
      op: "append_assistant_turn",
      effectId: "turn-accepted:message",
      turn: {
        role: "agent",
        text: "Mensagem aceita pelo provedor.",
        at: NOW,
        authoring: "llm",
      },
    }],
  });
  const unit = persistence.begin();
  unit.casState(conversationId, 0, createInitialState({
    conversationId,
    tenantId: TENANT,
    agentId: AGENT,
    leadId: "lead-accepted",
    now: NOW,
  }));
  unit.appendOutbox([accepted]);
  const committed = unit.commit();
  if (!committed.ok) throw new Error(committed.reason);

  let dispatchCalls = 0;
  const provider: EffectDispatcher = {
    async dispatch(record): Promise<EffectResult> {
      dispatchCalls += 1;
      throw new Error(`redispatch_inesperado:${record.effectId}`);
    },
  };
  const reconciler = new OutboxReconciler(persistence, clock, provider);
  await reconciler.reconcileConversation(conversationId);

  const repaired = persistence.listOutbox(conversationId)[0];
  const snapshot = persistence.load(conversationId);
  const remembered = snapshot?.state.recentTurns.at(-1);
  check("receipt accepted-safe repara outcome sem redisparar mensagem",
    dispatchCalls === 0 && repaired?.outcomeAppliedAt != null,
    JSON.stringify({ dispatchCalls, repaired }));
  check("reparo accepted-safe preserva texto e autoria da LLM na memoria",
    remembered?.text === "Mensagem aceita pelo provedor."
      && remembered.authoring === "llm",
    JSON.stringify(remembered));
}

// Descoberta do worker: apenas estados realmente vencidos entram; o roteamento
// ainda precisa pertencer ao mesmo tenant+agente.
{
  const rows: DatabaseRow[] = [
    { conversation_id: "due", status: "failed", attempts: 1, next_retry_at: "2026-07-26T14:59:59.000Z", receipt_level: null, required_receipt_level: "accepted", outcome_applied_at: null, terminal_at: null, processing_expires_at: null, dispatched_at: NOW, created_at: NOW },
    { conversation_id: "future", status: "failed", attempts: 1, next_retry_at: "2026-07-26T15:01:00.000Z", receipt_level: null, required_receipt_level: "accepted", outcome_applied_at: null, terminal_at: null, processing_expires_at: null, dispatched_at: NOW, created_at: NOW },
    { conversation_id: "stale", status: "processing", attempts: 1, next_retry_at: null, receipt_level: null, required_receipt_level: "accepted", outcome_applied_at: null, terminal_at: null, processing_expires_at: "2026-07-26T14:59:00.000Z", dispatched_at: NOW, created_at: NOW },
    { conversation_id: "pending", status: "pending", attempts: 0, next_retry_at: null, receipt_level: null, required_receipt_level: "accepted", outcome_applied_at: null, terminal_at: null, processing_expires_at: null, dispatched_at: null, created_at: NOW },
    // Receipt aceito pode preencher terminal_at antes de o CAS do outcome
    // terminar. Esse e o formato real que o filtro antigo escondia do worker.
    { conversation_id: "repair", status: "succeeded", attempts: 1, next_retry_at: null, receipt_level: "delivered", required_receipt_level: "delivered", outcome_applied_at: null, terminal_at: NOW, processing_expires_at: null, dispatched_at: NOW, created_at: NOW },
    { conversation_id: "repair-accepted", status: "succeeded", attempts: 1, next_retry_at: null, receipt_level: "accepted", required_receipt_level: "accepted", outcome_applied_at: null, terminal_at: NOW, processing_expires_at: null, dispatched_at: NOW, created_at: NOW },
    { conversation_id: "settled", status: "succeeded", attempts: 1, next_retry_at: null, receipt_level: "delivered", required_receipt_level: "delivered", outcome_applied_at: NOW, terminal_at: NOW, processing_expires_at: null, dispatched_at: NOW, created_at: NOW },
    { conversation_id: "terminal-failure", status: "failed", attempts: 3, next_retry_at: "2026-07-26T14:59:00.000Z", receipt_level: null, required_receipt_level: "accepted", outcome_applied_at: null, terminal_at: NOW, processing_expires_at: null, dispatched_at: NOW, created_at: NOW },
  ];
  const selectFilters: DatabaseFilters[] = [];
  class FakeGateway implements V3DatabaseGateway {
    async rpc<T>(): Promise<T> { throw new Error("rpc_not_expected"); }
    async selectMany(_table: string, filters: DatabaseFilters): Promise<DatabaseRow[]> {
      selectFilters.push(filters);
      return rows.filter((row) => Object.entries(filters).every(([key, value]) =>
        key === "tenant_id" || row[key] === value));
    }
    async selectOne(_table: string, filters: DatabaseFilters): Promise<DatabaseRow | null> {
      if (filters.conversation_id === "stale") return null; // outro agente/sem routing
      return { to_addr: "5512999999999", instance_id: "instance-1", lead_id: "lead-1" };
    }
    async count(): Promise<number> { return 0; }
  }
  const store = new OutboxMaintenanceCandidateStore(new FakeGateway());
  const candidates = await store.list({ tenantId: TENANT, agentId: AGENT }, NOW);
  const ids = candidates.map((item) => item.conversationId).sort();
  check("worker encontra retry, pending e outcomes accepted/delivered sem aplicar",
    JSON.stringify(ids) === JSON.stringify(["due", "pending", "repair", "repair-accepted"]), JSON.stringify(ids));
  check("worker ignora retry futuro e routing sem ownership", !ids.includes("future") && !ids.includes("stale"));
  check("worker busca succeeded por outcome pendente mesmo com terminal_at preenchido",
    selectFilters.some((filters) => filters.status === "succeeded"
      && filters.outcome_applied_at === null
      && !("terminal_at" in filters)), JSON.stringify(selectFilters));
  check("worker ignora outcome aplicado e falha terminal",
    !ids.includes("settled") && !ids.includes("terminal-failure"), JSON.stringify(ids));
  check("predicado de vencimento nao confunde retry futuro",
    isOutboxMaintenanceDue(rows[0]!, NOW) && !isOutboxMaintenanceDue(rows[1]!, NOW));
}

// Trava de composicao: o runtime precisa acordar a manutencao periodicamente e
// usar um modelo impossivel de chamar, em vez de depender da chave OpenAI.
{
  const here = fileURLToPath(new URL(".", import.meta.url));
  const server = readFileSync(`${here}/../src/runtime/server.ts`, "utf8");
  const root = readFileSync(`${here}/../src/engine/pilot-active-root.ts`, "utf8");
  const effectsRoot = server.slice(server.indexOf("async #createEffectsRoot"), server.indexOf("async processDueOutboxMaintenance"));
  check("runtime possui tick periodico de manutencao", server.includes("setInterval(runOutboxTick, 15_000)"));
  check("root de efeitos nao resolve nem chama IA", effectsRoot.includes("model: EFFECTS_ONLY_MODEL")
    && effectsRoot.includes('brainMode: "off"')
    && !effectsRoot.includes("resolveTenantAiSecret"));
  check("manutencao executa reconciliador antes do dispatcher",
    root.indexOf("reconciler.reconcileConversation") < root.indexOf("runtime.dispatcher.dispatchConversation", root.indexOf("maintainConversationEffects")));
}

console.log(`\nF2.86: ${ok} OK / ${fail} FALHA\n`);
if (fail > 0) process.exitCode = 1;
