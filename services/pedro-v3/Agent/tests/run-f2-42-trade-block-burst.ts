// ============================================================================
// F2.42 — Missão P0: resposta de veículo de TROCA em BLOCO QUEBRADO não cai em fallback nem vira busca/descoberta.
//  Incidente real (2026-07-09, piloto): agente perguntou troca; lead mandou "tenho / Uma hillux 2020 / 85km rodados"
//  em rajada; o agente respondeu "Me conta um pouco mais do que você procura" (recovery_ask_need). Causas:
//   (1) requireVehicleDetailBeforeFinal via "85km rodados" (regex de atributo) e EXIGIA vehicle_details do Nivus
//       SELECIONADO num turno de RESPOSTA DE TROCA -> consumia os passos do cérebro em silêncio -> technical_fallback;
//   (2) modelo "hillux" (typo, fora do catálogo) não era capturado -> veiculoTroca sem modelo no briefing;
//   (3) (latente) nomear o carro de troca na resposta era negado pelo grounding de catálogo (POL-GROUND-STOCK)
//       quando o modelo colidia com a taxonomia/catálogo — o carro DO LEAD nunca está no estoque.
//  Invariantes: turno de troca NUNCA exige/roda tool comercial; o carro citado é DO LEAD (modelo/ano/km vão p/ o
//  briefing, km<1000 = milhar); a LLM acolhe NOMEANDO o carro do lead (proveniência do lead) e avança o funil;
//  interesse/selecionado de compra PRESERVADOS; resposta = brain_final/brain_retry (nunca discovery genérico).
//   npx tsx tests/run-f2-42-trade-block-burst.ts
// ============================================================================
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
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
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-09T12:00:00.000Z", SHA = "sha-42";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

// Estoque do tenant: NIVUS (o carro do incidente) + CRETA + ONIX. Hilux NÃO existe no estoque (como no incidente).
const NIVUS: VehicleFact = { vehicleKey: "rm:nivus", marca: "Volkswagen", modelo: "Nivus", ano: 2021, preco: 98000, km: 35000, cambio: "Automatico", cor: "Cinza", tipo: "suv" };
const CRETA: VehicleFact = { vehicleKey: "rm:creta", marca: "Hyundai", modelo: "Creta", ano: 2021, preco: 88000, km: 40000, cambio: "Automatico", cor: "Prata", tipo: "suv" };
const ONIX: VehicleFact = { vehicleKey: "rm:onix", marca: "Chevrolet", modelo: "Onix", ano: 2018, preco: 62000, km: 70000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const STOCK = [NIVUS, CRETA, ONIX];
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
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
function finU(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
function qU(call: { tool: string; input: Record<string, unknown> }, u: TurnUnderstanding): AgentBrainStep { return { kind: "query", call: call as never, understanding: u } as AgentBrainStep; }
const resist: BrainResponder = () => finU([txt("Certo!")], "reply", U("other"));
// Agente PERGUNTA sobre troca (o próximo turno do lead é "resposta de troca").
const askTrade: BrainResponder = () => finU([txt("Perfeito! Para eu te passar as condições, você tem algum carro para dar de troca?")], "reply", U("other"));
// Cérebro de BUSCA com evidence do PRÓPRIO bloco (como a LLM real faz).
const searchB = (input: Record<string, unknown>): BrainResponder => (f, obs: readonly AgentToolObservation[]) => {
  const u: TurnUnderstanding = { primaryIntent: "search_stock", requestedCapabilities: ["stock_search"], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [{ capability: "stock_search", quote: (f.block ?? "").trim().split(/\s+/).slice(0, 2).join(" ") || "tem" }], isTopicChange: false, answeredLeadQuestions: [] };
  const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
  if (!so) return qU({ tool: "stock_search", input }, u);
  if (so.data.items.length === 0) return finU([txt("No momento não tenho esse modelo em estoque. Quer que eu veja opções parecidas pra você?")], "reply", u);
  return finU([txt("Encontrei estas opções:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart, txt("Quer ver as fotos de algum deles?")], "reply", u);
};
// Seleção ordinal ("gostei do primeiro") — acolhe sem nomear (a seleção canônica é do engine).
const selectFirst: BrainResponder = () => finU([txt("Boa escolha! Quer ver as condições de pagamento?")], "reply",
  { primaryIntent: "select_vehicle", requestedCapabilities: ["select"], subject: "ordinal_from_last_offer", subjectValue: "1", subjectSource: "current_turn", evidence: [{ capability: "select", quote: "primeiro" }], isTopicChange: false, answeredLeadQuestions: [] });

type Slots = ConversationState["slots"];
type Cap = { outbox: string; committed: boolean; stockCalls: number; stockObs: number; detailObs: number; terminalSafe: boolean; primaryIntent: string | null; stockInput: Record<string, unknown> | null; src: string | null; slots: Slots | null; selected: string | null };
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
  const stockObs = r.status === "committed" ? r.toolObservations.filter((o) => o.tool === "stock_search").length : 0;
  const detailObs = r.status === "committed" ? r.toolObservations.filter((o) => o.tool === "vehicle_details").length : 0;
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  const st = persistence.load(convId)?.state ?? null;
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed",
    stockCalls: stocks.length, stockObs, detailObs, terminalSafe: r.status === "committed" ? r.terminalSafe : false,
    primaryIntent: r.status === "committed" ? r.understanding.primaryIntent : null,
    stockInput: stocks.length > 0 ? (stocks[stocks.length - 1].input as Record<string, unknown>) : null,
    src: r.status === "committed" ? (r.responseSource ?? null) : null,
    slots: st?.slots ?? null, selected: st?.vehicleContext.selected?.key ?? null,
  };
}
let seq0 = 0;
function conv() {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `wa:f42_${seq0++}`; let s = 0;
  const t = (lead: string, responder?: BrainResponder, rel: TurnRelation = "ambiguous"): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, rel, responder ?? resist);
  return { t };
}
const tv = (c: Cap): { marca?: string; modelo?: string; ano?: number; km?: number } => (c.slots?.veiculoTroca.value ?? {}) as { marca?: string; modelo?: string; ano?: number; km?: number };
const NO_DISCOVERY = (out: string): boolean => !has(out, "me conta um pouco mais do que voce procura") && !has(out, "o que voce procura");

// Acolhimento REAL de troca: nomeia o carro DO LEAD + avança UMA pergunta (o que a gpt-4.1-mini autora).
const ackTradeHilux: BrainResponder = () => finU([txt("Perfeito! Anotei sua Hilux 2020 com 85 mil km para avaliação na troca. Você pretende dar algum valor de entrada?")], "reply", U("trade_in"));

async function main(): Promise<void> {
  console.log("== F2.42: troca em BLOCO QUEBRADO (incidente hillux) — 0 fallback, 0 busca, briefing completo ==");

  // ── A) INCIDENTE REAL: Nivus selecionado -> pergunta de troca -> bloco "tenho / Uma hillux 2020 / 85km rodados" ──
  {
    const c = conv();
    await c.t("quero um Nivus", searchB({ modelo: "Nivus" }));
    await c.t("gostei do primeiro", selectFirst);
    await c.t("quais as condições?", askTrade);
    const t4 = await c.t("tenho\nUma hillux 2020\n85km rodados", ackTradeHilux);
    check("[A-1] 0 stock_search (exec+obs) no turno da troca", t4.stockCalls === 0 && t4.stockObs === 0, `calls=${t4.stockCalls} obs=${t4.stockObs}`);
    check("[A-2] needDetail NÃO dispara ('85km rodados' não é pergunta de atributo do Nivus): 0 obs de vehicle_details", t4.detailObs === 0, `detailObs=${t4.detailObs}`);
    check("[A-3] resposta é da LLM (brain_final/brain_retry), sem discovery genérico", (t4.src === "brain_final" || t4.src === "brain_retry") && NO_DISCOVERY(t4.outbox), `src=${t4.src} outbox="${t4.outbox}"`);
    check("[A-4] acolhe NOMEANDO o carro do lead (Hilux) e avança (entrada)", has(t4.outbox, "hilux") && has(t4.outbox, "entrada"), `outbox="${t4.outbox}"`);
    check("[A-5] possuiTroca=true", t4.slots?.possuiTroca.value === true, `possuiTroca=${JSON.stringify(t4.slots?.possuiTroca)}`);
    check("[A-6] veiculoTroca canonizado: modelo Hilux + marca Toyota + ano 2020 + km 85000 (85km->milhar)", has(String(tv(t4).modelo ?? ""), "hilux") && has(String(tv(t4).marca ?? ""), "toyota") && tv(t4).ano === 2020 && tv(t4).km === 85000, `veiculoTroca=${JSON.stringify(tv(t4))}`);
    check("[A-7] primaryIntent=trade_in", t4.primaryIntent === "trade_in", `intent=${t4.primaryIntent}`);
    check("[A-8] compra PRESERVADA: selecionado segue o Nivus; interesse não vira hilux", t4.selected === NIVUS.vehicleKey && !has(String(t4.slots?.interesse.value ?? ""), "hilux"), `selected=${t4.selected} interesse=${JSON.stringify(t4.slots?.interesse.value)}`);

    // ── F) valor financeiro DEPOIS da troca: "tenho 8k de entrada" -> entrada=8000, 0 busca ──
    const t5 = await c.t("tenho 8k de entrada", () => finU([txt("Show! Entrada de R$ 8.000 anotada. Qual parcela mensal caberia no seu orçamento?")], "reply", U("financing")));
    check("[F-1] entrada=8000 (não faixaPreco, não busca)", t5.slots?.entrada.value === 8000 && t5.stockCalls === 0 && t5.slots?.faixaPreco.status !== "known", `entrada=${JSON.stringify(t5.slots?.entrada.value)} calls=${t5.stockCalls} faixa=${JSON.stringify(t5.slots?.faixaPreco)}`);
    check("[F-2] LLM conduz (brain_*) citando o valor do LEAD sem deny monetário", (t5.src === "brain_final" || t5.src === "brain_retry") && has(t5.outbox, "8.000"), `src=${t5.src} outbox="${t5.outbox}"`);
    check("[F-3] veiculoTroca PRESERVADO após a entrada", has(String(tv(t5).modelo ?? ""), "hilux") && tv(t5).km === 85000, `veiculoTroca=${JSON.stringify(tv(t5))}`);
  }

  // ── B) mensagens separadas no MESMO bloco: "tenho / um renegade / 2019 / 86km" (modelo fora do catálogo do tenant) ──
  {
    const c = conv();
    await c.t("quero um Nivus", searchB({ modelo: "Nivus" }));
    await c.t("quais as condições?", askTrade);
    const t3 = await c.t("tenho\num renegade\n2019\n86km", () => finU([txt("Anotado! Seu Renegade 2019 fica para avaliação na troca. Prefere simular com ou sem entrada?")], "reply", U("trade_in")));
    check("[B-1] 0 stock_search + brain_* + sem discovery", t3.stockCalls === 0 && t3.stockObs === 0 && (t3.src === "brain_final" || t3.src === "brain_retry") && NO_DISCOVERY(t3.outbox), `calls=${t3.stockCalls} src=${t3.src} outbox="${t3.outbox}"`);
    check("[B-2] veiculoTroca: modelo Renegade (canônico via taxonomia) + ano 2019 + km 86000", has(String(tv(t3).modelo ?? ""), "renegade") && tv(t3).ano === 2019 && tv(t3).km === 86000, `veiculoTroca=${JSON.stringify(tv(t3))}`);
  }

  // ── C) COMPRA EXPLÍCITA no mesmo bloco VENCE: troca registrada E busca do alvo de compra ──
  {
    const c = conv();
    await c.t("quero um Onix", searchB({ modelo: "Onix" }));
    await c.t("quais as condições?", askTrade);
    const t3 = await c.t("tenho uma Hilux 2020 85km, mas quero ver um SUV até 100 mil", searchB({ tipo: "suv", precoMax: 100000 }));
    check("[C-1] stock_search roda com o ALVO DE COMPRA (tipo=suv, precoMax=100000)", t3.stockCalls >= 1 && String(t3.stockInput?.tipo ?? "") === "suv" && Number(t3.stockInput?.precoMax ?? 0) === 100000, `calls=${t3.stockCalls} input=${JSON.stringify(t3.stockInput)}`);
    check("[C-2] veiculoTroca=Hilux/2020/85000 registrado MESMO com compra no bloco", has(String(tv(t3).modelo ?? ""), "hilux") && tv(t3).ano === 2020 && tv(t3).km === 85000, `veiculoTroca=${JSON.stringify(tv(t3))}`);
    check("[C-3] interesse de compra NÃO vira Hilux", !has(String(t3.slots?.interesse.value ?? ""), "hilux"), `interesse=${JSON.stringify(t3.slots?.interesse.value)}`);
  }

  // ── D) COMPRA PURA: "tem Hilux 2020?" -> busca (sem estoque -> honesto), NÃO grava veiculoTroca ──
  {
    const c = conv();
    const t1 = await c.t("tem Hilux 2020?", searchB({ modelo: "Hilux", anos: [2020] }));
    check("[D-1] 'tem Hilux 2020?' = COMPRA -> stock_search roda, veiculoTroca NÃO gravado", t1.stockCalls >= 1 && t1.slots?.veiculoTroca.status !== "known" && t1.slots?.possuiTroca.value !== true, `calls=${t1.stockCalls} veic=${JSON.stringify(t1.slots?.veiculoTroca)}`);
  }

  // ── E) NEGAÇÃO: "não tenho" respondendo a pergunta de troca -> possuiTroca=false, 0 busca, conduz ──
  {
    const c = conv();
    await c.t("quero um Nivus", searchB({ modelo: "Nivus" }));
    await c.t("gostei do primeiro", selectFirst);
    await c.t("quais as condições?", askTrade);
    const t4 = await c.t("não tenho", () => finU([txt("Sem problemas! Você pretende dar algum valor de entrada?")], "reply", U("trade_in")));
    check("[E-1] possuiTroca=false + 0 stock_search + brain_* + avança (entrada)", t4.slots?.possuiTroca.value === false && t4.stockCalls === 0 && (t4.src === "brain_final" || t4.src === "brain_retry") && has(t4.outbox, "entrada"), `possui=${JSON.stringify(t4.slots?.possuiTroca.value)} calls=${t4.stockCalls} src=${t4.src}`);
  }

  // ── G) COLISÃO com o catálogo: a troca é um ONIX (modelo QUE EXISTE no estoque, nunca ofertado na conversa) —
  //       nomear o carro DO LEAD não pode ser negado como "modelo não-aterrado" (proveniência do lead). ──
  {
    const c = conv();
    await c.t("quero um Nivus", searchB({ modelo: "Nivus" }));
    await c.t("gostei do primeiro", selectFirst);
    await c.t("quais as condições?", askTrade);
    const t4 = await c.t("tenho um onix 2018 70 mil km", () => finU([txt("Perfeito! Anotei seu Onix 2018 com 70 mil km para avaliação na troca. Você pretende dar algum valor de entrada?")], "reply", U("trade_in")));
    check("[G-1] acolhimento NOMEANDO o Onix do lead PASSA (brain_*, sem fallback)", (t4.src === "brain_final" || t4.src === "brain_retry") && has(t4.outbox, "onix") && NO_DISCOVERY(t4.outbox), `src=${t4.src} outbox="${t4.outbox}"`);
    check("[G-2] veiculoTroca=Onix/2018/70000 + 0 busca + selecionado segue Nivus", has(String(tv(t4).modelo ?? ""), "onix") && tv(t4).ano === 2018 && tv(t4).km === 70000 && t4.stockCalls === 0 && t4.selected === NIVUS.vehicleKey, `veic=${JSON.stringify(tv(t4))} calls=${t4.stockCalls} selected=${t4.selected}`);
  }

  console.log(`\n== F2.42: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { for (const f of fails) console.error("  FALHOU: " + f); process.exit(1); }
}

main().catch((err) => { console.error(err); process.exit(1); });
