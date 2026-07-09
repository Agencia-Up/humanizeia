// ============================================================================
// F2.33 — P0 (audit Codex smoke CTWA): dois refinamentos do anúncio.
//  P0-A: anúncio modelo+ANO -> referência EXATA aterrada; "me manda fotos dele/desse/esse" resolve pro veículo exato do
//        anúncio (Compass 2019) e envia send_media (não re-lista). Se >1 pergunta qual; se 1 envia.
//  P0-B: "tem algo parecido/opções semelhantes" depois de um anúncio -> RELAXA modelo/marca, busca por TIPO (+preço).
//        Ex.: anúncio Ranger sem estoque -> "algo parecido até 100 mil?" busca {tipo:pickup, precoMax:100000}, sem Ranger.
//  P0 #2 (A-4..A-8): INVARIANTE DE FOTO DETERMINÍSTICO. O gpt-4.1-mini às vezes AUTORA "não localizei as fotos" (ausência
//        honesta FALSA — o carro TEM fotos). Se o lead pede foto + alvo resolvido, o engine FORÇA vehicle_photos_resolve e,
//        havendo fotos, faz OVERRIDE (envia send_media do alvo). Ausência honesta só sobrevive após consultar e vir VAZIO.
//   npx tsx tests/run-f2-33-ctwa-ad-refinements.ts
// ============================================================================
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { detectSimilarityIntent, relaxToSimilar } from "../src/engine/commercial-constraints.ts";
import { resolveAdReferenceKey } from "../src/engine/ad-context.ts";
import { authorizesPhotoByAdReference, type TargetResolution } from "../src/engine/turn-understanding.ts";
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
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-06T12:00:00.000Z", SHA = "sha-33";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

const CMP17: VehicleFact = { vehicleKey: "rm:cmp17", marca: "Jeep", modelo: "Compass", ano: 2017, preco: 92990, km: 88000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const CMP19: VehicleFact = { vehicleKey: "rm:cmp19", marca: "Jeep", modelo: "Compass", ano: 2019, preco: 96990, km: 82000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const STRADA: VehicleFact = { vehicleKey: "rm:strada", marca: "Fiat", modelo: "Strada", ano: 2021, preco: 89000, km: 30000, cambio: "Manual", cor: "Vermelho", tipo: "pickup" };
const ONIX: VehicleFact = { vehicleKey: "rm:onix", marca: "Chevrolet", modelo: "Onix", ano: 2016, preco: 51990, km: 93000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const STOCK = [CMP17, CMP19, STRADA, ONIX];   // SEM Ranger (out-of-stock)
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Avant", promptText: "Você é o Aloan da Avant." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: "Rua Teste 100, Taubaté", hours: null, unit: "Avant", source: "test" }; } });

const adCompass: AdContext = { adId: "1", source: "FB_Ads", sourceUrl: null, title: "Avant", body: "", greeting: "Olá! Quer saber mais sobre o Jeep Compass 2019?", imageUrls: [], capturedAtTurn: 0 };
const adRanger: AdContext = { adId: "2", source: "FB_Ads", sourceUrl: null, title: "Ranger XLT TD 3.2 2016", body: "Picape diesel automatica", greeting: "Olá! Quer saber mais sobre a Ford Ranger XLT TD 3.2 2016?", imageUrls: [], capturedAtTurn: 0 };

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
    if (inp.cambio) items = items.filter((v) => (inp.cambio === "automatic") === /autom/i.test(v.cambio ?? ""));
    if (inp.excludeKeys) items = items.filter((v) => !inp.excludeKeys!.includes(v.vehicleKey));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; const photoIds = key === "rm:cmp17" ? [] : ["p1", "p2"]; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds }, source: "fake" } as QueryResult; }   // cmp17 = SEM fotos (prova: ausência honesta legítima)
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
const resist: BrainResponder = () => finU([txt("Certo!")], "reply", U("other"));
// ⭐AUTORIDADE (audit Codex): "na verdade quero o Onix" é BUSCA (a LLM real classifica search_stock); declara o ATO mas
// resiste — o executor determinístico garante a execução com a correção aplicada.
const resistSearch: BrainResponder = (f) => finU([txt("Certo!")], "reply", {
  ...U("search_stock"), requestedCapabilities: ["stock_search"],
  evidence: [{ capability: "stock_search", quote: (f.block ?? "").trim().split(/\s+/).slice(0, 2).join(" ") || "tem" }],
});

type Cap = { outbox: string; committed: boolean; hasMedia: boolean; mediaKey: string | null; exec: string[]; stockInput: Record<string, unknown> | null; reasonCode: string | null };
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
  // aplica receipts p/ o ledger de foto (accepted) — como o smoke real.
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
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string; vehicleKey?: string } }[];
  const media = outbox.find((o) => o.kind === "send_media");
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed", hasMedia: !!media, mediaKey: media?.payload?.vehicleKey ?? null,
    exec: executed.map((e) => e.tool), stockInput: stock ? (stock.input as Record<string, unknown>) : null, reasonCode: r.status === "committed" ? r.decision.reasonCode : null,
  };
}
let seq0 = 0;
function conv() {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `wa:conv${seq0++}`; let s = 0;
  const t = (lead: string, opts?: { rel?: TurnRelation; responder?: BrainResponder; ad?: AdContext }): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, opts?.rel ?? "ambiguous", opts?.responder ?? resist, opts?.ad);
  return { t };
}

async function main(): Promise<void> {
  console.log("== F2.33: CTWA P0-A (foto do ano exato) + P0-B (algo parecido relaxa) ==");

  // ── PARTE 1 — PURO ──
  check("[U-1] detectSimilarityIntent 'tem algo parecido até 100 mil?' -> true", detectSimilarityIntent("tem algo parecido até 100 mil?") === true);
  check("[U-2] detectSimilarityIntent 'quero um onix' -> false", detectSimilarityIntent("quero um onix") === false);
  check("[U-3] relaxToSimilar dropa marca/modelo/ano/câmbio (keepCambio=false)", (() => { const r = relaxToSimilar({ marca: "ford", modelos: ["Ranger"], tipo: "pickup", cambio: "automatic", precoMax: 100000, anos: [2016] }, false); return r.tipo === "pickup" && r.precoMax === 100000 && !r.marca && !r.modelos && !r.cambio && !r.anos; })());
  check("[U-4] relaxToSimilar mantém câmbio se keepCambio=true", relaxToSimilar({ tipo: "pickup", cambio: "automatic" }, true).cambio === "automatic");
  check("[U-5] resolveAdReferenceKey(Compass 2019, [2017,2019]) = cmp19", resolveAdReferenceKey(adCompass, [{ vehicleKey: "rm:cmp17", modelo: "Compass", ano: 2017 }, { vehicleKey: "rm:cmp19", modelo: "Compass", ano: 2019 }]) === "rm:cmp19");
  check("[U-6] resolveAdReferenceKey só 2017 (ano do anúncio ausente) -> null", resolveAdReferenceKey(adCompass, [{ vehicleKey: "rm:cmp17", modelo: "Compass", ano: 2017 }]) === null);
  check("[U-7] resolveAdReferenceKey 2 Compass 2019 (>1) -> null", resolveAdReferenceKey(adCompass, [{ vehicleKey: "a", modelo: "Compass", ano: 2019 }, { vehicleKey: "b", modelo: "Compass", ano: 2019 }]) === null);
  check("[U-8] authorizesPhotoByAdReference (alvo ad_reference + pedido de foto) -> true", (() => { const t: TargetResolution = { kind: "resolved", vehicleKey: "rm:cmp19", source: "ad_reference", candidateVehicleKeys: ["rm:cmp19"], subjectModel: "Compass" }; return authorizesPhotoByAdReference(t, "me manda fotos dele") === true && authorizesPhotoByAdReference(t, "não quero foto") === false; })());

  // ── P0-A: anúncio Compass 2019 (estoque 2017+2019) -> "me manda fotos dele" envia a foto do 2019 ──
  {
    const c = conv();
    const t1 = await c.t("esse ainda tem?", { ad: adCompass });
    check("[A-1] T1 lista os Compass do anúncio (2017 e 2019)", has(t1.outbox, "Compass") && has(t1.outbox, "2019"), `outbox="${t1.outbox}"`);
    const t2 = await c.t("me manda fotos dele");
    check("[A-2] T2 ENVIA send_media (não re-lista)", t2.hasMedia === true, `hasMedia=${t2.hasMedia} outbox="${t2.outbox}"`);
    check("[A-3] a foto é do Compass 2019 exato do anúncio (rm:cmp19)", t2.mediaKey === "rm:cmp19", `mediaKey=${t2.mediaKey}`);
  }

  // ── P0 (audit Codex smoke CTWA #2): NÃO-DETERMINISMO. O gpt-4.1-mini às vezes AUTORA "não localizei as fotos" (ausência
  //    honesta FALSA — o carro TEM fotos) e isso passava na completude. O engine agora FORÇA a resolução do alvo e, havendo
  //    fotos, faz OVERRIDE (envia). Só honra a ausência DEPOIS de consultar o alvo certo e vir vazio. ──
  {
    const c = conv();
    await c.t("esse ainda tem?", { ad: adCompass });                 // T1 lista CMP17 (ord.1) + CMP19 (ord.2)
    const fakeAbsence: BrainResponder = () => finU([txt("Não localizei as fotos do Jeep Compass 2019 agora. Quer que eu te passe os detalhes dele?")], "photo_unavailable", U("request_photos"));
    const t2 = await c.t("me manda fotos dele", { responder: fakeAbsence });
    check("[A-4] cérebro autora 'não localizei' mas o Compass 2019 TEM fotos -> engine OVERRIDE e ENVIA", t2.hasMedia === true, `hasMedia=${t2.hasMedia} outbox="${t2.outbox}"`);
    check("[A-5] override envia a foto do 2019 exato do anúncio (rm:cmp19)", t2.mediaKey === "rm:cmp19", `mediaKey=${t2.mediaKey}`);
    check("[A-6] resposta final descarta a ausência honesta falsa (sem 'não localizei')", !has(t2.outbox, "nao localizei"), `outbox="${t2.outbox}"`);
  }
  {
    const c = conv();
    await c.t("esse ainda tem?", { ad: adCompass });                 // CMP17 = ordinal 1 (SEM fotos no fake)
    const fakeAbsence: BrainResponder = () => finU([txt("Não localizei as fotos desse carro agora.")], "photo_unavailable", U("request_photos"));
    const t2 = await c.t("me manda foto do primeiro", { responder: fakeAbsence });   // ordinal 1 -> CMP17 sem fotos
    check("[A-7] alvo REALMENTE sem fotos (ordinal 1 = 2017) -> ausência honesta SOBREVIVE (sem media)", t2.hasMedia === false, `hasMedia=${t2.hasMedia} outbox="${t2.outbox}"`);
    check("[A-8] o engine CONSULTOU as fotos do alvo antes de honrar a ausência", t2.exec.includes("vehicle_photos_resolve"), `exec=${t2.exec.join(",")}`);
  }

  // ── P0-B: anúncio Ranger (sem estoque) -> "algo parecido até 100 mil?" relaxa p/ picape, sem Ranger ──
  {
    const c = conv();
    await c.t("tem esse?", { ad: adRanger });                          // T1: Ranger -> vazio
    const t2 = await c.t("tem algo parecido até 100 mil?");            // T2: similaridade
    const input = JSON.stringify(t2.stockInput ?? {});
    check("[B-1] T2 busca por TIPO picape + precoMax, SEM modelo=Ranger", t2.stockInput?.tipo === "pickup" && t2.stockInput?.precoMax === 100000 && !has(input, "ranger"), `input=${input}`);
    check("[B-2] T2 NÃO mantém a marca do anúncio (ford) presa", !has(input, "ford"), `input=${input}`);
    check("[B-3] T2 lista a picape alternativa (Strada), resposta não 'não temos Ranger'", has(t2.outbox, "Strada") || (!has(t2.outbox, "não temos ranger") && !has(t2.outbox, "nao temos ranger")), `outbox="${t2.outbox}"`);
  }

  // ── Regressão: correção do lead vence o anúncio; institucional não usa estoque do anúncio ──
  {
    const c = conv();
    await c.t("esse ainda tem?", { ad: adCompass });
    const t2 = await c.t("na verdade quero o Onix", { responder: resistSearch });
    check("[R-1] correção -> busca Onix (não Compass)", has(String(t2.stockInput?.modelo ?? ""), "onix") && !has(String(t2.stockInput?.modelo ?? ""), "compass"), `input=${JSON.stringify(t2.stockInput)}`);
  }
  {
    const c = conv();
    const r = await c.t("onde fica a loja?", { ad: adCompass, rel: "asks_store" as TurnRelation });
    check("[R-2] institucional NÃO roda stock_search do anúncio", !r.exec.includes("stock_search"), `exec=${r.exec.join(",")}`);
  }

  console.log(`\n== F2.33: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
