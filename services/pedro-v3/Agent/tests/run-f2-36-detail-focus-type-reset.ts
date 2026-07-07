// ============================================================================
// F2.36 - P0: detail target from ad/focus + broad type resets stale model/brand.
//   1) "qual o valor dele?" after an ad/list must force vehicle_details for the
//      focused ad vehicle, not generic fallback and not arbitrary stock_search.
//   2) "na verdade quero um SUV automatico ate 100 mil" after HB20/Hyundai must
//      clear stale brand/model and search broad SUV automatic <=100k.
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { mergeActiveConstraints } from "../src/engine/commercial-constraints.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { createInitialState, type AdContext, type ConversationState, type ActiveSearchConstraints } from "../src/domain/conversation-state.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainDecision, AgentBrainStep, CentralQueryCall, PrimaryIntent, TurnCapability, TurnSubjectKind, TurnUnderstanding } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponseDraft, ResponsePart, TurnRelation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0;
const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); return; }
  fail++; fails.push(`${name}${detail ? ` - ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` - ${detail}` : ""}`);
}

const TENANT = "ecb26258";
const AGENT = "d4fd5c38";
const NOW = "2026-07-07T12:00:00.000Z";
const SHA = "sha-36";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const has = (s: string, needle: string): boolean => norm(s).includes(norm(needle));

const HB20_2020: VehicleFact = { vehicleKey: "bndv:hb20-2020", marca: "Hyundai", modelo: "HB20", ano: 2020, preco: 73990, km: 64000, cambio: "Automatico", cor: "Prata", tipo: "hatch" };
const HB20_2019: VehicleFact = { vehicleKey: "bndv:hb20-2019", marca: "Hyundai", modelo: "HB20", ano: 2019, preco: 68990, km: 79000, cambio: "Automatico", cor: "Branco", tipo: "hatch" };
const CRV: VehicleFact = { vehicleKey: "rm:crv", marca: "Honda", modelo: "CR-V", ano: 2010, preco: 62990, km: 158000, cambio: "Automatico", cor: "Preto", tipo: "suv" };
const RENEGADE: VehicleFact = { vehicleKey: "rm:renegade", marca: "Jeep", modelo: "Renegade", ano: 2018, preco: 72990, km: 85000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const STOCK = [HB20_2020, HB20_2019, CRV, RENEGADE];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Voce e o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: "Rua Teste 100", hours: "9h as 19h", unit: "Icom", source: "test" }; } });

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { marca?: string; modelo?: string; tipo?: string; precoMax?: number; cambio?: string };
    let items = STOCK.slice();
    if (inp.marca) { const m = norm(inp.marca); items = items.filter((v) => norm(v.marca).includes(m) || m.includes(norm(v.marca))); }
    if (inp.modelo) { const toks = norm(inp.modelo).split(/\s+/).filter(Boolean); items = items.filter((v) => toks.every((t) => norm(`${v.marca} ${v.modelo}`).includes(t))); }
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (typeof inp.precoMax === "number") { const max = inp.precoMax; items = items.filter((v) => (v.preco ?? Infinity) <= max); }
    if (inp.cambio) items = items.filter((v) => (inp.cambio === "automatic") === /autom/i.test(v.cambio ?? ""));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_details") {
    const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey);
    return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
  }
  if (call.tool === "vehicle_photos_resolve") return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: "", ambiguous: false, photoIds: [] }, source: "fake" } as QueryResult;
  throw new Error(`unexpected tool ${call.tool}`);
};

class ComposeSpyLlm implements DecisionLlm {
  async proposeNextQueryOrFinal(): Promise<never> { throw new Error("legacy compose path must not run"); }
  async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; }
}
class RelPreparer implements TurnContextPreparer {
  relation: TurnRelation = "ambiguous";
  async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> {
    return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor };
  }
}

type UOpts = { caps?: TurnCapability[]; subject?: TurnSubjectKind; subjectValue?: string | null; evidence?: { capability?: TurnCapability; quote: string }[] };
const U = (primaryIntent: PrimaryIntent, o: UOpts = {}): TurnUnderstanding => ({
  primaryIntent, requestedCapabilities: o.caps ?? [], subject: o.subject ?? "none", subjectValue: o.subjectValue ?? null,
  subjectSource: "current_turn", evidence: o.evidence ?? [], isTopicChange: false, answeredLeadQuestions: [],
});
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
function final(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
const query = (call: CentralQueryCall, u: TurnUnderstanding): AgentBrainStep => ({ kind: "query", call, understanding: u });
const resist: BrainResponder = () => final([txt("Certo!")], "reply", U("other"));

const detailU = U("vehicle_detail", {
  caps: ["vehicle_details"],
  subject: "selected_vehicle",
  subjectValue: "dele",
  evidence: [{ capability: "vehicle_details", quote: "valor dele" }],
});
const detailBrain: BrainResponder = (_frame, obs) => {
  const detail = obs.find((o) => o.tool === "vehicle_details" && o.ok);
  if (detail?.ok && detail.tool === "vehicle_details") return final([
    txt("O "),
    { type: "vehicle_ref", vehicleKey: detail.data.vehicle.vehicleKey, field: "marca" },
    txt(" "),
    { type: "vehicle_ref", vehicleKey: detail.data.vehicle.vehicleKey, field: "modelo" },
    txt(" "),
    { type: "vehicle_ref", vehicleKey: detail.data.vehicle.vehicleKey, field: "ano" },
    txt(" esta por "),
    { type: "money_ref", role: "vehicle_price", source: { kind: "vehicle_fact", vehicleKey: detail.data.vehicle.vehicleKey } },
    txt("."),
  ], "vehicle_detail_answer", detailU);
  const missing = obs.find((o) => o.tool === "vehicle_details" && !o.ok && o.error.code === "REQUIRED_TOOL_MISSING");
  if (missing && !missing.ok) {
    const key = /vehicleKey":"([^"]+)"/.exec(missing.error.message)?.[1] ?? "";
    return query({ tool: "vehicle_details", input: { vehicleKey: key } }, detailU);
  }
  return final([txt("Ele esta por R$ 73.990.")], "premature_detail", detailU);
};

type Cap = { outbox: string; reason: string | null; src: string | null; stockInputs: Record<string, unknown>[]; detailKeys: string[] };
async function runTurn(args: { state?: Partial<ConversationState>; lead: string; relation?: TurnRelation; responder?: BrainResponder }): Promise<Cap> {
  executed.length = 0;
  const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const brain = new ScriptedAgentBrain();
  const preparer = new RelPreparer();
  const convId = `f236-${Math.random().toString(36).slice(2)}`;
  if (args.state) {
    const state = { ...createInitialState({ conversationId: convId, tenantId: TENANT, agentId: AGENT, now: NOW }), ...args.state } as ConversationState;
    const uow = persistence.begin();
    uow.casState(convId, 0, state);
    const res = await uow.commit();
    if (!res.ok) throw new Error("seed_failed");
  }
  preparer.relation = args.relation ?? "ambiguous";
  brain.setResponder(args.responder ?? resist);
  await persistence.tryInsert({ eventId: `${convId}-e1`, conversationId: convId, raw: redact({ text: args.lead }), receivedAt: clock.now() });
  clock.advance(1000);
  const r: CentralTurnResult = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: preparer,
    conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId: `${convId}-t1`, leaseTtlMs: 60_000, portalPromptSha256: SHA,
    limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 2, brainMaxSteps: 8, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
  });
  const outbox = await persistence.listOutbox(convId) as unknown as { kind: string; payload?: { text?: string } }[];
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "",
    reason: r.status === "committed" ? r.decision.reasonCode : null,
    src: r.status === "committed" ? r.responseSource : null,
    stockInputs: executed.filter((e) => e.tool === "stock_search").map((e) => e.input as Record<string, unknown>),
    detailKeys: executed.filter((e) => e.tool === "vehicle_details").map((e) => (e.input as { vehicleKey?: string }).vehicleKey ?? ""),
  };
}

const offer = { sourceTurnId: "seed", createdAt: NOW, items: [HB20_2020, HB20_2019].map((v, i) => ({ ordinal: i + 1, vehicleKey: v.vehicleKey, marca: v.marca, modelo: v.modelo, ano: v.ano, preco: v.preco, tipo: v.tipo })) };
const ad: AdContext = { adId: "ad-hb20", source: "fb", sourceUrl: null, title: "Hyundai HB20 2020", body: "HB20 automatico completo", greeting: "Tenho interesse no HYUNDAI HB20 2020", imageUrls: [], capturedAtTurn: 0 };

async function main(): Promise<void> {
  console.log("== F2.36: detail focus + broad type reset ==");

  check("[M-1] tipo amplo novo limpa marca/modelo stale", (() => {
    const m = mergeActiveConstraints({ marca: "hyundai", modelos: ["HB20"], precoMax: 80000 }, { tipo: "suv", cambio: "automatic", precoMax: 100000 });
    return m.tipo === "suv" && m.cambio === "automatic" && m.precoMax === 100000 && m.marca == null && m.modelos == null;
  })(), JSON.stringify(mergeActiveConstraints({ marca: "hyundai", modelos: ["HB20"], precoMax: 80000 }, { tipo: "suv", cambio: "automatic", precoMax: 100000 })));
  check("[M-2] marca atual explicita continua estreitando tipo atual", (() => {
    const m = mergeActiveConstraints({ marca: "hyundai", modelos: ["HB20"] }, { marca: "jeep", tipo: "suv" });
    return m.marca === "jeep" && m.tipo === "suv" && m.modelos == null;
  })());

  const p1 = await runTurn({
    state: { adContext: ad, lastRenderedOfferContext: offer, activeSearchConstraints: { marca: "hyundai", modelos: ["HB20"] } as ActiveSearchConstraints },
    lead: "qual o valor dele?",
    relation: "asks_vehicle_detail",
    responder: detailBrain,
  });
  check("[P0-1a] detalhe pronominal do anuncio/lista consulta vehicle_details do HB20 2020", p1.detailKeys.length === 1 && p1.detailKeys[0] === HB20_2020.vehicleKey, `detailKeys=${JSON.stringify(p1.detailKeys)} outbox=${p1.outbox}`);
  check("[P0-1b] responde o valor aterrado, sem technical_fallback", has(p1.outbox, "73.990") && p1.src !== "technical_fallback", `src=${p1.src} reason=${p1.reason} outbox=${p1.outbox}`);
  check("[P0-1c] nao roda stock_search em pergunta de atributo do veiculo focado", p1.stockInputs.length === 0, `stock=${JSON.stringify(p1.stockInputs)}`);

  const p1Amb = await runTurn({
    state: { adContext: ad, lastRenderedOfferContext: offer, activeSearchConstraints: { marca: "hyundai", modelos: ["HB20"] } as ActiveSearchConstraints },
    lead: "qual o valor dele?",
    relation: "ambiguous",
    responder: detailBrain,
  });
  check("[P0-1d] detalhe pronominal nao depende do classificador relation=asks_vehicle_detail", p1Amb.detailKeys.length === 1 && p1Amb.detailKeys[0] === HB20_2020.vehicleKey && has(p1Amb.outbox, "73.990") && p1Amb.src !== "technical_fallback", `detailKeys=${JSON.stringify(p1Amb.detailKeys)} src=${p1Amb.src} outbox=${p1Amb.outbox}`);

  const p2 = await runTurn({
    state: { activeSearchConstraints: { marca: "hyundai", modelos: ["HB20"], precoMax: 80000 } as ActiveSearchConstraints },
    lead: "na verdade quero um SUV automatico ate 100 mil",
    relation: "ambiguous",
    responder: resist,
  });
  const input = p2.stockInputs[0] ?? {};
  check("[P0-2a] busca executada como SUV automatico ate 100k, sem marca/modelo stale", input.tipo === "suv" && input.cambio === "automatic" && input.precoMax === 100000 && input.marca == null && input.modelo == null, `input=${JSON.stringify(input)}`);
  check("[P0-2b] lista SUVs reais e nao fala Hyundai SUV", (has(p2.outbox, "CR-V") || has(p2.outbox, "Renegade")) && !has(p2.outbox, "Hyundai SUV"), `outbox=${p2.outbox}`);

  const photoU = U("request_photos", { caps: ["send_photos"], subject: "ordinal_from_last_offer", subjectValue: "2", evidence: [{ capability: "send_photos", quote: "me manda fotos do segundo" }] });
  const p3 = await runTurn({
    lead: "me manda fotos do segundo",
    relation: "ambiguous",
    responder: () => final([txt("Nao temos Compass ate 100 mil no estoque para mostrar fotos. Quer que eu te mostre outras opcoes disponiveis?")], "bad_photo_absence", photoU),
  });
  check("[P0-3a] foto por ordinal sem lista valida nao repete busca antiga; pede qual/lista/ordinal", /qual|segundo|lista|item/i.test(p3.outbox) && !/nao temos compass ate 100 mil/i.test(norm(p3.outbox)), `outbox=${p3.outbox} src=${p3.src} reason=${p3.reason}`);

  console.log(`\n== F2.36: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
