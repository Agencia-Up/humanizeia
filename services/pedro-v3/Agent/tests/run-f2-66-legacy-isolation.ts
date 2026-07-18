// ============================================================================
// F2.66 — F7-6: ISOLAMENTO DEFINITIVO do ramo LEGADO de autoria comercial determinística. Offline/$0 (sem OpenAI).
//
// PROVA a exigência essencial do dono: "nenhum central_active/central_shadow pode produzir resposta deterministic_*".
// Produção = central_active E central_shadow, AMBOS llmFirst=true. Os handlers determinísticos (foto/institucional/
// desengajamento/mais-opções/recuperação/recall) só rodam sob opt-in explícito `legacyCommercialReplay=true`
// (replay/offline). Testa por 3 eixos:
//   (P) PRODUÇÃO   llmFirst=true, singleAuthor=true                       -> NUNCA deterministic_* (só brain_*/technical_fallback)
//   (R) REPLAY     llmFirst=false, singleAuthor=true, legacyReplay=true   -> ramo legado ALCANÇÁVEL (deterministic_* aparece)
//   (U) NÃO-AUTOR. llmFirst=false, singleAuthor=true, legacyReplay=false  -> fail-closed technical_fallback (NUNCA deterministic_*)
// + unidade pura da política (legacy-replay.ts) + SHADOW verdadeiro (llmFirst, canônico intocado, autoria da LLM).
//   npx tsx tests/run-f2-66-legacy-isolation.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { runCentralShadowTurn } from "../src/engine/central-shadow-runner.ts";
import {
  LEGACY_DETERMINISTIC_SOURCES, isLegacyReplayEnabled, assertReplayWiring, assertLegacyAuthoringAuthorized,
} from "../src/engine/legacy/legacy-replay.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { AgentBrainPort, AgentBrainStep, AgentBrainDecision, AgentToolObservation, CentralQueryCall, TurnFrame } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import type { TenantBusinessInfoSource, TenantBusinessInfo } from "../src/engine/tenant-business-info.ts";
import { deriveFallbackUnderstanding } from "../src/engine/turn-understanding.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const TENANT = "ecb26258", AGENT = "d4fd5c38", CONV = "conv-legacy-iso";
const NOW = "2026-07-17T15:00:00.000Z", SHA = "sha-f266";

const ONIX1: VehicleFact = { vehicleKey: "revendamais:1", marca: "Chevrolet", modelo: "Onix", ano: 2016, preco: 51990, km: 80000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const ONIX2: VehicleFact = { vehicleKey: "revendamais:8022153", marca: "Chevrolet", modelo: "Onix", ano: 2014, preco: 42990, km: 132623, cambio: "Manual", cor: "Branco", tipo: "hatch" };
const STOCK: VehicleFact[] = [ONIX1, ONIX2];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);

let toolCalls: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  toolCalls.push(call);
  if (call.tool === "vehicle_details") {
    const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey);
    return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult
            : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
  }
  if (call.tool === "stock_search") return { ok: true, tool: "stock_search", data: { items: [ONIX1, ONIX2], filtersUsed: {} as Record<string, never> }, source: "fake" } as QueryResult;
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1", "p2"] }, source: "fake" } as QueryResult; }
  throw new Error("runQuery: tool não suportada: " + call.tool);
};

class ComposeSpyLlm implements DecisionLlm {
  composeCalls = 0;
  async proposeNextQueryOrFinal(): Promise<never> { throw new Error("single-author NÃO deve chamar proposeNextQueryOrFinal"); }
  async compose(): Promise<ResponseDraft> { this.composeCalls++; return { parts: [{ type: "text", content: "[SPY_COMPOSE_PROIBIDO]" }] }; }
}
class FixedPreparer implements TurnContextPreparer {
  constructor(private readonly relation: TurnRelation = "asks_vehicle_detail") {}
  async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> {
    return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor };
  }
}
class FakeBusinessInfo implements TenantBusinessInfoSource {
  async getBusinessInfo(): Promise<TenantBusinessInfo> { return { address: null, hours: null, unit: null, source: "tenant_runtime_config" }; }
}
class UnderstandingBrain implements AgentBrainPort {
  constructor(private readonly inner: ScriptedAgentBrain) {}
  async proposeNextStep(frame: TurnFrame, observations: readonly AgentToolObservation[]): Promise<AgentBrainStep> {
    const step = await this.inner.proposeNextStep(frame, observations);
    return step.understanding ? step : { ...step, understanding: deriveFallbackUnderstanding(frame.block, frame.signals, extractor) };
  }
}

const label = (v: VehicleFact): string => `${v.marca} ${v.modelo} ${v.ano}`;
function seedSelected(selected: VehicleFact): ConversationState {
  const s = createInitialState({ conversationId: CONV, tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
  s.vehicleContext.selected = { kind: "vehicle", key: selected.vehicleKey, label: label(selected) };
  s.lastRenderedOfferContext = { sourceTurnId: "seed-t0", createdAt: NOW, items: [ONIX1, ONIX2].map((v, i) => ({ ordinal: i + 1, vehicleKey: v.vehicleKey, marca: v.marca, modelo: v.modelo, ano: v.ano, preco: v.preco })) };
  return s;
}
const txt = (content: string): ResponsePart => ({ type: "text", content });
const vref = (v: VehicleFact, field: "km" | "cor" | "ano" | "cambio"): ResponsePart => ({ type: "vehicle_ref", vehicleKey: v.vehicleKey, field });
const q = (call: CentralQueryCall): AgentBrainStep => ({ kind: "query", call });
function groundedCambioFinal(v: VehicleFact): AgentBrainStep {
  const decision: AgentBrainDecision = {
    reasonCode: "answer", reasonSummary: "câmbio aterrado", confidence: 0.9,
    responsePlan: { guidance: "responder câmbio", draft: { parts: [txt("O câmbio é"), vref(v, "cambio"), txt(". Quer ver as fotos?")] } },
    proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan],
    memoryMutations: [], stateMutations: [],
  };
  return { kind: "final", decision };
}
function ungroundedKmFinal(): AgentBrainStep {
  // Cita km SEM vehicle_details -> grounding rejeita em toda tentativa -> engine cai no ELSE (recuperação/fallback).
  const decision: AgentBrainDecision = {
    reasonCode: "answer", reasonSummary: "km sem fato", confidence: 0.9,
    responsePlan: { guidance: "responder km", draft: { parts: [txt("Tem"), vref(ONIX2, "km"), txt("km")] } },
    proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan],
    memoryMutations: [], stateMutations: [],
  };
  return { kind: "final", decision };
}
function groundedGreetingFinal(text: string): AgentBrainStep {
  const decision: AgentBrainDecision = {
    reasonCode: "reply", reasonSummary: "saudação", confidence: 0.9,
    responsePlan: { guidance: "cumprimentar", draft: { parts: [txt(text)] } },
    proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan],
    memoryMutations: [], stateMutations: [],
  };
  return { kind: "final", decision };
}

type Cfg = { llmFirst: boolean; singleAuthor: boolean; legacyCommercialReplay: boolean };
type TurnOut = { status: string; src: string; degraded: boolean; text: string; threw: boolean; err: string };
let seq = 0;
async function runTurn(cfg: Cfg, opts: { state: ConversationState; leadText: string; script: AgentBrainStep[]; relation?: TurnRelation }): Promise<TurnOut> {
  toolCalls = []; seq += 1;
  const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  { const uow = persistence.begin(); uow.casState(CONV, 0, opts.state); await uow.commit(); }
  await persistence.tryInsert({ eventId: `${CONV}-e${seq}`, conversationId: CONV, raw: redact({ text: opts.leadText }), receivedAt: clock.now() });
  clock.advance(1000);
  const brain = new ScriptedAgentBrain(); brain.setTurnScript(opts.script);
  try {
    const r: CentralTurnResult = await runCentralConversationTurn({
      persistence, clock, brain: new UnderstandingBrain(brain), llm: new ComposeSpyLlm(), runQuery,
      businessInfo: new FakeBusinessInfo(), contextPreparer: new FixedPreparer(opts.relation ?? "asks_vehicle_detail"),
      conversationId: CONV, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId: `${CONV}-t${seq}`, leaseTtlMs: 60_000, portalPromptSha256: SHA,
      limits: { maxSteps: 4, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
      maxValidationAttempts: 2, brainMaxSteps: 4, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
      providerCapability: { send_message: "none", send_media: "none" },
      singleAuthor: cfg.singleAuthor, llmFirst: cfg.llmFirst, legacyCommercialReplay: cfg.legacyCommercialReplay,
    });
    const outbox = (await persistence.listOutbox(CONV)).find((o) => o.kind === "send_message");
    return {
      status: r.status, src: r.status === "committed" ? r.responseSource : r.status,
      degraded: r.status === "committed" && r.degraded, text: (outbox?.payload as { text?: string } | undefined)?.text ?? "",
      threw: false, err: "",
    };
  } catch (e) {
    return { status: "threw", src: "threw", degraded: false, text: "", threw: true, err: (e as Error)?.message ?? String(e) };
  }
}

async function main(): Promise<void> {
  console.log("== F2.66 isolamento do ramo legado (F7-6) ==");

  // ── PARTE A: unidade pura da política (legacy-replay.ts) ─────────────────────────────────────────────────────
  check("[A1] isLegacyReplayEnabled: só (não-llmFirst + opt-in) habilita",
    isLegacyReplayEnabled(false, true) === true && isLegacyReplayEnabled(true, true) === false && isLegacyReplayEnabled(true, false) === false && isLegacyReplayEnabled(false, false) === false);
  check("[A2] LEGACY_DETERMINISTIC_SOURCES contém os deterministic_* comerciais",
    ["deterministic_recall", "deterministic_photo", "deterministic_institutional", "deterministic_recovery", "deterministic_discovery", "deterministic_conduct"].every((s) => LEGACY_DETERMINISTIC_SOURCES.has(s as never)));
  check("[A3] LEGACY_DETERMINISTIC_SOURCES NÃO contém brain_*/technical_fallback/legacy_compose",
    !["brain_final", "brain_retry", "technical_fallback", "legacy_compose"].some((s) => LEGACY_DETERMINISTIC_SOURCES.has(s as never)));
  {
    let threw = false; try { assertReplayWiring(true, true); } catch { threw = true; }
    check("[A4] assertReplayWiring estoura em (llmFirst=true, replay=true)", threw);
    let noThrow = true; try { assertReplayWiring(true, false); assertReplayWiring(false, true); assertReplayWiring(false, false); } catch { noThrow = false; }
    check("[A4] assertReplayWiring NÃO estoura nas combinações válidas", noThrow);
  }
  {
    let t1 = false; try { assertLegacyAuthoringAuthorized("deterministic_photo", { llmFirst: true, legacyCommercialReplay: false }); } catch { t1 = true; }
    let t2 = false; try { assertLegacyAuthoringAuthorized("deterministic_recall", { llmFirst: false, legacyCommercialReplay: false }); } catch { t2 = true; }
    check("[A5] assertLegacyAuthoringAuthorized estoura p/ deterministic_* sem replay autorizado", t1 && t2);
    let ok3 = true;
    try {
      assertLegacyAuthoringAuthorized("deterministic_photo", { llmFirst: false, legacyCommercialReplay: true });   // replay autorizado
      assertLegacyAuthoringAuthorized("technical_fallback", { llmFirst: true, legacyCommercialReplay: false });    // não é deterministic_*
      assertLegacyAuthoringAuthorized("brain_final", { llmFirst: true, legacyCommercialReplay: false });           // autoria da LLM
    } catch { ok3 = false; }
    check("[A5] assertLegacyAuthoringAuthorized NÃO estoura p/ replay autorizado nem p/ brain_*/technical_fallback", ok3);
  }

  // ── PARTE B: comportamento do engine nos 3 eixos, no MESMO cenário que força o ELSE (km sem vehicle_details) ──
  const kmScript = [ungroundedKmFinal(), ungroundedKmFinal(), ungroundedKmFinal(), ungroundedKmFinal()];
  const kmScenario = (): { state: ConversationState; leadText: string; script: AgentBrainStep[] } => ({ state: seedSelected(ONIX2), leadText: "quantos km ele tem?", script: [...kmScript] });
  const photoScenario = (): { state: ConversationState; leadText: string; script: AgentBrainStep[] } => ({ state: seedSelected(ONIX2), leadText: "me manda as fotos dele", relation: "asks_vehicle_detail", script: [ungroundedKmFinal(), ungroundedKmFinal(), ungroundedKmFinal(), ungroundedKmFinal()] } as never);

  // (P) PRODUÇÃO — llmFirst=true, singleAuthor=true, SEM replay. NUNCA deterministic_*; só brain_*/technical_fallback.
  const prodSources: string[] = [];
  for (const scen of [kmScenario(), photoScenario()]) {
    const r = await runTurn({ llmFirst: true, singleAuthor: true, legacyCommercialReplay: false }, scen);
    prodSources.push(r.src);
    check(`[P] produção não estoura e commita ("${scen.leadText}")`, r.status === "committed", `status=${r.status} err=${r.err}`);
    check(`[P] produção NUNCA deterministic_* ("${scen.leadText}")`, !LEGACY_DETERMINISTIC_SOURCES.has(r.src as never), `src=${r.src}`);
    check(`[P] produção -> technical_fallback honesto ("${scen.leadText}")`, r.src === "technical_fallback" && r.degraded === true && !r.text.includes("132.623"), `src=${r.src} text="${r.text}"`);
  }
  check("[P] produção: TODAS as fontes ∈ {brain_final,brain_retry,technical_fallback}", prodSources.every((s) => s === "brain_final" || s === "brain_retry" || s === "technical_fallback"), prodSources.join(","));

  // (R) REPLAY — llmFirst=false, singleAuthor=true, legacyCommercialReplay=true. Ramo legado ALCANÇÁVEL.
  const replaySources: string[] = [];
  for (const scen of [kmScenario(), photoScenario()]) {
    const r = await runTurn({ llmFirst: false, singleAuthor: true, legacyCommercialReplay: true }, scen);
    replaySources.push(r.src);
    check(`[R] replay não estoura e commita ("${scen.leadText}")`, r.status === "committed", `status=${r.status} err=${r.err}`);
  }
  check("[R] replay ALCANÇA o ramo legado (ao menos 1 deterministic_*)", replaySources.some((s) => LEGACY_DETERMINISTIC_SOURCES.has(s as never)), replaySources.join(","));
  check("[R] replay: photo request -> deterministic_photo (executor legado vivo)", replaySources[1] === "deterministic_photo", `photoSrc=${replaySources[1]}`);

  // (U) NÃO-AUTORIZADO — llmFirst=false, singleAuthor=true, SEM opt-in. Fail-closed: NUNCA deterministic_*.
  for (const scen of [kmScenario(), photoScenario()]) {
    const r = await runTurn({ llmFirst: false, singleAuthor: true, legacyCommercialReplay: false }, scen);
    check(`[U] não-autorizado NUNCA deterministic_* ("${scen.leadText}")`, r.status === "committed" && !LEGACY_DETERMINISTIC_SOURCES.has(r.src as never), `src=${r.src}`);
    check(`[U] não-autorizado -> technical_fallback ("${scen.leadText}")`, r.src === "technical_fallback", `src=${r.src}`);
  }

  // (W) FIAÇÃO INVÁLIDA — llmFirst=true + replay=true DEVE ser bloqueado (nunca produz deterministic_* commitado).
  {
    const r = await runTurn({ llmFirst: true, singleAuthor: true, legacyCommercialReplay: true }, kmScenario());
    check("[W] fiação llmFirst+replay: bloqueada (throw) OU nunca deterministic_*", r.threw || !LEGACY_DETERMINISTIC_SOURCES.has(r.src as never), `threw=${r.threw} src=${r.src}`);
  }

  // ── PARTE C: SHADOW verdadeiro (F7-5: llmFirst=true). Autoria da LLM, canônico intocado, sem deterministic_*. ──
  {
    const clock = new FakeClock(NOW);
    const canonical = new InMemoryPersistence(clock, new FakeIdGen());
    const seed = seedSelected(ONIX2);
    { const uow = canonical.begin(); uow.casState(CONV, 0, seed); await uow.commit(); }
    const beforeVersion = (await canonical.load(CONV))?.version ?? -1;
    const brain = new ScriptedAgentBrain(); brain.setTurnScript([groundedGreetingFinal("Oi! Posso te ajudar com o Chevrolet Onix 2014?")]);
    const shadow = await runCentralShadowTurn({
      canonicalPersistence: canonical, conversationId: CONV, tenantId: TENANT, agentId: AGENT, leadId: null,
      messageBlock: "oi, tudo bem?", turnId: `${CONV}-shadow`, seedStateOverride: seed,
      deps: {
        brain: new UnderstandingBrain(brain), llm: new ComposeSpyLlm(), runQuery, businessInfo: new FakeBusinessInfo(),
        contextPreparer: new FixedPreparer("ambiguous"), clock, portalPromptSha256: SHA,
        limits: { maxSteps: 4, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
        maxValidationAttempts: 2, brainMaxSteps: 4, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
      },
    });
    check("[C] shadow rodou ok (llmFirst) sem estourar invariante", shadow.ok === true, shadow.ok ? "" : shadow.reason);
    const afterVersion = (await canonical.load(CONV))?.version ?? -1;
    check("[C] shadow NÃO tocou o canônico (versão intacta)", afterVersion === beforeVersion, `before=${beforeVersion} after=${afterVersion}`);
    if (shadow.ok) {
      check("[C] shadow autora pela LLM (preview = texto do cérebro, não menu determinístico)", shadow.comparison.responsePreview.includes("Onix 2014"), `preview="${shadow.comparison.responsePreview}"`);
      check("[C] shadow reasonCode não é determinístico legado", !["send_vehicle_photos", "institutional_answer", "lead_disengaged", "more_options_needs_scope", "contextual_recovery"].includes(shadow.comparison.reasonCode ?? ""), `reason=${shadow.comparison.reasonCode}`);
    }
    // Shadow no cenário que EM REPLAY iria determinístico: como shadow é llmFirst, cai em technical_fallback (nunca throw).
    const brain2 = new ScriptedAgentBrain(); brain2.setTurnScript([ungroundedKmFinal(), ungroundedKmFinal(), ungroundedKmFinal(), ungroundedKmFinal()]);
    const clock2 = new FakeClock(NOW);
    const canonical2 = new InMemoryPersistence(clock2, new FakeIdGen());
    const seed2 = seedSelected(ONIX2);
    { const uow = canonical2.begin(); uow.casState(CONV, 0, seed2); await uow.commit(); }
    const shadow2 = await runCentralShadowTurn({
      canonicalPersistence: canonical2, conversationId: CONV, tenantId: TENANT, agentId: AGENT, leadId: null,
      messageBlock: "quantos km ele tem?", turnId: `${CONV}-shadow2`, seedStateOverride: seed2,
      deps: {
        brain: new UnderstandingBrain(brain2), llm: new ComposeSpyLlm(), runQuery, businessInfo: new FakeBusinessInfo(),
        contextPreparer: new FixedPreparer("asks_vehicle_detail"), clock: clock2, portalPromptSha256: SHA,
        limits: { maxSteps: 4, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
        maxValidationAttempts: 2, brainMaxSteps: 4, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
      },
    });
    check("[C] shadow em cenário-else NÃO estoura invariante (llmFirst -> degradação técnica, não deterministic_*)", shadow2.ok === true, shadow2.ok ? "" : shadow2.reason);
  }

  // ── PARTE D: F7-1 dedup/idempotência — a MESMA tool com o MESMO input NUNCA executa duas vezes no turno. ──
  {
    // O cérebro pede vehicle_details(rm:8022153) DUAS vezes (mesmo input) e depois autora o câmbio aterrado.
    const detScript = [q({ tool: "vehicle_details", input: { vehicleKey: ONIX2.vehicleKey } }), q({ tool: "vehicle_details", input: { vehicleKey: ONIX2.vehicleKey } }), groundedCambioFinal(ONIX2)];
    const r = await runTurn({ llmFirst: true, singleAuthor: true, legacyCommercialReplay: false }, { state: seedSelected(ONIX2), leadText: "qual o câmbio dele?", relation: "asks_vehicle_detail", script: detScript });
    const detailCalls = toolCalls.filter((c) => c.tool === "vehicle_details").length;
    check("[D] mesma tool+input NÃO executa 2x no turno (vehicle_details = 1 execução)", detailCalls === 1, `execs=${detailCalls}`);
    check("[D] turno ainda completa aterrado (câmbio na resposta)", r.status === "committed" && /manual/i.test(r.text), `status=${r.status} text="${r.text}"`);
  }

  console.log(`\n== F2.66: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
