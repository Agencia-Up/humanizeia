// ============================================================================
// F2.37 — Missão: ABERTURA SDR melhor (PARTE A) + SELEÇÃO INTELIGENTE de fotos (PARTE B).
//  PARTE A: sinais de abertura (firstContactNoCommercialTarget / specificAdEntry) + guardrail deny+feedback (o cérebro
//           reescreve) — abertura sem alvo NÃO começa pedindo nome; anúncio específico entrega o veículo do anúncio.
//  PARTE B: photo-selection puro (cap 5 + diversidade por espaçamento + dedup) + curadoria no engine (send_media com <=5,
//           "manda mais" = próximo lote sem repetir, veículo com 3 fotos envia 3, ordinal escolhe o carro certo, negação
//           não envia mídia, WM registra/usa os photoIds enviados).
//   npx tsx tests/run-f2-37-opening-and-photo-selection.ts
// ============================================================================
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { selectPhotos, spaceIndices, MAX_INITIAL_PHOTOS } from "../src/engine/photo-selection.ts";
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
import type { AdContext } from "../src/domain/conversation-state.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-08T12:00:00.000Z", SHA = "sha-37";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

// Estoque: SUV_A (3 fotos) e SUV_B (12 fotos, é o 2º da lista) para o cap; HB20 p/ anúncio específico.
const SUV_A: VehicleFact = { vehicleKey: "rm:suvA", marca: "Hyundai", modelo: "Creta", ano: 2021, preco: 88000, km: 40000, cambio: "Automatico", cor: "Prata", tipo: "suv" };
const SUV_B: VehicleFact = { vehicleKey: "rm:suvB", marca: "Jeep", modelo: "Renegade", ano: 2020, preco: 92000, km: 55000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const HB20: VehicleFact = { vehicleKey: "rm:hb20", marca: "Hyundai", modelo: "HB20", ano: 2020, preco: 73990, km: 60000, cambio: "Automatico", cor: "Prata", tipo: "hatch" };
const STOCK = [SUV_A, SUV_B, HB20];   // ordem importa: SUV_A antes de SUV_B -> ordinal 2 = SUV_B
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: "Rua Teste 100, Taubaté", hours: null, unit: "Icom", source: "test" }; } });

// Fotos por veículo: SUV_B = 12, SUV_A = 3, HB20 = 2.
const PHOTOS: Record<string, string[]> = {
  "rm:suvB": ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10", "b11", "b12"],
  "rm:suvA": ["a1", "a2", "a3"],
  "rm:hb20": ["h1", "h2"],
};
const adGeneric: AdContext = { adId: "1", source: "FB_Ads", sourceUrl: null, title: "Icom Motors", body: "", greeting: "Oi! Como podemos ajudar? Venha conhecer nosso estoque!", imageUrls: [], capturedAtTurn: 0 };
const adHB20: AdContext = { adId: "2", source: "FB_Ads", sourceUrl: null, title: "HB20 1.0", body: "Hatch econômico", greeting: "Olá! Quer saber mais sobre o Hyundai HB20 2020?", imageUrls: [], capturedAtTurn: 0 };

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { marca?: string; modelo?: string; tipo?: string; precoMax?: number; cambio?: string; excludeKeys?: string[]; broad?: boolean };
    let items = STOCK.slice();
    if (inp.marca) { const m = norm(inp.marca); items = items.filter((v) => norm(v.marca).includes(m) || m.includes(norm(v.marca))); }
    if (inp.modelo) { const toks = norm(inp.modelo).split(/\s+/).filter(Boolean); items = items.filter((v) => { const vt = norm(`${v.marca} ${v.modelo}`); return inp.broad ? toks.some((t) => vt.includes(t)) : toks.every((t) => vt.includes(t)); }); }
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (typeof inp.precoMax === "number") items = items.filter((v) => (v.preco ?? Infinity) <= inp.precoMax!);
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
const searchU: TurnUnderstanding = { primaryIntent: "search_stock", requestedCapabilities: ["stock_search"], subject: "vehicle_type", subjectValue: "suv", subjectSource: "current_turn", evidence: [{ capability: "stock_search", quote: "suv" }], isTopicChange: false, answeredLeadQuestions: [] };
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
function finU(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
function qU(call: { tool: string; input: Record<string, unknown> }, u: TurnUnderstanding): AgentBrainStep { return { kind: "query", call: call as never, understanding: u } as AgentBrainStep; }
const resist: BrainResponder = () => finU([txt("Certo!")], "reply", U("other"));
const photoRequest = (quote: string, subject: "ordinal_from_last_offer" | "selected_vehicle", subjectValue: string | null = null): BrainResponder => () => finU(
  [txt("Vou enviar as fotos do carro que você pediu.")],
  "send_vehicle_photos",
  {
    ...U("request_photos"), requestedCapabilities: ["send_photos"], subject, subjectValue,
    subjectSource: subject === "selected_vehicle" ? "memory" : "current_turn",
    evidence: [{ capability: "send_photos", quote }],
  },
);
// Responder que LISTA SUVs (query stock_search{tipo:suv} -> final com offer_list dos keys retornados).
const listSuvs: BrainResponder = (_f, obs: readonly AgentToolObservation[]) => {
  const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
  if (!so) return qU({ tool: "stock_search", input: { tipo: "suv" } }, searchU);
  const keys = so.data.items.map((i) => i.vehicleKey);
  return finU([txt("Encontrei estas opções:"), { type: "vehicle_offer_list", vehicleKeys: keys } as ResponsePart], "reply", searchU);
};

type Cap = { outbox: string; committed: boolean; hasMedia: boolean; mediaKey: string | null; mediaPhotoIds: string[]; src: string | null; exec: string[]; reasonCode: string | null };
type Conv = { t: (lead: string, opts?: { rel?: TurnRelation; responder?: BrainResponder; ad?: AdContext }) => Promise<Cap>; brain: ScriptedAgentBrain };
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
  // aplica receipts p/ o ledger de foto (accepted) — como o smoke real: popula lastPhotoAction (dedup de "manda mais").
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
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string; vehicleKey?: string; photoIds?: string[] } }[];
  const media = outbox.find((o) => o.kind === "send_media");
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed",
    hasMedia: !!media, mediaKey: media?.payload?.vehicleKey ?? null, mediaPhotoIds: media?.payload?.photoIds ?? [],
    src: r.status === "committed" ? (r.responseSource ?? null) : null, exec: executed.map((e) => e.tool),
    reasonCode: r.status === "committed" ? r.decision.reasonCode : null,
  };
}
let seq0 = 0;
function conv(): Conv {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `wa:f37_${seq0++}`; let s = 0;
  const t = (lead: string, opts?: { rel?: TurnRelation; responder?: BrainResponder; ad?: AdContext }): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, opts?.rel ?? "ambiguous", opts?.responder ?? resist, opts?.ad);
  return { t, brain };
}
const sig = (c: Conv, i = 0): Record<string, unknown> => (c.brain.seenFrames[i]?.signals ?? {}) as Record<string, unknown>;

async function main(): Promise<void> {
  console.log("== F2.37: abertura SDR (A) + seleção de fotos (B) ==");

  // ══ PARTE B — PURO (photo-selection) ══
  check("[PS-1] selectPhotos 12 -> 5, inclui principal(b1) e última(b12), distintas", (() => {
    const r = selectPhotos({ availablePhotoIds: PHOTOS["rm:suvB"] });
    return r.selectedPhotoIds.length === 5 && r.reason === "capped_diverse" && r.selectedPhotoIds[0] === "b1" && r.selectedPhotoIds.includes("b12") && new Set(r.selectedPhotoIds).size === 5;
  })());
  check("[PS-2] selectPhotos exclui já enviadas (next_batch sem repetir)", (() => {
    const first = selectPhotos({ availablePhotoIds: PHOTOS["rm:suvB"] }).selectedPhotoIds;
    const second = selectPhotos({ availablePhotoIds: PHOTOS["rm:suvB"], alreadySentPhotoIds: first });
    return second.selectedPhotoIds.length === 5 && second.selectedPhotoIds.every((id) => !first.includes(id)) && second.reason === "next_batch_capped";
  })());
  check("[PS-3] selectPhotos 3 disponíveis (<=5) -> envia 3 (all_available)", (() => { const r = selectPhotos({ availablePhotoIds: PHOTOS["rm:suvA"] }); return r.selectedPhotoIds.length === 3 && r.reason === "all_available"; })());
  check("[PS-4] selectPhotos tudo já enviado -> exhausted (vazio)", selectPhotos({ availablePhotoIds: ["a1", "a2", "a3"], alreadySentPhotoIds: ["a1", "a2", "a3"] }).selectedPhotoIds.length === 0);
  check("[PS-5] spaceIndices(12,5)=[0,3,6,8,11]; (3,5)=[0,1,2]; (6,5) 5 distintos", (() => {
    const a = spaceIndices(12, 5); const b = spaceIndices(3, 5); const c = spaceIndices(6, 5);
    return a.join(",") === "0,3,6,8,11" && b.join(",") === "0,1,2" && new Set(c).size === 5 && c[0] === 0 && c[c.length - 1] === 5;
  })());
  check("[PS-6] MAX_INITIAL_PHOTOS = 5", MAX_INITIAL_PHOTOS === 5);

  // ══ PARTE B — ENGINE (curadoria no send_media) ══
  // 12 fotos -> 5; "manda mais" -> próximo lote sem repetir. (ordinal 2 = SUV_B, 12 fotos)
  {
    const c = conv();
    const t1 = await c.t("tem SUV?", { responder: listSuvs });
    check("[PB-0] T1 lista SUVs (2 itens)", has(t1.outbox, "Creta") && has(t1.outbox, "Renegade"), `outbox="${t1.outbox}"`);
    const t2 = await c.t("me manda fotos do segundo", { responder: photoRequest("me manda fotos do segundo", "ordinal_from_last_offer", "2") });
    check("[PB-1] T2 send_media do SUV_B com EXATAS 5 fotos (12 -> 5)", t2.hasMedia && t2.mediaKey === "rm:suvB" && t2.mediaPhotoIds.length === 5, `key=${t2.mediaKey} n=${t2.mediaPhotoIds.length} ids=${t2.mediaPhotoIds.join(",")}`);
    check("[PB-1b] as 5 têm DIVERSIDADE (inclui principal b1 e última b12, distintas)", t2.mediaPhotoIds[0] === "b1" && t2.mediaPhotoIds.includes("b12") && new Set(t2.mediaPhotoIds).size === 5, `ids=${t2.mediaPhotoIds.join(",")}`);
    const t3 = await c.t("me manda mais fotos do segundo", { responder: photoRequest("me manda mais fotos do segundo", "ordinal_from_last_offer", "2") });
    check("[PB-2] T3 'manda mais' envia PRÓXIMO lote (<=5) SEM repetir o de T2", t3.hasMedia && t3.mediaPhotoIds.length > 0 && t3.mediaPhotoIds.length <= 5 && t3.mediaPhotoIds.every((id) => !t2.mediaPhotoIds.includes(id)), `t2=${t2.mediaPhotoIds.join(",")} t3=${t3.mediaPhotoIds.join(",")}`);
  }
  // veículo com 3 fotos -> envia 3
  {
    const c = conv();
    await c.t("tem SUV?", { responder: listSuvs });
    const t2 = await c.t("me manda foto do primeiro", { responder: photoRequest("me manda foto do primeiro", "ordinal_from_last_offer", "1") });   // ordinal 1 = SUV_A (3 fotos)
    check("[PB-3] veículo com 3 fotos -> send_media com as 3 (não força 5)", t2.hasMedia && t2.mediaKey === "rm:suvA" && t2.mediaPhotoIds.length === 3, `key=${t2.mediaKey} n=${t2.mediaPhotoIds.length}`);
  }
  // ordinal escolhe o veículo correto (foto do 2º = SUV_B, nunca o 1º)
  {
    const c = conv();
    await c.t("tem SUV?", { responder: listSuvs });
    const t2 = await c.t("me manda foto do segundo", { responder: photoRequest("me manda foto do segundo", "ordinal_from_last_offer", "2") });
    check("[PB-4] foto por ordinal escolhe o carro CERTO (2º = SUV_B, não SUV_A)", t2.mediaKey === "rm:suvB", `key=${t2.mediaKey}`);
  }
  // negação "não quero fotos agora" -> sem mídia
  {
    const c = conv();
    await c.t("tem SUV?", { responder: listSuvs });
    const t2 = await c.t("não quero fotos agora", { responder: () => finU([txt("Tranquilo! Quer que eu te passe as condições ou veja outro modelo?")], "respect_photo_decline", U("other")) });
    check("[PB-5] negação de foto -> NÃO envia mídia", t2.hasMedia === false, `hasMedia=${t2.hasMedia}`);
  }

  // "Tem mais fotos?" continua mídia do veículo em foco; não é "mais opções" de estoque.
  {
    const c = conv();
    await c.t("tem SUV?", { responder: listSuvs });
    const t2 = await c.t("me manda fotos do segundo", { responder: photoRequest("me manda fotos do segundo", "ordinal_from_last_offer", "2") });
    const t3 = await c.t("Tem mais fotos?", { responder: photoRequest("Tem mais fotos?", "selected_vehicle") });
    const t3Signals = sig(c, 2);
    check("[PB-2b] 'Tem mais fotos?' nao vira mentionsMoreOptions/stock_search", t3Signals.mentionsPhoto === true && t3Signals.mentionsMoreOptions !== true && !t3.exec.includes("stock_search"), `signals=${JSON.stringify(t3Signals)} exec=${t3.exec.join(",")}`);
    check("[PB-2c] 'Tem mais fotos?' envia proximo lote do MESMO veiculo", t3.hasMedia && t3.mediaKey === "rm:suvB" && t3.mediaPhotoIds.length > 0 && t3.mediaPhotoIds.every((id) => !t2.mediaPhotoIds.includes(id)), `key=${t3.mediaKey} t2=${t2.mediaPhotoIds.join(",")} t3=${t3.mediaPhotoIds.join(",")} outbox="${t3.outbox}"`);
  }

  // ══ PARTE A — ABERTURA SDR ══
  // 1) primeiro contato genérico SEM anúncio: sinal firstContactNoCommercialTarget + guardrail (deny+feedback -> discovery)
  {
    const c = conv();
    // responder que ABRE pedindo o nome no passo 0 e, no retry, faz DESCOBERTA comercial (prova o deny+feedback).
    const nameThenDiscovery: BrainResponder = (_f, _o, step) => step === 0
      ? finU([txt("Boa tarde! Sou o Aloan da Icom. Qual é o seu nome?")], "reply", U("smalltalk"))
      : finU([txt("Boa tarde! Sou o Aloan da Icom. Você procura um modelo específico, um tipo de carro (SUV, sedan, hatch) ou uma faixa de preço?")], "reply", U("smalltalk"));
    const t1 = await c.t("Boa tarde", { responder: nameThenDiscovery });
    check("[PA-1] 1º contato sem anúncio -> signals.firstContactNoCommercialTarget=true", sig(c, 0).firstContactNoCommercialTarget === true, JSON.stringify(sig(c, 0)));
    check("[PA-1b] guardrail deny+feedback: resposta final vira DESCOBERTA (não pede nome)", (has(t1.outbox, "tipo de carro") || has(t1.outbox, "faixa de preço") || has(t1.outbox, "modelo")) && !has(t1.outbox, "seu nome"), `outbox="${t1.outbox}"`);
  }
  // 1b) cérebro INSISTE em pedir nome (nunca descobre) -> o sistema NUNCA entrega uma abertura que só pede nome
  {
    const c = conv();
    const alwaysName: BrainResponder = () => finU([txt("Olá! Qual é o seu nome, por favor?")], "reply", U("smalltalk"));
    const t1 = await c.t("Boa tarde", { responder: alwaysName });
    check("[PA-1c] abertura nunca ENTREGA só 'qual seu nome' (backstop/recovery cobrem)", !has(t1.outbox, "seu nome"), `outbox="${t1.outbox}" src=${t1.src}`);
  }
  // 2) anúncio GENÉRICO: adGenericEntry + abertura não pede nome
  {
    const c = conv();
    const alwaysName: BrainResponder = () => finU([txt("Olá! Qual é o seu nome?")], "reply", U("smalltalk"));
    const t1 = await c.t("Olá, vim pelo anúncio", { ad: adGeneric, responder: alwaysName });
    check("[PA-2] anúncio genérico -> signals.adGenericEntry=true", sig(c, 0).adGenericEntry === true, JSON.stringify(sig(c, 0)));
    check("[PA-2b] abertura de anúncio genérico não entrega 'qual seu nome'", !has(t1.outbox, "seu nome"), `outbox="${t1.outbox}"`);
  }
  // 3) anúncio ESPECÍFICO (HB20): specificAdEntry + adVehicle entregues; abertura DEVE reconhecer/conduzir o veículo do anúncio.
  //    Aterramento: o cérebro busca o HB20 (stock_search) e MOSTRA/lista o veículo do anúncio (grounded).
  const hb20U: TurnUnderstanding = { primaryIntent: "search_stock", requestedCapabilities: ["stock_search"], subject: "explicit_model", subjectValue: "HB20", subjectSource: "current_turn", evidence: [{ capability: "stock_search", quote: "interesse" }], isTopicChange: false, answeredLeadQuestions: [] };
  const listHb20 = (_f: unknown, obs: readonly AgentToolObservation[]): AgentBrainStep => {
    const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
    if (!so) return qU({ tool: "stock_search", input: { modelo: "HB20" } }, hb20U);
    return finU([txt("Bom dia! Vi que você se interessou pelo HB20 do anúncio:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart], "reply", hb20U);
  };
  {
    const c = conv();
    const t1 = await c.t("Olá, tenho interesse", { ad: adHB20, responder: listHb20 });
    check("[PA-3] anúncio específico -> signals.specificAdEntry=true", sig(c, 0).specificAdEntry === true, JSON.stringify(sig(c, 0)));
    check("[PA-3b] o cérebro recebe o veículo do anúncio (signals.adVehicle ~ HB20)", has(String(sig(c, 0).adVehicle ?? ""), "HB20"), `adVehicle=${sig(c, 0).adVehicle}`);
    check("[PA-3c] abertura que reconhece+MOSTRA o HB20 do anúncio é ACEITA", has(t1.outbox, "HB20") && t1.committed, `outbox="${t1.outbox}"`);
  }
  // 3d) INVARIANTE P0: saudação genérica ignorando o veículo do anúncio -> NEGADA; cérebro RE-AUTORA mostrando o HB20
  {
    const c = conv();
    const genericThenList = (_f: unknown, obs: readonly AgentToolObservation[], step: number): AgentBrainStep =>
      step === 0 ? finU([txt("Bom dia! Sou o Aloan da Icom. Você é aqui de Taubaté? Já conhece a nossa loja?")], "reply", U("smalltalk")) : listHb20(_f, obs);
    const t1 = await c.t("Olá, tenho interesse", { ad: adHB20, responder: genericThenList });
    check("[PA-3d] saudação genérica é NEGADA e o cérebro re-autora falando do HB20 (mostrando o veículo)", has(t1.outbox, "HB20") && !has(t1.outbox, "conhece a nossa loja"), `outbox="${t1.outbox}"`);
  }
  // 3e) cérebro INSISTE na saudação genérica -> a saudação que IGNORA o anúncio NUNCA é entregue ao lead (sem falso-verde)
  {
    const c = conv();
    const alwaysGeneric: BrainResponder = () => finU([txt("Bom dia! Você é aqui de Taubaté? Já conhece a nossa loja?")], "reply", U("smalltalk"));
    const t1 = await c.t("Olá, tenho interesse", { ad: adHB20, responder: alwaysGeneric });
    check("[PA-3e] saudação genérica que ignora o anúncio NÃO é entregue (guardrail nega, sem falso-verde)", !has(t1.outbox, "conhece a nossa loja"), `outbox="${t1.outbox}" src=${t1.src}`);
  }
  // 4) lead JÁ dá intenção comercial no 1º contato: NÃO é firstContactNoCommercialTarget (vai buscar, não força discovery)
  {
    const c = conv();
    const t1 = await c.t("Quero SUV até 100 mil", { responder: listSuvs });
    check("[PA-4] 1º contato COM intenção comercial -> firstContactNoCommercialTarget NÃO dispara", !sig(c, 0).firstContactNoCommercialTarget, JSON.stringify(sig(c, 0)));
    check("[PA-4b] o turno busca estoque e lista (não pede nome antes)", t1.exec.includes("stock_search") && (has(t1.outbox, "Creta") || has(t1.outbox, "Renegade")), `exec=${t1.exec.join(",")} outbox="${t1.outbox}"`);
  }
  // 5) regressão: turno NÃO-abertura ("Douglas" respondendo o nome) não engata o guardrail de abertura
  {
    const c = conv();
    await c.t("Boa tarde", { responder: () => finU([txt("Boa tarde! Sou o Aloan da Icom. Que tipo de carro você procura?")], "reply", U("smalltalk")) });
    const t2 = await c.t("Douglas", { responder: () => finU([txt("Prazer, Douglas! Me conta: procura algum modelo, tipo de carro ou faixa de preço?")], "reply", U("other")) });
    check("[PA-5] 2º turno ('Douglas') NÃO é abertura (firstContactNoCommercialTarget=false)", !sig(c, 1).firstContactNoCommercialTarget, JSON.stringify(sig(c, 1)));
    check("[PA-5b] a resposta ao nome é preservada (o cérebro conduz, sem virar discovery forçada)", has(t2.outbox, "Douglas"), `outbox="${t2.outbox}"`);
  }

  console.log(`\n== F2.37: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
