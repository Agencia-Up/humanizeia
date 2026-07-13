// ============================================================================
// F2.43 — Missão P0: FATOS FRESCOS vencem snapshot de catálogo (fim do "exige-e-proíbe") + LLM-first sob falha.
//  Incidente (smoke F2.42 run 1): loadCatalog falhou-fechado p/ VAZIO -> o engine mandou a LLM listar a key vinda da
//  PRÓPRIA stock_search do turno e o validador rejeitou a MESMA key ("fora do catálogo do tenant") -> recovery_offer.
//  Invariantes: (1) keys de stock_search/vehicle_details OK do turno são grounding VÁLIDO de oferta (snapshot vazio
//  não apaga fato fresco); (2) o engine NUNCA exige/entrega uma key que a própria policy nega (inclui teto de preço e
//  ato conversacional na perna contextual); (3) key inventada/de outro tenant/memória-sem-fato/troca continuam
//  BLOQUEADAS; (4) catálogo falho é OBSERVÁVEL (catalogDegraded), nunca silencioso; (5) falha REAL da tool -> a LLM
//  responde honesta (nunca inventa nem cai em fallback genérico).
//   npx tsx tests/run-f2-43-fresh-facts-catalog.ts
// ============================================================================
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog, isVehicleKeyGrounded } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent, AgentToolObservation } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, EffectReceipt, EffectResult, TenantCatalog } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import type { ConversationState, AdContext } from "../src/domain/conversation-state.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-09T12:00:00.000Z", SHA = "sha-43";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

const CRETA: VehicleFact = { vehicleKey: "rm:creta", marca: "Hyundai", modelo: "Creta", ano: 2021, preco: 88000, km: 40000, cambio: "Automatico", cor: "Prata", tipo: "suv" };
const TUCSON: VehicleFact = { vehicleKey: "rm:tucson", marca: "Hyundai", modelo: "Tucson", ano: 2020, preco: 95000, km: 60000, cambio: "Automatico", cor: "Preto", tipo: "suv" };
const COMPASS: VehicleFact = { vehicleKey: "rm:compass", marca: "Jeep", modelo: "Compass", ano: 2019, preco: 99000, km: 70000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const RENEG: VehicleFact = { vehicleKey: "rm:reneg", marca: "Jeep", modelo: "Renegade", ano: 2019, preco: 92000, km: 55000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const ONIX: VehicleFact = { vehicleKey: "rm:onix", marca: "Chevrolet", modelo: "Onix", ano: 2018, preco: 62000, km: 70000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const STOCK = [CRETA, TUCSON, COMPASS, RENEG, ONIX];
const PHOTOS: Record<string, string[]> = { "rm:onix": ["o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8"], "rm:compass": ["c1", "c2", "c3"] };
const catalog = buildTenantCatalog(STOCK);
const EMPTY_CATALOG: TenantCatalog = { entries: [] };
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: "Rua Teste 100, Taubaté", hours: null, unit: "Icom", source: "test" }; } });

const executed: QueryCall[] = [];
let stockFails = false;   // caso J: falha REAL da tool
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    if (stockFails) return { ok: false, tool: "stock_search", error: { code: "UPSTREAM", message: "feed indisponível", retryable: true } } as QueryResult;
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
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: PHOTOS[key] ?? ["p1", "p2"] }, source: "fake" } as QueryResult; }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
// Preparer com CATÁLOGO CHAVEÁVEL: emptyCatalog=true simula o soluço do feed (snapshot vazio + catalogDegraded).
class RelPreparer implements TurnContextPreparer {
  relation: TurnRelation = "ambiguous";
  emptyCatalog = false;
  async prepare() {
    const cat = this.emptyCatalog ? EMPTY_CATALOG : catalog;
    return { interpretation: { relation: this.relation }, tenantCatalog: cat, claimExtractor: new CatalogClaimExtractor(cat), catalogDegraded: this.emptyCatalog };
  }
}

const U = (primaryIntent: PrimaryIntent): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [] });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const media = (vehicleKey: string, photoIds: string[]): ProposedEffectPlan => ({ kind: "send_media", planId: "media", order: 1, vehicleKey, photoIds, onSuccess: [] } as ProposedEffectPlan);
function finU(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
function finWithEffects(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding, effects: ProposedEffectPlan[]): AgentBrainStep {
  const step = finU(parts, reasonCode, u);
  if (step.kind !== "final") return step;
  return { ...step, decision: { ...step.decision, proposedEffects: effects } };
}
function qU(call: { tool: string; input: Record<string, unknown> }, u: TurnUnderstanding): AgentBrainStep { return { kind: "query", call: call as never, understanding: u } as AgentBrainStep; }
const resist: BrainResponder = () => finU([txt("Certo!")], "reply", U("other"));
const photoBrain: BrainResponder = (frame, obs) => {
  const understanding: TurnUnderstanding = {
    ...U("request_photos"), requestedCapabilities: ["send_photos"], subject: "selected_vehicle", subjectSource: "memory",
    evidence: [{ capability: "send_photos", quote: (frame.block ?? "").trim() || "fotos" }],
  };
  const photo = [...obs].reverse().find((o) => o.tool === "vehicle_photos_resolve" && o.ok) as Extract<AgentToolObservation, { tool: "vehicle_photos_resolve"; ok: true }> | undefined;
  return photo?.data.photoIds.length
    ? finWithEffects([txt("Aqui estao as fotos que voce pediu.")], "send_vehicle_photos", understanding, [reply, media(photo.data.vehicleKey, photo.data.photoIds)])
    : finU([txt("Vou confirmar as fotos desse veiculo.")], "resolve_vehicle_photos", understanding);
};
const searchUOf = (block: string): TurnUnderstanding => ({ primaryIntent: "search_stock", requestedCapabilities: ["stock_search"], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [{ capability: "stock_search", quote: (block ?? "").trim().split(/\s+/).slice(0, 2).join(" ") || "tem" }], isTopicChange: false, answeredLeadQuestions: [] });
// Busca + lista TODOS os retornados (a LLM obediente ao feedback de LISTAGEM).
const searchB = (input: Record<string, unknown>): BrainResponder => (f, obs: readonly AgentToolObservation[]) => {
  const u = searchUOf(f.block ?? "");
  const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
  if (!so) return qU({ tool: "stock_search", input }, u);
  if (so.data.items.length === 0) return finU([txt("No momento não tenho esse modelo em estoque. Quer ver opções parecidas?")], "reply", u);
  return finU([txt("Encontrei estas opções:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart, txt("Quer ver as fotos de algum deles?")], "reply", u);
};

type Slots = ConversationState["slots"];
type Cap = { outbox: string; committed: boolean; stockCalls: number; stockInput: Record<string, unknown> | null; hasMedia: boolean; mediaKey: string | null; mediaPhotoIds: string[]; src: string | null; slots: Slots | null; selected: string | null; terminalSafe: boolean; primaryIntent: string | null; pf: string[] };
async function turn(persistence: InMemoryPersistence, clock: FakeClock, brain: ScriptedAgentBrain, preparer: RelPreparer, convId: string, seq: number, lead: string, relation: TurnRelation, responder: BrainResponder, ad?: AdContext): Promise<Cap> {
  executed.length = 0; preparer.relation = relation; brain.setResponder(responder);
  const raw = ad ? redact({ text: lead, adContext: ad } as never) : redact({ text: lead });
  await persistence.tryInsert({ eventId: `${convId}-e${seq}`, conversationId: convId, raw, receivedAt: clock.now() });
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
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string; vehicleKey?: string; photoIds?: string[] } }[];
  const media = outbox.find((o) => o.kind === "send_media");
  const st = persistence.load(convId)?.state ?? null;
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed",
    stockCalls: stocks.length, stockInput: stocks.length > 0 ? (stocks[stocks.length - 1].input as Record<string, unknown>) : null,
    hasMedia: !!media, mediaKey: media?.payload?.vehicleKey ?? null, mediaPhotoIds: media?.payload?.photoIds ?? [],
    src: r.status === "committed" ? (r.responseSource ?? null) : null,
    slots: st?.slots ?? null, selected: st?.vehicleContext.selected?.key ?? null,
    terminalSafe: r.status === "committed" ? r.terminalSafe : false,
    primaryIntent: r.status === "committed" ? r.understanding.primaryIntent : null,
    pf: r.status === "committed" ? [...r.policyFeedback] : [],
  };
}
let seq0 = 0;
function conv() {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `wa:f43_${seq0++}`; let s = 0;
  const t = (lead: string, responder?: BrainResponder, opts?: { rel?: TurnRelation; ad?: AdContext }): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, opts?.rel ?? "ambiguous", responder ?? resist, opts?.ad);
  return { t, preparer };
}
const NO_FALLBACK = (c: Cap): boolean => (c.src === "brain_final" || c.src === "brain_retry") && !has(c.outbox, "me conta um pouco mais do que voce procura");

async function main(): Promise<void> {
  console.log("== F2.43: fatos frescos vencem snapshot (fim do exige-e-proíbe) + LLM-first sob falha ==");

  // ── PURO: isVehicleKeyGrounded — fato fresco aterra; inventada não; snapshot segue valendo ──
  {
    const freshFact = { ok: true, tool: "stock_search", data: { items: [CRETA], filtersUsed: {} }, source: "fake" } as QueryResult;
    check("[P-1] key da stock_search do turno aterra MESMO com catálogo vazio", isVehicleKeyGrounded(EMPTY_CATALOG, [freshFact], "rm:creta") === true);
    check("[P-2] key inventada NÃO aterra (nem com catálogo vazio, nem com fato de outro carro)", isVehicleKeyGrounded(EMPTY_CATALOG, [freshFact], "fake:zzz") === false && isVehicleKeyGrounded(catalog, [freshFact], "outrotenant:1") === false);
    check("[P-3] snapshot continua aterrando sem fato do turno", isVehicleKeyGrounded(catalog, [], "rm:onix") === true);
    check("[P-4] fato com ok=false NÃO aterra", isVehicleKeyGrounded(EMPTY_CATALOG, [{ ok: false, tool: "stock_search", error: { code: "UPSTREAM", message: "x", retryable: true } } as QueryResult], "rm:creta") === false);
  }

  // ── A) INCIDENTE: snapshot VAZIO + stock_search com itens -> a LISTA PASSA (0 fallback, 0 recovery) ──
  {
    const c = conv();
    c.preparer.emptyCatalog = true;   // soluço do feed no prepare
    const t1 = await c.t("quero um SUV", searchB({ tipo: "suv" }));
    check("[A-1] catálogo VAZIO + busca com itens -> vehicle_offer_list ACEITA (brain_*, sem recovery)", NO_FALLBACK(t1) && has(t1.outbox, "Encontrei estas opções"), `src=${t1.src} outbox="${t1.outbox.slice(0, 80)}"`);
    check("[A-2] a lista renderizou os carros dos FATOS (Creta/Tucson)", has(t1.outbox, "creta") && has(t1.outbox, "tucson"), `outbox="${t1.outbox.slice(0, 120)}"`);
    check("[A-3] stock_search executada 1x (sem loop de re-busca)", t1.stockCalls === 1, `calls=${t1.stockCalls}`);
  }

  // ── B) key INVENTADA pela LLM continua bloqueada (sem tool no turno) ──
  {
    const c = conv();
    let step = 0;
    const inventor: BrainResponder = () => {
      step += 1;
      if (step === 1) return finU([txt("Tenho uma opção ótima:"), { type: "vehicle_offer_list", vehicleKeys: ["fake:zzz"] } as ResponsePart], "reply", U("other"));
      return finU([txt("Me conta que tipo de carro você procura que eu já te mostro as opções certinhas!")], "reply", U("other"));
    };
    const t1 = await c.t("oi, quero um carro", inventor);
    check("[B-1] key inventada NÃO vai ao lead (deny -> LLM re-autora sem a lista)", !has(t1.outbox, "fake:zzz") && !has(t1.outbox, "Encontrei"), `outbox="${t1.outbox}"`);
    check("[B-2] resposta final é da LLM (brain_retry), não recovery", t1.src === "brain_retry", `src=${t1.src}`);
  }

  // ── C) key de OUTRO TENANT bloqueada MESMO com busca válida no turno; a LLM corrige p/ as keys da tool ──
  {
    const c = conv();
    c.preparer.emptyCatalog = true;
    let step = 0;
    const wrongTenant: BrainResponder = (f, obs: readonly AgentToolObservation[]) => {
      const u = searchUOf(f.block ?? "");
      const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
      if (!so) return qU({ tool: "stock_search", input: { tipo: "suv" } }, u);
      step += 1;
      if (step === 1) return finU([txt("Encontrei estas opções:"), { type: "vehicle_offer_list", vehicleKeys: ["outrotenant:1"] } as ResponsePart], "reply", u);
      return finU([txt("Encontrei estas opções:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart, txt("Quer ver as fotos de algum deles?")], "reply", u);
    };
    const t1 = await c.t("tem SUV?", wrongTenant);
    check("[C-1] key de outro tenant NUNCA vai ao lead; a lista final usa as keys da TOOL", !has(t1.outbox, "outrotenant") && has(t1.outbox, "creta"), `outbox="${t1.outbox.slice(0, 120)}"`);
    check("[C-2] final = brain_retry (a LLM corrigiu com feedback)", t1.src === "brain_retry", `src=${t1.src}`);
  }

  // ── D) MAIS OPÇÕES com snapshot vazio: exclui SÓ os mostrados; itens novos da tool passam ──
  {
    const c = conv();
    c.preparer.emptyCatalog = true;
    const t1 = await c.t("quero um SUV", searchB({ tipo: "suv" }));
    const shown = [CRETA, TUCSON, COMPASS, RENEG].filter((v) => has(t1.outbox, v.modelo)).map((v) => v.vehicleKey);
    const t2 = await c.t("tem outros?", searchB({ tipo: "suv", excludeKeys: shown }));
    check("[D-1] 2ª busca exclui SÓ os mostrados (excludeKeys)", Array.isArray(t2.stockInput?.excludeKeys) && (t2.stockInput!.excludeKeys as string[]).length === shown.length, `exclude=${JSON.stringify(t2.stockInput?.excludeKeys)} shown=${shown.length}`);
    check("[D-2] itens NOVOS da tool passam com snapshot vazio (brain_*, sem recovery)", NO_FALLBACK(t2), `src=${t2.src} outbox="${t2.outbox.slice(0, 100)}"`);
  }

  // ── E) ANÚNCIO ESPECÍFICO com snapshot vazio: fala do Compass 2019; foto "dele" resolve o Compass ──
  {
    const c = conv();
    c.preparer.emptyCatalog = true;
    const adCompass: AdContext = { adId: "1", source: "FB_Ads", sourceUrl: null, title: "Icom", body: "Veículos revisados", greeting: "Olá! Quer saber mais sobre o Jeep Compass 2019?", imageUrls: [], capturedAtTurn: 0 };
    const adResponder: BrainResponder = (f, obs: readonly AgentToolObservation[]) => {
      const u = searchUOf(f.block ?? "");
      const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
      if (!so) return qU({ tool: "stock_search", input: { modelo: "Compass", anos: [2019] } }, u);
      return finU([txt("Que bom que você viu nosso anúncio! Esse é o carro:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart, txt("Quer ver as fotos de algum deles?")], "reply", u);
    };
    const t1 = await c.t("Oi, tenho interesse", adResponder, { ad: adCompass });
    check("[E-1] entrada por anúncio + snapshot vazio -> apresenta o Compass 2019 (fatos frescos)", NO_FALLBACK(t1) && has(t1.outbox, "compass"), `src=${t1.src} outbox="${t1.outbox.slice(0, 120)}"`);
    const t2 = await c.t("me manda fotos dele", photoBrain);
    // O seed do anúncio roda 1 stock_search de ATERRAMENTO (F2.33 P0-A: com snapshot vazio é o que aterra a foto
    // pronominal) — o que a missão proíbe é DESVIAR (listar/oferecer em vez da foto), não o grounding interno.
    check("[E-2] foto 'dele' resolve o COMPASS do anúncio (send_media do mesmo key, sem re-lista)", t2.hasMedia && t2.mediaKey === "rm:compass" && t2.stockCalls <= 1 && !has(t2.outbox, "Encontrei estas opções"), `media=${t2.mediaKey} calls=${t2.stockCalls} outbox="${t2.outbox.slice(0, 80)}"`);
  }

  // ── F) TROCA não vira catálogo: nomear "sua Hilux" PASSA; OFERTAR a Hilux (key inventada) é bloqueado ──
  {
    const c = conv();
    await c.t("quero um Onix", searchB({ modelo: "Onix" }));
    await c.t("gostei do primeiro", () => finU([txt("Boa escolha! Quer ver as condições?")], "reply", { primaryIntent: "select_vehicle", requestedCapabilities: ["select"], subject: "ordinal_from_last_offer", subjectValue: "1", subjectSource: "current_turn", evidence: [{ capability: "select", quote: "primeiro" }], isTopicChange: false, answeredLeadQuestions: [] }));
    await c.t("quais as condições?", () => finU([txt("Perfeito! Para eu te passar as condições, você tem algum carro para dar de troca?")], "reply", U("other")));
    let step = 0;
    const tradeOfferer: BrainResponder = () => {
      step += 1;
      if (step === 1) return finU([txt("Perfeito! Temos essa opção:"), { type: "vehicle_offer_list", vehicleKeys: ["lead:hilux"] } as ResponsePart], "reply", U("trade_in"));
      return finU([txt("Perfeito! Anotei sua Hilux 2020 com 85 mil km para avaliação na troca. Você pretende dar algum valor de entrada?")], "reply", U("trade_in"));
    };
    const t4 = await c.t("tenho uma Hilux 2020 85km rodados", tradeOfferer);
    check("[F-1] OFERTA da Hilux do lead (key não-factual) BLOQUEADA; acolhimento nomeando 'sua Hilux' PASSA", !has(t4.outbox, "Temos essa opção") && has(t4.outbox, "hilux") && has(t4.outbox, "entrada"), `outbox="${t4.outbox}"`);
    check("[F-2] veiculoTroca gravado + 0 stock_search + brain_retry", (t4.slots?.veiculoTroca.status === "known") && t4.stockCalls === 0 && t4.src === "brain_retry", `veic=${JSON.stringify(t4.slots?.veiculoTroca.value)} calls=${t4.stockCalls} src=${t4.src}`);
  }

  // ── G) FINANCEIRO: "tenho 8k" (entrada) e "até 2100" (parcela) -> 0 busca, slots certos ──
  {
    const c = conv();
    await c.t("quero um Onix", searchB({ modelo: "Onix" }));
    await c.t("gostei do primeiro", () => finU([txt("Boa escolha! Quer ver as condições?")], "reply", { primaryIntent: "select_vehicle", requestedCapabilities: ["select"], subject: "ordinal_from_last_offer", subjectValue: "1", subjectSource: "current_turn", evidence: [{ capability: "select", quote: "primeiro" }], isTopicChange: false, answeredLeadQuestions: [] }));
    await c.t("quais as condições?", () => finU([txt("Show! Você pretende dar algum valor de entrada?")], "reply", U("other")));
    const t4 = await c.t("tenho 8k", () => finU([txt("Anotado! E qual parcela mensal caberia no seu orçamento?")], "reply", U("financing")));
    check("[G-1] 'tenho 8k' -> entrada=8000, 0 stock_search", t4.slots?.entrada.value === 8000 && t4.stockCalls === 0, `entrada=${JSON.stringify(t4.slots?.entrada.value)} calls=${t4.stockCalls}`);
    const t5 = await c.t("até 2100", () => finU([txt("Perfeito! Vou te passar as melhores condições. Prefere agendar uma visita para ver o carro?")], "reply", U("financing")));
    check("[G-2] 'até 2100' -> parcelaDesejada=2100 (não vira busca/faixaPreco)", t5.slots?.parcelaDesejada.value === 2100 && t5.stockCalls === 0 && t5.slots?.faixaPreco.status !== "known", `parcela=${JSON.stringify(t5.slots?.parcelaDesejada.value)} calls=${t5.stockCalls}`);
  }

  // ── H) CONTESTAÇÃO com snapshot vazio: 0 busca, sem re-lista, a LLM reconhece/corrige ──
  {
    const c = conv();
    c.preparer.emptyCatalog = true;
    await c.t("tem sedan?", searchB({ tipo: "sedan" }));   // 0 sedans no stock -> honesto
    const t2 = await c.t("tem onix?", searchB({ modelo: "Onix" }));
    check("[H-0] setup: lista o Onix com snapshot vazio", has(t2.outbox, "onix"), `outbox="${t2.outbox.slice(0, 100)}"`);
    const t3 = await c.t("Onix nao e um carro? pq disse que nao tinha?", () => finU([txt("Você tem razão, me desculpe pela confusão! Eu quis dizer que não tinha sedans — o Onix que te mostrei é um hatch. Quer ver as condições dele?")], "conversation_repair", U("conversation_repair")));
    check("[H-1] contestação: 0 stock_search, brain_*, sem re-lista", t3.stockCalls === 0 && NO_FALLBACK(t3) && !has(t3.outbox, "Encontrei estas opções"), `calls=${t3.stockCalls} src=${t3.src} outbox="${t3.outbox.slice(0, 100)}"`);
    check("[H-2] primaryIntent=conversation_repair", t3.primaryIntent === "conversation_repair", `intent=${t3.primaryIntent}`);
  }

  // ── I) MAIS FOTOS com snapshot vazio: próximo lote do MESMO veículo, 0 stock_search ──
  {
    const c = conv();
    c.preparer.emptyCatalog = true;
    await c.t("tem onix?", searchB({ modelo: "Onix" }));
    const t2 = await c.t("me manda fotos do onix", photoBrain);
    check("[I-1] fotos do Onix com snapshot vazio (send_media, lote 1)", t2.hasMedia && t2.mediaKey === "rm:onix" && t2.mediaPhotoIds.length > 0, `media=${t2.mediaKey} n=${t2.mediaPhotoIds.length}`);
    const t3 = await c.t("tem mais fotos?", photoBrain);
    check("[I-2] 'tem mais fotos?' -> PRÓXIMO lote do MESMO Onix, sem repetir, 0 stock_search", t3.hasMedia && t3.mediaKey === "rm:onix" && t3.mediaPhotoIds.length > 0 && t3.mediaPhotoIds.every((id) => !t2.mediaPhotoIds.includes(id)) && t3.stockCalls === 0, `t2=${t2.mediaPhotoIds.join(",")} t3=${t3.mediaPhotoIds.join(",")} calls=${t3.stockCalls}`);
  }

  // ── J) FALHA REAL da tool: a LLM responde HONESTA (brain_*), não inventa, não lista, sem fallback genérico ──
  {
    const c = conv();
    stockFails = true;
    const honest: BrainResponder = (f, obs: readonly AgentToolObservation[]) => {
      const u = searchUOf(f.block ?? "");
      const tried = obs.some((o) => o.tool === "stock_search");
      if (!tried) return qU({ tool: "stock_search", input: { tipo: "suv" } }, u);
      // ⭐Codex rodada 2: honestidade SEM oferecer consultor (promessa sem efeito é deny) e SEM pergunta mista.
      return finU([txt("Estou com uma instabilidade para consultar o estoque neste exato momento 😕 Me diz o modelo que você procura, por favor?")], "reply", u);
    };
    const t1 = await c.t("quero um SUV", honest);
    stockFails = false;
    check("[J-1] falha real da tool -> resposta HONESTA da LLM (brain_*), sem lista inventada", NO_FALLBACK(t1) && !has(t1.outbox, "Encontrei estas opções") && has(t1.outbox, "instabilidade"), `src=${t1.src} outbox="${t1.outbox.slice(0, 120)}"`);
    check("[J-2] não fabricou send_media/oferta", !t1.hasMedia, `hasMedia=${t1.hasMedia}`);
  }

  // ── K/L) ECO do valor DO LEAD passa (audit Codex T9/T10): "Tenho 8k de entrada" -> "R$ 8.000 anotado" = brain_*,
  //        MESMO com a pergunta pendente sendo de TROCA (o slot pode nem estar no estado na hora da validação —
  //        o aterro vem da PROVENIÊNCIA: valor escrito no bloco atual + projeção dos slots extraídos). ──
  {
    const c = conv();
    await c.t("quero um Onix", searchB({ modelo: "Onix" }));
    await c.t("gostei do primeiro", () => finU([txt("Boa escolha! Quer ver as condições de pagamento?")], "reply", { primaryIntent: "select_vehicle", requestedCapabilities: ["select"], subject: "ordinal_from_last_offer", subjectValue: "1", subjectSource: "current_turn", evidence: [{ capability: "select", quote: "primeiro" }], isTopicChange: false, answeredLeadQuestions: [] }));
    await c.t("quais as condições?", () => finU([txt("Perfeito! Você tem algum carro para dar de troca?")], "reply", U("other")));
    const t4 = await c.t("Tenho 8k de entrada", () => finU([txt("Perfeito! R$ 8.000 de entrada anotado. Você tem carro pra dar na troca também?")], "reply", U("financing")));
    check("[K-1] eco 'R$ 8.000' do valor DO LEAD passa (brain_*, sem fallback, 0 busca)", (t4.src === "brain_final" || t4.src === "brain_retry") && has(t4.outbox, "8.000") && t4.stockCalls === 0 && NO_FALLBACK(t4), `src=${t4.src} outbox="${t4.outbox}" pf=${JSON.stringify(t4.pf.map((f) => f.slice(0, 90)))}`);
    const t5 = await c.t("Até 2100 de parcela", () => finU([txt("Show! Parcela de até R$ 2.100 anotada. Quer agendar uma visita pra ver o carro?")], "reply", U("financing")));
    check("[L-1] eco 'R$ 2.100' da parcela DO LEAD passa (brain_*, 0 busca)", (t5.src === "brain_final" || t5.src === "brain_retry") && has(t5.outbox, "2.100") && t5.stockCalls === 0, `src=${t5.src} outbox="${t5.outbox}"`);
    check("[L-2] slots: entrada=8000 + parcelaDesejada=2100 (faixaPreco intacta)", t5.slots?.entrada.value === 8000 && t5.slots?.parcelaDesejada.value === 2100 && t5.slots?.faixaPreco.status !== "known", `entrada=${JSON.stringify(t5.slots?.entrada.value)} parcela=${JSON.stringify(t5.slots?.parcelaDesejada.value)}`);
  }

  // ── M) ADVERSARIAL: a LLM INVENTA um valor calculado (saldo) que o lead NÃO disse -> deny -> re-autora sem ele ──
  {
    const c = conv();
    await c.t("quero um Onix", searchB({ modelo: "Onix" }));
    await c.t("gostei do primeiro", () => finU([txt("Boa escolha! Quer ver as condições de pagamento?")], "reply", { primaryIntent: "select_vehicle", requestedCapabilities: ["select"], subject: "ordinal_from_last_offer", subjectValue: "1", subjectSource: "current_turn", evidence: [{ capability: "select", quote: "primeiro" }], isTopicChange: false, answeredLeadQuestions: [] }));
    await c.t("quais as condições?", () => finU([txt("Perfeito! Você tem algum carro para dar de troca?")], "reply", U("other")));
    let step = 0;
    const inventor: BrainResponder = () => {
      step += 1;
      if (step === 1) return finU([txt("Perfeito! Com R$ 8.000 de entrada, o saldo fica em R$ 54.000 para financiar.")], "reply", U("financing"));
      return finU([txt("Perfeito! R$ 8.000 de entrada anotado. Qual parcela caberia no seu orçamento?")], "reply", U("financing"));
    };
    const t4 = await c.t("Tenho 8k de entrada", inventor);
    check("[M-1] valor CALCULADO (54.000) que o lead não disse é NEGADO; o eco do valor dele (8.000) passa no retry", !has(t4.outbox, "54.000") && has(t4.outbox, "8.000") && t4.src === "brain_retry", `src=${t4.src} outbox="${t4.outbox}"`);
  }

  console.log(`\n== F2.43: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { for (const f of fails) console.error("  FALHOU: " + f); process.exit(1); }
}

main().catch((err) => { console.error(err); process.exit(1); });
