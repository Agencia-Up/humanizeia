// ============================================================================
// F2.12 — R13-S1 (revisado + Incremento 2 Parte A). Contratos + reducer da WorkingMemory. Offline, $0.
// Cobre a auditoria + as pendências A.1–A.4: acceptedAt vem do receipt; triple-check effectId; newer-wins
// (A→B→callback atrasado A mantém B); add_tool_result é SISTEMA (não LLM); turnId em toda mutação (incl. intent);
// schemaVersion futuro fail-closed; + fonte única, IDs estáveis, sem PII, rejeição atômica, restart determinístico.
//   npx tsx tests/run-f2-12-working-memory.ts
// ============================================================================
import {
  createInitialPersistedWorkingMemory, loadPersistedWorkingMemory, applyDecisionWorkingMemoryMutations,
  applySystemWorkingMemoryMutations, applyEffectOutcomeToWorkingMemory, deriveCanonicalViews, buildWorkingMemory,
  toAgentObservation, toToolTelemetry, toToolResultMemory, recallLastPhotoLabel, hasUnansweredInstitutional,
} from "../src/engine/working-memory.ts";
import type {
  PersistedWorkingMemory, DecisionWorkingMemoryMutation, SystemWorkingMemoryMutation, EffectOutcomeWorkingMemoryMutation,
  PhotoActionDraft, AgentToolObservation,
} from "../src/domain/agent-brain.ts";
import { WORKING_MEMORY_SCHEMA_VERSION } from "../src/domain/agent-brain.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import type { ProposedEffectPlan, EffectResult, QueryResult } from "../src/domain/decision.ts";

const NOW = "2026-07-03T12:00:00.000Z";
let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const T = "eval-t5";
const KICKS: PhotoActionDraft = { vehicleKey: "revendamais:kicks", label: "Nissan Kicks 2018", photoIds: ["p1", "p2", "p3"], effectId: `${T}:media`, sourceTurnId: T, sourceTurnNumber: 5 };
const initial = createInitialPersistedWorkingMemory;
const decide = (mem: PersistedWorkingMemory, muts: DecisionWorkingMemoryMutation[], turnId = T) => applyDecisionWorkingMemoryMutations(mem, muts, { authorizedTurnId: turnId });
const sys = (mem: PersistedWorkingMemory, muts: SystemWorkingMemoryMutation[], turnId = T) => applySystemWorkingMemoryMutations(mem, muts, { authorizedTurnId: turnId });
const outc = (mem: PersistedWorkingMemory, draft: PhotoActionDraft, result: EffectResult) => applyEffectOutcomeToWorkingMemory(mem, { op: "mark_photo_action_accepted", action: draft }, result);
const mustOk = (r: ReturnType<typeof decide>): PersistedWorkingMemory => { if (!r.ok) throw new Error("rejeitou: " + JSON.stringify(r.rejected)); return r.next; };
const rcpt = (effectId: string, level: "accepted" | "delivered", at = NOW): EffectResult => ({ status: "succeeded", effectId, receipt: { effectId, level, at } });
const accepted = rcpt(`${T}:media`, "accepted"), delivered = rcpt(`${T}:media`, "delivered");
const failed: EffectResult = { status: "failed", effectId: `${T}:media`, error: { code: "UPSTREAM", message: "x", retryable: true } };
const uncertain = { status: "outcome_uncertain", effectId: `${T}:media`, metadata: { __redacted: true } } as unknown as EffectResult;

function stateFixture(): ConversationState {
  const s = createInitialState({ conversationId: "c", tenantId: "icom", agentId: "aloan", now: NOW });
  const kn = (v: unknown) => ({ status: "known" as const, value: v, confidence: 1, updatedAt: NOW });
  return {
    ...s, turnNumber: 4,
    slots: { ...s.slots, nome: kn("Douglas"), interesse: kn("suv"), possuiTroca: { status: "declined", value: null, confidence: 1, updatedAt: NOW } } as ConversationState["slots"],
    currentObjective: { id: "o-faixaPreco", type: "perguntou_dados", slot: "faixaPreco", askedAt: NOW, askedInTurnId: "t0", deliveredByEffectId: "e0", deliveryLevel: "accepted", expectedAnswerKinds: ["valor"], status: "pending", attempts: 0, deferrals: 1 },
    vehicleContext: { focus: null, selected: { kind: "vehicle", key: "revendamais:kicks", label: "Nissan Kicks 2018" } },
    lastRenderedOfferContext: { sourceTurnId: "eval-t3", createdAt: NOW, items: [{ ordinal: 1, vehicleKey: "revendamais:kicks", marca: "Nissan", modelo: "Kicks", ano: 2018 }] },
  } as ConversationState;
}

async function main(): Promise<void> {
  console.log("\n=== F2.12 WorkingMemory V1 (R13-S1 + Inc2 Parte A) ===\n");

  // 1) outcome-mutation na união de decisão -> impossível por tipo + rejeitada em runtime.
  {
    const forbidden = { op: "mark_photo_action_accepted", action: KICKS } as unknown as DecisionWorkingMemoryMutation;
    const r = decide(initial(), [forbidden]);
    check("1 outcome-mutation na decisão -> rejeitada runtime", !r.ok && r.rejected.some((x) => /desconhecida/.test(x.reason)));
  }

  // 2) effectId: a LLM não cria; ProposedEffectPlan sem effectId; Finalizer materializa turnId:planId.
  {
    const finalizeEffectId = (turnId: string, planId: string) => `${turnId}:${planId}`;
    const proposed: ProposedEffectPlan = { kind: "send_media", planId: "media", order: 1, onSuccess: [], vehicleKey: "revendamais:kicks", photoIds: ["p1"] };
    check("2 ProposedEffectPlan compila SEM effectId", proposed.effectId === undefined);
    check("2 effectId forjado ignorado (Finalizer usa turnId:planId)", finalizeEffectId(T, "media") === `${T}:media` && finalizeEffectId(T, "media") !== "FORJADO");
  }

  // 3) A.1: accepted grava lastPhotoAction com acceptedAt = receipt.at (não fabricado pela mutação/LLM).
  {
    const a = outc(initial(), KICKS, accepted);
    check("3 accepted grava Kicks; acceptedAt = receipt.at", a.ok && recallLastPhotoLabel(a.next) === "Nissan Kicks 2018" && a.next.lastPhotoAction?.acceptedAt === NOW);
    check("3 PhotoActionDraft não tem acceptedAt (só o commit preenche)", !("acceptedAt" in KICKS));
  }

  // 4) failed/outcome_uncertain NÃO alteram; duplicado do mesmo effectId é no-op; delivered posterior não duplica.
  {
    check("4 failed -> memória inalterada", (() => { const r = outc(initial(), KICKS, failed); return r.ok && recallLastPhotoLabel(r.next) === null; })());
    check("4 outcome_uncertain -> memória inalterada", (() => { const r = outc(initial(), KICKS, uncertain); return r.ok && recallLastPhotoLabel(r.next) === null; })());
    const mem = mustOk(decide(initial(), []) as never); // base
    const a1 = outc(mem, KICKS, accepted); const m1 = a1.ok ? a1.next : mem;
    const a2 = outc(m1, KICKS, accepted);
    check("4 accepted duplicado (mesmo effectId) -> no-op", a2.ok && a2.next === m1);
    const d = outc(m1, KICKS, delivered);
    check("4 delivered posterior (mesmo effectId) -> no-op", d.ok && d.next === m1);
  }

  // 5) A.1 TRIPLE-CHECK + NEWER-WINS: mismatch rejeita; A→B→callback atrasado A mantém B.
  {
    // mismatch: draft.effectId != result.effectId
    check("5 mismatch effectId (ação != result) -> rejeição atômica", !outc(initial(), { ...KICKS, effectId: "outro:media" }, accepted).ok);
    // result.effectId != receipt.effectId
    const inconsistent: EffectResult = { status: "succeeded", effectId: `${T}:media`, receipt: { effectId: "diferente", level: "accepted", at: NOW } };
    check("5 result.effectId != receipt.effectId -> rejeitado", !outc(initial(), KICKS, inconsistent).ok);
    // Correção 1: RECÊNCIA por sourceTurnNumber. A(T1,#1), B(T2,#2). B aceita primeiro; A aceita DEPOIS com
    // timestamp MAIOR -> memória permanece B (turno da ação, não horário do callback).
    const A: PhotoActionDraft = { vehicleKey: "v:a", label: "Carro A", photoIds: ["a1"], effectId: "tA:media", sourceTurnId: "t1", sourceTurnNumber: 1 };
    const B: PhotoActionDraft = { vehicleKey: "v:b", label: "Carro B", photoIds: ["b1"], effectId: "tB:media", sourceTurnId: "t2", sourceTurnNumber: 2 };
    let m = initial();
    m = (outc(m, B, rcpt("tB:media", "accepted", "2026-07-03T12:00:00.000Z")) as { next: PersistedWorkingMemory }).next; // B aceita primeiro
    check("5 B aceita primeiro -> memória B", recallLastPhotoLabel(m) === "Carro B");
    const lateA = outc(m, A, rcpt("tA:media", "accepted", "2026-07-03T12:10:00.000Z")); // A aceita depois, timestamp MAIOR, mas turno MENOR
    check("5 A aceita depois (ts maior, turno menor) -> permanece B", lateA.ok && recallLastPhotoLabel(lateA.next) === "Carro B");
    // mesmo sourceTurnNumber com effectId diferente -> fail-closed.
    const mA = (outc(initial(), A, rcpt("tA:media", "accepted")) as { next: PersistedWorkingMemory }).next;
    const C: PhotoActionDraft = { vehicleKey: "v:c", label: "C", photoIds: ["c1"], effectId: "tC:media", sourceTurnId: "t1", sourceTurnNumber: 1 };
    check("5 mesmo sourceTurnNumber + effectId diferente -> fail-closed", !outc(mA, C, rcpt("tC:media", "accepted")).ok);
  }

  // 6) A.2: add_tool_result é de SISTEMA (engine), não da LLM. lastToolResults só por resultado executado.
  {
    // por tipo, record_tool_result NÃO é DecisionWorkingMemoryMutation; runtime também rejeita.
    const asDecision = { op: "record_tool_result", result: { tool: "stock_search", status: "ok", turnId: T, itemCount: 3 } } as unknown as DecisionWorkingMemoryMutation;
    check("6 record_tool_result via DECISÃO -> rejeitado (autoridade de sistema)", !decide(initial(), [asDecision]).ok);
    const r = sys(initial(), [{ op: "record_tool_result", result: { tool: "stock_search", status: "ok", turnId: T, itemCount: 3, factKeys: ["rm:2"] } }]);
    check("6 record_tool_result via SISTEMA -> grava lastToolResults estruturado", r.ok && r.next.lastToolResults.length === 1 && r.next.lastToolResults[0].status === "ok" && r.next.lastToolResults[0].itemCount === 3);
    check("6 sistema valida turnId != autorizado -> rejeita", !sys(initial(), [{ op: "record_tool_result", result: { tool: "x", status: "ok", turnId: "OUTRO" } }]).ok);
    // Correção 2: toToolResultMemory constrói estrutura sanitizada; erro NÃO carrega URL/corpo.
    const errRes: QueryResult = { ok: false, tool: "stock_search", error: { code: "UPSTREAM", message: "https://x.y/secret?token=abc corpo", retryable: true } };
    const trm = toToolResultMemory(errRes, T);
    check("6 toToolResultMemory de erro -> status error, SEM url/token/corpo", trm.status === "error" && !JSON.stringify(trm).includes("token") && !JSON.stringify(trm).includes("http"));
  }

  // 7) A.3: toda mutação carrega turnId (inclui set_lead_intent); turno errado rejeita.
  {
    check("7 set_lead_intent com turnId correto -> ok", decide(initial(), [{ op: "set_lead_intent", intent: "buy_now", confidence: 0.9, evidence: [], turnId: T }]).ok);
    check("7 set_lead_intent com turnId errado -> rejeitado", !decide(initial(), [{ op: "set_lead_intent", intent: "buy_now", confidence: 0.9, evidence: [], turnId: "OUTRO" }]).ok);
  }

  // 8) A.4: schemaVersion futuro/desconhecido -> FAIL-CLOSED; ausente/0 -> migra p/ V1.
  {
    const fut = loadPersistedWorkingMemory({ schemaVersion: 2, conversationSummary: "x" });
    check("8 schema futuro (2) -> fail-closed (inicial + diagnóstico)", fut.memory.conversationSummary === "" && fut.diagnostics.some((d) => d.field === "schemaVersion"));
    const mig0 = loadPersistedWorkingMemory({ schemaVersion: 0, conversationSummary: "migra" });
    check("8 schema 0 -> migra p/ V1 preservando válido", mig0.memory.schemaVersion === WORKING_MEMORY_SCHEMA_VERSION && mig0.memory.conversationSummary === "migra");
    const migAbsent = loadPersistedWorkingMemory({ conversationSummary: "sem versao" });
    check("8 schema ausente -> migra p/ V1", migAbsent.memory.conversationSummary === "sem versao");
  }

  // 9) restart recupera EXATAMENTE a mesma memória.
  {
    let mem = mustOk(decide(initial(), [
      { op: "set_active_topic", topic: "suv", origin: "lead_message", turnId: T },
      { op: "add_unanswered_question", question: { id: `${T}:q1`, text: "onde fica a loja?", kind: "institutional", createdTurnId: T, resolvedTurnId: null, status: "open" } },
    ]));
    mem = mustOk(sys(mem, [{ op: "record_tool_result", result: { tool: "stock_search", status: "ok", turnId: T, itemCount: 3 } }]) as never);
    const withPhoto = outc(mem, KICKS, accepted);
    const src = withPhoto.ok ? withPhoto.next : mem;
    const restored = loadPersistedWorkingMemory(JSON.parse(JSON.stringify(src))).memory;
    check("9 restart: load(dump(mem)) == mem", JSON.stringify(restored) === JSON.stringify(src));
  }

  // 10) JSONB malformado NÃO injeta enum/veículo/compromisso/pergunta inválida (fail-closed + diagnóstico).
  {
    const { memory, diagnostics } = loadPersistedWorkingMemory({
      currentLeadIntent: { intent: "HACK", confidence: 9 }, conversationSummary: 123,
      unansweredLeadQuestions: [{ id: "", text: "", kind: "NOPE" }, { id: "q9", text: "ok?", kind: "price", createdTurnId: "t1", resolvedTurnId: null, status: "open" }],
      commitments: [{ id: "c1" }], lastPhotoAction: { vehicleKey: "" },
    });
    check("10 intent inválido -> null", memory.currentLeadIntent === null);
    check("10 pergunta inválida descartada, válida mantida", memory.unansweredLeadQuestions.length === 1 && memory.unansweredLeadQuestions[0].id === "q9");
    check("10 commitment/photoAction malformado -> descartado/null", memory.commitments.length === 0 && memory.lastPhotoAction === null);
    check("10 diagnósticos tipados", diagnostics.length > 0 && diagnostics.every((d) => typeof d.field === "string"));
  }

  // 11) fonte única: funnel/oferta/foco DERIVADOS (read-only); stale ignorado; não divergem do estado.
  {
    const st = stateFixture(); const views = deriveCanonicalViews(st);
    check("11 known XOR declined (possuiTroca declined)", views.funnel.declined.includes("possuiTroca") && !views.funnel.known.includes("possuiTroca"));
    check("11 suggestedObjective + deferred = objetivo pendente", views.funnel.suggestedObjective === "faixaPreco" && views.funnel.deferred.includes("faixaPreco"));
    const built = buildWorkingMemory(st, { funnel: { known: ["cpf"] }, selectedVehicle: { vehicleKey: "STALE" }, lastOffer: { vehicleKeys: ["STALE"] } }).memory;
    check("11 stale ignorado -> funnel/foco/oferta = estado canônico", !built.funnel.known.includes("cpf") && built.selectedVehicle?.vehicleKey === "revendamais:kicks" && built.lastOffer?.vehicleKeys[0] === "revendamais:kicks");
    check("11 WM não diverge do estado", JSON.stringify(built.funnel) === JSON.stringify(views.funnel));
  }

  // 12) observação factual × telemetria; sem PII.
  {
    const stock: QueryResult = { ok: true, tool: "stock_search", source: "fake", data: { items: [{ vehicleKey: "rm:2", marca: "Honda", modelo: "CRV", ano: 2010, preco: 62990, tipo: "suv" }], filtersUsed: {} } };
    const obs = toAgentObservation(stock);
    check("12 stock_search -> observação com VehicleFact[]", obs.ok && obs.tool === "stock_search" && obs.data.items[0].preco === 62990);
    const store: AgentToolObservation = { tool: "tenant_business_info", ok: true, data: { topic: "address", value: "Av. Central, 100 - Taubaté", source: "tenant_config" } };
    check("12 tenant_business_info -> fato (não mensagem ao lead)", store.ok && "data" in store && store.data.value.includes("Taubaté"));
    const crm: QueryResult = { ok: true, tool: "crm_read", source: "fake", data: { leadId: "L1", name: "Douglas Aloan" } };
    check("12 telemetria do crm SEM nome (sem PII)", !JSON.stringify(toToolTelemetry(crm, 5)).includes("Douglas"));
    check("12 toToolResultMemory(crm) NÃO carrega nome/PII", !JSON.stringify(toToolResultMemory(crm, T)).includes("Douglas"));
    const mem = mustOk(sys(initial(), [{ op: "record_tool_result", result: toToolResultMemory(crm, T) }]) as never);
    check("12 memória guarda estrutura sanitizada (sem PII/payload)", mem.lastToolResults[0].status === "ok" && !JSON.stringify(mem.lastToolResults[0]).includes("Douglas"));
  }

  // 13) IDs estáveis + rejeição ATÔMICA.
  {
    let mem = mustOk(decide(initial(), [
      { op: "add_unanswered_question", question: { id: `${T}:q1`, text: "quanto custa?", kind: "price", createdTurnId: T, resolvedTurnId: null, status: "open" } },
      { op: "add_commitment", commitment: { id: `${T}:c1`, text: "confirmar cor", status: "open", createdTurnId: T, resolvedTurnId: null } },
    ]));
    mem = mustOk(decide(mem, [{ op: "resolve_unanswered_question", id: `${T}:q1`, resolvedTurnId: T }, { op: "update_commitment", id: `${T}:c1`, status: "fulfilled", resolvedTurnId: T }]));
    check("13 resolve/update por ID", mem.unansweredLeadQuestions[0].status === "answered" && mem.commitments[0].status === "fulfilled");
    check("13 resolve de ID inexistente -> rejeitado", !decide(mem, [{ op: "resolve_unanswered_question", id: "nope", resolvedTurnId: T }]).ok);
    const atom = decide(initial(), [{ op: "set_conversation_summary", summary: "ok", turnId: T }, { op: "set_lead_intent", intent: "buy_now", confidence: 9, evidence: [], turnId: T }]);
    check("13 rejeição ATÔMICA (1 inválida derruba o lote)", !atom.ok);
    check("13 seletor institucional", hasUnansweredInstitutional(mustOk(decide(initial(), [{ op: "add_unanswered_question", question: { id: `${T}:qi`, text: "onde?", kind: "institutional", createdTurnId: T, resolvedTurnId: null, status: "open" } }]))) === true);
  }

  console.log(`\n=== F2.12 WORKING MEMORY: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) { for (const f of fails) console.error("  - " + f); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", String((e as Error)?.message ?? e)); process.exit(1); });
