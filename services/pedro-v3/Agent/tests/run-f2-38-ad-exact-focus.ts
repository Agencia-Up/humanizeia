// ============================================================================
// F2.38 — Missão P0 CTWA: anúncio ESPECÍFICO = FOCO no veículo EXATO (não filtro amplo).
//  Anúncio "Jeep Compass 2019" -> a 1ª interação fala do Compass 2019 (busca modelo+ANO), NÃO lista o Compass 2017.
//  Alternativas ("tem outro Compass?") só quando o lead pede -> aí relaxa para o modelo (lista outros anos).
//  Mudança de intenção ("quero Onix") -> o anúncio não prende. Sem match exato -> honesto, não lista outros.
//   npx tsx tests/run-f2-38-ad-exact-focus.ts
// ============================================================================
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { resolveAdFocusedVehicle, asksAdAlternatives } from "../src/engine/ad-context.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, EffectReceipt, EffectResult } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import type { AdContext } from "../src/domain/conversation-state.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-08T12:00:00.000Z", SHA = "sha-38";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

const CMP17: VehicleFact = { vehicleKey: "rm:cmp17", marca: "Jeep", modelo: "Compass", ano: 2017, preco: 92990, km: 88000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const CMP19: VehicleFact = { vehicleKey: "rm:cmp19", marca: "Jeep", modelo: "Compass", ano: 2019, preco: 96990, km: 82000, cambio: "Automatico", cor: "Cinza", tipo: "suv" };
const ONIX: VehicleFact = { vehicleKey: "rm:onix", marca: "Chevrolet", modelo: "Onix", ano: 2016, preco: 51990, km: 93000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const STOCK = [CMP17, CMP19, ONIX];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: "Rua Teste 100, Taubaté", hours: null, unit: "Icom", source: "test" }; } });
const PHOTOS: Record<string, string[]> = { "rm:cmp19": ["c1", "c2", "c3", "c4", "c5", "c6"], "rm:cmp17": ["d1", "d2"] };

const adCompass19: AdContext = { adId: "1", source: "FB_Ads", sourceUrl: null, title: "Icom", body: "Veículos revisados", greeting: "Olá! Quer saber mais sobre o Jeep Compass 2019?", imageUrls: [], capturedAtTurn: 0 };
const adCompass15: AdContext = { adId: "2", source: "FB_Ads", sourceUrl: null, title: "Icom", body: "", greeting: "Olá! Quer saber mais sobre o Jeep Compass 2015?", imageUrls: [], capturedAtTurn: 0 };
const adGeneric: AdContext = { adId: "3", source: "instagram", sourceUrl: null, title: "Icom", body: "", greeting: "Oi! Como podemos ajudar? Venha conhecer nosso estoque!", imageUrls: [], capturedAtTurn: 0 };

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
    if (Array.isArray(inp.anos) && inp.anos.length > 0) items = items.filter((v) => inp.anos!.includes(v.ano));   // ANO RÍGIDO
    if (inp.excludeKeys) items = items.filter((v) => !inp.excludeKeys!.includes(v.vehicleKey));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: PHOTOS[key] ?? ["p1", "p2"] }, source: "fake" } as QueryResult; }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; } }

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
const currentEvidence = (frame: Parameters<BrainResponder>[0], capability: "stock_search" | "send_photos") => ({
  capability,
  quote: (frame.block ?? "").trim() || "Olá",
});
const searchU = (frame: Parameters<BrainResponder>[0], subjectValue: string): TurnUnderstanding => ({
  ...U("search_stock"),
  requestedCapabilities: ["stock_search"],
  subject: "explicit_model",
  subjectValue,
  subjectSource: "current_turn",
  evidence: [currentEvidence(frame, "stock_search")],
});
const photoIntentU = (frame: Parameters<BrainResponder>[0]): TurnUnderstanding => ({
  ...U("request_photos"),
  requestedCapabilities: ["send_photos"],
  subject: "selected_vehicle",
  subjectSource: "memory",
  evidence: [currentEvidence(frame, "send_photos")],
});
const authored: BrainResponder = (frame, obs) => {
  const photo = [...obs].reverse().find((o) => o.tool === "vehicle_photos_resolve" && o.ok) as Extract<import("../src/domain/agent-brain.ts").AgentToolObservation, { tool: "vehicle_photos_resolve"; ok: true }> | undefined;
  const photoU = photoIntentU(frame);
  if (photo?.data.photoIds.length) {
    return finWithEffects([txt("Aqui estao as fotos do veiculo que voce pediu.")], "send_vehicle_photos", photoU, [reply, media(photo.data.vehicleKey, photo.data.photoIds)]);
  }
  const stock = [...obs].reverse().find((o) => o.tool === "stock_search" && o.ok) as Extract<import("../src/domain/agent-brain.ts").AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
  const block = norm(frame.block ?? "");
  const adVehicle = norm(String((frame.signals as { adVehicle?: string | null }).adVehicle ?? ""));
  const requestedModel = block.includes("onix") ? "Onix" : "Compass";
  const currentSearchU = searchU(frame, requestedModel);
  if (stock) {
    if (stock.data.items.length === 0) {
      const adLabel = String((frame.signals as { adVehicle?: string | null }).adVehicle ?? "veiculo do anuncio");
      return finU([txt(`Nao encontrei ${adLabel} no estoque agora.`)], "stock_empty", currentSearchU);
    }
    const intro = stock.data.items.length === 1 && (frame.signals as { specificAdEntry?: boolean }).specificAdEntry
      ? `Encontrei o ${stock.data.items[0]!.marca} ${stock.data.items[0]!.modelo} ${stock.data.items[0]!.ano} do anuncio:`
      : "Encontrei estas opcoes:";
    return finU([txt(intro), { type: "vehicle_offer_list", vehicleKeys: stock.data.items.map((v) => v.vehicleKey) } as ResponsePart], "offer_stock", currentSearchU);
  }
  if (block.includes("foto")) {
    return qU({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: "rm:cmp19" } } }, photoU);
  }
  if (block.includes("onix")) {
    return qU({ tool: "stock_search", input: { marca: "Chevrolet", modelo: "Onix" } }, currentSearchU);
  }
  if (block.includes("outro") && block.includes("compass")) {
    const years = block.includes("2018") ? { anos: [2018] } : {};
    return qU({ tool: "stock_search", input: { marca: "Jeep", modelo: "Compass", ...years, excludeKeys: ["rm:cmp19"] } }, currentSearchU);
  }
  if (adVehicle.includes("compass 2015")) {
    return qU({ tool: "stock_search", input: { marca: "Jeep", modelo: "Compass", anos: [2015] } }, currentSearchU);
  }
  if (adVehicle.includes("compass 2019")) {
    return qU({ tool: "stock_search", input: { marca: "Jeep", modelo: "Compass", anos: [2019] } }, currentSearchU);
  }
  return resist(frame, obs, 0);
};
const searchCompassU: TurnUnderstanding = { primaryIntent: "search_stock", requestedCapabilities: ["stock_search"], subject: "explicit_model", subjectValue: "Compass", subjectSource: "current_turn", evidence: [{ capability: "stock_search", quote: "compass" }], isTopicChange: false, answeredLeadQuestions: [] };
// A LLM interpreta "outro" como uma nova busca do mesmo modelo, sem herdar o
// ano do anúncio. O engine não corrige semanticamente os argumentos depois.
const brainChoosesAlternative: BrainResponder = (frame, obs) => {
  const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<import("../src/domain/agent-brain.ts").AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
  const u = searchU(frame, "Compass");
  if (!so) return qU({ tool: "stock_search", input: { modelo: "Compass", marca: "Jeep", excludeKeys: ["rm:cmp19"] } }, u);
  return finU([txt("Encontrei:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart], "reply", u);
};

// Reproduz o P0 visto com o gpt-4.1-mini no anuncio do Fastback: a tool retorna
// o carro certo, mas o primeiro draft usa texto livre em vez da estrutura
// segura. O engine deve devolver as keys aterradas ao MESMO cerebro e a LLM
// deve reescrever; a abertura generica nunca pode esconder esse feedback.
const malformedOpeningThenList: BrainResponder = (_f, obs) => {
  const currentU: TurnUnderstanding = {
    ...searchCompassU,
    evidence: [{ capability: "stock_search", quote: "desse carro" }],
  };
  const stock = [...obs].reverse().find((o) => o.tool === "stock_search" && o.ok) as Extract<import("../src/domain/agent-brain.ts").AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
  const listFeedback = [...obs].reverse().find((o) => o.tool === "response" && !o.ok && o.error.message.includes("Turno de LISTAGEM"));
  if (listFeedback && stock) {
    return finU([
      txt("Encontrei o veiculo exato do anuncio:"),
      { type: "vehicle_offer_list", vehicleKeys: stock.data.items.map((v) => v.vehicleKey) } as ResponsePart,
      txt("Quer ver as fotos dele ou saber mais detalhes?"),
    ], "ad_exact_offer", currentU);
  }
  if (stock) return finU([txt("Tenho um Jeep Compass 2019 por R$ 96.990 para voce. Quer fotos?")], "malformed_free_text_offer", currentU);
  return qU({ tool: "stock_search", input: { modelo: "Compass", marca: "Jeep", anos: [2019] } }, currentU);
};

const proactivePhotoThenList: BrainResponder = (_f, obs) => {
  const u: TurnUnderstanding = {
    ...searchCompassU,
    primaryIntent: "vehicle_detail",
    requestedCapabilities: ["send_photos", "stock_search"],
    evidence: [
      { capability: "send_photos", quote: "desse carro" },
      { capability: "stock_search", quote: "desse carro" },
    ],
  };
  const stock = [...obs].reverse().find((o) => o.tool === "stock_search" && o.ok) as Extract<import("../src/domain/agent-brain.ts").AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
  if (stock) return finU([txt("Encontrei o veiculo do anuncio:"), { type: "vehicle_offer_list", vehicleKeys: stock.data.items.map((v) => v.vehicleKey) } as ResponsePart, txt("Quer ver as fotos dele?")], "ad_offer", u);
  const photoDenied = obs.some((o) => o.tool === "response" && !o.ok && o.error.message.includes("nao pediu nem aceitou fotos"));
  if (photoDenied) return qU({ tool: "stock_search", input: { modelo: "Compass", marca: "Jeep", anos: [2019] } }, u);
  return qU({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: "rm:cmp19" } } }, u);
};

type Cap = { outbox: string; committed: boolean; hasMedia: boolean; mediaKey: string | null; mediaPhotoIds: string[]; photoResolveCalls: number; stockInput: Record<string, unknown> | null; src: string | null };
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
  const stock = [...executed].reverse().find((e) => e.tool === "stock_search");
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string; vehicleKey?: string; photoIds?: string[] } }[];
  const media = outbox.find((o) => o.kind === "send_media");
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed",
    hasMedia: !!media, mediaKey: media?.payload?.vehicleKey ?? null, mediaPhotoIds: media?.payload?.photoIds ?? [],
    photoResolveCalls: executed.filter((call) => call.tool === "vehicle_photos_resolve").length,
    stockInput: stock ? (stock.input as Record<string, unknown>) : null, src: r.status === "committed" ? (r.responseSource ?? null) : null,
  };
}
let seq0 = 0;
function conv() {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `wa:f38_${seq0++}`; let s = 0;
  const t = (lead: string, opts?: { rel?: TurnRelation; responder?: BrainResponder; ad?: AdContext }): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, opts?.rel ?? "ambiguous", opts?.responder ?? authored, opts?.ad);
  return { t };
}

async function main(): Promise<void> {
  console.log("== F2.38: anúncio específico = foco no veículo EXATO ==");

  // ── PURO ──
  check("[U-1] resolveAdFocusedVehicle(Compass 2019) -> {modelo:Compass, ano:2019, marca:Jeep}", (() => { const f = resolveAdFocusedVehicle(adCompass19, extractor); return has(String(f?.modelo ?? ""), "compass") && f?.ano === 2019 && has(String(f?.marca ?? ""), "jeep"); })());
  check("[U-2] resolveAdFocusedVehicle(genérico sem modelo) -> null", resolveAdFocusedVehicle(adGeneric, extractor) === null);
  check("[U-3] asksAdAlternatives('tem outro Compass?') -> true; ('esse ainda tem?') -> false", asksAdAlternatives("tem outro Compass?") === true && asksAdAlternatives("esse ainda tem?") === false);
  check("[U-4] asksAdAlternatives('tem mais barato?') -> true", asksAdAlternatives("tem mais barato?") === true);

  // ── AD-1: anúncio Compass 2019 + "Olá" -> busca modelo+ANO 2019, lista SÓ o 2019 (não 2017) ──
  {
    const c = conv();
    const t1 = await c.t("Olá", { ad: adCompass19 });
    check("[AD-1] T1 busca com anos=[2019] (foco EXATO do anúncio)", Array.isArray(t1.stockInput?.anos) && (t1.stockInput!.anos as number[]).includes(2019), `input=${JSON.stringify(t1.stockInput)}`);
    check("[AD-1b] a resposta fala do Compass 2019 e NÃO lista o 2017", has(t1.outbox, "2019") && !has(t1.outbox, "2017"), `outbox="${t1.outbox}"`);
    check("[AD-1c] não pede telefone/nome", !has(t1.outbox, "telefone") && !has(t1.outbox, "seu nome"), `outbox="${t1.outbox}"`);
    check("[AD-1d] polimento: 1 resultado do foco -> texto SINGULAR nomeando 'do anúncio' (não 'estas opções')", has(t1.outbox, "do anuncio") && !has(t1.outbox, "estas opcoes"), `outbox="${t1.outbox}"`);
  }

  // P0: o feedback factual de listagem deve vencer a orientacao generica de
  // abertura. A LLM continua sendo a autora e converge em brain_retry.
  {
    const c = conv();
    const t1 = await c.t("Boa tarde, queria saber mais desse carro", { ad: adCompass19, responder: malformedOpeningThenList });
    check("[AD-1e] draft livre invalido na abertura -> LLM reautora com a key real", t1.src === "brain_retry" && has(t1.outbox, "Compass") && has(t1.outbox, "2019"), `src=${t1.src} outbox="${t1.outbox}"`);
    check("[AD-1f] abertura corrigida nao cai em fallback nem oferece outro ano", !has(t1.outbox, "2017") && !has(t1.outbox, "nao consegui"), `outbox="${t1.outbox}"`);
  }

  {
    const c = conv();
    const t1 = await c.t("Boa tarde, queria saber mais desse carro", { ad: adCompass19, responder: proactivePhotoThenList });
    check("[AD-1g] oferecer foto nao autoriza prefetch: zero vehicle_photos_resolve sem pedido", t1.photoResolveCalls === 0, `photoCalls=${t1.photoResolveCalls}`);
    check("[AD-1h] a LLM segue livre para oferecer fotos depois de apresentar o carro", has(t1.outbox, "Compass") && has(t1.outbox, "fotos"), `outbox="${t1.outbox}"`);
  }

  // ── AD-2: anúncio Compass 2019 + "me manda fotos dele" -> send_media do 2019, <=5 fotos ──
  {
    const c = conv();
    await c.t("esse ainda tem?", { ad: adCompass19 });   // T1 apresenta o Compass 2019
    const t2 = await c.t("me manda fotos dele");
    check("[AD-2] T2 envia send_media do Compass 2019 exato (rm:cmp19)", t2.hasMedia && t2.mediaKey === "rm:cmp19", `hasMedia=${t2.hasMedia} key=${t2.mediaKey}`);
    check("[AD-2b] no máximo 5 fotos (curadoria)", t2.mediaPhotoIds.length > 0 && t2.mediaPhotoIds.length <= 5, `n=${t2.mediaPhotoIds.length}`);
  }

  // ── AD-3: após anúncio Compass 2019, "tem outro Compass?" -> AÍ SIM lista outros (2017 + 2019), sem ano preso ──
  {
    const c = conv();
    await c.t("esse ainda tem?", { ad: adCompass19 });   // T1: foco 2019
    const t2 = await c.t("tem outro Compass?");
    check("[AD-3] T2 'tem outro Compass?' NÃO filtra por ano (relaxa p/ o modelo)", !t2.stockInput?.anos || (t2.stockInput!.anos as number[]).length === 0, `input=${JSON.stringify(t2.stockInput)}`);
    // "outro Compass" = OUTRO (não o 2019 já mostrado): lista o Compass 2017 (o alternativo). Prova que o ano relaxou.
    check("[AD-3b] T2 lista o OUTRO Compass (2017), agora que o lead pediu alternativa", has(t2.outbox, "2017") && has(t2.outbox, "Compass"), `outbox="${t2.outbox}"`);
  }
  // ── AD-3c: a própria LLM interpreta a alternativa sem herdar o ano do anúncio ──
  {
    const c = conv();
    await c.t("esse ainda tem?", { ad: adCompass19 });
    const t2 = await c.t("tem outro compass?", { responder: brainChoosesAlternative });
    check("[AD-3c] LLM pede o outro Compass sem ano herdado; engine preserva a decisão", !t2.stockInput?.anos || (t2.stockInput!.anos as number[]).length === 0, `input=${JSON.stringify(t2.stockInput)}`);
    check("[AD-3c2] preserva modelo Compass na chamada executada", has(String(t2.stockInput?.modelo ?? ""), "compass"), `input=${JSON.stringify(t2.stockInput)}`);
  }
  // ── AD-3d: se o LEAD cita o ano ("tem outro Compass 2018?"), RESPEITA o ano do lead (não dropa) — engine força a busca ──
  {
    const c = conv();
    await c.t("esse ainda tem?", { ad: adCompass19 });
    const t2 = await c.t("tem outro Compass 2018?");   // resist -> engine força a busca com o ano do LEAD (2018)
    check("[AD-3d] lead citou 2018 -> a busca RESPEITA o ano do lead (não é o ano do anúncio)", Array.isArray(t2.stockInput?.anos) && (t2.stockInput!.anos as number[]).includes(2018) && !(t2.stockInput!.anos as number[]).includes(2019), `input=${JSON.stringify(t2.stockInput)}`);
  }

  // ── AD-4: após anúncio Compass 2019, "na verdade quero Onix" -> busca Onix, anúncio não prende ──
  {
    const c = conv();
    await c.t("esse ainda tem?", { ad: adCompass19 });
    const t2 = await c.t("na verdade quero Onix");
    check("[AD-4] T2 busca Onix (não Compass) e sem ano do anúncio", has(String(t2.stockInput?.modelo ?? ""), "onix") && !has(String(t2.stockInput?.modelo ?? ""), "compass") && (!t2.stockInput?.anos || (t2.stockInput!.anos as number[]).length === 0), `input=${JSON.stringify(t2.stockInput)}`);
    check("[AD-4b] resposta traz o Onix, não fica presa no Compass", has(t2.outbox, "Onix") && !has(t2.outbox, "Compass"), `outbox="${t2.outbox}"`);
  }

  // ── AD-5: anúncio Compass 2015 (estoque NÃO tem 2015) + "Olá" -> honesto, NÃO lista 2017/2019 por conta própria ──
  {
    const c = conv();
    const t1 = await c.t("Olá", { ad: adCompass15 });
    check("[AD-5] T1 busca com anos=[2015] (foco exato do anúncio)", Array.isArray(t1.stockInput?.anos) && (t1.stockInput!.anos as number[]).includes(2015), `input=${JSON.stringify(t1.stockInput)}`);
    check("[AD-5b] sem match exato -> honesto (nomeia Compass 2015), NÃO lista 2017/2019 como se fosse o do anúncio", !has(t1.outbox, "2017") && !has(t1.outbox, "2019"), `outbox="${t1.outbox}"`);
  }

  // ── AD-6: anúncio GENÉRICO + "Olá" -> discovery comercial, não nome/telefone ──
  {
    const c = conv();
    // ⭐RD1-2: abertura de anúncio genérico = descoberta (ADVISORY). A LLM advertida descobre de 1ª; o engine ENTREGA (brain_final).
    const discoverOpening: BrainResponder = () => finU([txt("Olá! Que bom que veio pelo anúncio. Você procura um modelo, um tipo de carro ou uma faixa de preço?")], "reply", U("smalltalk"));
    const t1 = await c.t("Olá", { ad: adGeneric, responder: discoverOpening });
    check("[AD-6] anúncio genérico não abre pedindo nome (discovery)", !has(t1.outbox, "seu nome"), `outbox="${t1.outbox}"`);
    check("[AD-6b] não pede telefone", !has(t1.outbox, "telefone"), `outbox="${t1.outbox}"`);
  }

  console.log(`\n== F2.38: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
