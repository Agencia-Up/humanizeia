// ============================================================================
// F2.40 — MISSÃO P0: Financial Question Context. Resposta a uma pergunta FINANCEIRA (parcela/entrada/pagamento) do
//   agente NUNCA vira busca de estoque. "até 1200" respondendo parcela = parcelaDesejada (não faixaPreco, não stock_search).
//   Contrato: inferExpectedAnswerContext + hasExplicitNewCommercialSearchIntent + isAnswerToFinancialQuestion.
//   PARTE 1 (PURA): helpers + extractLeadSlots. PARTE 2 (ENGINE E2E): bloqueio de tool + responseSource brain_*.
//   npx tsx tests/run-f2-40-financial-context.ts
// ============================================================================
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import {
  extractLeadSlots, inferExpectedAnswerContext, hasExplicitNewCommercialSearchIntent, isAnswerToFinancialQuestion,
  isFinancialValueDuringSelectedFinancing,
} from "../src/engine/lead-extraction.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent, AgentToolObservation } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, EffectReceipt, EffectResult } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-08T12:00:00.000Z", SHA = "sha-40";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

// Compass é o carro selecionado no fluxo da missão; todos SUV p/ a lista ser homogênea.
const COMPASS: VehicleFact = { vehicleKey: "rm:cmp", marca: "Jeep", modelo: "Compass", ano: 2017, preco: 95000, km: 60000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const CRETA: VehicleFact = { vehicleKey: "rm:creta", marca: "Hyundai", modelo: "Creta", ano: 2021, preco: 88000, km: 40000, cambio: "Automatico", cor: "Prata", tipo: "suv" };
const ONIX: VehicleFact = { vehicleKey: "rm:onix", marca: "Chevrolet", modelo: "Onix", ano: 2018, preco: 62000, km: 70000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
// Renegade também está no estoque (a loja vende) — o lead oferece o DELE na troca; o modelo é reconhecido pelo catálogo.
const RENEG: VehicleFact = { vehicleKey: "rm:reneg", marca: "Jeep", modelo: "Renegade", ano: 2020, preco: 98000, km: 45000, cambio: "Automatico", cor: "Cinza", tipo: "suv" };
const STOCK = [COMPASS, CRETA, ONIX, RENEG];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: "Rua Teste 100, Taubaté", hours: null, unit: "Icom", source: "test" }; } });

// ────────────────────────────────────────────────────────────────────────────
// PARTE 1 — PURA: helpers + extractLeadSlots (o contrato do contexto financeiro).
// ────────────────────────────────────────────────────────────────────────────
function stWith(agentText: string): ConversationState {
  const base = createInitialState({ conversationId: "c1", tenantId: TENANT, agentId: AGENT, now: NOW });
  return { ...base, recentTurns: [{ role: "agent", text: agentText } as never] };
}
// Estado de FINANCIAMENTO em andamento: carro selecionado + entrada JÁ respondida (0). Reproduz o run real onde o agente
// perguntou TROCA e o lead volunteou "até 1200" (parcela) — o valor NÃO pode virar entrada/faixaPreco/busca.
function stFinancing(agentText: string): ConversationState {
  const base = createInitialState({ conversationId: "c2", tenantId: TENANT, agentId: AGENT, now: NOW });
  return {
    ...base,
    recentTurns: [{ role: "agent", text: agentText } as never],
    vehicleContext: { focus: null, selected: { key: "rm:cmp", label: "Jeep Compass 2017" } as never },
    slots: { ...base.slots, entrada: { status: "known", value: 0, updatedAt: NOW, ref: null } as never },
  };
}
function slotsOf(agentText: string, lead: string): Record<string, unknown> {
  const muts = extractLeadSlots({ leadMessage: lead, state: stWith(agentText), interpretation: { relation: "ambiguous" } as never, claimExtractor: extractor, turnId: "t1" });
  const out: Record<string, unknown> = {};
  for (const m of muts) if (m.op === "set_slot") out[m.slot] = m.value;
  return out;
}
const PARCELA_Q = "Sem problemas, podemos ver com entrada zero. Qual parcela mensal caberia no seu orçamento?";
const ENTRADA_Q = "Você tem algum valor para dar de entrada?";
const TROCA_Q = "Você tem algum carro para dar de troca?";

function runPure(): void {
  console.log("== F2.40 PARTE 1 (pura): helpers + extractLeadSlots ==");

  // inferExpectedAnswerContext: classifica a pergunta pendente.
  check("[P-ctx-1] parcela -> {parcelaDesejada, financial}", (() => { const c = inferExpectedAnswerContext(stWith(PARCELA_Q)); return c.slot === "parcelaDesejada" && c.kind === "financial"; })());
  check("[P-ctx-2] entrada -> {entrada, financial}", (() => { const c = inferExpectedAnswerContext(stWith(ENTRADA_Q)); return c.slot === "entrada" && c.kind === "financial"; })());
  check("[P-ctx-3] troca -> {possuiTroca, trade}", (() => { const c = inferExpectedAnswerContext(stWith(TROCA_Q)); return c.kind === "trade"; })());

  // hasExplicitNewCommercialSearchIntent: só COMPRA nova explícita.
  const newIntent = (m: string): boolean => hasExplicitNewCommercialSearchIntent(m, { relation: "ambiguous" } as never, extractor);
  check("[P-new-1] 'na verdade quero Onix até 80 mil' -> intenção nova", newIntent("na verdade quero Onix até 80 mil"));
  check("[P-new-2] 'tem SUV até 80 mil?' -> intenção nova", newIntent("tem SUV até 80 mil?"));
  check("[P-new-3] 'me mostra outro carro' -> intenção nova", newIntent("me mostra outro carro"));
  check("[P-new-4] 'até 1200' NÃO é intenção nova", !newIntent("até 1200"));
  check("[P-new-5] 'tenho não' NÃO é intenção nova", !newIntent("tenho não"));
  check("[P-new-6] 'financiar' NÃO é intenção nova", !newIntent("financiar"));
  check("[P-new-7] '1200' NÃO é intenção nova", !newIntent("1200"));

  // isAnswerToFinancialQuestion.
  check("[P-ans-1] 'até 1200' responde parcela", isAnswerToFinancialQuestion("até 1200", "parcelaDesejada"));
  check("[P-ans-2] '1200' responde parcela", isAnswerToFinancialQuestion("1200", "parcelaDesejada"));
  check("[P-ans-3] 'tenho não' responde entrada", isAnswerToFinancialQuestion("tenho não", "entrada"));
  check("[P-ans-4] 'financiar' responde pagamento", isAnswerToFinancialQuestion("financiar", "formaPagamento"));
  check("[P-ans-5] pergunta ('qual o preço?') NÃO é resposta financeira", !isAnswerToFinancialQuestion("qual o preço?", "parcelaDesejada"));
  check("[P-ans-6] sem contexto financeiro pendente -> false", !isAnswerToFinancialQuestion("até 1200", "interesse"));

  check("[P-progress-1] financiamento em andamento + 'Ate 2100 ta bom' -> resposta financeira mesmo sem slot pendente", isFinancialValueDuringSelectedFinancing("Ate 2100 ta bom", stFinancing("Beleza, vamos seguir."), { relation: "ambiguous" } as never, extractor));
  check("[P-progress-2] financiamento em andamento + compra nova explicita ainda vence", !isFinancialValueDuringSelectedFinancing("na verdade quero Onix ate 80 mil", stFinancing("Beleza, vamos seguir."), { relation: "ambiguous" } as never, extractor));
  check("[P-progress-3] financiamento em andamento + 'Compass 2019' (ref. a veículo) -> NÃO é resposta financeira (ano/carro)", !isFinancialValueDuringSelectedFinancing("Compass 2019", stFinancing("Beleza, vamos seguir."), { relation: "ambiguous" } as never, extractor));
  check("[P-progress-4] financiamento em andamento + '2100' pelado -> resposta financeira (ano vira valor no contexto)", isFinancialValueDuringSelectedFinancing("2100", stFinancing("Beleza, vamos seguir."), { relation: "ambiguous" } as never, extractor));
  // extractLeadSlots — CASO 1: "até 1200" respondendo parcela -> parcelaDesejada=1200, faixaPreco NÃO setado.
  {
    const s = slotsOf(PARCELA_Q, "até 1200");
    check("[E1] parcelaDesejada=1200", s.parcelaDesejada === 1200, JSON.stringify(s));
    check("[E1b] faixaPreco NÃO setado (não vira 1200)", s.faixaPreco === undefined, JSON.stringify(s));
  }
  // CASO E: "1200" (sem "até") respondendo parcela -> parcelaDesejada=1200.
  {
    const s = slotsOf(PARCELA_Q, "1200");
    check("[E-E] '1200' -> parcelaDesejada=1200, sem faixaPreco", s.parcelaDesejada === 1200 && s.faixaPreco === undefined, JSON.stringify(s));
  }
  // CASO 2: "tenho não" respondendo entrada -> entrada=0, sem faixaPreco/parcela.
  {
    const s = slotsOf(ENTRADA_Q, "tenho não");
    check("[E2] entrada=0", s.entrada === 0, JSON.stringify(s));
    check("[E2b] sem faixaPreco/parcela", s.faixaPreco === undefined && s.parcelaDesejada === undefined, JSON.stringify(s));
  }
  // CASO 3: "Tenho um Renegade 2019 86km" respondendo troca -> possuiTroca + veiculoTroca, sem interesse contaminado.
  {
    const s = slotsOf(TROCA_Q, "Tenho um Renegade 2019 86km");
    const vt = JSON.stringify(s.veiculoTroca ?? "");
    check("[E3] possuiTroca=true + veiculoTroca=Renegade/2019/86000", s.possuiTroca === true && has(vt, "renegade") && vt.includes("2019") && vt.includes("86000"), JSON.stringify(s));
    check("[E3b] interesse de compra NÃO contaminado com renegade", !has(JSON.stringify(s.interesse ?? ""), "renegade"), JSON.stringify(s));
  }
  // CASO 4: "na verdade quero Onix até 80 mil" respondendo parcela -> intenção nova VENCE: faixaPreco=80000, NÃO parcela.
  {
    const s = slotsOf(PARCELA_Q, "na verdade quero Onix até 80 mil");
    const fp = s.faixaPreco as { max?: number } | undefined;
    check("[E4] parcelaDesejada NÃO vira 80000", s.parcelaDesejada === undefined, JSON.stringify(s));
    check("[E4b] faixaPreco.max=80000 + interesse=onix (compra nova)", fp?.max === 80000 && has(JSON.stringify(s.interesse ?? ""), "onix"), JSON.stringify(s));
  }
  // CASO REAL: financiamento em andamento (carro selecionado + entrada=0), agente perguntou TROCA, lead volunteia "até 1200"
  //  -> é PARCELA (mensal), NUNCA entrada (já respondida) nem faixaPreco (orçamento de compra) nem busca.
  {
    const muts = extractLeadSlots({ leadMessage: "até 1200", state: stFinancing("Você tem algum carro para dar de troca?"), interpretation: { relation: "ambiguous" } as never, claimExtractor: extractor, turnId: "t1" });
    const out: Record<string, unknown> = {};
    for (const m of muts) if (m.op === "set_slot") out[m.slot] = m.value;
    check("[E-fin] 'até 1200' (pergunta troca pendente + financiamento) -> parcelaDesejada=1200, NÃO entrada/faixaPreco", out.parcelaDesejada === 1200 && out.entrada === undefined && out.faixaPreco === undefined, JSON.stringify(out));
  }
  // ⭐MISSÃO "Até 2100" — valor no range de ANO (1900-2100) respondendo parcela = parcelaDesejada, faixaPreco NÃO setado.
  {
    const s = slotsOf(PARCELA_Q, "Até 2100 ta bom");
    check("[E-2100] 'Até 2100 ta bom' respondendo parcela -> parcelaDesejada=2100", s.parcelaDesejada === 2100, JSON.stringify(s));
    check("[E-2100b] faixaPreco NÃO setado (2100 não é teto de compra)", s.faixaPreco === undefined, JSON.stringify(s));
  }
  { const s = slotsOf(PARCELA_Q, "2100"); check("[E-2100c] '2100' pelado respondendo parcela -> parcelaDesejada=2100, sem faixaPreco", s.parcelaDesejada === 2100 && s.faixaPreco === undefined, JSON.stringify(s)); }
  { const s = slotsOf(PARCELA_Q, "uns 2100"); check("[E-2100d] 'uns 2100' respondendo parcela -> parcelaDesejada=2100", s.parcelaDesejada === 2100, JSON.stringify(s)); }
  { const s = slotsOf(PARCELA_Q, "até 2.100"); check("[E-2100e] 'até 2.100' (com separador) -> parcelaDesejada=2100", s.parcelaDesejada === 2100 && s.faixaPreco === undefined, JSON.stringify(s)); }
  // "Tenho 8k" respondendo entrada -> entrada=8000, faixaPreco NÃO setado.
  { const s = slotsOf(ENTRADA_Q, "Tenho 8k"); check("[E-8k] 'Tenho 8k' respondendo entrada -> entrada=8000, sem faixaPreco", s.entrada === 8000 && s.faixaPreco === undefined, JSON.stringify(s)); }
  // CASO ANO (não abrir brecha): "Compass 2019" respondendo parcela NÃO vira valor financeiro 2019 (é ano do carro).
  { const s = slotsOf(PARCELA_Q, "Compass 2019"); check("[E-ano] 'Compass 2019' -> parcelaDesejada NÃO vira 2019 (fica ano)", s.parcelaDesejada !== 2019, JSON.stringify(s)); }
  { const s = slotsOf(PARCELA_Q, "Onix 2020"); check("[E-ano-b] 'Onix 2020' -> parcelaDesejada NÃO vira 2020", s.parcelaDesejada !== 2020, JSON.stringify(s)); }
  // REGRESSÃO busca: "quero pickup até 90 mil" continua orçamento de COMPRA (faixaPreco), não parcela.
  { const s = slotsOf(PARCELA_Q, "quero pickup até 90 mil"); const fp = s.faixaPreco as { max?: number } | undefined; check("[E-busca] 'quero pickup até 90 mil' -> faixaPreco.max=90000 (compra), NÃO parcela", fp?.max === 90000 && s.parcelaDesejada === undefined, JSON.stringify(s)); }
}

// ────────────────────────────────────────────────────────────────────────────
// PARTE 2 — ENGINE E2E: bloqueio de tool comercial + responseSource brain_* (harness estilo F2.39).
// ────────────────────────────────────────────────────────────────────────────
const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { marca?: string; modelo?: string; tipo?: string; precoMax?: number; anos?: number[]; excludeKeys?: string[]; broad?: boolean };
    let items = STOCK.slice();
    if (inp.marca) { const m = norm(inp.marca); items = items.filter((v) => norm(v.marca).includes(m) || m.includes(norm(v.marca))); }
    if (inp.modelo) { const toks = norm(inp.modelo).split(/\s+/).filter(Boolean); items = items.filter((v) => { const vt = norm(`${v.marca} ${v.modelo}`); return inp.broad ? toks.some((t) => vt.includes(t)) : toks.every((t) => vt.includes(t)); }); }
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (typeof inp.precoMax === "number") items = items.filter((v) => (v.preco ?? Infinity) <= inp.precoMax!);
    if (Array.isArray(inp.anos) && inp.anos.length > 0) items = items.filter((v) => inp.anos!.includes(v.ano));
    if (inp.excludeKeys) items = items.filter((v) => !inp.excludeKeys!.includes(v.vehicleKey));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; } }

const U = (primaryIntent: PrimaryIntent): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [] });
const searchSuvU: TurnUnderstanding = { primaryIntent: "search_stock", requestedCapabilities: ["stock_search"], subject: "vehicle_type", subjectValue: "suv", subjectSource: "current_turn", evidence: [{ capability: "stock_search", quote: "suv" }], isTopicChange: false, answeredLeadQuestions: [] };
const selectU: TurnUnderstanding = { primaryIntent: "select_vehicle", requestedCapabilities: ["select"], subject: "ordinal_from_last_offer", subjectValue: "1", subjectSource: "current_turn", evidence: [{ capability: "select", quote: "primeiro" }], isTopicChange: false, answeredLeadQuestions: [] };
const searchOnixU: TurnUnderstanding = { primaryIntent: "search_stock", requestedCapabilities: ["stock_search"], subject: "explicit_model", subjectValue: "onix", subjectSource: "current_turn", evidence: [{ capability: "stock_search", quote: "onix" }], isTopicChange: false, answeredLeadQuestions: [] };
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
function finU(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
function finUM(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding, stateMutations: AgentBrainDecision["stateMutations"]): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations } as AgentBrainDecision };
}
function qU(call: { tool: string; input: Record<string, unknown> }, u: TurnUnderstanding): AgentBrainStep { return { kind: "query", call: call as never, understanding: u } as AgentBrainStep; }

// Cérebro lista SUVs; depois seleciona o primeiro (Compass); depois pergunta parcela.
const listSuv: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => {
  const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
  if (!so) return qU({ tool: "stock_search", input: { tipo: "suv" } }, searchSuvU);
  return finU([txt("Encontrei estas opções:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart], "reply", searchSuvU);
};
const selectFirst: BrainResponder = () => finU([txt("Ótima escolha! O Jeep Compass 2017 é uma baita opção. Quer que eu já te passe as condições?")], "reply", selectU);
const askParcela: BrainResponder = () => finU([txt("Perfeito! Para montar as condições, qual parcela mensal caberia no seu orçamento?")], "reply", U("financing"));
// Cérebro que, num turno de resposta financeira, TENTA stock_search (o bug); ao ver o bloqueio, CONDUZ sem buscar.
// ⭐Codex rodada 2 (proveniência temporal): o final de CONDUÇÃO precisa de evidence do BLOCO ATUAL — sem quote,
// o reconcile mantém a base herdada (searchSuvU) e o deny UNDERSTANDING_STALE descarta a decisão (correto).
const finConductU = (quote: string): TurnUnderstanding => ({ primaryIntent: "financing", requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [{ capability: null, quote }] as never, isTopicChange: false, answeredLeadQuestions: [] });
const financialTryThenConduct: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => {
  const blocked = obs.some((o) => o.tool === "response" && !o.ok);
  if (!blocked) return qU({ tool: "stock_search", input: { tipo: "suv", precoMax: 1200 } }, searchSuvU);
  return finU([txt("Show! Com essa parcela dá pra montar um plano bacana pra você. Você tem algum carro pra dar na troca?")], "reply", finConductU(_f.block.slice(0, 30)));
};
// Resposta de entrada "tenho não": cérebro conduz sem buscar.
const entradaConduct: BrainResponder = () => finU([txt("Sem problemas, seguimos com entrada zero. Qual parcela mensal caberia pra você?")], "reply", U("financing"));
// Caso F: cérebro tenta pergunta DUPLA ("entrada ou financiar?"); ao ser negado, reautora com UMA pergunta.
// ⭐RD1-2: "uma pergunta financeira por vez" é ADVISORY. A LLM advertida faz UMA pergunta de 1ª; o engine ENTREGA (brain_final).
const singleFin: BrainResponder = () => finU([txt("Perfeito! Você tem algum valor para dar de entrada?")], "reply", U("financing"));
// Mudança de intenção: "na verdade quero Onix até 80 mil" -> busca de verdade.
const searchOnix: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => {
  const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
  if (!so) return qU({ tool: "stock_search", input: { modelo: "Onix", precoMax: 80000 } }, searchOnixU);
  return finU([txt("Encontrei estas opções:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart], "reply", searchOnixU);
};

type Slots = ConversationState["slots"];
type Cap = { outbox: string; committed: boolean; stockCalls: number; stockObs: number; terminalSafe: boolean; primaryIntent: string | null; stockInput: Record<string, unknown> | null; src: string | null; slots: Slots | null };
async function turn(persistence: InMemoryPersistence, clock: FakeClock, brain: ScriptedAgentBrain, preparer: RelPreparer, convId: string, seq: number, lead: string, responder: BrainResponder): Promise<Cap> {
  executed.length = 0; brain.setResponder(responder);
  await persistence.tryInsert({ eventId: `${convId}-e${seq}`, conversationId: convId, raw: redact({ text: lead }), receivedAt: clock.now() });
  clock.advance(1000);
  const turnId = `${convId}-t${seq}`;
  const r: CentralTurnResult = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: preparer,
    conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
    limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 3, brainMaxSteps: 8, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
  });
  while (true) {
    const claimed = await persistence.claimOutbox(convId, "w", 60_000, 25);
    if (claimed.length === 0) break;
    for (const rec of claimed as unknown as { effectId: string; kind: string }[]) {
      const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev-${rec.effectId}`, at: clock.now() };
      const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
      await commitEffectOutcome({ persistence, clock, conversationId: convId, effectId: rec.effectId, result });
      if (rec.kind === "send_media") await applyAcceptedPhotoActionOutcome({ persistence, conversationId: convId, effectId: rec.effectId, result });
    }
  }
  const stocks = executed.filter((e) => e.tool === "stock_search");
  const stockObs = r.status === "committed" ? r.toolObservations.filter((o) => o.tool === "stock_search").length : 0;
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed",
    stockCalls: stocks.length, stockObs, terminalSafe: r.status === "committed" ? r.terminalSafe : false,
    primaryIntent: r.status === "committed" ? r.understanding.primaryIntent : null,
    stockInput: stocks.length > 0 ? (stocks[stocks.length - 1].input as Record<string, unknown>) : null,
    src: r.status === "committed" ? (r.responseSource ?? null) : null,
    slots: persistence.load(convId)?.state.slots ?? null,
  };
}
let seq0 = 0;
function conv() {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `wa:f40_${seq0++}`; let s = 0;
  const t = (lead: string, responder: BrainResponder): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, responder);
  return { t };
}
// Fluxo até ter Compass SELECIONADO + última pergunta do agente sendo a financeira desejada.
async function selectedCompassThenAsk(askResponder: BrainResponder): Promise<ReturnType<typeof conv>> {
  const c = conv();
  await c.t("quero SUV", listSuv);              // T1: lista SUVs (Compass primeiro)
  await c.t("gostei do primeiro", selectFirst);  // T2: seleciona Compass
  await c.t("quais as condições?", askResponder); // T3: agente pergunta (parcela/entrada)
  return c;
}

async function runEngine(): Promise<void> {
  console.log("== F2.40 PARTE 2 (engine E2E): bloqueio de tool + brain_* ==");

  // CASO 1 E2E: parcela pendente + "até 1200" -> stock_search=0, parcelaDesejada=1200, faixaPreco não setado, brain_*.
  {
    const c = await selectedCompassThenAsk(askParcela);
    const t = await c.t("até 1200", financialTryThenConduct);
    check("[G1] 'até 1200' -> 0 stock_search (engine bloqueia)", t.stockCalls === 0 && t.stockObs === 0, `calls=${t.stockCalls} obs=${t.stockObs}`);
    check("[G1b] parcelaDesejada=1200", t.slots?.parcelaDesejada.status === "known" && t.slots?.parcelaDesejada.value === 1200, JSON.stringify(t.slots?.parcelaDesejada));
    check("[G1c] faixaPreco NÃO virou 1200", t.slots?.faixaPreco.status !== "known", JSON.stringify(t.slots?.faixaPreco));
    check("[G1d] responseSource brain_final/brain_retry (a LLM conduz)", t.src === "brain_final" || t.src === "brain_retry", `src=${t.src}`);
    check("[G1e] primaryIntent=financing (não search_stock)", t.primaryIntent === "financing", `intent=${t.primaryIntent}`);
    check("[G1f] não caiu em terminalSafe", !t.terminalSafe, `terminalSafe=${t.terminalSafe}`);
  }

  // CASO 2 E2E: entrada pendente + "tenho não" -> entrada=0, stock_search=0, brain_*.
  {
    const c = await selectedCompassThenAsk(() => finU([txt("Você tem algum valor para dar de entrada?")], "reply", U("financing")));
    const t = await c.t("tenho não", entradaConduct);
    check("[G2] 'tenho não' -> 0 stock_search", t.stockCalls === 0 && t.stockObs === 0, `calls=${t.stockCalls} obs=${t.stockObs}`);
    check("[G2b] entrada=0", t.slots?.entrada.status === "known" && t.slots?.entrada.value === 0, JSON.stringify(t.slots?.entrada));
    check("[G2c] responseSource brain_*", t.src === "brain_final" || t.src === "brain_retry", `src=${t.src}`);
  }

  // CASO 4 E2E: parcela pendente + "na verdade quero Onix até 80 mil" -> intenção nova VENCE: stock_search=1 (Onix/80000).
  {
    const c = await selectedCompassThenAsk(askParcela);
    const t = await c.t("na verdade quero Onix até 80 mil", searchOnix);
    check("[G4] intenção nova -> stock_search roda (1x)", t.stockCalls === 1, `calls=${t.stockCalls} input=${JSON.stringify(t.stockInput)}`);
    check("[G4b] input modelo=Onix + precoMax=80000", has(JSON.stringify(t.stockInput ?? {}), "onix") && JSON.stringify(t.stockInput ?? {}).includes("80000"), JSON.stringify(t.stockInput));
    check("[G4c] parcelaDesejada NÃO virou 80000", t.slots?.parcelaDesejada.value !== 80000, JSON.stringify(t.slots?.parcelaDesejada));
  }

  // CASO 5 E2E: pergunta financeira DUPLA ("entrada ou financiar?") -> engine NEGA -> a LLM reautora com UMA pergunta.
  {
    const c = conv();
    await c.t("quero SUV", listSuv);
    await c.t("gostei do primeiro", selectFirst);
    const t = await c.t("quais as condições?", singleFin);
    check("[G5] LLM conduz financiamento com UMA pergunta (brain_final, sem fallback)", t.src === "brain_final", `src=${t.src}`);
    check("[G5b] texto final tem UMA pergunta financeira (não entrada E financiamento juntos)", t.committed && !(has(t.outbox, "entrada") && has(t.outbox, "financ")), `outbox="${t.outbox}"`);
  }

  // CASO REAL: o lead nao tem uma parcela ideal. A LLM registra a ausencia de
  // preferencia no slot pendente e avanca; nao repete a mesma pergunta.
  {
    const c = await selectedCompassThenAsk(askParcela);
    const declineParcela: BrainResponder = (frame) => finUM(
      [txt("Sem problema, a simulacao pode definir a parcela. Vou seguir com os demais dados.")],
      "financial_preference_declined",
      finConductU(frame.block.slice(0, 40)),
      [{ op: "decline_slot", slot: "parcelaDesejada", sourceTurnId: frame.turnId }] as never,
    );
    const t = await c.t("nao sei, depende do financiamento", declineParcela);
    check("[G1g] ausencia de preferencia de parcela vira slot declined", t.slots?.parcelaDesejada.status === "declined", JSON.stringify(t.slots?.parcelaDesejada));
    check("[G1h] ausencia de preferencia nao busca estoque", t.stockCalls === 0 && t.stockObs === 0, `calls=${t.stockCalls} obs=${t.stockObs}`);
    check("[G1i] LLM acolhe e avanca sem repetir a pergunta", /^brain_/.test(t.src ?? "") && !has(t.outbox, "qual parcela"), `src=${t.src} outbox=${JSON.stringify(t.outbox)}`);
  }

  // Se o lead informar um valor explicito, o fato novo substitui a ausencia.
  // Uma resposta que contradiga o slot conhecido e negada e volta para a LLM.
  {
    const c = await selectedCompassThenAsk(askParcela);
    let attempt = 0;
    const contradictThenCorrect: BrainResponder = (frame) => {
      attempt += 1;
      return attempt === 1
        ? finU([txt("Como voce nao tem uma parcela ideal definida, vou chamar o consultor.")], "wrong_financial_echo", finConductU(frame.block.slice(0, 40)))
        : finU([txt("Anotei a parcela de ate R$ 2.000. Vou seguir com a qualificacao.")], "financial_value_ack", finConductU(frame.block.slice(0, 40)));
    };
    const t = await c.t("ate 2k ta bom", contradictThenCorrect);
    check("[G1j] 'ate 2k' grava parcela=2000", t.slots?.parcelaDesejada.status === "known" && t.slots?.parcelaDesejada.value === 2000, JSON.stringify(t.slots?.parcelaDesejada));
    check("[G1k] contradicao ao valor conhecido e negada e reautora pela LLM", t.src === "brain_retry" && has(t.outbox, "2.000"), `src=${t.src} outbox=${JSON.stringify(t.outbox)}`);
  }

  // CASO ENCODING (incidente real): a gpt-4.1-mini emite a resposta com CARACTERES DE CONTROLE embutidos (corrompida) ->
  //  o engine REJEITA -> a LLM REAUTORA limpo (brain_retry) -> o texto final NAO tem caracteres de controle.
  {
    const c = conv();
    const corruptThenClean: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => obs.some((o) => o.tool === "response" && !o.ok)
      ? finU([txt("Ola! Eu sou o Carvalho, consultor da Icom. Voce e de Taubate mesmo? Qual modelo, tipo de carro ou faixa de preco voce procura?")], "reply", U("other"))   // retry: limpo e abertura SDR valida
      : finU([txt("Ola! Eu sou o Carvalho " + String.fromCharCode(0x1f,0x1f) + "Voc" + String.fromCharCode(0) + "ê é de Taubaté?")], "reply", U("other"));   // 1a: corrompido (controle)
    const t = await c.t("Boa tarde", corruptThenClean);
    const hasCtrl = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/.test(t.outbox);
    check("[G-enc] resposta com caracteres de controle -> engine rejeita -> reautora (brain_retry)", t.src === "brain_retry", `src=${t.src}`);
    check("[G-enc-b] texto final LIMPO (sem caracteres de controle)", t.committed && !hasCtrl && has(t.outbox, "Taubate"), `outbox=${JSON.stringify(t.outbox)}`);
  }

  // CASO ENCODING B (incidente real do WhatsApp): mojibake visível ("Voceaa e9... Taubate9... je1") é reparado no
  // chokepoint final de saída. Não é decisão comercial, é limpeza de encoding do payload/texto persistido.
  {
    const c = conv();
    const visibleMojibake: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => obs.some((o) => o.tool === "response" && !o.ok)
      ? finU([txt("Boa tarde! Olá, eu sou o Carvalho, consultor aqui da Icom Motors. Você é de Taubaté mesmo ou já conhece a nossa loja? Qual modelo, tipo de carro ou faixa de preço você procura?")], "reply", U("other"))
      : finU([txt("Boa tarde! Ola eu sou o Carvalho, consultor aqui de IA da Icom Motors Voceaa e9 aqui de Taubate9 mesmo je1 conhece a nossa loja? Qual modelo, tipo de carro ou faixa de preco voce procura?")], "reply", U("other"));
    const t = await c.t("Boa tarde", visibleMojibake);
    const leaked = /Voceaa|\be9\b|Taubate9|je1/.test(t.outbox);
    check("[G-enc-c] mojibake visível reparado antes do WhatsApp", t.committed && !leaked, `outbox=${JSON.stringify(t.outbox)}`);
    check("[G-enc-d] nenhuma forma mojibake chega ao texto final", t.committed && !/Voceaa|\be9\b|Taubate9|je1/.test(t.outbox), `outbox=${JSON.stringify(t.outbox)}`);
  }

  // ⭐MISSÃO — E2E do print: quero SUV -> gostei do primeiro -> quais as condições? -> Tenho 8k -> Até 2100 ta bom.
  //  No último turno "Até 2100 ta bom" (parcela): 0 stock_search/details/photos, parcelaDesejada=2100, entrada=8000
  //  preservada, faixaPreco NÃO vira 2100, primaryIntent != search_stock, brain_final/brain_retry.
  {
    const c = conv();
    await c.t("quero SUV", listSuv);
    await c.t("gostei do primeiro", selectFirst);
    await c.t("quais as condicoes?", () => finU([txt("Perfeito! Você tem algum valor para dar de entrada?")], "reply", U("financing")));
    const t4 = await c.t("Tenho 8k", () => finU([txt("Ótimo! Qual parcela mensal caberia para você?")], "reply", U("financing")));
    // No turno da parcela o cérebro TENTA buscar estoque (o bug do print); ao ser bloqueado, conduz o financiamento.
    const parcelaTryThenConduct: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => obs.some((o) => o.tool === "response" && !o.ok)
      ? finU([txt("Show! Com essa parcela dá pra montar um plano bacana. Posso já simular o financiamento pra você?")], "reply", finConductU(_f.block.slice(0, 30)))
      : qU({ tool: "stock_search", input: { tipo: "pickup", precoMax: 2100 } }, searchSuvU);
    const t5 = await c.t("Até 2100 ta bom", parcelaTryThenConduct);
    check("[G-2100-T4] 'Tenho 8k' -> entrada=8000 (0 stock_search)", t4.slots?.entrada.value === 8000 && t4.stockCalls === 0, `entrada=${JSON.stringify(t4.slots?.entrada)} stock=${t4.stockCalls}`);
    check("[G-2100-a] 'Até 2100 ta bom' -> 0 stock_search (engine bloqueia)", t5.stockCalls === 0 && t5.stockObs === 0, `calls=${t5.stockCalls} obs=${t5.stockObs}`);
    check("[G-2100-b] parcelaDesejada=2100", t5.slots?.parcelaDesejada.status === "known" && t5.slots?.parcelaDesejada.value === 2100, JSON.stringify(t5.slots?.parcelaDesejada));
    check("[G-2100-c] entrada=8000 preservada", t5.slots?.entrada.value === 8000, JSON.stringify(t5.slots?.entrada));
    check("[G-2100-d] faixaPreco NÃO virou 2100", (t5.slots?.faixaPreco.value as { max?: number } | undefined)?.max !== 2100, JSON.stringify(t5.slots?.faixaPreco));
    check("[G-2100-e] primaryIntent NÃO é search_stock (=financing)", t5.primaryIntent !== "search_stock", `intent=${t5.primaryIntent}`);
    check("[G-2100-f] responseSource brain_final/brain_retry", t5.src === "brain_final" || t5.src === "brain_retry", `src=${t5.src}`);
    check("[G-2100-g] não caiu em terminalSafe", !t5.terminalSafe, `terminalSafe=${t5.terminalSafe}`);
  }
}

async function main(): Promise<void> {
  runPure();
  await runEngine();
  console.log(`\n== F2.40: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("\nFALHAS:\n" + fails.map((f) => `  - ${f}`).join("\n")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
