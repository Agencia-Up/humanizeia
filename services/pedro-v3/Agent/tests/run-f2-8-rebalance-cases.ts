// ============================================================================
// F2.8 — Rebalanceamento Fase 1 (FATIA 1A + 1B.6). Casos OBRIGATÓRIOS da auditoria Codex,
// offline e determinísticos ($0, sem rede/LLM):
//  1) "Mostra mais opções" NÃO vira nome (binder compatível).
//  2) "picape até 100 mil, parcela até 1.800" preserva AMBOS (papéis monetários separados).
//  3) "financiar sem entrada, parcela até 1.800" NÃO sobrescreve faixaPreco (mutual exclusion).
//  4) TIPO em `modelo` vira `tipo` no runner (nunca stock_search({modelo:"suv"})).
//  5) afirmação sobre carro SEM veículo aterrado -> POL-GROUND-DETAIL deny (anti-alucinação).
//  6) troca respondida/pergunta pendente NÃO é seguida da mesma pergunta hardcoded (anti-fixação).
// ============================================================================
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState, PendingObjective } from "../src/domain/conversation-state.ts";
import type { ClaimExtractor, DecisionMutation, QueryResult, TenantCatalog, TurnDecision, TurnInterpretation, RenderedResponse } from "../src/domain/decision.ts";
import type { TurnContext } from "../src/domain/context.ts";
import type { TurnOutput } from "../src/engine/decision-engine.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import type { CrmReadSource, StockSource, VehicleDetailSource, VehiclePhotoSource } from "../src/domain/read-ports.ts";
import { normalizeStockSearchInput } from "../src/domain/decision.ts";
import { extractLeadSlots } from "../src/engine/lead-extraction.ts";
import { applyDecision } from "../src/engine/state-reducer.ts";
import { createReadQueryRunner } from "../src/engine/read-query-runner.ts";
import { PolicyEngine } from "../src/engine/policy-engine.ts";
import { applySdrConduction, buildSdrQualificationPolicy, enforceNoSlotFixation, adjustDraftSafeguards, reconcileObjectiveWithQuestion, conductDecision } from "../src/engine/sdr-conductor.ts";
import { buildExplicitSearchTurnOutput, resolveMoreOptionsIntent, looksLikeMoreOptions, buildMoreOptionsTurnOutput } from "../src/engine/explicit-search.ts";
import { focusInvalidationMutations, isNewSearchTurn } from "../src/engine/vehicle-focus.ts";
import { ResponseRenderer } from "../src/engine/response-renderer.ts";
import { resolvePhotoIntent } from "../src/engine/photo-intent.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";

const NOW = "2026-07-01T12:00:00.000Z";
let ok = 0, fail = 0;
const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const STOCK: VehicleFact[] = [
  { vehicleKey: "chevrolet|onix|2016", marca: "Chevrolet", modelo: "Onix", ano: 2016, preco: 51990, km: 93753, tipo: "hatch" },
  { vehicleKey: "jeep|renegade|2018", marca: "Jeep", modelo: "Renegade", ano: 2018, preco: 82990, km: 70000, tipo: "suv" },
];
const catalog: TenantCatalog = buildTenantCatalog(STOCK);
const extractor: ClaimExtractor = new CatalogClaimExtractor(catalog);
const ambiguous: TurnInterpretation = { relation: "ambiguous" };
const base = (over: Partial<ConversationState> = {}): ConversationState => ({
  ...createInitialState({ conversationId: "c", tenantId: "icom", agentId: "aloan", now: NOW }), ...over,
});
function pendingObj(slot: PendingObjective["slot"], kinds: PendingObjective["expectedAnswerKinds"]): PendingObjective {
  return { id: `o-${slot}`, type: "perguntou_dados", slot, askedAt: NOW, askedInTurnId: "t0", deliveredByEffectId: "e0", deliveryLevel: "accepted", expectedAnswerKinds: kinds, status: "pending", attempts: 0 };
}
function slot(muts: DecisionMutation[], name: string): DecisionMutation | undefined {
  return muts.find((m) => m.op === "set_slot" && m.slot === name);
}
const slotVal = (m: DecisionMutation | undefined): unknown => (m && m.op === "set_slot" ? m.value : undefined);

async function main(): Promise<void> {
  console.log("\n=== F2.8 Rebalanceamento Fase 1 (casos obrigatórios) ===\n");

  // 1) "Mostra mais opções" com objetivo de nome pendente -> NÃO vira nome.
  {
    const st = base({ currentObjective: pendingObj("nome", ["nome"]), recentTurns: [{ role: "agent", text: "Qual é o seu nome?", at: NOW }] });
    const muts = extractLeadSlots({ leadMessage: "Mostra mais opções", state: st, interpretation: ambiguous, claimExtractor: extractor, turnId: "t1" });
    check("1 'Mostra mais opções' NÃO vira nome", !slot(muts, "nome"), JSON.stringify(muts));
    check("1 objetivo de nome NÃO é resolvido por resposta incompatível", !muts.some((m) => m.op === "resolve_objective"), JSON.stringify(muts));
  }

  // 1c) BINDER SEMÂNTICO (item 4): com objetivo nome pendente, respostas INCOMPATÍVEIS não viram nome.
  {
    const st = () => base({ currentObjective: pendingObj("nome", ["nome"]), recentTurns: [{ role: "agent", text: "Qual é o seu nome?", at: NOW }] });
    for (const msg of ["outras possibilidades", "automático", "sábado de manhã", "não tenho troca", "sem entrada", "mais barato"]) {
      const muts = extractLeadSlots({ leadMessage: msg, state: st(), interpretation: ambiguous, claimExtractor: extractor, turnId: "t1c" });
      check(`1c "${msg}" NÃO vira nome`, !slot(muts, "nome"), JSON.stringify(muts));
      check(`1c "${msg}" NÃO resolve objetivo de nome`, !muts.some((m) => m.op === "resolve_objective"), JSON.stringify(muts));
    }
    const clean = extractLeadSlots({ leadMessage: "Douglas", state: st(), interpretation: ambiguous, claimExtractor: extractor, turnId: "t1c2" });
    check("1c nome LIMPO 'Douglas' AINDA vincula (não sobre-bloqueia)", slotVal(slot(clean, "nome")) === "Douglas", JSON.stringify(clean));
  }

  // 1b) rajada mista preserva o nome real ("Douglas") + registra interesse.
  {
    const st = base({ currentObjective: pendingObj("nome", ["nome"]) });
    const muts = extractLeadSlots({ leadMessage: "Douglas\nquero um onix", state: st, interpretation: { relation: "answers_pending", extractedEntities: { models: ["onix"] } }, claimExtractor: extractor, turnId: "t1b" });
    check("1b rajada mista preserva nome 'Douglas'", slotVal(slot(muts, "nome")) === "Douglas", JSON.stringify(muts));
  }

  // R11-A1: pedido de COMPRA com objetivo 'possuiTroca' pendente NÃO vira possuiTroca=true espúrio; posse real sim.
  {
    const stTroca = base({ currentObjective: pendingObj("possuiTroca", ["boolean", "afirmacao", "negacao"]) });
    const buy = extractLeadSlots({ leadMessage: "Quero SUV até 70 mil", state: stTroca, interpretation: ambiguous, claimExtractor: extractor, turnId: "tA1" });
    check("A1 'Quero SUV até 70 mil' (objetivo troca pendente) NÃO seta possuiTroca (não é resposta de troca)", !slot(buy, "possuiTroca"), JSON.stringify(buy));
    const has = extractLeadSlots({ leadMessage: "tenho um gol", state: stTroca, interpretation: ambiguous, claimExtractor: extractor, turnId: "tA1b" });
    check("A1 'tenho um gol' (posse real) -> possuiTroca=true", slotVal(slot(has, "possuiTroca")) === true, JSON.stringify(has));
    const no = extractLeadSlots({ leadMessage: "não tenho carro para troca", state: stTroca, interpretation: ambiguous, claimExtractor: extractor, turnId: "tA1c" });
    check("A1 'não tenho carro para troca' -> possuiTroca=false", slotVal(slot(no, "possuiTroca")) === false, JSON.stringify(no));
  }

  // 2) "picape até 100 mil, parcela até 1.800" -> faixaPreco.max=100000 E parcelaDesejada=1800 E tipo=pickup.
  {
    const muts = extractLeadSlots({ leadMessage: "quero uma picape até 100 mil, parcela até 1.800", state: base(), interpretation: ambiguous, claimExtractor: extractor, turnId: "t2" });
    check("2 faixaPreco.max = 100000 (orçamento do carro)", JSON.stringify(slotVal(slot(muts, "faixaPreco"))) === JSON.stringify({ max: 100000 }), JSON.stringify(muts));
    check("2 parcelaDesejada = 1800 (parcela mensal)", slotVal(slot(muts, "parcelaDesejada")) === 1800, JSON.stringify(muts));
    check("2 tipoVeiculo = pickup", slotVal(slot(muts, "tipoVeiculo")) === "pickup", JSON.stringify(muts));
  }

  // 3) "financiar sem entrada, parcela até 1.800" com faixaPreco previamente 100000 -> NÃO sobrescreve faixaPreco.
  {
    const st = base({
      currentObjective: pendingObj("formaPagamento", ["afirmacao"]),
      slots: { ...base().slots, faixaPreco: { status: "known", value: { max: 100000 }, confidence: 0.9, sourceTurnId: "t0", updatedAt: NOW } },
    });
    const muts = extractLeadSlots({ leadMessage: "vou financiar sem entrada, parcela até 1.800", state: st, interpretation: ambiguous, claimExtractor: extractor, turnId: "t3" });
    check("3 NÃO emite mutação de faixaPreco (preserva 100000)", !slot(muts, "faixaPreco"), JSON.stringify(muts));
    check("3 parcelaDesejada = 1800", slotVal(slot(muts, "parcelaDesejada")) === 1800, JSON.stringify(muts));
    check("3 entrada = 0 (sem entrada)", slotVal(slot(muts, "entrada")) === 0, JSON.stringify(muts));
    check("3 formaPagamento = financiamento", slotVal(slot(muts, "formaPagamento")) === "financiamento", JSON.stringify(muts));
  }

  // 3b) Papéis monetários order-independent (item 3): AMBAS as ordens preservam cada valor.
  {
    const money = (msg: string) => extractLeadSlots({ leadMessage: msg, state: base(), interpretation: ambiguous, claimExtractor: extractor, turnId: "t3b" });
    const a = money("quero uma picape até 100 mil, parcela 1.800");
    check("3b ordem A: faixaPreco=100000", JSON.stringify(slotVal(slot(a, "faixaPreco"))) === JSON.stringify({ max: 100000 }), JSON.stringify(a));
    check("3b ordem A: parcelaDesejada=1800", slotVal(slot(a, "parcelaDesejada")) === 1800, JSON.stringify(a));
    const b = money("parcela 1.800 e picape até 100 mil");
    check("3b ordem B (invertida): faixaPreco=100000", JSON.stringify(slotVal(slot(b, "faixaPreco"))) === JSON.stringify({ max: 100000 }), JSON.stringify(b));
    check("3b ordem B (invertida): parcelaDesejada=1800", slotVal(slot(b, "parcelaDesejada")) === 1800, JSON.stringify(b));
    const c = money("entrada 10 mil e carro até 80 mil");
    check("3b entrada/carro: entrada=10000 e faixaPreco=80000", slotVal(slot(c, "entrada")) === 10000 && JSON.stringify(slotVal(slot(c, "faixaPreco"))) === JSON.stringify({ max: 80000 }), JSON.stringify(c));
    const d = money("carro até 80 mil com entrada de 10 mil");
    check("3b carro/entrada (invertida): entrada=10000 e faixaPreco=80000", slotVal(slot(d, "entrada")) === 10000 && JSON.stringify(slotVal(slot(d, "faixaPreco"))) === JSON.stringify({ max: 80000 }), JSON.stringify(d));
    const e = money("picape 2018 até 100 mil, roda 90 mil km");
    check("3b ano(2018)+km(90 mil km) nunca viram dinheiro", JSON.stringify(slotVal(slot(e, "faixaPreco"))) === JSON.stringify({ max: 100000 }) && !slot(e, "parcelaDesejada") && !slot(e, "entrada"), JSON.stringify(e));
  }

  // 4) TIPO em `modelo` -> `tipo` no runner. Modelo real fica intacto.
  {
    const recorded: Array<Record<string, unknown>> = [];
    const stock: StockSource = { search: async (_r, input) => { recorded.push(input as Record<string, unknown>); return { items: [], filtersUsed: input as never }; } };
    const details: VehicleDetailSource = { getDetails: async () => null };
    const photos: VehiclePhotoSource = { resolvePhotos: async () => ({ vehicleKey: "", ambiguous: true, photoIds: [] }), resolveUrls: async () => [] };
    const crm: CrmReadSource = { readLead: async () => null };
    const runner = createReadQueryRunner({ tenantId: "icom", agentId: "aloan" }, { stock, vehicleDetails: details, vehiclePhotos: photos, crm });
    await runner({ tool: "stock_search", input: { modelo: "suv", precoMax: 70000 } });
    await runner({ tool: "stock_search", input: { modelo: "Onix" } });
    check("4 modelo:'suv' -> tipo:'suv' e modelo removido", recorded[0]?.tipo === "suv" && recorded[0]?.modelo === undefined, JSON.stringify(recorded[0]));
    check("4 precoMax preservado", recorded[0]?.precoMax === 70000, JSON.stringify(recorded[0]));
    check("4 modelo real 'Onix' fica intacto", recorded[1]?.modelo === "Onix" && recorded[1]?.tipo === undefined, JSON.stringify(recorded[1]));
  }

  // 4b) Normalizador PURO (usado no decodeStep do LLM E no runner): {modelo:"suv",tipo:"suv"} -> {tipo:"suv"}.
  //     Prova que a proposta crua do LLM ({modelo:"suv"}) é corrigida no boundary, não só no runner.
  {
    const n1 = normalizeStockSearchInput({ modelo: "suv", tipo: "suv", precoMax: 70000 });
    check("4b decode: modelo:'suv'+tipo:'suv' -> só tipo (sem modelo)", n1.ok && n1.input.modelo === undefined && n1.input.tipo === "suv" && n1.input.precoMax === 70000, JSON.stringify(n1));
    const n2 = normalizeStockSearchInput({ modelo: "picape" });
    check("4b decode: modelo:'picape' -> tipo:'pickup'", n2.ok && n2.input.modelo === undefined && n2.input.tipo === "pickup", JSON.stringify(n2));
    const n3 = normalizeStockSearchInput({ modelo: "HB20", precoMax: 60000 });
    check("4b decode: modelo real 'HB20' intacto", n3.ok && n3.input.modelo === "HB20" && n3.input.tipo === undefined, JSON.stringify(n3));
    const n4 = normalizeStockSearchInput({ modelo: "suv", tipo: "sedan" });
    check("6 conflito tipo/modelo FALHA FECHADO (não vira sedan)", !n4.ok, JSON.stringify(n4));
  }

  // 5) POL-GROUND-DETAIL (item 2): atributo do veículo exige o SELECIONADO aterrado nos fatos do turno.
  {
    const decision: TurnDecision = { action: "reply", reasonCode: "answer", reasonSummary: "", confidence: 0.8, responsePlan: { guidance: "" }, effectPlan: [], decisionMutations: [], policyChecks: [] } as unknown as TurnDecision;
    const onix = STOCK[0];
    const hall: RenderedResponse = { draft: { parts: [{ type: "text", content: "Sim, ele é automático." }] }, text: "Sim, ele é automático." };
    const mkCtx = (st: ConversationState): TurnContext => ({ state: st, turnId: "t5", leadMessage: "ele é automático?", now: NOW, interpretation: { relation: "asks_vehicle_detail" }, tenantCatalog: catalog, claimExtractor: extractor });
    // a) sem veículo SELECIONADO -> deny (pedir esclarecimento)
    const v1 = PolicyEngine.validateResponse(hall, [], decision, mkCtx(base()));
    check("5a atributo sem veículo SELECIONADO -> POL-GROUND-DETAIL deny", v1.some((v) => v.policyId === "POL-GROUND-DETAIL" && v.outcome === "deny"), JSON.stringify(v1));
    // b) selecionado Onix + Onix NOS FATOS -> allow
    const selState = base({ vehicleContext: { focus: null, selected: { kind: "vehicle", key: onix.vehicleKey, label: "Chevrolet Onix 2016" } } });
    const factsOnix: QueryResult[] = [{ ok: true, tool: "vehicle_details", source: "fake", data: { vehicle: onix } }];
    const v2 = PolicyEngine.validateResponse(hall, factsOnix, decision, mkCtx(selState));
    check("5b selecionado Onix + Onix aterrado -> sem POL-GROUND-DETAIL", !v2.some((v) => v.policyId === "POL-GROUND-DETAIL"), JSON.stringify(v2));
    // c) selecionado Onix mas só OUTRO veículo (Renegade) aterrado -> deny (outro não autoriza)
    const factsOther: QueryResult[] = [{ ok: true, tool: "stock_search", source: "fake", data: { items: [STOCK[1]], filtersUsed: {} } }];
    const v3 = PolicyEngine.validateResponse(hall, factsOther, decision, mkCtx(selState));
    check("5c selecionado Onix mas só Renegade aterrado -> deny (fato de outro veículo não autoriza)", v3.some((v) => v.policyId === "POL-GROUND-DETAIL" && v.outcome === "deny"), JSON.stringify(v3));
  }

  // 7) Item 1: seleção do lead (ordinal/modelo) grava selectedVehicleFocus com o vehicleKey EXATO.
  {
    const rendered = { sourceTurnId: "t0", createdAt: NOW, items: [
      { ordinal: 1, vehicleKey: "chevrolet|onix|2016", marca: "Chevrolet", modelo: "Onix", ano: 2016 },
      { ordinal: 2, vehicleKey: "chevrolet|onix|2014", marca: "Chevrolet", modelo: "Onix", ano: 2014 },
      { ordinal: 3, vehicleKey: "jeep|renegade|2018", marca: "Jeep", modelo: "Renegade", ano: 2018 },
    ] };
    const st = base({ lastRenderedOfferContext: rendered });
    const sel = (msg: string, tid: string) => extractLeadSlots({ leadMessage: msg, state: st, interpretation: ambiguous, claimExtractor: extractor, turnId: tid }).find((m) => m.op === "select_vehicle_focus");
    const ord3 = sel("quero o terceiro", "t7a");
    check("7 ordinal 'o terceiro' -> select do 3º (Renegade) key exata", ord3?.op === "select_vehicle_focus" && ord3.vehicle.key === "jeep|renegade|2018", JSON.stringify(ord3));
    const ord2 = sel("gostei do segundo", "t7b");
    check("7 ordinal 'do segundo' -> 2º Onix (2014), não o 1º similar", ord2?.op === "select_vehicle_focus" && ord2.vehicle.key === "chevrolet|onix|2014", JSON.stringify(ord2));
    const amb = sel("quero o onix", "t7c");
    check("7 'Onix' ambíguo (2 Onix) -> NÃO seleciona (fail-closed, ordinal desambigua)", !amb, JSON.stringify(amb));
    // F-2: QUANTIDADE não é ordinal (parser único endurecido)
    check("F2 'quero 3 fotos' NÃO seleciona (quantidade≠posição)", !sel("quero 3 fotos", "t7e"), JSON.stringify(sel("quero 3 fotos", "t7e")));
    check("F2 'manda 2 imagens dele' NÃO seleciona item 2", !sel("manda 2 imagens dele", "t7f"), JSON.stringify(sel("manda 2 imagens dele", "t7f")));
    const q3 = sel("quero o 3", "t7g");
    check("F2 'quero o 3' seleciona item 3 (Renegade)", q3?.op === "select_vehicle_focus" && q3.vehicle.key === "jeep|renegade|2018", JSON.stringify(q3));
    const op3 = sel("foto da opção 3", "t7h");
    check("F2 'foto da opção 3' seleciona item 3", op3?.op === "select_vehicle_focus" && op3.vehicle.key === "jeep|renegade|2018", JSON.stringify(op3));
    const applied = applyDecision(st, [{ op: "select_vehicle_focus", vehicle: { kind: "vehicle", key: "jeep|renegade|2018", label: "Jeep Renegade 2018" }, sourceTurnId: "t7d" }], "t7d", NOW);
    check("7 reducer aplica selectedVehicleFocus no COMMIT (inbound, sem receipt)", applied.ok && applied.next.vehicleContext.selected?.key === "jeep|renegade|2018", JSON.stringify(applied.ok ? applied.next.vehicleContext : applied));
  }

  // 6) Anti-fixação: objetivo possuiTroca pendente + resposta do handler sem pergunta de troca ->
  //    o conductor NÃO reescreve com "Você tem algum veículo para usar na troca?".
  {
    const policy = buildSdrQualificationPolicy({ qualificationQuestions: ["Você tem algum carro para troca?"], agentName: "Aloan" });
    const st = base({
      turnNumber: 4,
      currentObjective: pendingObj("possuiTroca", ["boolean", "afirmacao", "negacao"]),
      recentTurns: [{ role: "agent", text: "Você tem algum veículo para usar na troca?", at: NOW }],
      slots: {
        ...base().slots,
        nome: { status: "known", value: "Douglas", confidence: 0.9, sourceTurnId: "t0", updatedAt: NOW },
        interesse: { status: "known", value: "onix", confidence: 0.9, sourceTurnId: "t0", updatedAt: NOW },
      },
    });
    const handlerText = "O Onix 2016 é um ótimo custo-benefício! 📸";
    const output: TurnOutput = {
      decision: { action: "reply", reasonCode: "continuity_conduct", reasonSummary: "", confidence: 0.8, responsePlan: { guidance: "responda o lead" }, effectPlan: [], decisionMutations: [], policyChecks: [] } as unknown as TurnDecision,
      composed: { draft: { parts: [{ type: "text", content: handlerText }] }, text: handlerText },
      facts: [], loopExhausted: false, terminalSafe: false, steps: 0,
    };
    const conducted = applySdrConduction({ output, state: st, policy, turnId: "t6" });
    check("6 anti-fixação: NÃO repergunta troca (slot já pendente)", !/troca/i.test(conducted.composed.text), conducted.composed.text);
    check("6 anti-fixação: preserva a resposta do handler ao lead", conducted.composed.text.includes("Onix 2016"), conducted.composed.text);
  }

  // 8) Item 5: deferimento TIPADO — defere até o limite (conta), depois avança p/ outro slot (não fica preso).
  {
    const policy = buildSdrQualificationPolicy({ qualificationQuestions: ["Você tem algum carro para troca?"], agentName: "Aloan" });
    const mkState = (deferrals: number) => base({
      turnNumber: 4,
      currentObjective: { ...pendingObj("possuiTroca", ["boolean", "afirmacao", "negacao"]), deferrals },
      recentTurns: [{ role: "agent", text: "Você tem algum veículo para usar na troca?", at: NOW }],
      slots: { ...base().slots, nome: { status: "known", value: "Douglas", confidence: 0.9, sourceTurnId: "t0", updatedAt: NOW }, interesse: { status: "known", value: "onix", confidence: 0.9, sourceTurnId: "t0", updatedAt: NOW } },
    });
    // Output REAL de handler (com efeito send_message) — attachQualificationObjective precisa do efeito.
    const mkOutput = (): TurnOutput => buildExplicitSearchTurnOutput({ kind: "offer", label: "Onix", vehicles: [STOCK[0]], missingLabels: [] }, "t8");
    const d0 = applySdrConduction({ output: mkOutput(), state: mkState(0), policy, turnId: "t8a" });
    check("8 deferral<limite: NÃO repergunta troca", !/troca/i.test(d0.composed.text), d0.composed.text);
    check("8 deferral<limite: emite defer_objective (conta o deferimento)", d0.decision.decisionMutations.some((m) => m.op === "defer_objective"), JSON.stringify(d0.decision.decisionMutations));
    const d2 = applySdrConduction({ output: mkOutput(), state: mkState(2), policy, turnId: "t8b" });
    check("8 deferral>=limite: avança p/ OUTRO slot (não fica preso em troca)", d2.decision.decisionMutations.some((m) => m.op === "set_planned_objective" && m.planned.slot !== "possuiTroca"), JSON.stringify(d2.decision.decisionMutations));
    // F-5: supersede do objetivo ANTIGO antes do novo planejado + reducer rejeita defer divergente
    const ms = d2.decision.decisionMutations;
    const si = ms.findIndex((m) => m.op === "supersede_objective" && m.objectiveId === "o-possuiTroca");
    const pi = ms.findIndex((m) => m.op === "set_planned_objective");
    check("F5 avanço: supersede do objetivo antigo ANTES do novo planejado", si >= 0 && pi >= 0 && si < pi, JSON.stringify(ms));
    const badDefer = applyDecision(mkState(0), [{ op: "defer_objective", objectiveId: "objetivo-inexistente" }], "t8c", NOW);
    check("F5 reducer REJEITA defer_objective com objectiveId divergente (não ignora)", !badDefer.ok, JSON.stringify(badDefer));
  }

  // F-6) resolve do objetivo exige CAPTURA compatível com expectedAnswerKinds
  {
    const nomeObj = base({ currentObjective: pendingObj("nome", ["nome"]), recentTurns: [{ role: "agent", text: "Qual é o seu nome?", at: NOW }] });
    const named = extractLeadSlots({ leadMessage: "Douglas", state: nomeObj, interpretation: ambiguous, claimExtractor: extractor, turnId: "tF6a" });
    check("F6 nome + 'Douglas' (compatível) -> resolve", named.some((m) => m.op === "resolve_objective" && m.status === "satisfied"), JSON.stringify(named));
    const budgetObj = base({ currentObjective: pendingObj("faixaPreco", ["valor"]), recentTurns: [{ role: "agent", text: "Qual faixa de valor?", at: NOW }] });
    const val = extractLeadSlots({ leadMessage: "até 80 mil", state: budgetObj, interpretation: ambiguous, claimExtractor: extractor, turnId: "tF6b" });
    check("F6 faixaPreco + 'até 80 mil' (valor compatível) -> resolve", val.some((m) => m.op === "resolve_objective" && m.status === "satisfied"), JSON.stringify(val));
    const incompat = extractLeadSlots({ leadMessage: "Douglas", state: budgetObj, interpretation: ambiguous, claimExtractor: extractor, turnId: "tF6c" });
    check("F6 faixaPreco + 'Douglas' (não é valor) -> NÃO resolve nem altera", !incompat.some((m) => m.op === "resolve_objective"), JSON.stringify(incompat));
  }

  // F-3 / P0-2) Invalidação CENTRAL do foco (função única, não por-handler): nova intenção limpa; 1 renderizado
  //   -> select; vários/nenhum -> só clear; sem nova intenção -> não mexe.
  {
    const rItem = { ordinal: 1, vehicleKey: "jeep|renegade|2018", marca: "Jeep", modelo: "Renegade", ano: 2018 };
    const one = focusInvalidationMutations(true, [rItem], "tF3a");
    check("P0-2 nova intenção + 1 renderizado -> clear + select do vehicleKey exato", one.some((m) => m.op === "clear_vehicle_focus") && one.some((m) => m.op === "select_vehicle_focus" && m.vehicle.key === "jeep|renegade|2018"), JSON.stringify(one));
    const many = focusInvalidationMutations(true, [rItem, { ordinal: 2, vehicleKey: "chevrolet|onix|2016", marca: "Chevrolet", modelo: "Onix", ano: 2016 }], "tF3b");
    check("P0-2 nova intenção + vários -> clear SEM select (selected=null)", many.some((m) => m.op === "clear_vehicle_focus") && !many.some((m) => m.op === "select_vehicle_focus"), JSON.stringify(many));
    const none = focusInvalidationMutations(true, [], "tF3c");
    check("P0-2 nova intenção + nenhum -> clear SEM select", none.some((m) => m.op === "clear_vehicle_focus") && !none.some((m) => m.op === "select_vehicle_focus"), JSON.stringify(none));
    const noIntent = focusInvalidationMutations(false, [rItem], "tF3d");
    check("P0-2 SEM nova intenção -> NÃO mexe no foco", noIntent.length === 0, JSON.stringify(noIntent));
  }

  // F-4) Grounding do VALOR do atributo: mismatch de câmbio -> deny; vehicle_ref renderiza do fato; ausente falha.
  {
    const decision: TurnDecision = { action: "reply", reasonCode: "answer", reasonSummary: "", confidence: 0.8, responsePlan: { guidance: "" }, effectPlan: [], decisionMutations: [], policyChecks: [] } as unknown as TurnDecision;
    const onixManual: VehicleFact = { ...STOCK[0], cambio: "Manual", cor: null };
    const factsManual: QueryResult[] = [{ ok: true, tool: "vehicle_details", source: "fake", data: { vehicle: onixManual } }];
    const selState = base({ vehicleContext: { focus: null, selected: { kind: "vehicle", key: onixManual.vehicleKey, label: "Chevrolet Onix 2016" } } });
    const detailCtx: TurnContext = { state: selState, turnId: "tF4", leadMessage: "ele é automático?", now: NOW, interpretation: { relation: "asks_vehicle_detail" }, tenantCatalog: catalog, claimExtractor: extractor };
    const wrong: RenderedResponse = { draft: { parts: [{ type: "text", content: "Sim, ele é automático." }] }, text: "Sim, ele é automático." };
    const vw = PolicyEngine.validateResponse(wrong, factsManual, decision, detailCtx);
    check("F4 fato Manual + texto 'automático' -> POL-ATTR-VALUE deny", vw.some((v) => v.policyId === "POL-ATTR-VALUE" && v.outcome === "deny"), JSON.stringify(vw));
    const right: RenderedResponse = { draft: { parts: [{ type: "text", content: "Ele é manual." }] }, text: "Ele é manual." };
    const vr = PolicyEngine.validateResponse(right, factsManual, decision, detailCtx);
    check("F4 fato Manual + texto 'manual' -> sem POL-ATTR-VALUE (valor bate)", !vr.some((v) => v.policyId === "POL-ATTR-VALUE"), JSON.stringify(vr));
    // renderer estruturado: vehicle_ref(cambio) renderiza o valor do fato; cor ausente FALHA FECHADO.
    const rendered = ResponseRenderer.render({ parts: [{ type: "vehicle_ref", vehicleKey: onixManual.vehicleKey, field: "cambio" }] }, factsManual, selState);
    check("F4 vehicle_ref(cambio) renderiza 'Manual' do fato exato", rendered === "Manual", rendered);
    let threw = false;
    try { ResponseRenderer.render({ parts: [{ type: "vehicle_ref", vehicleKey: onixManual.vehicleKey, field: "cor" }] }, factsManual, selState); } catch { threw = true; }
    check("F4 vehicle_ref(cor) com cor AUSENTE falha fechado (não inventa)", threw);
  }

  // F-1) Prioridade da foto: o veículo SELECIONADO vence a INTERPRETAÇÃO da LLM.
  {
    const hb20 = "hyundai|hb20|2021";
    const stF1 = base({
      lastRenderedOfferContext: { sourceTurnId: "t0", createdAt: NOW, items: [{ ordinal: 1, vehicleKey: hb20, marca: "Hyundai", modelo: "HB20", ano: 2021 }] },
      vehicleContext: { focus: null, selected: { kind: "vehicle", key: hb20, label: "Hyundai HB20 2021" } },
    });
    const runQ: QueryRunner = async (call) => {
      if (call.tool === "vehicle_photos_resolve") return { ok: true, tool: "vehicle_photos_resolve", source: "fake", data: { vehicleKey: (call.input as { vehicleRef: { key: string } }).vehicleRef.key, ambiguous: false, photoIds: ["p1"] } };
      return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
    };
    const res = await resolvePhotoIntent({ leadMessage: "manda fotos dele", state: stF1, claimExtractor: extractor, runQuery: runQ, interpretation: { relation: "asks_vehicle_detail", extractedEntities: { models: ["C3"] } } });
    check("F1 selecionado HB20 + interp C3 + 'fotos dele' -> HB20 (interpretação NÃO vence a seleção)", res?.kind === "send" && res.vehicleKey === hb20, JSON.stringify(res));
  }

  // P0-1 e2e) foto: selected-compatível entre os resultados usa o key EXATO; múltiplos sem seleção -> ask_which.
  {
    const onix14 = "chevrolet|onix|2014", onix16 = "chevrolet|onix|2016";
    const onixStock: VehicleFact[] = [
      { vehicleKey: onix14, marca: "Chevrolet", modelo: "Onix", ano: 2014, preco: 50000, tipo: "hatch" },
      { vehicleKey: onix16, marca: "Chevrolet", modelo: "Onix", ano: 2016, preco: 52000, tipo: "hatch" },
    ];
    const runQ: QueryRunner = async (call) => {
      if (call.tool === "stock_search") return { ok: true, tool: "stock_search", source: "fake", data: { items: /onix/i.test(String((call.input as { modelo?: string }).modelo ?? "")) ? onixStock : [], filtersUsed: {} } };
      if (call.tool === "vehicle_photos_resolve") return { ok: true, tool: "vehicle_photos_resolve", source: "fake", data: { vehicleKey: (call.input as { vehicleRef: { key: string } }).vehicleRef.key, ambiguous: false, photoIds: ["p1"] } };
      return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
    };
    const stSel = base({ vehicleContext: { focus: null, selected: { kind: "vehicle", key: onix16, label: "Chevrolet Onix 2016" } } });
    const rSel = await resolvePhotoIntent({ leadMessage: "manda foto do onix", state: stSel, claimExtractor: extractor, runQuery: runQ, interpretation: ambiguous });
    check("P0-1 e2e: Onix 2016 selecionado + 'foto do onix' (2 Onix) -> 2016 (NUNCA 2014/items[0])", rSel?.kind === "send" && rSel.vehicleKey === onix16, JSON.stringify(rSel));
    const rMulti = await resolvePhotoIntent({ leadMessage: "manda foto do onix", state: base(), claimExtractor: extractor, runQuery: runQ, interpretation: ambiguous });
    check("P0-1 e2e: múltiplos Onix SEM seleção -> ask_which (proibido items[0])", rMulti?.kind === "ask_which", JSON.stringify(rMulti));
  }

  // P1-3 adversariais) cor/ano/câmbio incorretos em pergunta de detalhe -> POL-ATTR-VALUE deny; corretos passam.
  {
    const dec: TurnDecision = { action: "reply", reasonCode: "answer", reasonSummary: "", confidence: 0.8, responsePlan: { guidance: "" }, effectPlan: [], decisionMutations: [], policyChecks: [] } as unknown as TurnDecision;
    const onixW: VehicleFact = { ...STOCK[0], cor: "Branco", ano: 2016, km: 90000, cambio: "Manual" };
    const f2: QueryResult[] = [{ ok: true, tool: "vehicle_details", source: "fake", data: { vehicle: onixW } }];
    const sel2 = base({ vehicleContext: { focus: null, selected: { kind: "vehicle", key: onixW.vehicleKey, label: "Onix" } } });
    const ctx2 = (msg: string): TurnContext => ({ state: sel2, turnId: "tP13", leadMessage: msg, now: NOW, interpretation: { relation: "asks_vehicle_detail" }, tenantCatalog: catalog, claimExtractor: extractor });
    const txt = (s: string): RenderedResponse => ({ draft: { parts: [{ type: "text", content: s }] }, text: s });
    check("P1-3 cor errada (fato Branco, texto 'preto') -> deny", PolicyEngine.validateResponse(txt("Ele é preto."), f2, dec, ctx2("qual a cor dele?")).some((v) => v.policyId === "POL-ATTR-VALUE"), "");
    check("P1-3 cor certa (fato Branco, texto 'branco') -> sem deny", !PolicyEngine.validateResponse(txt("Ele é branco."), f2, dec, ctx2("qual a cor?")).some((v) => v.policyId === "POL-ATTR-VALUE"), "");
    check("P1-3 ano errado (fato 2016, texto 'de 2020') -> deny", PolicyEngine.validateResponse(txt("Ele é de 2020."), f2, dec, ctx2("qual o ano dele?")).some((v) => v.policyId === "POL-ATTR-VALUE"), "");
    check("P1-3 câmbio errado (fato Manual, texto 'automático') -> deny", PolicyEngine.validateResponse(txt("Sim, ele é automático."), f2, dec, ctx2("é automático?")).some((v) => v.policyId === "POL-ATTR-VALUE"), "");
  }

  // P0 (Codex) — invalidação do foco baseada na AÇÃO do turno (não em palavras): FOTO/DETALHE do carro atual
  // NÃO limpa; só uma BUSCA/direção comercial nova (lista renderizada OU busca explícita sem resultado) limpa.
  {
    const item = { ordinal: 1, vehicleKey: "jeep|renegade|2018", marca: "Jeep", modelo: "Renegade", ano: 2018 };
    // Ação = PEDIR FOTO do carro atual -> NÃO é busca nova (preserva o foco), mesmo citando um modelo.
    check("P0 'manda foto do Onix' (photoIntent) -> NÃO é busca nova (preserva foco)", !isNewSearchTurn({ isPhotoIntent: true, relation: "continues_offer", renderedItemCount: 0, explicitSearchKind: null }), "");
    // Ação = perguntar DETALHE (valor/câmbio/cor/ano/km) do carro atual -> preserva.
    check("P0 'e o valor dele?' / 'ele é automático?' (asks_vehicle_detail) -> preserva foco", !isNewSearchTurn({ isPhotoIntent: false, relation: "asks_vehicle_detail", renderedItemCount: 1, explicitSearchKind: null }), "");
    // Ação = nova busca que RENDERIZOU 1 carro -> busca nova (invalida) e seleciona esse veículo.
    check("P0 'agora quero Renegade' (renderizou 1) -> É busca nova (invalida)", isNewSearchTurn({ isPhotoIntent: false, relation: "direction_change", renderedItemCount: 1, explicitSearchKind: "model" }), "");
    const mSel = focusInvalidationMutations(isNewSearchTurn({ isPhotoIntent: false, relation: "direction_change", renderedItemCount: 1, explicitSearchKind: "model" }), [item], "tP0");
    check("P0 busca nova + 1 renderizado -> clear + select do vehicleKey", mSel.some((m) => m.op === "clear_vehicle_focus") && mSel.some((m) => m.op === "select_vehicle_focus" && m.vehicle.key === item.vehicleKey), JSON.stringify(mSel));
    // Ação = nova busca com VÁRIOS resultados ("mostra SUVs") -> invalida, sem selecionar (ambíguo).
    check("P0 'mostra SUVs' (renderizou vários) -> É busca nova (invalida)", isNewSearchTurn({ isPhotoIntent: false, relation: "direction_change", renderedItemCount: 4, explicitSearchKind: "type" }), "");
    const mMulti = focusInvalidationMutations(true, [item, { ...item, ordinal: 2, vehicleKey: "vw|tcross|2020" }], "tP0");
    check("P0 busca nova + vários -> clear SEM select", mMulti.some((m) => m.op === "clear_vehicle_focus") && !mMulti.some((m) => m.op === "select_vehicle_focus"), JSON.stringify(mMulti));
    // Ação = busca explícita NOVA sem resultado (kind "none") -> invalida (não deixa foco velho grudado).
    check("P0 busca explícita nova SEM resultado (kind none) -> É busca nova (invalida)", isNewSearchTurn({ isPhotoIntent: false, relation: "direction_change", renderedItemCount: 0, explicitSearchKind: "none" }), "");
    // Ação = turno sem busca e sem render (conversa/objeção) -> NÃO é busca nova (preserva).
    check("P0 turno sem render e sem busca (ambíguo/objeção) -> preserva foco", !isNewSearchTurn({ isPhotoIntent: false, relation: "ambiguous", renderedItemCount: 0, explicitSearchKind: null }), "");
  }

  // P1 (Codex) — grounding COMPLETO de atributos: km mismatch/render/fail-closed + cor/câmbio FORA do léxico não escapa + veículo errado.
  {
    const dec: TurnDecision = { action: "reply", reasonCode: "answer", reasonSummary: "", confidence: 0.8, responsePlan: { guidance: "" }, effectPlan: [], decisionMutations: [], policyChecks: [] } as unknown as TurnDecision;
    const txt = (s: string): RenderedResponse => ({ draft: { parts: [{ type: "text", content: s }] }, text: s });
    const hasAttr = (vs: ReturnType<typeof PolicyEngine.validateResponse>): boolean => vs.some((v) => v.policyId === "POL-ATTR-VALUE");
    const detailCtx = (state: ConversationState, msg: string): TurnContext => ({ state, turnId: "tP1", leadMessage: msg, now: NOW, interpretation: { relation: "asks_vehicle_detail" }, tenantCatalog: catalog, claimExtractor: extractor });
    // ── KM: mismatch -> deny; tolerância; vehicle_ref renderiza do fato; ausente falha fechado.
    const onixKm: VehicleFact = { ...STOCK[0], km: 130000, cambio: "Manual", cor: "Branco", ano: 2016 };
    const fKm: QueryResult[] = [{ ok: true, tool: "vehicle_details", source: "fake", data: { vehicle: onixKm } }];
    const selKm = base({ vehicleContext: { focus: null, selected: { kind: "vehicle", key: onixKm.vehicleKey, label: "Onix" } } });
    check("P1 km: fato 130.000 + texto '80.000 km' -> deny", hasAttr(PolicyEngine.validateResponse(txt("Ele tem 80.000 km."), fKm, dec, detailCtx(selKm, "quantos km ele tem?"))), "");
    check("P1 km: fato 130.000 + texto 'uns 130 mil km' -> sem deny (tolerância arredondamento)", !hasAttr(PolicyEngine.validateResponse(txt("Tem uns 130 mil km rodados."), fKm, dec, detailCtx(selKm, "quantos km?"))), "");
    const kmRendered = ResponseRenderer.render({ parts: [{ type: "vehicle_ref", vehicleKey: onixKm.vehicleKey, field: "km" }] }, fKm, selKm);
    check("P1 km: vehicle_ref(km) renderiza '130.000 km' do fato exato", kmRendered === "130.000 km", kmRendered);
    let kmThrew = false;
    const onixNoKm: VehicleFact = { ...onixKm, km: undefined };
    try { ResponseRenderer.render({ parts: [{ type: "vehicle_ref", vehicleKey: onixKm.vehicleKey, field: "km" }] }, [{ ok: true, tool: "vehicle_details", source: "fake", data: { vehicle: onixNoKm } }], selKm); } catch { kmThrew = true; }
    check("P1 km: vehicle_ref(km) com km AUSENTE falha fechado (não inventa)", kmThrew);
    // ── COR fora do léxico hardcoded: não pode escapar por texto livre.
    const bordo: VehicleFact = { ...STOCK[0], vehicleKey: "chevrolet|onix|2019", cor: "Bordô", ano: 2019, km: 40000, cambio: "Automático" };
    const fB: QueryResult[] = [{ ok: true, tool: "vehicle_details", source: "fake", data: { vehicle: bordo } }];
    const selB = base({ vehicleContext: { focus: null, selected: { kind: "vehicle", key: bordo.vehicleKey, label: "Onix 2019" } } });
    check("P1 cor fora do léxico: fato 'Bordô' + texto 'grená' (não está na lista) -> deny (não escapa)", hasAttr(PolicyEngine.validateResponse(txt("Ele é grená."), fB, dec, detailCtx(selB, "qual a cor dele?"))), "");
    check("P1 cor fora do léxico: fato 'Bordô' + dodge 'é uma cor linda' -> deny", hasAttr(PolicyEngine.validateResponse(txt("É uma cor linda!"), fB, dec, detailCtx(selB, "qual a cor?"))), "");
    check("P1 cor fora do léxico: fato 'Bordô' + texto 'bordô' -> sem deny (valor do fato presente)", !hasAttr(PolicyEngine.validateResponse(txt("Ele é bordô, bem conservado."), fB, dec, detailCtx(selB, "qual a cor?"))), "");
    const corRef: RenderedResponse = { draft: { parts: [{ type: "vehicle_ref", vehicleKey: bordo.vehicleKey, field: "cor" }] }, text: "Ele é Bordô." };
    check("P1 cor fora do léxico: vehicle_ref(cor) -> sem deny + renderiza 'Bordô'", !hasAttr(PolicyEngine.validateResponse(corRef, fB, dec, detailCtx(selB, "qual a cor?"))) && ResponseRenderer.render({ parts: [{ type: "vehicle_ref", vehicleKey: bordo.vehicleKey, field: "cor" }] }, fB, selB) === "Bordô", "");
    check("P1 cor: deferral explícito 'vou confirmar a cor' -> sem deny", !hasAttr(PolicyEngine.validateResponse(txt("Vou confirmar a cor certinha e já te falo!"), fB, dec, detailCtx(selB, "qual a cor?"))), "");
    // ── CÂMBIO fora do léxico binário (fato Manual, texto 'CVT') -> deny.
    const gol: VehicleFact = { ...STOCK[0], vehicleKey: "vw|gol|2015", cambio: "Manual", cor: "Prata", ano: 2015 };
    const fG: QueryResult[] = [{ ok: true, tool: "vehicle_details", source: "fake", data: { vehicle: gol } }];
    const selG = base({ vehicleContext: { focus: null, selected: { kind: "vehicle", key: gol.vehicleKey, label: "Gol" } } });
    check("P1 câmbio fora do léxico: fato 'Manual' + texto 'é CVT' -> deny (não escapa)", hasAttr(PolicyEngine.validateResponse(txt("Ele é CVT."), fG, dec, detailCtx(selG, "qual o câmbio dele?"))), "");
    check("P1 câmbio: fato 'Manual' + texto 'é manual' -> sem deny (valor do fato presente)", !hasAttr(PolicyEngine.validateResponse(txt("Ele é manual mesmo."), fG, dec, detailCtx(selG, "qual o câmbio?"))), "");
    // ── Atributo do VEÍCULO ERRADO: selecionado Onix(Branco/2016); texto afirma valor de OUTRO carro -> deny.
    const onixSel: VehicleFact = { ...STOCK[0], cor: "Branco", ano: 2016, km: 70000, cambio: "Manual" };
    const hb20Other: VehicleFact = { vehicleKey: "hyundai|hb20|2021", marca: "Hyundai", modelo: "HB20", ano: 2021, preco: 60000, tipo: "hatch", cor: "Preto", km: 30000, cambio: "Automático" };
    const fMix: QueryResult[] = [{ ok: true, tool: "vehicle_details", source: "fake", data: { vehicle: onixSel } }, { ok: true, tool: "vehicle_details", source: "fake", data: { vehicle: hb20Other } }];
    const selMix = base({ vehicleContext: { focus: null, selected: { kind: "vehicle", key: onixSel.vehicleKey, label: "Onix" } } });
    check("P1 veículo errado: selecionado Onix(Branco) + texto 'preto' (cor do HB20) -> deny", hasAttr(PolicyEngine.validateResponse(txt("Ele é preto."), fMix, dec, detailCtx(selMix, "qual a cor do onix?"))), "");
    check("P1 veículo errado: selecionado Onix(2016) + texto 'de 2021' (ano do HB20) -> deny", hasAttr(PolicyEngine.validateResponse(txt("Ele é de 2021."), fMix, dec, detailCtx(selMix, "qual o ano do onix?"))), "");
    check("P1 veículo errado: selecionado Onix(Manual) + texto 'automático' (câmbio do HB20) -> deny", hasAttr(PolicyEngine.validateResponse(txt("Sim, ele é automático."), fMix, dec, detailCtx(selMix, "o onix é automático?"))), "");
  }

  // Seção 4 (Codex) — "mais opções" DETERMINÍSTICO: herda tipo+teto dos slots, exclui os já mostrados, nunca inventa.
  {
    check("S4 'tem mais opções?' detectado", looksLikeMoreOptions("tem mais opções?"));
    check("S4 'e mais alguma?' detectado", looksLikeMoreOptions("e mais alguma?"));
    check("S4 'tem algo mais barato?' NÃO é mais-opções (é economy)", !looksLikeMoreOptions("tem algo mais barato?"));
    const shown = [
      { ordinal: 1, vehicleKey: "jeep|renegade|2018", marca: "Jeep", modelo: "Renegade", ano: 2018 },
      { ordinal: 2, vehicleKey: "vw|tcross|2020", marca: "VW", modelo: "T-Cross", ano: 2020 },
    ];
    const st = base({
      slots: { ...base().slots, tipoVeiculo: { status: "known", value: "suv", confidence: 0.9, updatedAt: NOW }, faixaPreco: { status: "known", value: { max: 70000 }, confidence: 0.9, updatedAt: NOW } } as ConversationState["slots"],
      lastRenderedOfferContext: { sourceTurnId: "t0", createdAt: NOW, items: shown },
    });
    const cap: { input: Record<string, unknown> } = { input: {} };
    const runQ: QueryRunner = async (call) => { cap.input = call.input as Record<string, unknown>; return { ok: true, tool: "stock_search", source: "fake", data: { items: [{ vehicleKey: "jeep|compass|2019", marca: "Jeep", modelo: "Compass", ano: 2019, preco: 68000, tipo: "suv" }], filtersUsed: {} } } as QueryResult; };
    const r = await resolveMoreOptionsIntent({ leadMessage: "tem mais opções?", state: st, runQuery: runQ, claimExtractor: extractor });
    check("S4 herda tipo=suv na query", cap.input.tipo === "suv", JSON.stringify(cap.input));
    check("S4 herda precoMax=70000 na query", cap.input.precoMax === 70000, JSON.stringify(cap.input));
    check("S4 exclui os já mostrados (excludeKeys)", Array.isArray(cap.input.excludeKeys) && (cap.input.excludeKeys as string[]).includes("jeep|renegade|2018") && (cap.input.excludeKeys as string[]).includes("vw|tcross|2020"), JSON.stringify(cap.input));
    check("S4 offer com veículo NOVO (Compass), sem repetir os mostrados", r?.kind === "offer" && r.vehicles.some((v) => v.vehicleKey === "jeep|compass|2019") && !r.vehicles.some((v) => v.vehicleKey === "jeep|renegade|2018"), JSON.stringify(r?.kind));
    const rNull = await resolveMoreOptionsIntent({ leadMessage: "tem mais opções?", state: base(), runQuery: runQ, claimExtractor: extractor });
    check("S4 sem contexto comercial anterior -> null (deixa o LLM)", rNull === null);
    // P1 memória CUMULATIVA (Codex): exclui offers.presentedKeys (accepted-safe) + a última lista ordinal.
    const stCumul = base({ slots: st.slots, offers: { last: null, presentedKeys: ["jeep|renegade|2018", "hist|antigo|2010"] }, lastRenderedOfferContext: { sourceTurnId: "t0", createdAt: NOW, items: [{ ordinal: 1, vehicleKey: "vw|tcross|2020", marca: "VW", modelo: "T-Cross", ano: 2020 }] } });
    const cap2: { input: Record<string, unknown> } = { input: {} };
    const runQ2: QueryRunner = async (call) => { cap2.input = call.input as Record<string, unknown>; return { ok: true, tool: "stock_search", source: "fake", data: { items: [], filtersUsed: {} } } as QueryResult; };
    await resolveMoreOptionsIntent({ leadMessage: "e mais alguma?", state: stCumul, runQuery: runQ2, claimExtractor: extractor });
    check("S4 memória CUMULATIVA: exclui offers.presentedKeys + lastRendered", Array.isArray(cap2.input.excludeKeys) && ["jeep|renegade|2018", "hist|antigo|2010", "vw|tcross|2020"].every((k) => (cap2.input.excludeKeys as string[]).includes(k)), JSON.stringify(cap2.input.excludeKeys));
    // "mais opções até 90 mil": ATUALIZA o teto, MANTÉM categoria (suv) e exclusões.
    const cap3: { input: Record<string, unknown> } = { input: {} };
    const runQ3: QueryRunner = async (call) => { cap3.input = call.input as Record<string, unknown>; return { ok: true, tool: "stock_search", source: "fake", data: { items: [], filtersUsed: {} } } as QueryResult; };
    await resolveMoreOptionsIntent({ leadMessage: "tem mais opções até 90 mil?", state: st, runQuery: runQ3, claimExtractor: extractor });
    check("S4 'mais opções até 90 mil' -> teto 90000, mantém tipo suv + exclusões", cap3.input.precoMax === 90000 && cap3.input.tipo === "suv" && Array.isArray(cap3.input.excludeKeys), JSON.stringify(cap3.input));
  }

  // Anti-SLOT_FIXATION (trava determinística pós-compose): 3ª pergunta consecutiva do mesmo slot -> troca.
  {
    const policy = buildSdrQualificationPolicy({ qualificationQuestions: null, agentName: "Aloan" });
    // 2 falas anteriores do agente já perguntaram NOME -> o compose deste turno pergunta nome 3ª vez.
    const stFix = base({ turnNumber: 4, recentTurns: [{ role: "agent", text: "Qual é o seu nome?", at: NOW }, { role: "lead", text: "quero um carro", at: NOW }, { role: "agent", text: "Antes, qual seu nome?", at: NOW }] });
    const fixated = "Legal! Qual é o seu nome?";
    const fixed = enforceNoSlotFixation({ composedText: fixated, state: stFix, policy });
    check("anti-fixação: 3ª pergunta de 'nome' -> troca pelo próximo slot (não repete nome)", !/qual.*seu nome/i.test(fixed) && fixed !== fixated, fixed);
    // 1ª vez: permitida (não troca).
    const st1 = base({ turnNumber: 2, recentTurns: [{ role: "agent", text: "Bom dia!", at: NOW }] });
    check("anti-fixação: 1ª pergunta de nome -> permitida (não troca)", enforceNoSlotFixation({ composedText: "Qual é o seu nome?", state: st1, policy }) === "Qual é o seu nome?");
    // Sem pergunta de slot no texto -> inalterado.
    check("anti-fixação: texto sem pergunta de slot -> inalterado", enforceNoSlotFixation({ composedText: "Perfeito, já anotei aqui!", state: stFix, policy }) === "Perfeito, já anotei aqui!");
  }

  // P0-2 (Codex, revisto na Rodada 9) — POL-QUESTION-OBJECTIVE barra só DANO REAL na pergunta de qualificação:
  //   (a) empilhar 2+ perguntas de dados de famílias diferentes; (b) CPF antes da hora; (c) reperguntar dado JÁ
  //   conhecido. NÃO impõe slot rígido (avanço do funil é condução legítima). Classificação = ÚLTIMA cláusula
  //   interrogativa (reconhecer um dado antes de perguntar NÃO conta como reperguntar esse dado).
  {
    const plannedObj = (slot: string) => ({ id: `o-${slot}`, activationPlanId: "reply", effectId: "tQ:reply", type: "perguntou_dados", slot, plannedInTurnId: "tQ", expectedAnswerKinds: ["afirmacao"] });
    const dec = (muts: DecisionMutation[]): TurnDecision => ({ action: "reply", target: null, reasonCode: "answer", reasonSummary: "", confidence: 0.9, decisionMutations: muts, effectPlan: [], responsePlan: { guidance: "" }, policyChecks: [] } as unknown as TurnDecision);
    const withObj = (slot: string, extra: DecisionMutation[] = []): TurnDecision => dec([{ op: "set_planned_objective", planned: plannedObj(slot) } as unknown as DecisionMutation, ...extra]);
    const txt = (s: string): RenderedResponse => ({ draft: { parts: [{ type: "text", content: s }] }, text: s });
    const ctxQ = (state: ConversationState): TurnContext => ({ state, turnId: "tQ", leadMessage: "x", now: NOW, interpretation: { relation: "answers_pending" }, tenantCatalog: catalog, claimExtractor: extractor });
    const denies = (composed: RenderedResponse, d: TurnDecision, state: ConversationState = base()): boolean => PolicyEngine.validateResponse(composed, [], d, ctxQ(state)).some((v) => v.policyId === "POL-QUESTION-OBJECTIVE" && v.outcome === "deny");

    // (b) CPF antes da hora -> deny.
    check("P0-2 pergunta CPF (antes da hora) -> deny", denies(txt("Show! Qual o seu CPF?"), withObj("interesseVisita")));
    // (c) reperguntar dado JÁ conhecido -> deny (memória).
    const stNome = base({ slots: { ...base().slots, nome: { status: "known", value: "Douglas", confidence: 1, updatedAt: NOW } } as ConversationState["slots"] });
    check("P0-2 nome KNOWN + repergunta nome -> deny", denies(txt("Perfeito! Qual é o seu nome?"), dec([]), stNome));
    // (a) empilhar 2 perguntas de dados de famílias diferentes -> deny.
    check("P0-2 duas perguntas de dados distintas -> deny", denies(txt("Qual seu nome? E qual seu CPF?"), dec([])));
    // Família de descoberta: "modelo ou tipo" = UMA pergunta congruente -> SEM deny.
    check("P0-2 pergunta de modelo/tipo (descoberta) -> SEM deny", !denies(txt("Massa! Qual modelo ou tipo de carro você procura?"), withObj("interesse")));
    // AVANÇO do funil: objetivo 'interesse' mas o LLM pergunta um slot FALTANTE (troca) -> SEM deny (condução).
    check("P0-2 avanço: objetivo 'interesse' + pergunta 'troca' (faltante) -> SEM deny", !denies(txt("Legal! Tem algum carro para dar de troca?"), withObj("interesse")));
    // FIX DO CLASSIFICADOR (falsos positivos do eval real): reconhecer um dado ANTES de perguntar não conta como
    // reperguntar esse dado — a pergunta real é a última cláusula.
    check("P0-2 'obrigado pelo nome. Tem troca?' (nome known) -> SEM deny (pergunta real = troca)", !denies(txt("Douglas, obrigado por informar seu nome. Você tem algum carro para dar de troca?"), withObj("interesse"), stNome));
    const stLoja = base({ slots: { ...base().slots, conheceLoja: { status: "known", value: true, confidence: 1, updatedAt: NOW } } as ConversationState["slots"] });
    check("P0-2 'que bom que conhece a loja! Qual modelo?' (loja known) -> SEM deny (pergunta real = interesse)", !denies(txt("Que bom que você já conhece nossa loja! Qual modelo ou tipo de carro você procura?"), withObj("interesse"), stLoja));
    const stPag = base({ slots: { ...base().slots, formaPagamento: { status: "known", value: "financiamento", confidence: 1, updatedAt: NOW } } as ConversationState["slots"] });
    check("P0-2 'você quer financiar! Qual tipo?' (pagamento known) -> SEM deny (pergunta real = descoberta)", !denies(txt("Você mencionou que quer financiar! Qual modelo ou tipo de carro você tem interesse?"), withObj("interesse"), stPag));
    // Responder SEM perguntar (deixar a conversa fluir) NÃO é dano -> SEM deny.
    check("P0-2 responder sem pergunta -> SEM deny (não é obrigatório perguntar sempre)", !denies(txt("Beleza, anotado por aqui!"), withObj("nome")));
  }

  // POL-GROUND-PRICE (Rodada 9) — valor que o LEAD forneceu (faixa/entrada/parcela) pode ser referenciado no
  // texto ("não temos até 10 mil"); preço de VEÍCULO fora dos fatos continua negado (anti-alucinação).
  {
    const dec: TurnDecision = { action: "reply", reasonCode: "answer", reasonSummary: "", confidence: 0.8, responsePlan: { guidance: "" }, effectPlan: [], decisionMutations: [], policyChecks: [] } as unknown as TurnDecision;
    const txt = (s: string): RenderedResponse => ({ draft: { parts: [{ type: "text", content: s }] }, text: s });
    const priceDenied = (composed: RenderedResponse, state: ConversationState, facts: QueryResult[] = []): boolean =>
      PolicyEngine.validateResponse(composed, facts, dec, { state, turnId: "tGP", leadMessage: "x", now: NOW, interpretation: { relation: "answers_pending" }, tenantCatalog: catalog, claimExtractor: extractor }).some((v) => v.policyId === "POL-GROUND-PRICE" && v.outcome === "deny");
    const stEntrada = base({ slots: { ...base().slots, faixaPreco: { status: "known", value: { max: 10000 }, confidence: 1, updatedAt: NOW }, entrada: { status: "known", value: 10000, confidence: 1, updatedAt: NOW } } as ConversationState["slots"] });
    check("GP lead deu 10 mil (faixa/entrada) + texto 'até 10 mil reais' -> SEM deny", !priceDenied(txt("Douglas, no momento não temos veículos até 10 mil reais no estoque."), stEntrada));
    check("GP lead deu parcela 1.800 + texto 'parcela de 1.800' -> SEM deny", !priceDenied(txt("A parcela de 1.800 cabe no seu orçamento?"), base({ slots: { ...base().slots, parcelaDesejada: { status: "known", value: 1800, confidence: 1, updatedAt: NOW } } as ConversationState["slots"] })));
    check("GP preço de veículo inventado 'R$ 45.000' (sem fato, sem valor do lead) -> deny", priceDenied(txt("Esse custa R$ 45.000."), base()));
  }

  // R10-4 (Codex) — "mais opções esgotadas": progressão que NÃO repete texto; incrementa contador; reseta em nova oferta.
  {
    const none = { kind: "none" as const, label: "SUV" };
    const t0 = buildMoreOptionsTurnOutput(none, "t0", 0);
    const t1 = buildMoreOptionsTurnOutput(none, "t1", 1);
    const t2 = buildMoreOptionsTurnOutput(none, "t2", 2);
    const fb = (o: TurnOutput): string => o.fallbackText ?? o.composed.text;
    check("R10-4 esgotado 1x ≠ 2x (não repete texto)", fb(t0) !== fb(t1), `${fb(t0)} || ${fb(t1)}`);
    check("R10-4 esgotado 2x ≠ 3x (não repete texto)", fb(t1) !== fb(t2), `${fb(t1)} || ${fb(t2)}`);
    check("R10-4 1x ampliar PREÇO/faixa", /faixa|pre[cç]o|valor/i.test(fb(t0)), fb(t0));
    check("R10-4 2x outro TIPO", /tipo|suv|sedan|hatch|picape/i.test(fb(t1)), fb(t1));
    check("R10-4 3x conduz p/ fotos/visita/rever (fechamento)", /foto|visita|rever/i.test(fb(t2)), fb(t2));
    const bumpVal = (o: TurnOutput): number | undefined => { const m = o.decision.decisionMutations.find((x) => x.op === "set_more_options_exhausted"); return m && m.op === "set_more_options_exhausted" ? m.value : undefined; };
    check("R10-4 incrementa contador 0->1", bumpVal(t0) === 1);
    check("R10-4 incrementa contador 2->3", bumpVal(t2) === 3);
    check("R10-4 esgotado NÃO tem facts de veículo (não inventa)", t0.facts.length === 0);
    check("R10-4 esgotado passa pelo compose (needsCompose)", t0.needsCompose === true);
    const offer = buildMoreOptionsTurnOutput({ kind: "offer", label: "SUV", vehicles: [STOCK[1]], missingLabels: [] }, "t3", 2);
    check("R10-4 oferta com veículos reseta contador ->0", bumpVal(offer) === 0);
  }

  // R10-1 (Codex) — RECONCILIAÇÃO objetivo↔pergunta: o objetivo PERSISTIDO = a pergunta REALMENTE enviada.
  {
    const sendMsg = (onSuccess: unknown[] = []) => [{ kind: "send_message", planId: "reply", effectId: "tR:reply", order: 0, onSuccess }];
    const mkDec = (muts: DecisionMutation[], effectPlan: unknown[] = sendMsg()): TurnDecision =>
      ({ action: "reply", target: null, reasonCode: "answer", reasonSummary: "", confidence: 0.9, decisionMutations: muts, effectPlan, responsePlan: { guidance: "" }, policyChecks: [] } as unknown as TurnDecision);
    const plannedMut = (slot: string): DecisionMutation => ({ op: "set_planned_objective", planned: { id: `o-${slot}`, activationPlanId: "reply", effectId: "tR:reply", type: "perguntou_dados", slot, plannedInTurnId: "tR", expectedAnswerKinds: ["afirmacao"] } } as unknown as DecisionMutation);
    const recPolicy = buildSdrQualificationPolicy({ qualificationQuestions: null });
    const rec = (text: string, decision: TurnDecision, state: ConversationState = base()) => reconcileObjectiveWithQuestion({ decision, composedText: text, state, turnId: "tR", policy: recPolicy });
    const objOf = (d: TurnDecision) => d.decisionMutations.find((m) => m.op === "set_planned_objective");
    const slotOfObj = (d: TurnDecision): string | undefined => { const m = objOf(d); return m && m.op === "set_planned_objective" ? (m.planned.slot as string) : undefined; };
    // conductor "planejou" nome (mutação + activate), mas o LLM perguntou TROCA -> objetivo persistido = possuiTroca.
    const withNome = mkDec([plannedMut("nome")], sendMsg([{ op: "activate_objective", effectId: "tR:reply", plannedObjectiveId: "o-nome" }]));
    check("R10-1 planejou 'nome' mas pergunta é troca -> objetivo persistido = possuiTroca", slotOfObj(rec("Legal! Você tem carro para dar de troca?", withNome)) === "possuiTroca");
    check("R10-1 reconciliação remove o objetivo antigo do conductor (não fica 'nome')", slotOfObj(rec("Legal! Você tem carro para dar de troca?", withNome)) !== "nome");
    // 0 perguntas -> NÃO cria objetivo.
    check("R10-1 texto sem pergunta -> nenhum objetivo persistido", !objOf(rec("Perfeito, anotado por aqui!", withNome)));
    // pergunta de slot CONHECIDO -> não cria objetivo (defesa; a policy já negaria antes).
    const stNome = base({ slots: { ...base().slots, nome: { status: "known", value: "Douglas", confidence: 1, updatedAt: NOW } } as ConversationState["slots"] });
    check("R10-1 pergunta de slot conhecido -> nenhum objetivo persistido", !objOf(rec("Qual é o seu nome?", mkDec([]), stNome)));
    // objetivo pendente DIFERENTE -> supersede antes do novo.
    const stPend = base({ currentObjective: pendingObj("interesse", ["modelo"]) });
    const r4 = rec("Você tem carro para troca?", mkDec([]), stPend);
    check("R10-1 pendente 'interesse' + pergunta troca -> supersede 'o-interesse'", r4.decisionMutations.some((m) => m.op === "supersede_objective" && m.objectiveId === "o-interesse"));
    check("R10-1 pendente 'interesse' + pergunta troca -> objetivo persistido = possuiTroca", slotOfObj(r4) === "possuiTroca");
    // expectedAnswerKinds correspondem à pergunta real.
    const oN = objOf(rec("Qual é o seu nome?", mkDec([])));
    check("R10-1 expectedAnswerKinds da pergunta real (nome -> ['nome'])", oN?.op === "set_planned_objective" && JSON.stringify((oN.planned as { expectedAnswerKinds: string[] }).expectedAnswerKinds) === JSON.stringify(["nome"]));
  }

  // R10-2 (Codex) — UMA pergunta por vez: interesseVisita/diaHorario CONTAM; dado + CTA = duas perguntas -> deny.
  {
    const decR: TurnDecision = { action: "reply", target: null, reasonCode: "answer", reasonSummary: "", confidence: 0.9, decisionMutations: [], effectPlan: [], responsePlan: { guidance: "" }, policyChecks: [] } as unknown as TurnDecision;
    const txt = (s: string): RenderedResponse => ({ draft: { parts: [{ type: "text", content: s }] }, text: s });
    const ctxQ = (state: ConversationState): TurnContext => ({ state, turnId: "tQ2", leadMessage: "x", now: NOW, interpretation: { relation: "answers_pending" }, tenantCatalog: catalog, claimExtractor: extractor });
    const denies = (composed: RenderedResponse, state: ConversationState = base()): boolean => PolicyEngine.validateResponse(composed, [], decR, ctxQ(state)).some((v) => v.policyId === "POL-QUESTION-OBJECTIVE" && v.outcome === "deny");
    check("R10-2 dado + CTA de visita na mesma msg -> deny (duas perguntas)", denies(txt("Qual é o seu nome? E quer agendar uma visita?")));
    check("R10-2 duas perguntas da MESMA familia -> deny", denies(txt("Qual modelo voce procura? Prefere SUV ou hatch?")));
    check("R10-2 CPF + CTA na mesma msg -> deny mesmo quando CPF esta liberado", denies(txt("Qual o seu CPF? E qual horario prefere?"), base({ slots: { ...base().slots, formaPagamento: { status: "known", value: "financiamento", confidence: 1, updatedAt: NOW } } as ConversationState["slots"] })));
    check("R10-2 só CTA de visita (uma pergunta) -> SEM deny", !denies(txt("Encontrei ótimas opções! Quer agendar uma visita?")));
    check("R10-2 só um dado (uma pergunta) -> SEM deny", !denies(txt("Qual é o seu nome?")));
    // visita/horário já conhecidos -> não reofertar/reperguntar visita.
    const stVisita = base({ slots: { ...base().slots, interesseVisita: { status: "known", value: true, confidence: 1, updatedAt: NOW } } as ConversationState["slots"] });
    check("R10-2 interesseVisita já true + reoferta visita -> deny (não reperguntar)", denies(txt("Que ótimo! Quer agendar uma visita?"), stVisita));
    const stHorario = base({ slots: { ...base().slots, interesseVisita: { status: "known", value: true, confidence: 1, updatedAt: NOW }, diaHorario: { status: "known", value: "sábado de manhã", confidence: 1, updatedAt: NOW } } as ConversationState["slots"] });
    check("R10-2 visita/horário conhecidos + pergunta visita de novo -> deny", denies(txt("Quer mesmo agendar a visita?"), stHorario));
    // visita=true, falta só o horário -> o CONDUTOR sugere DIA/HORÁRIO (não reoferta a visita).
    const policy2 = buildSdrQualificationPolicy({ qualificationQuestions: null, agentName: "Aloan" });
    const kn = (value: unknown) => ({ status: "known" as const, value, confidence: 1, updatedAt: NOW });
    const stVisitaTrue = base({ turnNumber: 8, slots: { ...base().slots, nome: kn("Douglas"), interesse: kn("suv"), tipoVeiculo: kn("suv"), faixaPreco: kn({ max: 80000 }), formaPagamento: kn("financiamento"), entrada: kn(0), parcelaDesejada: kn(1000), possuiTroca: kn(false), cidade: kn("Taubaté"), conheceLoja: kn(true), interesseVisita: kn(true) } as ConversationState["slots"] });
    const decBase = { action: "reply", target: null, reasonCode: "continuity_conduct", reasonSummary: "", confidence: 0.8, responsePlan: { guidance: "" }, effectPlan: [], decisionMutations: [], policyChecks: [] } as unknown as TurnDecision;
    const gV = conductDecision({ decision: decBase, state: stVisitaTrue, policy: policy2, turnId: "tV" }).responsePlan.guidance;
    check("R10-2 visita=true + falta só horário -> conductor sugere DIA/HORÁRIO", /hor[aá]rio|\bdia\b/i.test(gV), gV);
    // CPF na HORA CERTA (missão SDR real): dado de FECHAMENTO — liberado SÓ ao AGENDAR a visita (interesseVisita=true
    // ou diaHorario known). Intenção de financiamento NÃO libera (pedir CPF logo após "quero financiar" é robótico).
    check("R10-2 CPF na qualificação inicial -> deny", denies(txt("Qual o seu CPF?")));
    const stFin = base({ slots: { ...base().slots, formaPagamento: { status: "known", value: "financiamento", confidence: 1, updatedAt: NOW } } as ConversationState["slots"] });
    check("R10-2 CPF só com financiamento (sem agendar) -> DENY (CPF é do fechamento)", denies(txt("Para simular o financiamento, qual o seu CPF?"), stFin));
    const stVisit = base({ slots: { ...base().slots, interesseVisita: { status: "known", value: true, confidence: 1, updatedAt: NOW } } as ConversationState["slots"] });
    check("R10-2 CPF ao AGENDAR visita (interesseVisita=true) -> SEM deny (hora certa)", !denies(txt("Show! Pra confirmar a visita, qual o seu CPF?"), stVisit));
  }

  // POL-GROUND-STOCK (R10-3 Codex) — aterramento EXATO: formatação (espaço/case) colapsa, mas modelos DISTINTOS
  // NÃO se confundem. HB20≠HB20S, Onix≠Onix Plus, C3≠C3 Aircross (vehicleKeys diferentes). Aliases só do turno.
  {
    const dec2: TurnDecision = { action: "reply", reasonCode: "answer", reasonSummary: "", confidence: 0.8, responsePlan: { guidance: "" }, effectPlan: [], decisionMutations: [], policyChecks: [] } as unknown as TurnDecision;
    const txt = (s: string): RenderedResponse => ({ draft: { parts: [{ type: "text", content: s }] }, text: s });
    // Catálogo do TENANT tem os PARES (base + variante) + Civic. O TURNO oferta SÓ os BASE (HB20, Onix, C3).
    const globalStock: VehicleFact[] = [
      { vehicleKey: "hyundai|hb20|2015", marca: "Hyundai", modelo: "HB20", ano: 2015, preco: 49990, tipo: "hatch" },
      { vehicleKey: "hyundai|hb20s|2017", marca: "Hyundai", modelo: "HB20S", ano: 2017, preco: 69990, tipo: "sedan" },
      { vehicleKey: "chevrolet|onix|2016", marca: "Chevrolet", modelo: "Onix", ano: 2016, preco: 51990, tipo: "hatch" },
      { vehicleKey: "chevrolet|onix plus|2020", marca: "Chevrolet", modelo: "Onix Plus", ano: 2020, preco: 72990, tipo: "sedan" },
      { vehicleKey: "citroen|c3|2015", marca: "Citroen", modelo: "C3", ano: 2015, preco: 47990, tipo: "hatch" },
      { vehicleKey: "citroen|c3 aircross|2021", marca: "Citroen", modelo: "C3 Aircross", ano: 2021, preco: 89990, tipo: "suv" },
      { vehicleKey: "honda|civic|2018", marca: "Honda", modelo: "Civic", ano: 2018, preco: 95000, tipo: "sedan" },
    ];
    const catG = buildTenantCatalog(globalStock);
    const extG = new CatalogClaimExtractor(catG);
    // turno oferta SÓ os base: HB20, Onix, C3.
    const factsTurn: QueryResult[] = [{ ok: true, tool: "stock_search", source: "fake", data: { items: [globalStock[0], globalStock[2], globalStock[4]], filtersUsed: {} } }];
    const gsDenied = (s: string): boolean =>
      PolicyEngine.validateResponse(txt(s), factsTurn, dec2, { state: base(), turnId: "tGS", leadMessage: "x", now: NOW, interpretation: { relation: "answers_pending" }, tenantCatalog: catG, claimExtractor: extG }).some((v) => v.policyId === "POL-GROUND-STOCK" && v.outcome === "deny");
    // EXATO aterrado -> SEM deny.
    check("GS base 'HB20' do turno -> SEM deny", !gsDenied("Gostei do HB20, ótimo hatch."));
    check("GS base 'Onix' do turno -> SEM deny", !gsDenied("O Onix é econômico."));
    check("GS base 'C3' do turno -> SEM deny", !gsDenied("O C3 é bem equipado."));
    // VARIANTE distinta NÃO é autorizada pelo base (adversarial Codex).
    check("GS turno tem HB20, texto 'HB20S' (variante) -> deny", gsDenied("Recomendo o HB20S."));
    check("GS turno tem Onix, texto 'Onix Plus' -> deny", gsDenied("Recomendo o Onix Plus."));
    check("GS turno tem C3, texto 'C3 Aircross' -> deny", gsDenied("Recomendo o C3 Aircross."));
    // Modelo de FORA do turno -> deny.
    check("GS 'Civic' (fora do turno) -> deny", gsDenied("Recomendo o Civic também."));
    // Formatação (case) NÃO quebra o exato: 'onix' minúsculo == 'Onix' do fato.
    check("GS 'onix' (case) == 'Onix' do turno -> SEM deny", !gsDenied("gostei do onix."));
    const modelClaims = (s: string): string[] => extG.extractClaims(s).filter((c) => c.kind === "model").map((c) => c.normalized);
    check("R10 claim overlap: HB20S nao fabrica claim HB20", JSON.stringify(modelClaims("HYUNDAI HB20S 2017")) === JSON.stringify(["hb20s"]), JSON.stringify(modelClaims("HYUNDAI HB20S 2017")));
    check("R10 claim overlap: Onix Plus nao fabrica claim Onix", JSON.stringify(modelClaims("CHEVROLET ONIX PLUS 2020")) === JSON.stringify(["onix plus"]), JSON.stringify(modelClaims("CHEVROLET ONIX PLUS 2020")));
    check("R10 claim overlap: C3 Aircross nao fabrica claim C3", JSON.stringify(modelClaims("CITROEN C3 AIRCROSS 2021")) === JSON.stringify(["c3 aircross"]), JSON.stringify(modelClaims("CITROEN C3 AIRCROSS 2021")));
    const separateClaims = modelClaims("HB20 ou HB20S");
    check("R10 claim overlap: mencoes separadas preservam HB20 e HB20S", separateClaims.includes("hb20") && separateClaims.includes("hb20s"), JSON.stringify(separateClaims));
  }

  // P1 (Codex) — travas via adjustDraft operam nas PARTS (preservam vehicle_offer_list), sem reescrita pós-policy.
  {
    const policy = buildSdrQualificationPolicy({ qualificationQuestions: null, agentName: "Aloan" });
    const draft = () => ({ parts: [{ type: "text" as const, content: "Encontrei estas opções:" }, { type: "vehicle_offer_list" as const, vehicleKeys: ["k1"] }, { type: "text" as const, content: "Qual é o seu nome?" }] });
    // 1º contato -> prefixa apresentação, MANTÉM o vehicle_offer_list.
    const adj = adjustDraftSafeguards(draft(), base({ turnNumber: 0 }), policy);
    check("P1 adjustDraft preserva vehicle_offer_list (não colapsa em texto puro)", adj.parts.some((p) => p.type === "vehicle_offer_list"), JSON.stringify(adj.parts.map((p) => p.type)));
    check("P1 adjustDraft prefixa a apresentação (Aloan) no 1º contato", adj.parts[0]?.type === "text" && /aloan/i.test((adj.parts[0] as { content: string }).content));
    // anti-fixação: nome perguntado 2x antes + draft pergunta nome 3ª vez -> troca a pergunta, mantém offer_list.
    const stFix = base({ turnNumber: 4, recentTurns: [{ role: "agent", text: "Qual é o seu nome?", at: NOW }, { role: "lead", text: "quero carro", at: NOW }, { role: "agent", text: "Antes, qual seu nome?", at: NOW }] });
    const adj2 = adjustDraftSafeguards(draft(), stFix, policy);
    const lastText = [...adj2.parts].reverse().find((p) => p.type === "text") as { content: string } | undefined;
    check("P1 adjustDraft anti-fixação troca a pergunta repetida (não pede nome 3ª vez)", !/qual.*seu nome/i.test(lastText?.content ?? ""), lastText?.content);
    check("P1 adjustDraft anti-fixação mantém o vehicle_offer_list", adj2.parts.some((p) => p.type === "vehicle_offer_list"));
  }

  console.log(`\n=== F2.8 REBALANCE: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) { console.error(fails.join("\n")); process.exit(1); }
}

main().catch((e) => { console.error("ERRO FATAL:", String((e as Error)?.message ?? e)); process.exit(1); });
