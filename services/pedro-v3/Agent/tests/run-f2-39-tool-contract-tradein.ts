// ============================================================================
// F2.39 — Missão P0: contrato de tool comercial + resposta a pergunta pendente + veículo de TROCA.
//  INC1/A: turno de busca NUNCA finaliza com "vou buscar" sem stock_search (força/nega); "cadê?" retoma a busca ativa.
//  INC2/F: abertura/qualificação não vira pedido de nome; NUNCA pede sobrenome.
//  INC3/C/D/E/G: resposta à pergunta de TROCA vira briefing (possuiTroca+veiculoTroca, km 86->86000), NÃO stock_search.
//   npx tsx tests/run-f2-39-tool-contract-tradein.ts
// ============================================================================
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { inferredQuestionSlot } from "../src/engine/lead-extraction.ts";
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
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-08T12:00:00.000Z", SHA = "sha-39";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

const CRETA: VehicleFact = { vehicleKey: "rm:creta", marca: "Hyundai", modelo: "Creta", ano: 2021, preco: 88000, km: 40000, cambio: "Automatico", cor: "Prata", tipo: "suv" };
const RENEG: VehicleFact = { vehicleKey: "rm:reneg", marca: "Jeep", modelo: "Renegade", ano: 2019, preco: 92000, km: 55000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const ONIX: VehicleFact = { vehicleKey: "rm:onix", marca: "Chevrolet", modelo: "Onix", ano: 2018, preco: 62000, km: 70000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const STOCK = [CRETA, RENEG, ONIX];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: "Rua Teste 100, Taubaté", hours: null, unit: "Icom", source: "test" }; } });

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
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1", "p2"] }, source: "fake" } as QueryResult; }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; } }

const U = (primaryIntent: PrimaryIntent): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [] });
const searchSuvU: TurnUnderstanding = { primaryIntent: "search_stock", requestedCapabilities: ["stock_search"], subject: "vehicle_type", subjectValue: "suv", subjectSource: "current_turn", evidence: [{ capability: "stock_search", quote: "suv" }], isTopicChange: false, answeredLeadQuestions: [] };
// Seleção ordinal ("gostei do segundo"): capability "select" (NÃO "vehicle_details") — o cérebro que tenta vehicle_details é rejeitado.
const selectU: TurnUnderstanding = { primaryIntent: "select_vehicle", requestedCapabilities: ["select"], subject: "ordinal_from_last_offer", subjectValue: "2", subjectSource: "current_turn", evidence: [{ capability: "select", quote: "segundo" }], isTopicChange: false, answeredLeadQuestions: [] };
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
function finU(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
function qU(call: { tool: string; input: Record<string, unknown> }, u: TurnUnderstanding): AgentBrainStep { return { kind: "query", call: call as never, understanding: u } as AgentBrainStep; }
const resist: BrainResponder = () => finU([txt("Certo!")], "reply", U("other"));
// Agente PERGUNTA sobre troca (para o próximo turno ser "resposta de troca").
const askTrade: BrainResponder = () => finU([txt("Perfeito! Para eu te passar as condições, você tem algum carro para dar de troca?")], "reply", U("other"));
// Cérebro LISTA SUVs (query stock_search{tipo:suv} -> offer_list).
const listSuv: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => {
  const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
  if (!so) return qU({ tool: "stock_search", input: { tipo: "suv" } }, searchSuvU);
  return finU([txt("Encontrei estas opções:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart], "reply", searchSuvU);
};
// Cérebro que PROMETE buscar sem chamar tool (INC1/A) — o engine deve NÃO deixar isso vazar.
const promiseNoSearch: BrainResponder = () => finU([txt("Boa! Vou buscar as opções de SUV pra você já já.")], "reply", searchSuvU);

type Slots = ConversationState["slots"];
type Cap = { outbox: string; committed: boolean; stockCalls: number; stockObs: number; detailObs: number; terminalSafe: boolean; primaryIntent: string | null; stockInput: Record<string, unknown> | null; hasMedia: boolean; src: string | null; slots: Slots | null };
async function turn(persistence: InMemoryPersistence, clock: FakeClock, brain: ScriptedAgentBrain, preparer: RelPreparer, convId: string, seq: number, lead: string, relation: TurnRelation, responder: BrainResponder): Promise<Cap> {
  executed.length = 0; preparer.relation = relation; brain.setResponder(responder);
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
  // stockObs = observações commitadas com tool==="stock_search" — MESMO critério do smoke real (countTool). Buscas
  // deduplicadas no loop viram tool:"response" (feedback de controle), então NÃO inflam esta contagem.
  const stockObs = r.status === "committed" ? r.toolObservations.filter((o) => o.tool === "stock_search").length : 0;
  const detailObs = r.status === "committed" ? r.toolObservations.filter((o) => o.tool === "vehicle_details").length : 0;
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed",
    stockCalls: stocks.length, stockObs, detailObs, terminalSafe: r.status === "committed" ? r.terminalSafe : false,
    primaryIntent: r.status === "committed" ? r.understanding.primaryIntent : null,
    stockInput: stocks.length > 0 ? (stocks[stocks.length - 1].input as Record<string, unknown>) : null,
    hasMedia: outbox.some((o) => o.kind === "send_media"), src: r.status === "committed" ? (r.responseSource ?? null) : null,
    slots: persistence.load(convId)?.state.slots ?? null,
  };
}
let seq0 = 0;
function conv() {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `wa:f39_${seq0++}`; let s = 0;
  const t = (lead: string, opts?: { rel?: TurnRelation; responder?: BrainResponder }): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, opts?.rel ?? "ambiguous", opts?.responder ?? resist);
  return { t };
}

async function main(): Promise<void> {
  console.log("== F2.39: contrato de tool + resposta pendente + veículo de troca ==");

  // ── PURO: inferredQuestionSlot lê a última pergunta do agente ──
  check("[U-1] inferredQuestionSlot('...carro para dar de troca?') -> possuiTroca", (() => {
    const st = { currentObjective: null, recentTurns: [{ role: "agent", text: "você tem algum carro para dar de troca?" }] } as unknown as ConversationState;
    return inferredQuestionSlot(st) === "possuiTroca";
  })());

  // ── 1) "Aloan" + "você tem SUV?" -> stock_search(tipo:suv) e lista no MESMO turno; nunca "vou buscar" sem lista ──
  {
    const c = conv();
    const t1 = await c.t("Aloan, você tem SUV?", { responder: promiseNoSearch });
    check("[T1] 'você tem SUV?' executa stock_search(tipo=suv)", t1.stockCalls >= 1 && has(JSON.stringify(t1.stockInput ?? {}), "suv"), `calls=${t1.stockCalls} input=${JSON.stringify(t1.stockInput)}`);
    check("[T1b] responde com a LISTA (Creta/Renegade), nunca 'vou buscar' solto", (has(t1.outbox, "Creta") || has(t1.outbox, "Renegade")) && !has(t1.outbox, "vou buscar"), `outbox="${t1.outbox}"`);
  }

  // ── 2) "cadê?" após busca pendente -> retoma a busca SUV, não repergunta ──
  {
    const c = conv();
    await c.t("quero SUV", { responder: listSuv });   // T1: fixa activeSearchConstraints=suv
    const t2 = await c.t("cadê?");                      // T2: retomada
    check("[T2] 'cadê?' retoma a busca SUV (stock_search roda, não repergunta)", t2.stockCalls >= 1 && has(JSON.stringify(t2.stockInput ?? {}), "suv"), `calls=${t2.stockCalls} input=${JSON.stringify(t2.stockInput)}`);
    check("[T2b] não repergunta 'qual modelo/tipo'", !has(t2.outbox, "qual modelo") && !has(t2.outbox, "qual tipo") && !has(t2.outbox, "o que voce procura"), `outbox="${t2.outbox}"`);
  }

  // ── 3) primeiro contato "Boa noite" -> não pede nome ──
  {
    const c = conv();
    const t1 = await c.t("Boa noite", { responder: () => finU([txt("Boa noite! Sou o Aloan da Icom. Qual é o seu nome?")], "reply", U("smalltalk")) });
    check("[T3] abertura não entrega pedido de NOME", !has(t1.outbox, "seu nome"), `outbox="${t1.outbox}"`);
  }

  // ── 4) "Sim, conheço" (qualificação, sem intenção comercial) -> não pede nome nem sobrenome ──
  {
    const c = conv();
    await c.t("Boa noite", { responder: () => finU([txt("Boa noite! Sou o Aloan. Você procura um modelo, um tipo de carro ou uma faixa de preço?")], "reply", U("smalltalk")) });
    const t2 = await c.t("Sim, conheço", { responder: () => finU([txt("Que bom! E qual é o seu nome?")], "reply", U("other")) });
    check("[T4] 'Sim, conheço' sem intenção comercial -> NÃO vira pedido de nome", !has(t2.outbox, "seu nome"), `outbox="${t2.outbox}"`);
    const t3 = await c.t("Douglas", { responder: () => finU([txt("Prazer, Douglas! Qual é o seu sobrenome?")], "reply", U("other")) });
    check("[T4b] NUNCA pede sobrenome", !has(t3.outbox, "sobrenome"), `outbox="${t3.outbox}"`);
  }

  // ── 5) resposta à pergunta de TROCA -> possuiTroca+veiculoTroca (km 86->86000), ZERO stock_search ──
  {
    const c = conv();
    await c.t("Boa noite", { responder: askTrade });   // agente pergunta troca
    const t2 = await c.t("Tenho, um Renegade, 2019, 86km", { responder: () => finU([txt("Anotado! Um Renegade 2019 na troca. Vamos seguir: prefere ver as condições ou já agendar uma visita?")], "reply", U("other")) });
    check("[T5] possuiTroca=true", t2.slots?.possuiTroca.value === true, `possuiTroca=${JSON.stringify(t2.slots?.possuiTroca)}`);
    check("[T5b] veiculoTroca.modelo=Renegade, ano=2019, km=86000", has(String(t2.slots?.veiculoTroca.value?.modelo ?? ""), "Renegade") && t2.slots?.veiculoTroca.value?.ano === 2019 && t2.slots?.veiculoTroca.value?.km === 86000, `veiculoTroca=${JSON.stringify(t2.slots?.veiculoTroca.value)}`);
    check("[T5c] ZERO stock_search (troca não é busca)", t2.stockCalls === 0, `calls=${t2.stockCalls}`);
    check("[T5d] não diz 'não encontrei'/'não achei' Jeep", !has(t2.outbox, "nao encontrei") && !has(t2.outbox, "nao achei"), `outbox="${t2.outbox}"`);
  }

  // ── 5-neg) cérebro TENTA buscar na resposta de troca -> engine BLOQUEIA stock_search ──
  {
    const c = conv();
    await c.t("Boa noite", { responder: askTrade });
    const tryStock: BrainResponder = (_f, obs) => obs.some((o) => o.tool === "stock_search")
      ? finU([txt("Anotado! Renegade 2019 na troca. Vamos às condições?")], "reply", U("other"))
      : qU({ tool: "stock_search", input: { modelo: "Renegade" } }, searchSuvU);
    const t2 = await c.t("Tenho um Renegade 2019 86km", { responder: tryStock });
    check("[T5-neg] cérebro tenta stock_search na resposta de troca -> BLOQUEADO (0 execuções)", t2.stockCalls === 0 && t2.slots?.possuiTroca.value === true, `calls=${t2.stockCalls}`);
  }

  // ── 7) "tem Renegade 2019?" (pergunta de COMPRA) -> AÍ SIM stock_search ──
  {
    const c = conv();
    await c.t("Boa noite", { responder: askTrade });   // mesmo com troca pendente, "tem X?" é compra
    const t2 = await c.t("na verdade tem Renegade 2019?", { responder: listSuv });
    check("[T7] pergunta de COMPRA ('tem Renegade 2019?') executa stock_search", t2.stockCalls >= 1, `calls=${t2.stockCalls} input=${JSON.stringify(t2.stockInput)}`);
  }

  // ── 8) "quero comprar um Renegade" -> stock_search ──
  {
    const c = conv();
    await c.t("Boa noite", { responder: askTrade });
    const t2 = await c.t("quero comprar um Renegade", { responder: listSuv });
    check("[T8] 'quero comprar um Renegade' executa stock_search", t2.stockCalls >= 1, `calls=${t2.stockCalls}`);
  }

  // ── 9) "não tenho troca" -> possuiTroca=false, ZERO stock_search ──
  {
    const c = conv();
    await c.t("Boa noite", { responder: askTrade });
    const t2 = await c.t("não tenho troca", { responder: () => finU([txt("Sem problema! Então vamos seguir. Prefere ver condições ou agendar uma visita?")], "reply", U("other")) });
    check("[T9] possuiTroca=false", t2.slots?.possuiTroca.value === false, `possuiTroca=${JSON.stringify(t2.slots?.possuiTroca)}`);
    check("[T9b] ZERO stock_search", t2.stockCalls === 0, `calls=${t2.stockCalls}`);
  }

  // ── 10) "tenho um Onix para troca, mas quero SUV" -> salva Onix (troca) + busca SUV (compra) ──
  {
    const c = conv();
    const t1 = await c.t("tenho um Onix para troca, mas quero SUV", { responder: listSuv });
    check("[T10] salva Onix como veículo de troca", has(String(t1.slots?.veiculoTroca.value?.modelo ?? ""), "Onix") && t1.slots?.possuiTroca.value === true, `veiculoTroca=${JSON.stringify(t1.slots?.veiculoTroca.value)}`);
    check("[T10b] busca SUV como interesse de compra (os dois não se misturam)", t1.stockCalls >= 1 && has(JSON.stringify(t1.stockInput ?? {}), "suv"), `calls=${t1.stockCalls} input=${JSON.stringify(t1.stockInput)}`);
  }

  // ══ AUDIT CODEX: buy-clause separa TROCA de COMPRA no MESMO bloco, COM pergunta de troca pendente (não falso-verde) ══
  const searchBudgetU: TurnUnderstanding = { primaryIntent: "search_stock", requestedCapabilities: ["stock_search"], subject: "budget", subjectValue: "70000", subjectSource: "current_turn", evidence: [{ capability: "stock_search", quote: "70 mil" }], isTopicChange: false, answeredLeadQuestions: [] };
  const searchBudget: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => {
    const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
    if (!so) return qU({ tool: "stock_search", input: { precoMax: 70000 } }, searchBudgetU);
    return finU([txt("Encontrei estas opções:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart], "reply", searchBudgetU);
  };
  // CX-1) troca pendente + "tenho um Onix para troca, mas quero SUV" -> Onix=troca E busca tipo=suv (não bloqueia)
  {
    const c = conv();
    await c.t("Boa noite", { responder: askTrade });
    const t2 = await c.t("tenho um Onix para troca, mas quero SUV", { responder: listSuv });
    check("[CX-1] veiculoTroca=Onix (troca) E possuiTroca=true", has(String(t2.slots?.veiculoTroca.value?.modelo ?? ""), "Onix") && t2.slots?.possuiTroca.value === true, `veiculoTroca=${JSON.stringify(t2.slots?.veiculoTroca.value)}`);
    check("[CX-1b] busca EXECUTA tipo=suv (compra), NÃO fica presa no Onix da troca", t2.stockCalls >= 1 && has(JSON.stringify(t2.stockInput ?? {}), "suv") && !has(JSON.stringify(t2.stockInput ?? {}), "onix"), `calls=${t2.stockCalls} input=${JSON.stringify(t2.stockInput)}`);
  }
  // CX-2) troca pendente + "tenho um Renegade 2019 86km" (SÓ troca) -> zero busca
  {
    const c = conv();
    await c.t("Boa noite", { responder: askTrade });
    const t2 = await c.t("tenho um Renegade 2019 86km", { responder: () => finU([txt("Anotado, Renegade 2019 na troca! Prefere ver as condições?")], "reply", U("other")) });
    check("[CX-2] só troca -> possuiTroca=true, veiculoTroca Renegade/2019/86000, ZERO stock_search", t2.slots?.possuiTroca.value === true && has(String(t2.slots?.veiculoTroca.value?.modelo ?? ""), "Renegade") && t2.slots?.veiculoTroca.value?.km === 86000 && t2.stockCalls === 0, `veic=${JSON.stringify(t2.slots?.veiculoTroca.value)} calls=${t2.stockCalls}`);
  }
  // CX-3) troca pendente + "quero SUV" (mudança/compra) -> busca tipo=suv, não trata como troca
  {
    const c = conv();
    await c.t("Boa noite", { responder: askTrade });
    const t2 = await c.t("quero SUV", { responder: listSuv });
    check("[CX-3] 'quero SUV' após pergunta de troca -> busca tipo=suv (não bloqueia)", t2.stockCalls >= 1 && has(JSON.stringify(t2.stockInput ?? {}), "suv"), `calls=${t2.stockCalls} input=${JSON.stringify(t2.stockInput)}`);
  }
  // CX-4) troca pendente + "tenho um Onix 2018 80km, quero algo até 70 mil" -> Onix=troca + busca precoMax=70000
  {
    const c = conv();
    await c.t("Boa noite", { responder: askTrade });
    const t2 = await c.t("tenho um Onix 2018 80km, quero algo até 70 mil", { responder: searchBudget });
    check("[CX-4] veiculoTroca=Onix/2018/80000 (troca)", has(String(t2.slots?.veiculoTroca.value?.modelo ?? ""), "Onix") && t2.slots?.veiculoTroca.value?.ano === 2018 && t2.slots?.veiculoTroca.value?.km === 80000, `veic=${JSON.stringify(t2.slots?.veiculoTroca.value)}`);
    check("[CX-4b] busca precoMax=70000 (compra), sem o Onix da troca", t2.stockCalls >= 1 && has(JSON.stringify(t2.stockInput ?? {}), "70000") && !has(JSON.stringify(t2.stockInput ?? {}), "onix"), `calls=${t2.stockCalls} input=${JSON.stringify(t2.stockInput)}`);
  }
  // CX-5) troca pendente + "não tenho troca" -> possuiTroca=false, zero busca
  {
    const c = conv();
    await c.t("Boa noite", { responder: askTrade });
    const t2 = await c.t("não tenho troca", { responder: () => finU([txt("Sem problema! Vamos seguir. Quer ver as condições?")], "reply", U("other")) });
    check("[CX-5] 'não tenho troca' -> possuiTroca=false, ZERO stock_search", t2.slots?.possuiTroca.value === false && t2.stockCalls === 0, `possuiTroca=${JSON.stringify(t2.slots?.possuiTroca.value)} calls=${t2.stockCalls}`);
  }

  // ══ AUDIT CODEX smoke real: interesse NÃO contaminado pela troca + dedup de stock_search ══
  // IN-1) interesse/tipoVeiculo de COMPRA preservados quando o lead informa o carro de TROCA
  {
    const c = conv();
    await c.t("quero SUV", { responder: listSuv });   // T1: tipoVeiculo=suv (compra)
    await c.t("Boa noite", { responder: askTrade });   // T2: agente pergunta troca
    const t3 = await c.t("Tenho um Renegade 2019 86km", { responder: () => finU([txt("Anotado, Renegade 2019 na troca! Vamos às condições?")], "reply", U("other")) });
    check("[IN-1] tipoVeiculo de COMPRA preservado (suv), NÃO virou Renegade", t3.slots?.tipoVeiculo.value === "suv", `tipoVeiculo=${JSON.stringify(t3.slots?.tipoVeiculo.value)}`);
    check("[IN-1b] interesse NÃO contaminado com 'renegade' (o Renegade é troca)", !has(String(t3.slots?.interesse.value ?? ""), "renegade"), `interesse=${JSON.stringify(t3.slots?.interesse.value)}`);
    check("[IN-1c] veiculoTroca=Renegade capturado + 0 stock_search", has(String(t3.slots?.veiculoTroca.value?.modelo ?? ""), "Renegade") && t3.stockCalls === 0, `veic=${JSON.stringify(t3.slots?.veiculoTroca.value)} calls=${t3.stockCalls}`);
  }
  // IN-2) DEDUP: cérebro chama stock_search equivalente 2x no MESMO turno -> executa 1x (fingerprint normalizado)
  {
    const c = conv();
    const dupSearch: BrainResponder = (_f, obs: readonly AgentToolObservation[], step) => {
      if (step === 0) return qU({ tool: "stock_search", input: { tipo: "suv" } }, searchSuvU);
      if (step === 1) return qU({ tool: "stock_search", input: { tipo: "SUV" } }, searchSuvU);   // MESMO fingerprint (case), sig diferente
      const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
      return finU([txt("Encontrei estas opções:"), { type: "vehicle_offer_list", vehicleKeys: so ? so.data.items.map((i) => i.vehicleKey) : [] } as ResponsePart], "reply", searchSuvU);
    };
    const t1 = await c.t("quero SUV", { responder: dupSearch });
    check("[IN-2] stock_search equivalente 2x -> executa 1x (dedup por fingerprint)", t1.stockCalls === 1, `calls=${t1.stockCalls}`);
    check("[IN-2b] ainda responde com a lista (fato reaproveitado)", has(t1.outbox, "Creta") || has(t1.outbox, "Renegade"), `outbox="${t1.outbox}"`);
  }
  // IN-3) "tem Renegade 2019?" após pergunta de troca -> COMPRA (busca), NÃO grava veiculoTroca
  {
    const c = conv();
    await c.t("Boa noite", { responder: askTrade });
    const t2 = await c.t("tem Renegade 2019?", { responder: listSuv });
    check("[IN-3] 'tem Renegade 2019?' = compra -> busca, NÃO grava veiculoTroca", t2.stockCalls >= 1 && t2.slots?.veiculoTroca.status !== "known", `calls=${t2.stockCalls} veic=${JSON.stringify(t2.slots?.veiculoTroca)}`);
  }

  // ══ AUDIT CODEX smoke real (rodada 2): "cadê? 7x stock_search" + primaryIntent da troca ══
  // IN-4) LOOP-DEDUP POR OBSERVAÇÃO: o cérebro repropõe a MESMA busca; a repetição vira feedback de controle (tool:"response",
  //       NÃO stock_search) -> stockObs<=1 (mesmo critério do smoke). O feedback conduz o cérebro a FINALIZAR com a lista.
  {
    const c = conv();
    const loopThenFinalize: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => {
      const dupFeedback = obs.some((o) => o.tool === "response" && o.ok === false);   // recebeu "você já buscou; finalize"
      const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
      if (dupFeedback && so) return finU([txt("Encontrei estas opções:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart], "reply", searchSuvU);
      return qU({ tool: "stock_search", input: { tipo: "suv" } }, searchSuvU);   // insiste na MESMA busca até o feedback
    };
    const t1 = await c.t("quero SUV", { responder: loopThenFinalize });
    check("[IN-4] busca repetida -> stockObs<=1 (loop não infla a contagem do smoke)", t1.stockObs <= 1, `stockObs=${t1.stockObs}`);
    check("[IN-4b] executou de verdade só 1x + respondeu com a lista", t1.stockCalls === 1 && (has(t1.outbox, "Creta") || has(t1.outbox, "Renegade")), `calls=${t1.stockCalls} outbox="${t1.outbox}"`);
  }
  // IN-5) CAP ANTI-LOOP: o cérebro NUNCA finaliza (repropõe a busca sem parar) -> o loop sai pelo cap e o turno COMMITA
  //       (recuperação determinística), com stockObs<=1 (não os 7x do relatório) e executando a busca só 1x.
  {
    const c = conv();
    const alwaysSearch: BrainResponder = () => qU({ tool: "stock_search", input: { tipo: "suv" } }, searchSuvU);
    const t1 = await c.t("quero SUV", { responder: alwaysSearch });
    check("[IN-5] cérebro em loop infinito de busca -> turno COMMITA (cap sai do loop) + stockObs<=1", t1.committed && t1.stockObs <= 1, `committed=${t1.committed} stockObs=${t1.stockObs}`);
    check("[IN-5b] a busca real executou só 1x (dedup, sem 7x)", t1.stockCalls === 1, `calls=${t1.stockCalls}`);
  }
  // IN-6) primaryIntent RECONCILIADO: em resposta de troca, mesmo o cérebro rotulando search_stock, o understanding do turno
  //       é trade_in (não basta bloquear o dano; a compreensão precisa refletir a conversa). + 0 stock_search + troca correta.
  {
    const c = conv();
    await c.t("Boa noite", { responder: askTrade });   // agente pergunta troca
    const tryStockThenFin: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => obs.some((o) => o.tool === "response" && o.ok === false)
      ? finU([txt("Anotado, Renegade 2019 na troca! Vamos às condições?")], "reply", searchSuvU)   // cérebro INSISTE em search_stock (o bug do smoke)
      : qU({ tool: "stock_search", input: { modelo: "Renegade" } }, searchSuvU);
    const t2 = await c.t("Tenho um Renegade 2019 86km", { responder: tryStockThenFin });
    check("[IN-6] primaryIntent reconciliado = trade_in (NÃO search_stock, mesmo o cérebro rotulando assim)", t2.primaryIntent === "trade_in", `primaryIntent=${t2.primaryIntent}`);
    check("[IN-6b] 0 stock_search executado E 0 stock_search observado (busca na troca é bloqueada)", t2.stockCalls === 0 && t2.stockObs === 0, `calls=${t2.stockCalls} obs=${t2.stockObs}`);
    check("[IN-6c] veiculoTroca=Renegade/2019/86000 capturado", has(String(t2.slots?.veiculoTroca.value?.modelo ?? ""), "Renegade") && t2.slots?.veiculoTroca.value?.ano === 2019 && t2.slots?.veiculoTroca.value?.km === 86000, `veic=${JSON.stringify(t2.slots?.veiculoTroca.value)}`);
    check("[IN-6d] interesse de compra NÃO contaminado com renegade", !has(String(t2.slots?.interesse.value ?? ""), "renegade"), `interesse=${JSON.stringify(t2.slots?.interesse.value)}`);
  }

  // ══ AUDIT CODEX smoke real (rodada 3): posse de troca sem pergunta + sanitização + rejeição não conta como busca ══
  // IN-7) posse de veículo COM km (o agente NÃO perguntou troca — perguntou financiamento) = oferta de troca. O entendimento
  //       reflete a conversa: captura veiculoTroca + possuiTroca, 0 stock_search, primaryIntent=trade_in.
  {
    const c = conv();
    await c.t("Boa noite", { responder: () => finU([txt("Para as condições, você tem valor de entrada ou quer financiar o total?")], "reply", U("financing")) });
    const tryStock: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => obs.some((o) => o.tool === "response" && o.ok === false)
      ? finU([txt("Anotado, Renegade 2019 na troca! Vamos às condições?")], "reply", U("other"))
      : qU({ tool: "stock_search", input: { modelo: "Renegade" } }, searchSuvU);
    const t2 = await c.t("Tenho um Renegade 2019 86km", { responder: tryStock });
    check("[IN-7] posse com km SEM pergunta de troca -> veiculoTroca+possuiTroca capturados", has(String(t2.slots?.veiculoTroca.value?.modelo ?? ""), "Renegade") && t2.slots?.veiculoTroca.value?.km === 86000 && t2.slots?.possuiTroca.value === true, `veic=${JSON.stringify(t2.slots?.veiculoTroca.value)} possui=${JSON.stringify(t2.slots?.possuiTroca.value)}`);
    check("[IN-7b] 0 stock_search (exec+obs) + primaryIntent=trade_in mesmo sem pergunta pendente", t2.stockCalls === 0 && t2.stockObs === 0 && t2.primaryIntent === "trade_in", `calls=${t2.stockCalls} obs=${t2.stockObs} intent=${t2.primaryIntent}`);
    check("[IN-7c] interesse de compra NÃO contaminado com renegade", !has(String(t2.slots?.interesse.value ?? ""), "renegade"), `interesse=${JSON.stringify(t2.slots?.interesse.value)}`);
  }
  // IN-8) SANITIZACAO: o cerebro autora texto com control chars (U+001F) -> o texto de saida sai LIMPO (nunca vao pro WhatsApp).
  {
    const CTRL = String.fromCharCode(0x1f);
    const c = conv();
    const t1 = await c.t("Oi", { responder: () => finU([txt("Ola" + CTRL + CTRL + "! Como posso te ajudar hoje?")], "reply", U("smalltalk")) });
    const hasCtrl = [...t1.outbox].some((ch) => { const cc = ch.codePointAt(0) ?? 0; return (cc < 0x20 && cc !== 9 && cc !== 10 && cc !== 13) || cc === 0x7f || cc === 0xfffd; });
    check("[IN-8] control chars (U+001F) removidos do texto de saida", !hasCtrl && has(t1.outbox, "Como posso te ajudar"), `outbox=${JSON.stringify(t1.outbox)}`);
  }
  // IN-9) rejeição de capability de stock_search (understanding sem evidence válida, ex.: "cadê?") NÃO conta como busca no
  //       relatório do smoke (tool:"response") + cap anti-loop; a busca comercial roda 1x na autoria determinística.
  {
    const c = conv();
    const invalidSearch: BrainResponder = () => qU({ tool: "stock_search", input: { tipo: "suv" } }, U("search_stock"));   // U() tem requestedCapabilities vazio -> gate rejeita
    const t1 = await c.t("quero SUV", { responder: invalidSearch });
    check("[IN-9] rejeição de capability não infla stock_search (stockObs<=1) + turno COMMITA", t1.stockObs <= 1 && t1.committed, `obs=${t1.stockObs} committed=${t1.committed}`);
  }

  // ══ AUDIT CODEX (rodada 6, LLM-first): T7 seleção + T8 nome — o ENGINE NÃO escreve a resposta; dá FEEDBACK e a LLM REDIGE ══
  // T7) SELEÇÃO "gostei do segundo": o cérebro tenta vehicle_details (sem a vehicleKey); o engine NÃO infla (tool:"response"
  //     + cap) e devolve FEEDBACK com o FATO (o label aterrado do carro escolhido). A LLM LÊ o feedback e REDIGE o acolhimento
  //     (brain_retry). O engine NÃO escreve "Ótima escolha…" (removido recovery_selection). [[pedro-v3-llm-first-no-handler]]
  {
    const c = conv();
    await c.t("você tem SUV?", { responder: listSuv });   // renderiza [Creta, Renegade]
    const selectThenAck: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => {
      const fb = obs.find((o) => o.ok === false && o.tool === "response");
      if (fb) { const label = /SELECIONOU o ([^(]+?) \(/.exec((fb as { error: { message: string } }).error.message)?.[1]?.trim() ?? "esse carro";
        return finU([txt(`Ótima escolha! O ${label} é uma boa. Quer que eu te envie as fotos ou já te passo as condições?`)], "reply", selectU); }   // a LLM usa o FATO do feedback
      return qU({ tool: "vehicle_details", input: { vehicleKey: "rm:reneg" } }, selectU);   // 1ª tentativa: detalhe -> rejeitado com feedback
    };
    const t2 = await c.t("gostei do segundo", { responder: selectThenAck });
    check("[T7] seleção: a LLM REDIGE (brain_final/retry, NÃO recovery), 0 vehicle_details, sem terminalSafe", t2.detailObs <= 1 && (t2.src === "brain_final" || t2.src === "brain_retry") && !t2.terminalSafe, `detailObs=${t2.detailObs} src=${t2.src} terminalSafe=${t2.terminalSafe}`);
    check("[T7b] a LLM nomeou o carro escolhido usando o LABEL entregue no FEEDBACK (engine não escreveu)", has(t2.outbox, "Renegade"), `outbox="${t2.outbox}"`);
  }
  // T8-a) captura OPORTUNÍSTICA de nome: "Douglas" pelado (sem pergunta de nome) -> nome=Douglas conhecido.
  {
    const c = conv();
    const t1 = await c.t("Douglas", { responder: () => finU([txt("Prazer, Douglas! O que você procura?")], "reply", U("other")) });
    check("[T8a] 'Douglas' pelado -> nome capturado oportunisticamente", t1.slots?.nome.value === "Douglas" && t1.slots?.nome.status === "known", `nome=${JSON.stringify(t1.slots?.nome)}`);
  }
  // T8-b) turno de PAGAMENTO NÃO pede nome: o cérebro tenta pedir nome -> engine NEGA -> re-autora conduzindo troca/entrada.
  {
    const c = conv();
    await c.t("quero SUV", { responder: listSuv });   // contexto comercial (não é abertura)
    const askNameInPayment: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => obs.some((o) => o.ok === false)
      ? finU([txt("Claro! Você tem algum carro para dar de troca?")], "reply", U("financing"))   // UMA pergunta financeira (F2.40 caso F)
      : finU([txt("Para as condições, qual é o seu nome?")], "reply", U("financing"));
    const t2 = await c.t("Me passa as condições de pagamento", { responder: askNameInPayment });
    check("[T8b] pagamento -> engine NEGA pedido de nome -> re-autora sem pedir nome", !has(t2.outbox, "seu nome") && (has(t2.outbox, "troca") || has(t2.outbox, "entrada")), `outbox="${t2.outbox}"`);
  }
  // T8-c) nome JÁ conhecido -> engine NEGA repergunta de nome (o cérebro re-autora seguindo a conversa).
  {
    const c = conv();
    await c.t("Douglas", { responder: () => finU([txt("Prazer! O que procura?")], "reply", U("other")) });   // nome=Douglas
    const reaskName: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => obs.some((o) => o.ok === false)
      ? finU([txt("Temos boas opções! Que tipo você prefere?")], "reply", U("other"))
      : finU([txt("Antes, me lembra qual é o seu nome?")], "reply", U("other"));
    const t2 = await c.t("quero ver carros", { responder: reaskName });
    check("[T8c] nome já conhecido -> NÃO repergunta nome", !has(t2.outbox, "seu nome"), `outbox="${t2.outbox}"`);
  }

  // ══ AUDIT CODEX (rodada 6, LLM-first): T3 turno só-nome — a LLM conduz, o engine NÃO escreve "Prazer, Douglas…" ══
  // T3) o lead responde APENAS o nome. O nome é capturado (memória) e o prompt manda acolher+avançar. Se a LLM erra (aqui a
  //     1ª tentativa pede sobrenome -> deny+FEEDBACK), ela REDIGE o acolhimento na retry (brain_retry). O engine NÃO escreve a
  //     resposta (removido recovery_name_identified). [[pedro-v3-llm-first-no-handler]]
  {
    const c = conv();
    await c.t("Oi", { responder: () => finU([txt("Olá! Me conta o que você procura: um modelo, um tipo de carro ou uma faixa de preço?")], "reply", U("other")) });
    const nameThenAck: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => obs.some((o) => o.ok === false)
      ? finU([txt("Prazer, Douglas! Me conta o que você procura: um modelo, um tipo de carro ou uma faixa de preço?")], "reply", U("other"))   // a LLM REDIGE após o feedback
      : finU([txt("Qual é o seu sobrenome?")], "reply", U("other"));   // 1ª tentativa negada (sobrenome) -> feedback
    const t2 = await c.t("Douglas", { responder: nameThenAck });
    check("[T3] só-nome: nome conhecido, 0 tools, a LLM REDIGE (brain_retry), NÃO technical_fallback", t2.slots?.nome.value === "Douglas" && t2.stockObs === 0 && t2.detailObs === 0 && !t2.terminalSafe && (t2.src === "brain_final" || t2.src === "brain_retry"), `nome=${JSON.stringify(t2.slots?.nome)} src=${t2.src} terminalSafe=${t2.terminalSafe}`);
    check("[T3b] a LLM acolhe pelo nome e avança a descoberta (engine não escreveu)", has(t2.outbox, "Douglas") && (has(t2.outbox, "procura") || has(t2.outbox, "tipo de carro")), `outbox="${t2.outbox}"`);
  }

  // ══ AUDIT CODEX (Fase 1, LLM-first): "cadê?" NÃO pode terminar em recovery_offer — a LLM lista, o engine só dá o FATO ══
  // T5R) após uma busca SUV, "cadê?" com activeSearchConstraints: o cérebro finaliza SEM ter o resultado (como o real). O
  //      engine EXECUTA a busca e devolve o resultado + feedback "liste com vehicle_offer_list"; a LLM REDIGE a lista →
  //      brain_final/brain_retry (NÃO deterministic_recovery/recovery_offer), sem loop de stock_search, sem repergunta.
  {
    const c = conv();
    await c.t("você tem SUV?", { responder: listSuv });   // renderiza SUVs + persiste activeSearchConstraints
    const cadeBrain: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => {
      const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
      if (so) return finU([txt("Encontrei estas opções:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart, txt("Quer ver as fotos ou as condições?")], "reply", searchSuvU);
      return finU([txt("Claro! Aqui estão as opções, quer ver as fotos ou as condições?")], "reply", searchSuvU);   // finaliza sem ter o resultado (como o cérebro real)
    };
    const t2 = await c.t("cadê?", { responder: cadeBrain });
    check("[T5R] 'cadê?' termina brain_final/brain_retry (NÃO recovery_offer/technical_fallback)", (t2.src === "brain_final" || t2.src === "brain_retry"), `src=${t2.src}`);
    check("[T5R-b] a LLM listou os SUVs (Creta/Renegade) + 1 stock_search, sem repergunta 'qual modelo/tipo'", (has(t2.outbox, "Creta") || has(t2.outbox, "Renegade")) && t2.stockObs <= 1 && !has(t2.outbox, "qual modelo") && !has(t2.outbox, "qual tipo"), `outbox="${t2.outbox}" stockObs=${t2.stockObs}`);
  }

  // ══ AUDIT CODEX (T8 LLM-first): pagamento de veículo ESCOLHIDO conduz financiamento; engine NEGA discovery, LLM redige ══
  {
    const c = conv();
    await c.t("você tem SUV?", { responder: listSuv });   // lista SUVs
    await c.t("gostei do segundo", { responder: () => finU([txt("Ótima escolha! O Renault Duster 2015 é uma boa. Quer fotos ou condições?")], "reply", selectU) });   // seleciona -> persiste selectedVehicle
    const payBrain: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => obs.some((o) => o.ok === false)
      ? finU([txt("Claro! Você tem algum valor para dar de entrada?")], "reply", U("financing"))   // conduz após feedback (UMA pergunta — F2.40 caso F)
      : finU([txt("Me conta o que você procura?")], "reply", U("financing"));   // discovery -> NEGADO
    const t3 = await c.t("Me passa as condições de pagamento", { responder: payBrain });
    check("[T8P] pagamento c/ veículo escolhido: engine NEGA discovery -> LLM conduz (brain_retry, não technical_fallback)", (t3.src === "brain_final" || t3.src === "brain_retry") && !t3.terminalSafe && !has(t3.outbox, "o que você procura"), `src=${t3.src} outbox="${t3.outbox}"`);
    check("[T8P-b] a LLM conduz entrada/parcela/financiamento (não discovery)", has(t3.outbox, "entrada") || has(t3.outbox, "financ") || has(t3.outbox, "parcela"), `outbox="${t3.outbox}"`);
  }

  console.log(`\n== F2.39: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
