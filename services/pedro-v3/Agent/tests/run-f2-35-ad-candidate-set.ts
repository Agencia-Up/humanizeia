// ============================================================================
// F2.35 — Fix C (audit CTWA smoke): resolução granular do anúncio + CONJUNTO CANDIDATO.
//   Anúncio "Onix Premier Turbo 1.0 2025" + estoque com 2 Onix 2025 -> "me manda fotos dele" NÃO re-lista o estoque todo
//   nem escolhe errado: lista SÓ os candidatos do anúncio (os 2 Onix 2025) e pergunta qual. Match ÚNICO -> envia direto.
//   npx tsx tests/run-f2-35-ad-candidate-set.ts
// ============================================================================
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { resolveAdCandidateKeys, resolveAdReferenceKey } from "../src/engine/ad-context.ts";
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
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-07T12:00:00.000Z", SHA = "sha-35";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

// Estoque: 2 Onix 2025 (mesmo modelo+ano, preços diferentes) + 1 Compass 2019 (match único p/ contraste).
const ONIX25A: VehicleFact = { vehicleKey: "rm:onix25a", marca: "Chevrolet", modelo: "Onix", ano: 2025, preco: 76990, km: 43900, cambio: "Manual", cor: "Branco", tipo: "hatch" };
const ONIX25B: VehicleFact = { vehicleKey: "rm:onix25b", marca: "Chevrolet", modelo: "Onix", ano: 2025, preco: 81990, km: 46300, cambio: "Automatico", cor: "Prata", tipo: "hatch" };
const CMP19: VehicleFact = { vehicleKey: "rm:cmp19", marca: "Jeep", modelo: "Compass", ano: 2019, preco: 96990, km: 82000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const STOCK = [ONIX25A, ONIX25B, CMP19];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: "Rua Teste 100", hours: null, unit: "Icom", source: "test" }; } });

const adOnix25: AdContext = { adId: "1", source: "FB_Ads", sourceUrl: null, title: "Icom", body: "", greeting: "Olá! Quer saber mais sobre o Onix Premier Turbo 1.0 2025?", imageUrls: [], capturedAtTurn: 0 };
const adCompass19: AdContext = { adId: "2", source: "FB_Ads", sourceUrl: null, title: "Icom", body: "", greeting: "Olá! Quer saber mais sobre o Jeep Compass 2019?", imageUrls: [], capturedAtTurn: 0 };

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
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1", "p2"] }, source: "fake" } as QueryResult; }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; } }

const U = (primaryIntent: PrimaryIntent): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [] });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const offer = (keys: string[]): ResponsePart => ({ type: "vehicle_offer_list", vehicleKeys: keys });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
function finU(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
function qU(call: QueryCall, understanding: TurnUnderstanding): AgentBrainStep {
  return { kind: "query", call, understanding };
}
const resist: BrainResponder = (frame, observations) => {
  const photoU: TurnUnderstanding = {
    ...U("request_photos"), requestedCapabilities: ["send_photos"], subject: "selected_vehicle", subjectSource: "current_turn",
    evidence: [{ capability: "send_photos", quote: frame.block ?? "fotos" }],
  };
  const photo = [...observations].reverse().find((o) => o.tool === "vehicle_photos_resolve" && o.ok) as { ok: true; tool: "vehicle_photos_resolve"; data: { vehicleKey: string; photoIds: string[] } } | undefined;
  if (photo) {
    const step = finU([txt("Aqui estão as fotos que você pediu.")], "send_vehicle_photos", photoU);
    if (step.kind !== "final") return step;
    return {
      ...step,
      decision: {
        ...step.decision,
        proposedEffects: [reply, { kind: "send_media", planId: "media", order: 1, vehicleKey: photo.data.vehicleKey, photoIds: photo.data.photoIds, onSuccess: [] } as ProposedEffectPlan],
      },
    };
  }
  if (/foto/i.test(frame.block ?? "")) {
    if (has(frame.signals.adVehicle ?? "", "Compass 2019")) {
      return qU({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: CMP19.vehicleKey } } }, photoU);
    }
    return finU([txt("Do anúncio, encontrei duas unidades do Onix 2025. De qual delas você quer as fotos?")], "photo_clarify_ad_candidates", photoU);
  }
  const stock = [...observations].reverse().find((o) => o.tool === "stock_search" && o.ok && o.data.items.length > 0) as { ok: true; tool: "stock_search"; data: { items: VehicleFact[] } } | undefined;
  if (stock) {
    const searchU: TurnUnderstanding = {
      ...U("search_stock"), requestedCapabilities: ["stock_search"],
      evidence: [{ capability: "stock_search", quote: (frame.block ?? "").trim() || "tem" }],
    };
    return finU([txt("Encontrei estas opções do anúncio:"), offer(stock.data.items.map((v) => v.vehicleKey)), txt("Qual delas chamou sua atenção?")], "offer_stock", searchU);
  }
  if (has(frame.signals.adVehicle ?? "", "Onix")) {
    const searchU: TurnUnderstanding = {
      ...U("search_stock"), requestedCapabilities: ["stock_search"],
      evidence: [{ capability: "stock_search", quote: (frame.block ?? "").trim() || "esse" }],
    };
    return qU({ tool: "stock_search", input: { marca: "Chevrolet", modelo: "Onix" } }, searchU);
  }
  if (has(frame.signals.adVehicle ?? "", "Compass")) {
    const searchU: TurnUnderstanding = {
      ...U("search_stock"), requestedCapabilities: ["stock_search"],
      evidence: [{ capability: "stock_search", quote: (frame.block ?? "").trim() || "esse" }],
    };
    return qU({ tool: "stock_search", input: { marca: "Jeep", modelo: "Compass" } }, searchU);
  }
  return finU([txt("Certo!")], "reply", U("other"));
};

type Cap = { outbox: string; committed: boolean; hasMedia: boolean; mediaKey: string | null; reasonCode: string | null; feedback: readonly string[] };
async function turn(persistence: InMemoryPersistence, clock: FakeClock, brain: ScriptedAgentBrain, preparer: RelPreparer, convId: string, seq: number, lead: string, responder: BrainResponder, ad?: AdContext): Promise<Cap> {
  executed.length = 0; preparer.relation = "ambiguous"; brain.setResponder(responder);
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
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string; vehicleKey?: string } }[];
  const media = outbox.find((o) => o.kind === "send_media");
  return { outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed", hasMedia: !!media, mediaKey: media?.payload?.vehicleKey ?? null, reasonCode: r.status === "committed" ? r.decision.reasonCode : null, feedback: r.status === "committed" ? r.policyFeedback : [] };
}
let seq0 = 0;
function conv() {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `wa:c${seq0++}`; let s = 0;
  const t = (lead: string, opts?: { responder?: BrainResponder; ad?: AdContext }): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, opts?.responder ?? resist, opts?.ad);
  return { t, persistence, id };
}

async function main(): Promise<void> {
  console.log("== F2.35: Fix C — resolução granular do anúncio + conjunto candidato ==");

  // ── PURO ──
  const offered = [{ vehicleKey: "rm:onix25a", modelo: "Onix", ano: 2025 }, { vehicleKey: "rm:onix25b", modelo: "Onix", ano: 2025 }, { vehicleKey: "rm:cmp19", modelo: "Compass", ano: 2019 }];
  check("[U-1] resolveAdCandidateKeys(Onix 2025, [2x Onix 2025 + Compass]) = os 2 Onix", (() => { const k = resolveAdCandidateKeys(adOnix25, offered); return k.length === 2 && k.includes("rm:onix25a") && k.includes("rm:onix25b"); })());
  check("[U-2] resolveAdReferenceKey(Onix 2025 com 2 candidatos) = null (>1, não escolhe)", resolveAdReferenceKey(adOnix25, offered) === null);
  check("[U-3] resolveAdCandidateKeys(Compass 2019, único) = 1", (() => { const k = resolveAdCandidateKeys(adCompass19, offered); return k.length === 1 && k[0] === "rm:cmp19"; })());
  check("[U-4] resolveAdReferenceKey(Compass 2019, único) = rm:cmp19", resolveAdReferenceKey(adCompass19, offered) === "rm:cmp19");

  // ── C-A: anúncio Onix 2025 (2 candidatos) -> "fotos dele" lista SÓ os 2 Onix 2025 e pergunta, sem enviar errado ──
  {
    const c = conv();
    const t1 = await c.t("esse ainda tem?", { ad: adOnix25 });
    check("[A-1] T1 lista os Onix 2025 do anúncio", has(t1.outbox, "Onix") && has(t1.outbox, "2025"), `outbox="${t1.outbox}"`);
    const afterOffer = c.persistence.load(c.id)?.state;
    const t2 = await c.t("me manda fotos dele");
    check("[A-2] T2 NÃO envia foto (2 candidatos -> não escolhe errado)", t2.hasMedia === false, `hasMedia=${t2.hasMedia} mediaKey=${t2.mediaKey}`);
    check("[A-3] T2 pergunta QUAL dos candidatos do anúncio (clarify de candidatos)", t2.reasonCode === "photo_clarify_ad_candidates" && has(t2.outbox, "Onix"), `rc=${t2.reasonCode} remembered=${JSON.stringify({ last: afterOffer?.lastRenderedOfferContext, presented: afterOffer?.offers.presentedKeys })} feedback=${JSON.stringify(t2.feedback)} outbox="${t2.outbox}"`);
    check("[A-4] T2 reconhece DUAS unidades sem inventar preços nem re-listar Compass", has(t2.outbox, "duas") && !has(t2.outbox, "R$") && !has(t2.outbox, "Compass"), `outbox="${t2.outbox}"`);
  }

  // ── C-B: anúncio Compass 2019 (único) -> "fotos dele" envia direto (contraste) ──
  {
    const c = conv();
    await c.t("esse ainda tem?", { ad: adCompass19 });
    const t2 = await c.t("me manda fotos dele");
    check("[B-1] match único -> envia a foto do Compass 2019 (rm:cmp19), sem perguntar", t2.hasMedia === true && t2.mediaKey === "rm:cmp19", `hasMedia=${t2.hasMedia} mediaKey=${t2.mediaKey} rc=${t2.reasonCode}`);
  }

  console.log(`\n== F2.35: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
