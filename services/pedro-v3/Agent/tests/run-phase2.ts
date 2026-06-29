// ============================================================================
// Pedro v3 — F2.0: testes da camada de persistência IN-MEMORY. SEM I/O ($0).
//   npx tsx tests/run-phase2.ts
// Prova: dedupe atômico, claim/lease, cutoff, lease release (finally),
// CAS de estado, UnitOfWork tudo-ou-nada, outbox store básico, determinismo.
// ============================================================================
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { redact } from "../src/domain/effect-intent.ts";
import { FakeLlm } from "../src/adapters/llm/fake-llm.ts";
import { materializeEffectPlans } from "../src/engine/effect-materializer.ts";
import { runConversationTurn } from "../src/engine/conversation-engine.ts";
import type { OutboxRecord } from "../src/domain/effect-intent.ts";
import type { ClaimExtractor, ProposedDecision, QueryResult, TenantCatalog, TurnInterpretation, EffectResult } from "../src/domain/decision.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";
import { OutboxDispatcher } from "../src/engine/outbox-dispatcher.ts";
import type { EffectDispatcher } from "../src/engine/outbox-dispatcher.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { InMemoryEffectGate } from "../src/engine/effect-gate.ts";
import { OutboxReconciler } from "../src/engine/reconciler.ts";
import { isEffectSatisfiedForDependency } from "../src/engine/receipt-policy.ts";
import { runShadowHarnessTurn } from "../src/engine/shadow-harness.ts";

const NOW = "2026-06-27T00:00:00.000Z";
let ok = 0, fail = 0; const fails: string[] = [];
function check(group: string, name: string, pass: boolean, detail = "") {
  if (pass) { ok++; console.log(`  ✅ [${group}] ${name}`); }
  else { fail++; fails.push(`[${group}] ${name} — ${detail}`); console.log(`  ❌ [${group}] ${name} — ${detail}`); }
}
function mk() { const clock = new FakeClock(NOW); const idgen = new FakeIdGen(); const gate = new InMemoryEffectGate(); gate.setActiveMode("c1", true); return { clock, idgen, gate, p: new InMemoryPersistence(clock, idgen) }; }
function state(conversationId = "c1") { return createInitialState({ conversationId, tenantId: "icom", agentId: "carvalho", now: NOW }); }
function outboxRec(conversationId: string, turnId: string, planId: string, order = 1, dependsOn: string[] = []): OutboxRecord {
  const effectId = `${turnId}:${planId}`;
  return {
    effectId, conversationId, turnId, planId, kind: "send_message",
    idempotencyKey: effectId, order, dependsOn, payload: redact({ text: "oi" }), onSuccess: [],
    status: "pending", providerCapability: "none", receiptLevel: null,
    attempts: 0, nextRetryAt: null, providerReceipt: null, outcomeAppliedAt: null,
    lastError: null, createdAt: NOW, dispatchedAt: null,
  };
}

console.log("\n=== F2.0 — persistência in-memory (ports/store) — $0 ===\n");

// 1) INBOX DEDUPE ATÔMICO
{
  const { p } = mk();
  const r1 = p.tryInsert({ eventId: "e1", conversationId: "c1", raw: redact({ text: "oi" }), receivedAt: "2026-06-27T00:00:01.000Z" });
  const r2 = p.tryInsert({ eventId: "e1", conversationId: "c1", raw: redact({ text: "oi de novo" }), receivedAt: "2026-06-27T00:00:02.000Z" });
  check("F2.0-inbox", "1 mesmo eventId entra UMA vez", r1 === true && r2 === false, `r1=${r1} r2=${r2}`);
  check("F2.0-inbox", "1 duplicado é no_op (pendingCount=1)", p.pendingCount("c1") === 1, String(p.pendingCount("c1")));
}

// 2) CLAIM / LEASE — dois workers, só um vence
{
  const { p } = mk();
  p.tryInsert({ eventId: "e1", conversationId: "c1", raw: redact({}), receivedAt: "2026-06-27T00:00:01.000Z" });
  const l1 = p.acquire("c1", "w1", 1000);
  const l2 = p.acquire("c1", "w2", 1000);
  check("F2.0-claim", "2 dois workers no mesmo lease, só um vence", l1 != null && l2 == null, `l1=${!!l1} l2=${!!l2}`);
  const claimed = p.claimBurst("c1", "2026-06-27T00:00:05.000Z", "w1", "t1");
  const claimedAgain = p.claimBurst("c1", "2026-06-27T00:00:05.000Z", "w2", "t2");
  check("F2.0-claim", "2 claimBurst marca o evento (segundo claim vê vazio)", claimed.length === 1 && claimed[0] === "e1" && claimedAgain.length === 0, JSON.stringify({ claimed, claimedAgain }));
  if (l1) p.release(l1);
}

// 3) CUTOFF — msg nova durante processamento fica p/ próximo turno
{
  const { p } = mk();
  p.tryInsert({ eventId: "a", conversationId: "c1", raw: redact({}), receivedAt: "2026-06-27T00:00:01.000Z" });
  const cutoff = "2026-06-27T00:00:02.000Z";
  p.tryInsert({ eventId: "b", conversationId: "c1", raw: redact({}), receivedAt: "2026-06-27T00:00:03.000Z" }); // chega DEPOIS do cutoff
  const burst1 = p.claimBurst("c1", cutoff, "w1", "t1");
  check("F2.0-cutoff", "3 burst do turno = só eventos <= cutoff", burst1.length === 1 && burst1[0] === "a", JSON.stringify(burst1));
  check("F2.0-cutoff", "3 msg nova fica pending p/ próximo turno", p.pendingCount("c1") === 1, String(p.pendingCount("c1")));
  const burst2 = p.claimBurst("c1", "2026-06-27T00:00:09.000Z", "w1", "t2");
  check("F2.0-cutoff", "3 próximo turno claima a msg nova", burst2.length === 1 && burst2[0] === "b", JSON.stringify(burst2));
}

// 4) LEASE RELEASE (async) — sucesso, reject e NÃO libera antes de Promise pendente terminar (F2.0.1)
await (async () => {
  const { p } = mk();
  let ran: boolean = false;
  await p.withLease("c1", "w1", 1000, () => { ran = true; });
  check("F2.0-lease", "4 release no SUCESSO (re-adquirível)", ran && p.acquire("c1", "w2", 1000) != null, "");
  let threw: boolean = false;
  try { await p.withLease("c2", "w1", 1000, () => { throw new Error("boom"); }); } catch { threw = true; }
  check("F2.0-lease", "4 release no ERRO/reject (re-adquirível)", threw && p.acquire("c2", "w3", 1000) != null, `threw=${threw}`);

  // NÃO libera enquanto uma Promise pendente não termina:
  let openGate!: () => void;
  const gate = new Promise<void>((res) => { openGate = res; });
  const pending = p.withLease("c3", "w1", 100000, async () => { await gate; return "done"; });
  const blocked = p.acquire("c3", "w2", 1000);   // lease ainda HELD durante o await
  check("F2.0-lease", "4 NÃO libera durante Promise pendente", blocked == null, `blocked=${!!blocked}`);
  openGate();
  const result = await pending;
  const freed = p.acquire("c3", "w2", 1000);      // liberado no resolve
  check("F2.0-lease", "4 libera no RESOLVE da Promise", result === "done" && freed != null, `result=${result}`);

  // reject de Promise pendente também libera:
  let openGate2!: () => void;
  const gate2 = new Promise<void>((res) => { openGate2 = res; });
  const pendingRej = p.withLease("c4", "w1", 100000, async () => { await gate2; throw new Error("boom2"); });
  const blocked2 = p.acquire("c4", "w2", 1000);
  openGate2();
  let rejThrew: boolean = false;
  try { await pendingRej; } catch { rejThrew = true; }
  const freed2 = p.acquire("c4", "w2", 1000);
  check("F2.0-lease", "4 libera no REJECT da Promise pendente", blocked2 == null && rejThrew && freed2 != null, `b2=${!!blocked2} rej=${rejThrew}`);
})();

// 5) CAS DE ESTADO — commit com versão antiga falha
{
  const { p } = mk();
  const u1 = p.begin(); u1.casState("c1", 0, state());
  check("F2.0-cas", "5 1º commit cria version 1", u1.commit().ok === true && p.load("c1")?.version === 1, JSON.stringify(p.load("c1")?.version));
  const u2 = p.begin(); u2.casState("c1", 0, state()); // expectedVersion ANTIGO (0), atual é 1
  check("F2.0-cas", "5 commit com versão antiga FALHA", u2.commit().ok === false, "");
  const u3 = p.begin(); u3.casState("c1", 1, state());
  check("F2.0-cas", "5 commit com versão correta avança p/ 2", u3.commit().ok === true && p.load("c1")?.version === 2, JSON.stringify(p.load("c1")?.version));
}

// 6) UNIT OF WORK tudo-ou-nada — se uma parte falha, nada persiste
{
  const { p } = mk();
  const u0 = p.begin(); u0.casState("c1", 0, state()); u0.commit(); // version 1
  const before = p.counts();
  const u = p.begin();
  u.casState("c1", 0, state()); // CAS STALE -> vai falhar
  u.appendEvents([{ eventId: "ev1", conversationId: "c1", turnId: "t1", type: "decision_final", payloadSchemaVersion: 1, payload: redact({}), at: NOW }]);
  u.appendOutbox([outboxRec("c1", "t1", "m1")]);
  const r = u.commit();
  const after = p.counts();
  check("F2.0-uow", "6 commit inválido REJEITA", r.ok === false, JSON.stringify(r));
  check("F2.0-uow", "6 nada persiste (events/outbox/version inalterados)", after.events === before.events && after.outbox === before.outbox && p.load("c1")?.version === 1, JSON.stringify({ before, after }));
}

// 7) OUTBOX STORE BÁSICO — grava records pending, sem dispatch
{
  const { p } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());
  u.appendOutbox([outboxRec("c1", "t1", "m1", 1, []), outboxRec("c1", "t1", "m2", 2, ["m1"])]);
  check("F2.0-outbox", "7 commit com outbox ok", u.commit().ok === true, "");
  const list = p.listOutbox("c1");
  check("F2.0-outbox", "7 records pending com effectId/idempotencyKey/order/dependsOn", list.length === 2 && list[0].status === "pending" && list[0].effectId === "t1:m1" && list[0].idempotencyKey === "t1:m1" && list[1].order === 2 && list[1].dependsOn[0] === "m1", JSON.stringify(list.map((r) => ({ e: r.effectId, s: r.status, o: r.order, d: r.dependsOn }))));
  check("F2.0-outbox", "7 nenhum dispatch (todos pending, sem receipt)", list.every((r) => r.status === "pending" && r.providerReceipt == null && r.dispatchedAt == null), "");
  const u2 = p.begin(); u2.casState("c1", 1, state()); u2.appendOutbox([outboxRec("c1", "t1", "m1")]); // idempotencyKey dup
  check("F2.0-outbox", "7 idempotencyKey UNIQUE (dup rejeita)", u2.commit().ok === false, "");
}

// 8) DETERMINISMO — Clock e IdGen fake deixam o teste reproduzível
{
  function scenario() {
    const clock = new FakeClock(NOW); const idgen = new FakeIdGen();
    const p = new InMemoryPersistence(clock, idgen);
    p.tryInsert({ eventId: "e1", conversationId: "c1", raw: redact({}), receivedAt: clock.now() });
    const l = p.acquire("c1", "w1", 1000);
    clock.advance(1000);
    const claimed = p.claimBurst("c1", clock.now(), "w1", "t1");
    return { leaseToken: l?.token, claimed, now: clock.now() };
  }
  const a = scenario(); const b = scenario();
  check("F2.0-determinismo", "8 duas execuções idênticas (clock/idgen fake)", JSON.stringify(a) === JSON.stringify(b) && a.leaseToken === "lease-1", JSON.stringify(a));
}

// 9) RECUPERAÇÃO de claim + markInboxDone validado (F2.0.1)
{
  const { p } = mk();
  p.tryInsert({ eventId: "e1", conversationId: "c1", raw: redact({}), receivedAt: "2026-06-27T00:00:01.000Z" });
  const claimed = p.claimBurst("c1", "2026-06-27T00:00:05.000Z", "w1", "t1");
  const released = p.releaseClaim(["e1"], "w1", "t1");  // turno falhou ANTES do commit -> volta p/ pending
  check("F2.0-recover", "9 claimBurst -> falha -> releaseClaim volta p/ pending", claimed.length === 1 && released.length === 1 && p.get("e1")?.status === "pending" && p.pendingCount("c1") === 1, JSON.stringify({ claimed, released, st: p.get("e1")?.status }));
  const reclaim = p.claimBurst("c1", "2026-06-27T00:00:09.000Z", "w1", "t2");
  check("F2.0-recover", "9 evento liberado é re-claimável", reclaim.length === 1, JSON.stringify(reclaim));
  const wrongOwner = p.releaseClaim(["e1"], "w9", "t2");
  const wrongTurn = p.releaseClaim(["e1"], "w1", "tX");
  check("F2.0-recover", "9 releaseClaim com owner/turno errado NÃO libera", wrongOwner.length === 0 && wrongTurn.length === 0 && p.get("e1")?.status === "claimed", JSON.stringify({ wrongOwner, wrongTurn, st: p.get("e1")?.status }));
  const uBad = p.begin(); uBad.casState("c1", 0, state()); uBad.markInboxDone(["e1"], "w1", "t9");  // turno errado (claimed por t2)
  check("F2.0-recover", "9 markInboxDone com turno errado é REJEITADO", uBad.commit().ok === false, "");
  const uOk = p.begin(); uOk.casState("c1", 0, state()); uOk.markInboxDone(["e1"], "w1", "t2");      // worker/turno correto
  check("F2.0-recover", "9 markInboxDone do worker/turno correto -> done", uOk.commit().ok === true && p.get("e1")?.status === "done", JSON.stringify(p.get("e1")?.status));
}


// 10) F2.1 MATERIALIZER + CONVERSATION ENGINE (in-memory, sem dispatch)
const emptyCatalog: TenantCatalog = { entries: [] };
const noClaims: ClaimExtractor = { extractClaims: () => [] };
const neutralInterpretation: TurnInterpretation = { relation: "ambiguous", intentSummary: "teste" };
const noQuery: QueryRunner = async (call) => ({
  ok: false,
  tool: call.tool,
  error: { code: "NOT_FOUND", message: "sem query no teste", retryable: false },
} as QueryResult);

function proposal(turnId: string, guidance = "Sigo por aqui."): ProposedDecision {
  return {
    proposedAction: "reply",
    facts: [{ op: "append_lead_turn", turn: { role: "lead", text: "oi", at: NOW } }],
    proposedEffects: [{ kind: "send_message", planId: "msg-1", order: 1, onSuccess: [] }],
    responsePlan: { guidance },
    reasonCode: "reply_test",
    reasonSummary: `resposta ${turnId}`,
    confidence: 0.99,
  };
}

function llmFor(text = "Sigo por aqui.") {
  const llm = new FakeLlm();
  llm.setTurnScript(
    [{ kind: "final", proposal: proposal("t", text) }],
    () => ({ parts: [{ type: "text", content: text }] }),
  );
  return llm;
}

async function runBasicTurn(args: { p: InMemoryPersistence; clock: FakeClock; turnId?: string; beforeCommit?: Parameters<typeof runConversationTurn>[0]["beforeCommit"]; afterCutoff?: Parameters<typeof runConversationTurn>[0]["afterCutoff"] }) {
  return runConversationTurn({
    persistence: args.p,
    clock: args.clock,
    llm: llmFor("Tudo certo, vou seguir."),
    runQuery: noQuery,
    conversationId: "c1",
    tenantId: "icom",
    agentId: "carvalho",
    leadId: "lead-1",
    workerId: "w1",
    turnId: args.turnId ?? "t-f21",
    leaseTtlMs: 1000,
    interpretation: neutralInterpretation,
    tenantCatalog: emptyCatalog,
    claimExtractor: noClaims,
    limits: { maxSteps: 3, totalTimeoutMs: 1000 },
    maxValidationAttempts: 1,
    beforeCommit: args.beforeCommit,
    afterCutoff: args.afterCutoff,
  });
}

{
  const { p } = mk();
  const llm = llmFor("Mensagem materializada.");
  llm.setTurnScript([{ kind: "final", proposal: proposal("t-mat", "Mensagem materializada.") }], () => ({ parts: [{ type: "text", content: "Mensagem materializada." }] }));
  const out = await runConversationTurn({
    persistence: p,
    clock: new FakeClock(NOW),
    llm,
    runQuery: noQuery,
    conversationId: "c1",
    tenantId: "icom",
    agentId: "carvalho",
    workerId: "w1",
    turnId: "t-mat",
    leaseTtlMs: 1000,
    interpretation: neutralInterpretation,
    tenantCatalog: emptyCatalog,
    claimExtractor: noClaims,
    limits: { maxSteps: 3, totalTimeoutMs: 1000 },
    maxValidationAttempts: 1,
  });
  check("F2.1-engine", "10 sem inbox retorna no_op", out.status === "no_op", JSON.stringify(out));
}

{
  const { p, clock } = mk();
  p.tryInsert({ eventId: "e1", conversationId: "c1", raw: redact({ text: "boa noite" }), receivedAt: NOW });
  const r = await runBasicTurn({ p, clock, turnId: "t1" });
  const list = p.listOutbox("c1");
  check("F2.1-engine", "10 ciclo completo commita turno", r.status === "committed" && r.claimedEventIds[0] === "e1", JSON.stringify(r));
  check("F2.1-engine", "10 inbox vira done so no commit", p.get("e1")?.status === "done", JSON.stringify(p.get("e1")));
  check("F2.1-engine", "10 estado avanca version/turnNumber", p.load("c1")?.version === 1 && p.load("c1")?.state.turnNumber === 1, JSON.stringify(p.load("c1")?.state));
  check("F2.1-engine", "10 outbox pending, sem dispatch/receipt", list.length === 1 && list[0].status === "pending" && list[0].providerReceipt == null && list[0].dispatchedAt == null, JSON.stringify(list));
}

{
  const { p, clock } = mk();
  p.tryInsert({ eventId: "e1", conversationId: "c1", raw: redact({ text: "oi" }), receivedAt: NOW });
  const r = await runBasicTurn({ p, clock, turnId: "t2" });
  const list = p.listOutbox("c1");
  check("F2.1-engine", "10 effectId/idempotencyKey deterministicos", r.status === "committed" && list[0]?.effectId === "t2:msg-1" && list[0]?.idempotencyKey === "t2:msg-1", JSON.stringify(list[0]));
  check("F2.1-engine", "10 payload persistido nasce redacted", list[0]?.payload.__redacted === true && list[0]?.payload.text === "Tudo certo, vou seguir.", JSON.stringify(list[0]?.payload));
}

{
  const decision = {
    turnId: "t3",
    action: "reply",
    reasonCode: "manual",
    reasonSummary: "manual",
    confidence: 1,
    decisionMutations: [],
    effectPlan: [{ kind: "send_message", planId: "msg-1", effectId: "t3:msg-1", order: 1, onSuccess: [] }],
    responsePlan: { guidance: "ok" },
    policyChecks: [],
  } as any;
  const records = materializeEffectPlans(decision, { draft: { parts: [] }, text: "texto final" }, { conversationId: "c1", createdAt: NOW });
  check("F2.1-materializer", "10 materializer nao despacha e usa payload renderizado", records.length === 1 && records[0].payload.text === "texto final" && records[0].status === "pending", JSON.stringify(records));
}

{
  const { p, clock } = mk();
  p.tryInsert({ eventId: "e1", conversationId: "c1", raw: redact({ text: "oi" }), receivedAt: NOW });
  const r = await runBasicTurn({ p, clock, turnId: "t4", beforeCommit: () => { throw new Error("falha antes do commit"); } });
  check("F2.1-engine", "10 falha antes do commit libera claim", r.status === "commit_failed" && p.get("e1")?.status === "pending" && p.pendingCount("c1") === 1, JSON.stringify({ r, inbox: p.get("e1") }));
  check("F2.1-engine", "10 falha antes do commit nao persiste outbox", p.listOutbox("c1").length === 0 && p.counts().decisions === 0, JSON.stringify(p.counts()));
}

{
  const { p, clock } = mk();
  p.tryInsert({ eventId: "e1", conversationId: "c1", raw: redact({ text: "oi" }), receivedAt: NOW });
  const r = await runBasicTurn({
    p,
    clock,
    turnId: "t5",
    beforeCommit: ({ expectedVersion }) => {
      const u = p.begin();
      u.casState("c1", expectedVersion, state("c1"));
      const committed = u.commit();
      if (!committed.ok) throw new Error(committed.reason);
    },
  });
  check("F2.1-engine", "10 conflito CAS falha e libera claim", r.status === "commit_failed" && p.get("e1")?.status === "pending", JSON.stringify({ r, inbox: p.get("e1") }));
  check("F2.1-engine", "10 conflito CAS nao vaza decision/outbox do turno", p.listOutbox("c1").length === 0 && p.counts().decisions === 0, JSON.stringify(p.counts()));
}

{
  const { p, clock } = mk();
  p.tryInsert({ eventId: "dup", conversationId: "c1", raw: redact({ text: "primeira" }), receivedAt: NOW });
  const dup = p.tryInsert({ eventId: "dup", conversationId: "c1", raw: redact({ text: "segunda" }), receivedAt: NOW });
  const r = await runBasicTurn({ p, clock, turnId: "t6" });
  check("F2.1-engine", "10 duplicado nao gera segundo turno/evento", dup === false && r.status === "committed" && r.claimedEventIds.length === 1 && p.counts().decisions === 1, JSON.stringify({ dup, r, counts: p.counts() }));
}

{
  const { p, clock } = mk();
  p.tryInsert({ eventId: "a", conversationId: "c1", raw: redact({ text: "antes" }), receivedAt: NOW });
  p.tryInsert({ eventId: "b", conversationId: "c1", raw: redact({ text: "depois" }), receivedAt: "2026-06-27T00:00:01.000Z" });
  const r = await runBasicTurn({ p, clock, turnId: "t7" });
  check("F2.1-engine", "10 cutoff do engine deixa msg futura pending", r.status === "committed" && r.claimedEventIds.length === 1 && r.claimedEventIds[0] === "a" && p.get("b")?.status === "pending", JSON.stringify({ r, b: p.get("b") }));
}

// 11) F2.2 DISPATCHER: dependsOn e order
{
  const { p, clock, gate } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());

  // Cria A (order=1, dependsOn=[]) e B (order=2, dependsOn=["msg-A"])
  const recA: OutboxRecord = {
    ...outboxRec("c1", "t1", "msg-A", 1, []),
  };
  const recB: OutboxRecord = {
    ...outboxRec("c1", "t1", "msg-B", 2, ["msg-A"]),
  };
  u.appendOutbox([recA, recB]);
  u.commit();

  const dispatched: OutboxRecord[] = [];
  const fakeDisp: EffectDispatcher = {
    async dispatch(record) {
      dispatched.push(record);
      return {
        status: "succeeded",
        effectId: record.effectId,
        receipt: { effectId: record.effectId, level: "delivered", at: clock.now() },
      };
    }
  };

  const dispatcher = new OutboxDispatcher(p, clock, fakeDisp, gate);
  const count = await dispatcher.dispatchConversation("c1");

  // Ambos devem ter sido despachados em sequência
  check("F2.2-dispatcher", "11 dispatcher processa ambos respeitando dependsOn", count === 2 && dispatched.length === 2 && dispatched[0].planId === "msg-A" && dispatched[1].planId === "msg-B", JSON.stringify(dispatched));
  const list = p.listOutbox("c1");
  check("F2.2-dispatcher", "11 ambos terminam como succeeded no outbox", list.every(r => r.status === "succeeded"), JSON.stringify(list));
}

// 12) F2.2 DISPATCHER: order implícito
{
  const { p, clock, gate } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());

  // Cria A (order=1, no dependsOn) e B (order=2, no dependsOn)
  const recA = outboxRec("c1", "t1", "msg-A", 1, []);
  const recB = outboxRec("c1", "t1", "msg-B", 2, []);
  u.appendOutbox([recA, recB]);
  u.commit();

  const dispatched: OutboxRecord[] = [];
  const fakeDisp: EffectDispatcher = {
    async dispatch(record) {
      dispatched.push(record);
      return {
        status: "succeeded",
        effectId: record.effectId,
        receipt: { effectId: record.effectId, level: "delivered", at: clock.now() },
      };
    }
  };

  const dispatcher = new OutboxDispatcher(p, clock, fakeDisp, gate);
  const count = await dispatcher.dispatchConversation("c1");

  check("F2.2-dispatcher", "12 dispatcher respeita order implícito", count === 2 && dispatched.length === 2 && dispatched[0].planId === "msg-A" && dispatched[1].planId === "msg-B", JSON.stringify(dispatched));
}

// 13) F2.2 DISPATCHER: skipped em cascata por falha
{
  const { p, clock, gate } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());

  // Cria A (order=1) e B (order=2, dependsOn=["msg-A"])
  const recA = outboxRec("c1", "t1", "msg-A", 1, []);
  const recB = outboxRec("c1", "t1", "msg-B", 2, ["msg-A"]);
  u.appendOutbox([recA, recB]);
  u.commit();

  const fakeDisp: EffectDispatcher = {
    async dispatch(record) {
      // Falha terminal (não retryable)
      return {
        status: "failed",
        effectId: record.effectId,
        error: { code: "UPSTREAM", message: "erro teste", retryable: false },
      };
    }
  };

  const dispatcher = new OutboxDispatcher(p, clock, fakeDisp, gate);
  const count = await dispatcher.dispatchConversation("c1");

  check("F2.2-dispatcher", "13 dispatcher despacha apenas o A (falhou)", count === 1, String(count));
  const list = p.listOutbox("c1");
  const a = list.find(r => r.planId === "msg-A")!;
  const b = list.find(r => r.planId === "msg-B")!;
  check("F2.2-dispatcher", "13 A falha e B termina skipped sem mentir outcome", a.status === "failed" && a.terminalAt != null && b.status === "skipped" && b.terminalAt != null && b.outcomeAppliedAt == null, JSON.stringify({ a, b }));
}

// 14) F2.2 OUTCOME COMMIT: accepted vs delivered
{
  const { p, clock } = mk();
  const u = p.begin();

  // Cadastra no plannedObjectives um objetivo pendente
  const plannedObj = {
    id: "obj-1",
    activationPlanId: "msg-1",
    effectId: "t1:msg-1",
    type: "perguntou_dados" as const,
    slot: "nome" as const,
    plannedInTurnId: "t1",
    expectedAnswerKinds: ["nome" as const]
  };
  const s0 = state();
  s0.plannedObjectives.push(plannedObj);
  u.casState("c1", 0, s0);

  const rec = outboxRec("c1", "t1", "msg-1", 1, []);
  rec.onSuccess = [{ op: "activate_objective", effectId: "t1:msg-1", plannedObjectiveId: "obj-1" }];
  u.appendOutbox([rec]);
  u.commit();
  p.claimOutbox("c1", "dispatcher-test", 60_000, 1);

  // Teste 1: Receipt "accepted" chega primeiro
  const resAccepted: EffectResult = {
    status: "succeeded",
    effectId: "t1:msg-1",
    receipt: { effectId: "t1:msg-1", level: "accepted", at: clock.now() }
  };

  const r1 = await commitEffectOutcome({ persistence: p, clock, conversationId: "c1", effectId: "t1:msg-1", result: resAccepted });
  check("F2.2-commit", "14 accepted commit retorna ok", r1.ok === true, JSON.stringify(r1));

  const afterAccepted = p.load("c1")!;
  const outAccepted = p.listOutbox("c1")[0];
  check("F2.2-commit", "14 accepted não muda estado (versão 1)", afterAccepted.version === 1 && afterAccepted.state.currentObjective == null, JSON.stringify(afterAccepted));
  check("F2.2-commit", "14 accepted marca succeeded, level accepted, outcomeAppliedAt null", outAccepted.status === "succeeded" && outAccepted.receiptLevel === "accepted" && outAccepted.outcomeAppliedAt === null, JSON.stringify(outAccepted));

  // Teste 2: Receipt "delivered" chega depois
  const resDelivered: EffectResult = {
    status: "succeeded",
    effectId: "t1:msg-1",
    receipt: { effectId: "t1:msg-1", level: "delivered", at: clock.now() }
  };

  const r2 = await commitEffectOutcome({ persistence: p, clock, conversationId: "c1", effectId: "t1:msg-1", result: resDelivered });
  check("F2.2-commit", "14 delivered commit retorna ok", r2.ok === true, JSON.stringify(r2));

  const afterDelivered = p.load("c1")!;
  const outDelivered = p.listOutbox("c1")[0];
  check("F2.2-commit", "14 delivered muda estado (versão 2) e ativa objetivo", afterDelivered.version === 2 && afterDelivered.state.currentObjective?.id === "obj-1", JSON.stringify(afterDelivered));
  check("F2.2-commit", "14 delivered preenche outcomeAppliedAt", outDelivered.status === "succeeded" && outDelivered.receiptLevel === "delivered" && outDelivered.outcomeAppliedAt != null, JSON.stringify(outDelivered));

  // Teste 3: Repetir "delivered" é idempotente
  const r3 = await commitEffectOutcome({ persistence: p, clock, conversationId: "c1", effectId: "t1:msg-1", result: resDelivered });
  check("F2.2-commit", "14 repetir delivered retorna ok (idempotência)", r3.ok === true, JSON.stringify(r3));
  const afterIdem = p.load("c1")!;
  check("F2.2-commit", "14 repetir delivered não incrementa versão (versão continua 2)", afterIdem.version === 2, String(afterIdem.version));
}

// 15) F2.2.1 COMMIT: Mismatch de IDs
{
  const { p, clock } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());

  const rec = outboxRec("c1", "t1", "msg-1", 1, []);
  u.appendOutbox([rec]);
  u.commit();

  // Teste 15.1: Mismatch do result.effectId no 'accepted'
  const resAccepted: EffectResult = {
    status: "succeeded",
    effectId: "outra-coisa",
    receipt: { effectId: "t1:msg-1", level: "accepted", at: clock.now() }
  };
  const r1 = await commitEffectOutcome({ persistence: p, clock, conversationId: "c1", effectId: "t1:msg-1", result: resAccepted });
  check("F2.2.1-commit", "15.1 mismatch de result.effectId no accepted retorna falha", r1.ok === false, JSON.stringify(r1));

  // Teste 15.2: Mismatch no 'failed'
  const resFailed: EffectResult = {
    status: "failed",
    effectId: "outra-coisa",
    error: { code: "UPSTREAM", message: "mismatch erro", retryable: false }
  };
  const r2 = await commitEffectOutcome({ persistence: p, clock, conversationId: "c1", effectId: "t1:msg-1", result: resFailed });
  check("F2.2.1-commit", "15.2 mismatch de result.effectId no failed retorna falha", r2.ok === false, JSON.stringify(r2));

  // Teste 15.3: Mismatch no 'outcome_uncertain'
  const resUncertain: EffectResult = {
    status: "outcome_uncertain",
    effectId: "outra-coisa",
    metadata: redact({})
  };
  const r3 = await commitEffectOutcome({ persistence: p, clock, conversationId: "c1", effectId: "t1:msg-1", result: resUncertain });
  check("F2.2.1-commit", "15.3 mismatch de result.effectId no outcome_uncertain retorna falha", r3.ok === false, JSON.stringify(r3));

  // Teste 15.4: Mismatch de receipt.effectId no 'delivered'
  const resDelivered: EffectResult = {
    status: "succeeded",
    effectId: "t1:msg-1",
    receipt: { effectId: "outra-coisa", level: "delivered", at: clock.now() }
  };
  const r4 = await commitEffectOutcome({ persistence: p, clock, conversationId: "c1", effectId: "t1:msg-1", result: resDelivered });
  check("F2.2.1-commit", "15.4 mismatch de receipt.effectId no delivered retorna falha", r4.ok === false, JSON.stringify(r4));

  // Verifica que nada mudou
  const list = p.listOutbox("c1");
  check("F2.2.1-commit", "15 records do outbox continuam pending", list.every(r => r.status === "pending"), JSON.stringify(list));
}

// 16) F2.2.1 PERSISTENCIA: Integridade e Imutabilidade
{
  const { p } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());

  const rec = outboxRec("c1", "t1", "msg-1", 1, []);
  u.appendOutbox([rec]);
  u.commit();

  // Teste 16.1: Update inexistente
  const u1 = p.begin();
  u1.updateOutbox({ ...rec, effectId: "inexistente" });
  const r1 = u1.commit();
  check("F2.2.1-persistence", "16.1 update de record inexistente falha", r1.ok === false, JSON.stringify(r1));

  // Teste 16.2: Tentativa de alterar idempotencyKey
  const u2 = p.begin();
  u2.updateOutbox({ ...rec, idempotencyKey: "mudou" });
  const r2 = u2.commit();
  check("F2.2.1-persistence", "16.2 alterar idempotencyKey falha", r2.ok === false, JSON.stringify(r2));

  // Teste 16.3: Tentativa de alterar kind
  const u3 = p.begin();
  u3.updateOutbox({ ...rec, kind: "send_media" as any });
  const r3 = u3.commit();
  check("F2.2.1-persistence", "16.3 alterar kind falha", r3.ok === false, JSON.stringify(r3));

  // Verifica que o original continua intacto
  const original = p.listOutbox("c1")[0];
  check("F2.2.1-persistence", "16 original continua intacto no store", original.idempotencyKey === rec.idempotencyKey && original.kind === rec.kind, JSON.stringify(original));
}

// 17) F2.2.1 COMMIT: Conflito de CAS real
{
  const { p, clock } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());
  const rec = outboxRec("c1", "t1", "msg-1", 1, []);
  u.appendOutbox([rec]);
  u.commit();

  p.claimOutbox("c1", "dispatcher-cas", 60_000, 1);

  // Injeta concorrencia exatamente entre o receipt entregue e o CAS do outcome.
  let injected = false;
  const pWrapper = {
    listOutbox(id: string) { return p.listOutbox(id); },
    load(id: string) { return p.load(id); },
    recordOutboxResult(record: OutboxRecord, result: EffectResult, nextRetryAt?: string | null) {
      return p.recordOutboxResult(record, result, nextRetryAt);
    },
    failOutbox(record: OutboxRecord, reason: string, at: string) {
      return p.failOutbox(record, reason, at);
    },
    commitOutboxOutcome(conversationId: string, effectId: string, expectedVersion: number, nextState: any, at: string) {
      if (!injected) {
        injected = true;
        const uowConcorrente = p.begin();
        const current = p.load("c1")!;
        uowConcorrente.casState("c1", current.version, { ...current.state, version: current.version + 1 });
        const concRes = uowConcorrente.commit();
        if (!concRes.ok) throw new Error("Falha no commit concorrente de teste");
      }
      return p.commitOutboxOutcome(conversationId, effectId, expectedVersion, nextState, at);
    },
  } as any;

  const resDelivered: EffectResult = {
    status: "succeeded",
    effectId: "t1:msg-1",
    receipt: { effectId: "t1:msg-1", level: "delivered", at: clock.now() }
  };

  // Chama o commit com a persistência envelopada
  const r = await commitEffectOutcome({ persistence: pWrapper, clock, conversationId: "c1", effectId: "t1:msg-1", result: resDelivered });
  check("F2.2.1-cas", "17 conflito CAS real retorna falha", r.ok === false, JSON.stringify(r));

  // O outbox record NÃO deve ter sido marcado como succeeded
  const out = p.listOutbox("c1")[0];
  check("F2.2.1-cas", "17 receipt permanece delivered e nao volta para envio", out.status === "succeeded" && out.receiptLevel === "delivered" && out.outcomeAppliedAt == null, JSON.stringify(out));
}

// 18) F2.3 RECONCILER: outcome_uncertain de acordo com a capability e limite de retry
{
  const { p, clock } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());

  // Criamos 3 records com status outcome_uncertain
  const recIdempotent = { ...outboxRec("c1", "t1", "msg-idemp"), providerCapability: "idempotent" as const, status: "outcome_uncertain" as const };
  const recQueryable = { ...outboxRec("c1", "t1", "msg-query"), providerCapability: "queryable" as const, status: "outcome_uncertain" as const };
  const recNone = { ...outboxRec("c1", "t1", "msg-none"), providerCapability: "none" as const, status: "outcome_uncertain" as const };

  u.appendOutbox([recIdempotent, recQueryable, recNone]);
  u.commit();

  let reconcileCalled = false;
  const fakeDispatcher: EffectDispatcher = {
    async dispatch() { return { status: "outcome_uncertain", effectId: "dummy", metadata: redact({}) }; },
    async reconcile(record) {
      reconcileCalled = true;
      if (record.effectId === "t1:msg-query") {
        return {
          status: "succeeded",
          receipt: { effectId: "t1:msg-query", level: "delivered", at: clock.now() }
        };
      }
      return { status: "outcome_uncertain" };
    }
  };

  const reconciler = new OutboxReconciler(p, clock, fakeDispatcher);
  await reconciler.reconcileConversation("c1", 60000, 3);

  const afterFirst = p.listOutbox("c1");
  const rIdemp = afterFirst.find(r => r.planId === "msg-idemp")!;
  const rQuery = afterFirst.find(r => r.planId === "msg-query")!;
  const rNone = afterFirst.find(r => r.planId === "msg-none")!;

  // Idempotente deve ter voltado para pending (retry)
  check("F2.3-reconciler", "18 idempotent outcome_uncertain vira pending (retry)", rIdemp.status === "pending" && rIdemp.attempts === 0 && rIdemp.outcomeAppliedAt === null && rIdemp.terminalAt === null, JSON.stringify(rIdemp));
  // Queryable deve ter sido reconciliado para succeeded + delivered e ter outcomeAppliedAt preenchido
  check("F2.3-reconciler", "18 queryable outcome_uncertain vira succeeded + delivered", rQuery.status === "succeeded" && rQuery.receiptLevel === "delivered" && rQuery.outcomeAppliedAt !== null, JSON.stringify(rQuery));
  // None deve ter virado failed terminal (dead-letter) com outcomeAppliedAt preenchido (mas sem alterar estado)
  check("F2.3-reconciler", "18 none outcome_uncertain vira failed terminal (dead-letter)", rNone.status === "failed" && rNone.lastError === "uncertain_dead_letter_none_capability" && rNone.outcomeAppliedAt === null && rNone.terminalAt !== null, JSON.stringify(rNone));

  // O estado conversacional de rNone NÃO deve ter sido modificado por onSuccess (estado continua version 1)
  const st = p.load("c1")!;
  check("F2.3-reconciler", "18 none dead-letter não altera estado conversacional", st.version === 1, String(st.version));

  // Agora vamos testar o limite de tentativas no idempotent
  // Vamos rodar reconciliação até atingir o limite (maxAttempts = 3)

  // Força attempts=3 e status=outcome_uncertain
  const u2 = p.begin();
  u2.updateOutbox({ ...rIdemp, attempts: 3, status: "outcome_uncertain" });
  u2.commit();

  await reconciler.reconcileConversation("c1", 60000, 3);

  const rIdempFinal = p.listOutbox("c1").find(r => r.planId === "msg-idemp")!;
  check("F2.3-reconciler", "18 idempotent excedendo maxAttempts vira dead-letter (failed)", rIdempFinal.status === "failed" && rIdempFinal.lastError === "max_attempts_exceeded_uncertain" && rIdempFinal.outcomeAppliedAt === null && rIdempFinal.terminalAt !== null, JSON.stringify(rIdempFinal));
}

// 19) F2.3 RECONCILER: processing preso (stale)
{
  const { p, clock } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());

  // dispatchedAt há mais de 60 segundos (stale)
  const pastTime = "2026-06-26T23:58:00.000Z";
  const recIdemp = { ...outboxRec("c1", "t1", "msg-idemp"), providerCapability: "idempotent" as const, status: "processing" as const, dispatchedAt: pastTime, processingBy: "worker-stale", processingToken: "token-idemp", processingExpiresAt: pastTime };
  const recQuery = { ...outboxRec("c1", "t1", "msg-query"), providerCapability: "queryable" as const, status: "processing" as const, dispatchedAt: pastTime, processingBy: "worker-stale", processingToken: "token-idemp", processingExpiresAt: pastTime };
  const recNone = { ...outboxRec("c1", "t1", "msg-none"), providerCapability: "none" as const, status: "processing" as const, dispatchedAt: pastTime, processingBy: "worker-stale", processingToken: "token-idemp", processingExpiresAt: pastTime };

  u.appendOutbox([recIdemp, recQuery, recNone]);
  u.commit();

  let reconcileCalledOnStale = false;
  const fakeDispatcher: EffectDispatcher = {
    async dispatch() { return { status: "outcome_uncertain", effectId: "dummy", metadata: redact({}) }; },
    async reconcile(record) {
      reconcileCalledOnStale = true;
      if (record.effectId === "t1:msg-query") {
        return {
          status: "succeeded",
          receipt: { effectId: "t1:msg-query", level: "delivered", at: clock.now() }
        };
      }
      return { status: "outcome_uncertain" };
    }
  };

  const reconciler = new OutboxReconciler(p, clock, fakeDispatcher);
  await reconciler.reconcileConversation("c1", 60000, 3);

  const afterReconcile = p.listOutbox("c1");
  const rIdemp = afterReconcile.find(r => r.planId === "msg-idemp")!;
  const rQuery = afterReconcile.find(r => r.planId === "msg-query")!;
  const rNone = afterReconcile.find(r => r.planId === "msg-none")!;

  // Idempotente stale processing deve ter voltado para pending para tentar novamente
  check("F2.3-reconciler", "19 idempotent stale processing vira pending", rIdemp.status === "pending", JSON.stringify(rIdemp));
  // Queryable stale processing deve tentar reconcile e resolver se sucedido
  check("F2.3-reconciler", "19 queryable stale processing chama reconcile e resolve", reconcileCalledOnStale && rQuery.status === "succeeded", JSON.stringify(rQuery));
  // None stale processing deve virar outcome_uncertain
  check("F2.3-reconciler", "19 none stale processing vira outcome_uncertain", rNone.status === "outcome_uncertain", JSON.stringify(rNone));
}

// 20) F2.3 RECONCILER: accepted preso em efeito crítico vira dead-letter
{
  const { p, clock } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());

  // Um effect do tipo handoff (crítico por definição)
  const pastTime = "2026-06-26T23:58:00.000Z";
  const recHandoff = {
    ...outboxRec("c1", "t1", "handoff-1"),
    kind: "handoff" as const,
    status: "succeeded" as const,
    receiptLevel: "accepted" as const,
    dispatchedAt: pastTime,
    outcomeAppliedAt: null // continua null, travado
  };

  u.appendOutbox([recHandoff]);
  u.commit();

  const fakeDispatcher: EffectDispatcher = {
    async dispatch() { return { status: "outcome_uncertain", effectId: "dummy", metadata: redact({}) }; },
    async reconcile() { return { status: "outcome_uncertain" }; } // não confirma
  };

  const reconciler = new OutboxReconciler(p, clock, fakeDispatcher);
  await reconciler.reconcileConversation("c1", 60000, 3);

  const record = p.listOutbox("c1")[0];
  // Deve ter virado failed terminal (timeout de entrega de accepted)
  check("F2.3-reconciler", "20 accepted crítico preso vira failed terminal (timeout)", record.status === "failed" && record.lastError === "accepted_delivery_timeout" && record.outcomeAppliedAt === null && record.terminalAt !== null, JSON.stringify(record));
}

// 21) F2.3 DEPENDENCIAS: evaluateDependencies bloqueia dependente de accepted crítico
{
  const { p, clock } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());

  // 1. Mensagem crítica com onSuccess (exige delivered)
  const msgCrit = {
    ...outboxRec("c1", "t1", "msg-critica", 1),
    onSuccess: [{ op: "advance_stage" as const, effectId: "t1:msg-critica", stage: "discovery" as const }],
    status: "succeeded" as const,
    receiptLevel: "accepted" as const, // aceita no gateway, mas sem delivered ainda
    outcomeAppliedAt: null
  };

  // 2. Handoff dependente da mensagem
  const handoff = {
    ...outboxRec("c1", "t1", "handoff-dep", 2, ["msg-critica"]),
    kind: "handoff" as const
  };

  u.appendOutbox([msgCrit, handoff]);
  u.commit();

  const fakeGate = new InMemoryEffectGate();
  fakeGate.setActiveMode("c1", true); // modo ativo

  const fakeDispatcher: EffectDispatcher = {
    async dispatch(record) {
      return {
        status: "succeeded",
        effectId: record.effectId,
        receipt: { effectId: record.effectId, level: "accepted", at: clock.now() }
      };
    }
  };

  const dispatcher = new OutboxDispatcher(p, clock, fakeDispatcher, fakeGate);
  const count = await dispatcher.dispatchConversation("c1");

  // O handoff dependente NÃO pode ter sido despachado (count = 0)
  check("F2.3-dependencies", "21 handoff dependente de accepted crítico permanece bloqueado", count === 0, `dispatched count=${count}`);

  const handoffRecord = p.listOutbox("c1").find(r => r.planId === "handoff-dep")!;
  check("F2.3-dependencies", "21 handoff record continua pending", handoffRecord.status === "pending", JSON.stringify(handoffRecord));
}

// 22) F2.3 DEPENDENCIAS: evaluateDependencies libera dependente de accepted não-crítico
{
  const { p, clock } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());

  // 1. Mensagem comum sem onSuccess (não crítica, exige apenas accepted)
  const msgComum = {
    ...outboxRec("c1", "t1", "msg-comum", 1),
    onSuccess: [],
    status: "succeeded" as const,
    receiptLevel: "accepted" as const,
    outcomeAppliedAt: null
  };

  // 2. Notificação dependente
  const notify = {
    ...outboxRec("c1", "t1", "notify-dep", 2, ["msg-comum"]),
    kind: "notify_seller" as const
  };

  u.appendOutbox([msgComum, notify]);
  u.commit();

  const fakeGate = new InMemoryEffectGate();
  fakeGate.setActiveMode("c1", true); // active mode

  const notifyDispatched = { value: false };
  const fakeDispatcher: EffectDispatcher = {
    async dispatch(record) {
      if (record.planId === "notify-dep") {
        notifyDispatched.value = true;
      }
      return {
        status: "succeeded",
        effectId: record.effectId,
        receipt: { effectId: record.effectId, level: "delivered", at: clock.now() }
      };
    }
  };

  const dispatcher = new OutboxDispatcher(p, clock, fakeDispatcher, fakeGate);
  const count = await dispatcher.dispatchConversation("c1");

  // O notify dependente deve ter sido despachado (count = 1)
  check("F2.3-dependencies", "22 dependente de accepted não-crítico é liberado", count === 1 && notifyDispatched.value === true, `count=${count} notifyDispatched=${notifyDispatched.value}`);
}

// 23) F2.3 SHADOW MODE: EffectGate impede despacho real e simula skipped auditável
{
  const { p, clock } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());

  const recMsg = outboxRec("c1", "t1", "msg-1", 1);
  const recHandoff = { ...outboxRec("c1", "t1", "handoff-1", 2, ["msg-1"]), kind: "handoff" as const };

  u.appendOutbox([recMsg, recHandoff]);
  u.commit();

  const fakeGate = new InMemoryEffectGate();
  fakeGate.setActiveMode("c1", false); // SHADOW MODE ativo (isActiveMode = false)

  let dispatchCalled = false;
  const fakeDispatcher: EffectDispatcher = {
    async dispatch() {
      dispatchCalled = true;
      return { status: "outcome_uncertain", effectId: "dummy", metadata: redact({}) };
    }
  };

  const dispatcher = new OutboxDispatcher(p, clock, fakeDispatcher, fakeGate);
  const count = await dispatcher.dispatchConversation("c1");

  // Não deve chamar o dispatch real e count = 0 dispatches bem-sucedidos reais
  check("F2.3-shadow", "23 shadow mode não faz dispatch real", count === 0 && dispatchCalled === false, `count=${count} dispatchCalled=${dispatchCalled}`);

  const records = p.listOutbox("c1");
  const msgOut = records.find(r => r.planId === "msg-1")!;
  const handoffOut = records.find(r => r.planId === "handoff-1")!;

  // Ambos devem ter virado skipped por shadow mode
  check("F2.3-shadow", "23 shadow record vira skipped por gate", msgOut.status === "skipped" && msgOut.lastError === "shadow_mode_gate_active" && msgOut.outcomeAppliedAt === null && msgOut.terminalAt !== null, JSON.stringify(msgOut));
  check("F2.3-shadow", "23 shadow dependente vira skipped por cascata", handoffOut.status === "skipped" && handoffOut.lastError === "dependency_failed_or_skipped" && handoffOut.outcomeAppliedAt === null && handoffOut.terminalAt !== null, JSON.stringify(handoffOut));

  // O estado conversacional não avançou (continua version 1)
  const st = p.load("c1")!;
  check("F2.3-shadow", "23 shadow mode não aplica mutações conversacionais", st.version === 1, String(st.version));
}

// 24) F2.3.1 RECONCILER: accepted não-crítico antigo NÃO vira dead-letter/timeout
{
  const { p, clock } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());

  // Mensagem comum sem onSuccess (não crítica, exige apenas accepted)
  const pastTime = "2026-06-26T23:58:00.000Z";
  const recMsgComum = {
    ...outboxRec("c1", "t1", "msg-comum", 1),
    onSuccess: [],
    status: "succeeded" as const,
    receiptLevel: "accepted" as const,
    dispatchedAt: pastTime,
    outcomeAppliedAt: null
  };

  u.appendOutbox([recMsgComum]);
  u.commit();

  const fakeDispatcher: EffectDispatcher = {
    async dispatch() { return { status: "outcome_uncertain", effectId: "dummy", metadata: redact({}) }; },
    async reconcile() { return { status: "outcome_uncertain" }; }
  };

  const reconciler = new OutboxReconciler(p, clock, fakeDispatcher);
  await reconciler.reconcileConversation("c1", 60000, 3);

  const record = p.listOutbox("c1")[0];

  // Deve continuar succeeded + accepted, lastError nulo, e não virar failed
  check("F2.3.1-reconciler", "24 msg comum em accepted não vira dead-letter após timeout", record.status === "succeeded" && record.receiptLevel === "accepted" && record.lastError === null, JSON.stringify(record));

  // Deve continuar satisfazendo dependências via política
  const satisfied = isEffectSatisfiedForDependency(record);
  check("F2.3.1-reconciler", "24 msg comum em accepted continua satisfazendo dependências", satisfied === true, String(satisfied));
}

// 25) F2.5.1: delivered + CAS conflict e reparado sem redispatch
{
  const { p, clock, gate } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());
  const rec = outboxRec("c1", "t1", "msg-cas", 1, []);
  rec.providerCapability = "idempotent";
  rec.onSuccess = [{ op: "advance_stage", effectId: rec.effectId, stage: "discovery" }];
  u.appendOutbox([rec]);
  u.commit();

  let injected = false;
  let dispatchCount = 0;
  const wrapped = new Proxy(p, {
    get(target, property) {
      if (property === "commitOutboxOutcome") {
        return (conversationId: string, effectId: string, expectedVersion: number, nextState: any, at: string) => {
          if (!injected) {
            injected = true;
            const concurrent = p.begin();
            const current = p.load(conversationId)!;
            concurrent.casState(conversationId, current.version, current.state);
            const committed = concurrent.commit();
            if (!committed.ok) throw new Error("falha ao injetar CAS concorrente");
          }
          return p.commitOutboxOutcome(conversationId, effectId, expectedVersion, nextState, at);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const provider: EffectDispatcher = {
    async dispatch(record) {
      dispatchCount += 1;
      return {
        status: "succeeded",
        effectId: record.effectId,
        receipt: { effectId: record.effectId, level: "delivered", at: clock.now() },
      };
    },
  };

  const dispatcher = new OutboxDispatcher(wrapped, clock, provider, gate);
  let dispatcherFailedClosed = false;
  try { await dispatcher.dispatchConversation("c1"); } catch { dispatcherFailedClosed = true; }
  const afterConflict = p.listOutbox("c1")[0];
  check("F2.5.1-no-redispatch", "25 CAS falha fechado depois de persistir delivered", dispatcherFailedClosed && afterConflict.status === "succeeded" && afterConflict.receiptLevel === "delivered" && afterConflict.outcomeAppliedAt === null, JSON.stringify(afterConflict));

  const reconciler = new OutboxReconciler(p, clock, provider);
  await reconciler.reconcileConversation("c1");
  const repaired = p.listOutbox("c1")[0];
  check("F2.5.1-no-redispatch", "25 reconciler aplica somente outcome sem reenviar", dispatchCount === 1 && repaired.outcomeAppliedAt !== null && p.load("c1")?.version === 3, JSON.stringify({ dispatchCount, repaired, version: p.load("c1")?.version }));
}

// 26) F2.5.1: writer atrasado nao cancela claim novo
{
  const { p } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());
  const pending = outboxRec("c1", "t1", "msg-race");
  u.appendOutbox([pending]);
  u.commit();
  const claimed = p.claimOutbox("c1", "worker-new", 60_000, 1)[0];
  const staleSkip = p.skipOutbox(pending, "stale_worker", NOW);
  const current = p.listOutbox("c1")[0];
  check("F2.5.1-concurrency", "26 skip com snapshot pending nao sobrescreve processing", !staleSkip.ok && current.status === "processing" && current.processingToken === claimed.processingToken, JSON.stringify({ staleSkip, current }));
}

// 27) F2.5.1: token de processing e infalsificavel
{
  const { p, clock } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());
  u.appendOutbox([outboxRec("c1", "t1", "msg-token")]);
  u.commit();
  const claimed = p.claimOutbox("c1", "worker-owner", 60_000, 1)[0];
  const forged = { ...claimed, processingToken: "token-forjado" };
  const result: EffectResult = {
    status: "succeeded",
    effectId: claimed.effectId,
    receipt: { effectId: claimed.effectId, level: "delivered", at: clock.now() },
  };
  const persisted = p.recordOutboxResult(forged, result);
  const current = p.listOutbox("c1")[0];
  check("F2.5.1-concurrency", "27 receipt com token errado e rejeitado atomicamente", !persisted.ok && current.status === "processing" && current.processingToken === claimed.processingToken, JSON.stringify({ persisted, current }));
}

// 28) F2.5.1: falha conhecida e retryable retorna a pending na hora correta
{
  const { p, clock } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());
  u.appendOutbox([outboxRec("c1", "t1", "msg-retry")]);
  u.commit();
  p.claimOutbox("c1", "worker-retry", 60_000, 1);
  const failed = await commitEffectOutcome({
    persistence: p,
    clock,
    conversationId: "c1",
    effectId: "t1:msg-retry",
    result: {
      status: "failed",
      effectId: "t1:msg-retry",
      error: { code: "UPSTREAM", message: "provider indisponivel", retryable: true },
    },
  });
  const beforeDue = p.listOutbox("c1")[0];
  const provider: EffectDispatcher = { async dispatch() { throw new Error("nao deveria despachar no reconciler"); } };
  const reconciler = new OutboxReconciler(p, clock, provider);
  await reconciler.reconcileConversation("c1");
  const stillWaiting = p.listOutbox("c1")[0];
  clock.advance(31_000);
  await reconciler.reconcileConversation("c1");
  const due = p.listOutbox("c1")[0];
  check("F2.5.1-retry", "28 retryable persiste janela e nao reenvia cedo", failed.ok && beforeDue.status === "failed" && beforeDue.nextRetryAt != null && stillWaiting.status === "failed", JSON.stringify({ failed, beforeDue, stillWaiting }));
  check("F2.5.1-retry", "28 retryable conhecido volta a pending mesmo capability none", due.status === "pending" && due.lastError === "retryable_failure_due", JSON.stringify(due));
}

// 29) F2.5.1: excecao desconhecida no dispatch vira outcome_uncertain
{
  const { p, clock, gate } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());
  u.appendOutbox([outboxRec("c1", "t1", "msg-timeout")]);
  u.commit();
  const provider: EffectDispatcher = {
    async dispatch() { throw new Error("socket timeout apos envio possivel"); },
  };
  const dispatcher = new OutboxDispatcher(p, clock, provider, gate);
  const count = await dispatcher.dispatchConversation("c1");
  const record = p.listOutbox("c1")[0];
  check("F2.5.1-uncertain", "29 throw do provider nao afirma falha nem entrega", count === 1 && record.status === "outcome_uncertain" && record.outcomeAppliedAt === null && record.terminalAt == null, JSON.stringify(record));
}

// 30) F2.5.1: callback accepted atrasado nao rebaixa delivered
{
  const { p, clock } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());
  u.appendOutbox([outboxRec("c1", "t1", "msg-callback")]);
  u.commit();
  p.claimOutbox("c1", "worker-callback", 60_000, 1);
  const delivered: EffectResult = {
    status: "succeeded",
    effectId: "t1:msg-callback",
    receipt: { effectId: "t1:msg-callback", level: "delivered", at: clock.now() },
  };
  await commitEffectOutcome({ persistence: p, clock, conversationId: "c1", effectId: delivered.effectId, result: delivered });
  const acceptedLate: EffectResult = {
    status: "succeeded",
    effectId: "t1:msg-callback",
    receipt: { effectId: "t1:msg-callback", level: "accepted", at: clock.now() },
  };
  const duplicate = await commitEffectOutcome({ persistence: p, clock, conversationId: "c1", effectId: acceptedLate.effectId, result: acceptedLate });
  const current = p.listOutbox("c1")[0];
  check("F2.5.1-callback", "30 accepted atrasado e no-op apos delivered", duplicate.ok && current.receiptLevel === "delivered" && current.outcomeAppliedAt !== null, JSON.stringify({ duplicate, current }));
}
// 31) F2.5.1: efeito terminal nao pode ser reaberto
{
  const { p, clock } = mk();
  const u = p.begin();
  u.casState("c1", 0, state());
  u.appendOutbox([outboxRec("c1", "t1", "msg-terminal")]);
  u.commit();
  p.claimOutbox("c1", "worker-terminal", 60_000, 1);
  await commitEffectOutcome({
    persistence: p,
    clock,
    conversationId: "c1",
    effectId: "t1:msg-terminal",
    result: {
      status: "failed",
      effectId: "t1:msg-terminal",
      error: { code: "VALIDATION", message: "falha terminal", retryable: false },
    },
  });
  const terminal = p.listOutbox("c1")[0];
  const reopen = p.requeueOutbox(terminal, NOW, "nao_deve_reabrir");
  const refail = p.failOutbox(terminal, "nao_deve_reterminalizar", NOW);
  const current = p.listOutbox("c1")[0];
  check("F2.5.1-terminal", "31 terminal nao reabre nem aceita writer stale", !reopen.ok && !refail.ok && current.lastError === "falha terminal" && current.terminalAt !== null, JSON.stringify({ reopen, refail, current }));
}

// 32) F2.5.2D: shadow harness end-to-end sem efeito externo
{
  const { p, clock } = mk();
  const llm = new FakeLlm();
  const stockFact = {
    vehicleKey: "revendamais:101",
    marca: "Chevrolet",
    modelo: "Onix",
    ano: 2020,
    preco: 60000,
    tipo: "hatch" as const,
    photoIds: ["revendamais:101:ph-1"],
  };
  const seenTools: string[] = [];
  const runQuery: QueryRunner = async (call) => {
    seenTools.push(call.tool);
    if (call.tool === "stock_search") {
      return {
        ok: true,
        tool: "stock_search",
        source: "fake-shadow-stock",
        data: { items: [stockFact], filtersUsed: { precoMax: 65000 } },
      };
    }
    return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "not used", retryable: false } } as QueryResult;
  };
  const catalog: TenantCatalog = {
    entries: [{ vehicleKey: stockFact.vehicleKey, brand: stockFact.marca, model: stockFact.modelo, aliases: [stockFact.modelo, `${stockFact.marca} ${stockFact.modelo}`] }],
  };
  const claimExtractor: ClaimExtractor = { extractClaims: () => [] };
  const interpretation: TurnInterpretation = { relation: "direction_change", intentSummary: "quer carro ate 65k" };

  llm.setTurnScript([
    { kind: "query", call: { tool: "stock_search", input: { precoMax: 65000 } } },
    {
      kind: "final",
      proposal: {
        proposedAction: "search_stock",
        facts: [],
        proposedEffects: [{
          kind: "send_message",
          planId: "msg-offer",
          order: 1,
          onSuccess: [{
            op: "record_offer",
            effectId: "",
            offer: { offerId: "offer-shadow-1", precoMax: 65000, vehicleKeys: [stockFact.vehicleKey], at: NOW },
          }],
        }],
        responsePlan: { guidance: "Tenho uma opcao dentro do que voce pediu:" },
        reasonCode: "stock_offer_shadow",
        reasonSummary: "oferta de estoque em modo shadow",
        confidence: 0.91,
      },
    },
  ]);

  const shadow = await runShadowHarnessTurn({
    persistence: p,
    clock,
    llm,
    runQuery,
    conversationId: "c-shadow",
    tenantId: "tenant-shadow",
    agentId: "agent-shadow",
    leadId: "lead-shadow",
    workerId: "worker-shadow",
    turnId: "turn-shadow-1",
    eventId: "evt-shadow-1",
    messageText: "quero um carro ate 65 mil",
    interpretation,
    tenantCatalog: catalog,
    claimExtractor,
    limits: { maxSteps: 3, totalTimeoutMs: 5000, queryTimeoutMs: 1000, proposeTimeoutMs: 1000, composeTimeoutMs: 1000 },
    maxValidationAttempts: 1,
    expected: { action: "search_stock", reasonCode: "stock_offer_shadow", requiredTools: ["stock_search"], forbiddenTools: ["crm_read"] },
  });

  const snapshot = p.load("c-shadow");
  const skipped = shadow.outboxAfterDispatch.every((record) => record.status === "skipped" && record.lastError === "shadow_mode_gate_active" && record.outcomeAppliedAt === null);
  check("F2.5.2D-shadow", "32 shadow insere e commita turno end-to-end", shadow.inserted && shadow.engine.status === "committed" && snapshot?.version === 1, JSON.stringify({ inserted: shadow.inserted, engine: shadow.engine.status, version: snapshot?.version }));
  check("F2.5.2D-shadow", "32 shadow usa QueryRunner e registra fatos", seenTools.join(",") === "stock_search" && shadow.facts.length === 1 && shadow.facts[0].tool === "stock_search", JSON.stringify({ seenTools, facts: shadow.facts }));
  check("F2.5.2D-shadow", "32 shadow gera outbox mas nao dispara provider", shadow.outboxBeforeDispatch.length === 1 && shadow.dispatchAttempts === 0 && skipped, JSON.stringify({ before: shadow.outboxBeforeDispatch, after: shadow.outboxAfterDispatch, dispatchAttempts: shadow.dispatchAttempts }));
  check("F2.5.2D-shadow", "32 shadow comparison passa", shadow.comparison.passed === true, JSON.stringify(shadow.comparison));
}
console.log(`\n=== F2.0/F2.1/F2.2/F2.2.1/F2.3/F2.3.1: ${ok} OK | ${fail} FALHA ===\n`);
if (fail > 0) { console.log("FALHAS:"); for (const f of fails) console.log("  " + f); process.exit(1); }
