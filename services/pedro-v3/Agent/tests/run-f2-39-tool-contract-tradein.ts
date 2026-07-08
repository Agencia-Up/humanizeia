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
type Cap = { outbox: string; committed: boolean; stockCalls: number; stockInput: Record<string, unknown> | null; hasMedia: boolean; src: string | null; slots: Slots | null };
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
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed",
    stockCalls: stocks.length, stockInput: stocks.length > 0 ? (stocks[stocks.length - 1].input as Record<string, unknown>) : null,
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

  console.log(`\n== F2.39: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
