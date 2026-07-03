// ============================================================================
// F2.7.18 — Ciclo de receipt do EVALUADOR REAL (correção da auditoria Codex).
// Prova, OFFLINE e sem LLM, o MECANISMO EXATO que o eval usa: claim + commitEffectOutcome
// com um EffectResult "accepted"/"delivered" SINTÉTICO — SEM dispatcher, SEM sender, SEM rede.
// Sem esse ciclo o harness sofria AMNÉSIA artificial (append_assistant_turn/activate_objective
// nunca aplicavam; a pergunta pendente não ativava; o "Douglas" seguinte não satisfazia o nome).
//
// Valida:
//  A) send_message [activate_objective(nome)+append_assistant_turn]: accepted -> objetivo nome ATIVO
//     (currentObjective pending) + fala do agente em recentTurns + receipt accepted aplicado.
//  B) send_media [mark_photos_sent]: accepted (baseline pilot-realistic) NÃO aplica (ledger vazio);
//     delivered (ideal) aplica o ledger. accepted->delivered não trava.
//  C) Nenhum dispatcher/sender é instanciado — o receipt é sintético (providerMessageId "eval-*").
// ============================================================================
import { FakeClock, FakeIdGen, InMemoryPersistence } from "../src/adapters/persistence/in-memory-store.ts";
import { createInitialState, type ConversationState, type PlannedObjective } from "../src/domain/conversation-state.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { OutboxRecord } from "../src/domain/effect-intent.ts";
import type { EffectReceipt, EffectResult } from "../src/domain/decision.ts";

const NOW = "2026-07-01T09:00:00.000Z";
const CONV = "conv-1";
const ref = { tenantId: "ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0", agentId: "d4fd5c38-dd37-4da5-a971-5a7b7dfb9185" };

let ok = 0, fail = 0;
const fails: string[] = [];
function check(group: string, name: string, pass: boolean, detail = ""): void {
  if (pass) { ok += 1; console.log(`  OK  [${group}] ${name}`); }
  else { fail += 1; fails.push(`[${group}] ${name}${detail ? ` - ${detail}` : ""}`); console.error(`  RED [${group}] ${name}${detail ? ` - ${detail}` : ""}`); }
}

function record(over: Partial<OutboxRecord>): OutboxRecord {
  const turnId = over.turnId ?? "turn-1";
  const planId = over.planId ?? "msg";
  const effectId = over.effectId ?? `${turnId}:${planId}`;
  return {
    effectId, conversationId: over.conversationId ?? CONV, turnId, planId,
    kind: over.kind ?? "send_message", idempotencyKey: over.idempotencyKey ?? effectId,
    order: over.order ?? 1, dependsOn: over.dependsOn ?? [], payload: over.payload ?? redact({ text: "Ola" }),
    onSuccess: over.onSuccess ?? [], status: "pending", providerCapability: over.providerCapability ?? "none",
    receiptLevel: null, attempts: 0, nextRetryAt: null, providerReceipt: null, outcomeAppliedAt: null,
    lastError: null, terminalAt: null, processingBy: null, processingToken: null, processingExpiresAt: null,
    createdAt: NOW, dispatchedAt: null,
  };
}

function seed(records: OutboxRecord[], planned: PlannedObjective[] = []): { p: InMemoryPersistence; clock: FakeClock } {
  const clock = new FakeClock(NOW);
  const p = new InMemoryPersistence(clock, new FakeIdGen());
  const state: ConversationState = { ...createInitialState({ conversationId: CONV, tenantId: ref.tenantId, agentId: ref.agentId, now: NOW }), plannedObjectives: planned };
  const u = p.begin();
  u.casState(CONV, 0, state);
  u.appendOutbox(records);
  const c = u.commit();
  if (!c.ok) throw new Error(`seed_failed: ${c.reason}`);
  return { p, clock };
}

// EXATAMENTE o que o harness faz: claim (pending->processing+token) e commit do receipt sintético.
// NENHUM dispatcher/sender é criado aqui — o efeito externo nunca sai.
async function applyReceipt(p: InMemoryPersistence, clock: FakeClock, effectId: string, level: "accepted" | "delivered", photoIds?: string[]) {
  const claimed = await p.claimOutbox(CONV, "eval-worker", 60_000, 25);
  const rec = claimed.find((r) => r.effectId === effectId);
  if (!rec) return { ok: false as const, reason: "nao_claimavel" };
  const perItem = level === "delivered" && photoIds ? photoIds.map((id) => ({ photoId: id, status: "succeeded" as const })) : undefined;
  const receipt = { effectId, level, providerMessageId: `eval-${effectId}`, at: clock.now(), ...(perItem ? { perItem } : {}) } as EffectReceipt;
  const result: EffectResult = { status: "succeeded", effectId, receipt };
  return commitEffectOutcome({ persistence: p, clock, conversationId: CONV, effectId, result });
}

console.log("\n=== F2.7.18 - ciclo de receipt do evaluador real (offline, sem LLM/dispatcher) ===\n");

// A) send_message: accepted ATIVA o objetivo pendente + grava a fala do agente. (o coração do fix RC1)
{
  const planned: PlannedObjective = { id: "po-nome", activationPlanId: "msg", effectId: "turn-1:msg", type: "perguntou_dados", slot: "nome", plannedInTurnId: "turn-1", expectedAnswerKinds: ["nome"] };
  const rec = record({
    effectId: "turn-1:msg", turnId: "turn-1", planId: "msg", kind: "send_message", payload: redact({ text: "Qual e o seu nome?" }),
    onSuccess: [
      { op: "activate_objective", effectId: "turn-1:msg", plannedObjectiveId: "po-nome" },
      { op: "append_assistant_turn", effectId: "turn-1:msg", turn: { role: "agent", text: "Qual e o seu nome?", at: NOW } },
    ],
  });
  const { p, clock } = seed([rec], [planned]);
  const res = await applyReceipt(p, clock, "turn-1:msg", "accepted");
  const st = p.load(CONV)?.state;
  const row = p.listOutbox(CONV)[0];
  check("A-accepted", "commitEffectOutcome ok", res.ok, JSON.stringify(res));
  check("A-accepted", "objetivo 'nome' vira ATIVO (currentObjective pending) no accepted", st?.currentObjective?.slot === "nome" && st?.currentObjective?.status === "pending", JSON.stringify(st?.currentObjective));
  check("A-accepted", "expectedAnswerKinds preservado ('nome') -> permite binding do proximo turno", st?.currentObjective?.expectedAnswerKinds?.includes("nome") === true, JSON.stringify(st?.currentObjective));
  check("A-accepted", "plannedObjectives esvaziou (promovido)", (st?.plannedObjectives?.length ?? -1) === 0, JSON.stringify(st?.plannedObjectives));
  check("A-accepted", "fala do agente entrou em recentTurns (fim da amnesia)", st?.recentTurns.some((t) => t.role === "agent" && /nome/i.test(t.text)) === true, JSON.stringify(st?.recentTurns));
  check("A-accepted", "receipt accepted + outcomeAppliedAt setado", row.receiptLevel === "accepted" && row.outcomeAppliedAt != null, JSON.stringify(row));
  check("A-accepted", "receipt e SINTETICO do eval (sem provider real): providerMessageId eval-*", JSON.stringify(row.providerReceipt).includes("eval-turn-1:msg"), JSON.stringify(row.providerReceipt));
}

// B1) send_media accepted (baseline pilot-realistic): NAO aplica o ledger (mídia não vira delivered).
{
  const rec = record({
    effectId: "turn-2:photos", turnId: "turn-2", planId: "photos", kind: "send_media", payload: redact({ vehicleKey: "veh-1", photoIds: ["p1", "p2"] }),
    onSuccess: [{ op: "mark_photos_sent", effectId: "turn-2:photos", vehicleKey: "veh-1", photoIds: ["p1", "p2"] }],
  });
  const { p, clock } = seed([rec]);
  const res = await applyReceipt(p, clock, "turn-2:photos", "accepted");
  const st = p.load(CONV)?.state;
  const row = p.listOutbox(CONV)[0];
  check("B1-media-baseline", "accepted registrado (commit ok)", res.ok, JSON.stringify(res));
  check("B1-media-baseline", "send_media accepted NAO aplica -> photoLedger vazio", Object.keys(st?.photoLedger.sentByVehicle ?? {}).length === 0, JSON.stringify(st?.photoLedger));
  check("B1-media-baseline", "outcomeAppliedAt fica null (espera delivered; nada de inventar entrega)", row.receiptLevel === "accepted" && row.outcomeAppliedAt == null, JSON.stringify(row));
}

// B2) send_media delivered (ideal-delivered): aplica o ledger com os perItem confirmados.
{
  const rec = record({
    effectId: "turn-2:photos", turnId: "turn-2", planId: "photos", kind: "send_media", payload: redact({ vehicleKey: "veh-1", photoIds: ["p1", "p2"] }),
    onSuccess: [{ op: "mark_photos_sent", effectId: "turn-2:photos", vehicleKey: "veh-1", photoIds: ["p1", "p2"] }],
  });
  const { p, clock } = seed([rec]);
  const res = await applyReceipt(p, clock, "turn-2:photos", "delivered", ["p1", "p2"]);
  const st = p.load(CONV)?.state;
  const row = p.listOutbox(CONV)[0];
  check("B2-media-ideal", "delivered aplica o ledger", res.ok && JSON.stringify(st?.photoLedger.sentByVehicle["veh-1"]) === JSON.stringify(["p1", "p2"]), JSON.stringify(st?.photoLedger));
  check("B2-media-ideal", "outcomeAppliedAt setado no delivered", row.receiptLevel === "delivered" && row.outcomeAppliedAt != null, JSON.stringify(row));
}

// C) accepted -> delivered NAO trava: mídia aceita e depois entregue aplica o ledger (transição válida).
{
  const rec = record({
    effectId: "turn-2:photos", turnId: "turn-2", planId: "photos", kind: "send_media", payload: redact({ vehicleKey: "veh-1", photoIds: ["p1"] }),
    onSuccess: [{ op: "mark_photos_sent", effectId: "turn-2:photos", vehicleKey: "veh-1", photoIds: ["p1"] }],
  });
  const { p, clock } = seed([rec]);
  await applyReceipt(p, clock, "turn-2:photos", "accepted"); // aceito, nao aplicado
  const before = p.load(CONV)?.state;
  const receipt = { effectId: "turn-2:photos", level: "delivered", providerMessageId: "eval-turn-2:photos", at: clock.now(), perItem: [{ photoId: "p1", status: "succeeded" as const }] } as EffectReceipt;
  const res2 = await commitEffectOutcome({ persistence: p, clock, conversationId: CONV, effectId: "turn-2:photos", result: { status: "succeeded", effectId: "turn-2:photos", receipt } });
  const after = p.load(CONV)?.state;
  check("C-transition", "accepted nao aplicou antes", Object.keys(before?.photoLedger.sentByVehicle ?? {}).length === 0, JSON.stringify(before?.photoLedger));
  check("C-transition", "delivered posterior aplica (accepted->delivered nao trava)", res2.ok && JSON.stringify(after?.photoLedger.sentByVehicle["veh-1"]) === JSON.stringify(["p1"]), JSON.stringify({ res2, ledger: after?.photoLedger }));
}

console.log(`\n=== F2.7.18 EVAL RECEIPT CYCLE: ${ok} OK | ${fail} FALHA ===`);
if (fail > 0) { console.error(fails.join("\n")); process.exit(1); }
