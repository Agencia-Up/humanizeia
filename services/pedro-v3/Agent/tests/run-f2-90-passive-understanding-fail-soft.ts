// ============================================================================
// F2.90 — metadado semantico auxiliar nunca derruba uma resposta passiva valida.
//
// O understanding continua fail-closed para query, midia, handoff, mutacoes e
// knowledge gaps. Quando a LLM ja escreveu somente texto/refs aterradas e apenas
// propos send_message, um metadado semantico invalido e descartado: ele nao
// autoriza nada, nao entra no estado e nao transforma a resposta em fallback.
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import {
  InMemoryPersistence,
  FakeClock,
  FakeIdGen,
  createInMemoryBacking,
} from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { createInitialState, type ConversationState } from "../src/domain/conversation-state.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type {
  AgentBrainDecision,
  AgentBrainStep,
  CentralQueryCall,
  PrimaryIntent,
  TurnCapability,
  TurnUnderstanding,
} from "../src/domain/agent-brain.ts";
import type {
  ProposedEffectPlan,
  QueryCall,
  QueryResult,
  ResponseDraft,
  ResponsePart,
  TurnRelation,
} from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import { validateTurnUnderstanding } from "../src/engine/turn-understanding.ts";

let ok = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok += 1; console.log(`  OK  ${name}`); return; }
  fail += 1;
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`);
}

const NOW = "2026-07-27T18:00:00.000Z";
const ONIX: VehicleFact = {
  vehicleKey: "test:onix-2020",
  marca: "Chevrolet",
  modelo: "Onix",
  ano: 2020,
  preco: 69_900,
  km: 52_000,
  cambio: "Automatico",
  cor: "Prata",
  tipo: "hatch",
};
const catalog = buildTenantCatalog([ONIX]);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({
  qualificationQuestions: [],
  agentName: "Aline",
  companyName: "Monaco",
  promptText: "Voce e a Aline da Monaco.",
} as never);
const businessInfo = (): TenantBusinessInfoSource => ({
  async getBusinessInfo() { return { address: null, hours: null, unit: "Monaco", source: "test" }; },
});
class ComposeSpyLlm implements DecisionLlm {
  async proposeNextQueryOrFinal(): Promise<never> { throw new Error("legacy compose must not run"); }
  async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "unused" }] }; }
}
class Preparer implements TurnContextPreparer {
  async prepare(): Promise<{
    interpretation: { relation: TurnRelation };
    tenantCatalog: typeof catalog;
    claimExtractor: typeof extractor;
    catalogDegraded: boolean;
  }> {
    return {
      interpretation: { relation: "ambiguous" },
      tenantCatalog: catalog,
      claimExtractor: extractor,
      catalogDegraded: false,
    };
  }
}

const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const text = (content: string): ResponsePart => ({ type: "text", content });
const U = (primaryIntent: PrimaryIntent, options: {
  caps?: TurnCapability[];
  quote?: string;
  capability?: TurnCapability | null;
  subject?: TurnUnderstanding["subject"];
  subjectValue?: string | null;
} = {}): TurnUnderstanding => ({
  primaryIntent,
  requestedCapabilities: options.caps ?? [],
  subject: options.subject ?? "none",
  subjectValue: options.subjectValue ?? null,
  subjectSource: options.subject ? "current_turn" : "none",
  evidence: options.quote ? [{ capability: options.capability ?? undefined, quote: options.quote }] : [],
  isTopicChange: false,
  answeredLeadQuestions: [],
});
const final = (
  content: ResponsePart[],
  understanding?: TurnUnderstanding,
  options: { effects?: ProposedEffectPlan[]; stateMutations?: unknown[] } = {},
): AgentBrainStep => ({
  kind: "final",
  understanding,
  decision: {
    reasonCode: "reply",
    reasonSummary: "resposta da LLM",
    confidence: 0.9,
    responsePlan: { guidance: "responda ao bloco atual", draft: { parts: content } },
    proposedEffects: options.effects ?? [reply],
    memoryMutations: [],
    stateMutations: options.stateMutations ?? [],
  } as AgentBrainDecision,
});

type RunCapture = {
  result: CentralTurnResult;
  text: string;
  kinds: string[];
  queryExecutions: number;
  selectedKey: string | null;
  decisionPayload: Record<string, unknown>;
};
let seq = 0;
async function runCase(lead: string, responder: BrainResponder): Promise<RunCapture> {
  seq += 1;
  const conversationId = `f290-${seq}`;
  const turnId = `${conversationId}-t1`;
  const clock = new FakeClock(NOW);
  const backing = createInMemoryBacking();
  const persistence = new InMemoryPersistence(clock, new FakeIdGen(), backing);
  const initial = createInitialState({
    conversationId,
    tenantId: "tenant-f290",
    agentId: "agent-f290",
    leadId: null,
    now: NOW,
  });
  const seeded: ConversationState = {
    ...initial,
    turnNumber: 2,
    recentTurns: [{ role: "agent", text: "Como posso ajudar?", at: NOW, authoring: "llm" }],
  };
  const uow = persistence.begin();
  uow.casState(conversationId, 0, seeded);
  const seededResult = await uow.commit();
  if (!seededResult.ok) throw new Error("seed failed");

  const brain = new ScriptedAgentBrain();
  brain.setResponder(responder);
  let queryExecutions = 0;
  const runQuery = async (call: QueryCall): Promise<QueryResult> => {
    queryExecutions += 1;
    if (call.tool === "stock_search") {
      return {
        ok: true,
        tool: "stock_search",
        data: { items: [ONIX], filtersUsed: call.input as Record<string, never> },
        source: "test",
      } as QueryResult;
    }
    throw new Error(`unexpected tool ${call.tool}`);
  };
  await persistence.tryInsert({
    eventId: `${conversationId}-e1`,
    conversationId,
    raw: redact({ text: lead }),
    receivedAt: clock.now(),
  });
  clock.advance(1_000);
  const result = await runCentralConversationTurn({
    persistence,
    clock,
    brain,
    llm: new ComposeSpyLlm(),
    runQuery,
    businessInfo: businessInfo(),
    contextPreparer: new Preparer(),
    conversationId,
    tenantId: "tenant-f290",
    agentId: "agent-f290",
    leadId: null,
    workerId: "worker-f290",
    turnId,
    leaseTtlMs: 60_000,
    portalPromptSha256: "sha-f290",
    limits: { maxSteps: 7, totalTimeoutMs: 8_000, proposeTimeoutMs: 2_000, queryTimeoutMs: 2_000, composeTimeoutMs: 2_000 },
    maxValidationAttempts: 2,
    brainMaxSteps: 7,
    sdrPolicy,
    allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" },
    singleAuthor: true,
    llmFirst: true,
  } as never) as CentralTurnResult;
  const outbox = (await persistence.listOutbox(conversationId)).filter((record) => record.turnId === turnId) as unknown as Array<{
    kind: string;
    payload?: { text?: string };
  }>;
  const state = (await persistence.load(conversationId))?.state;
  const decisionEvent = backing.events.find((event) => event.turnId === turnId && event.type === "decision_final");
  return {
    result,
    text: outbox.find((record) => record.kind === "send_message")?.payload?.text ?? "",
    kinds: outbox.map((record) => record.kind),
    queryExecutions,
    selectedKey: state?.vehicleContext.selected?.key ?? null,
    decisionPayload: (decisionEvent?.payload ?? {}) as unknown as Record<string, unknown>,
  };
}

async function main(): Promise<void> {
  console.log("== F2.90: fail-soft somente para understanding auxiliar de final passivo ==");

  const invalidYearSelection = U("select_vehicle", { caps: ["select"], quote: "2024", capability: "select" });
  const invalidYearValidation = validateTurnUnderstanding(invalidYearSelection, "2024", true);
  check("[A0] precondicao: '2024' nao prova selecao de veiculo", !invalidYearValidation.trusted, JSON.stringify(invalidYearValidation.semanticIssues));
  const a = await runCase("2024", () => final([text("Entendi. Qual modelo voce procura?")], invalidYearSelection));
  check("[A1] metadado invalido nao derruba texto passivo da LLM", a.result.status === "committed" && /^brain_/.test(a.result.responseSource) && !a.result.degraded, JSON.stringify(a.result));
  check("[A2] metadado descartado nao vira autoridade nem estado", a.result.status === "committed" && !a.result.understandingFromBrain && a.selectedKey == null, `fromBrain=${a.result.status === "committed" ? a.result.understandingFromBrain : "n/a"} selected=${a.selectedKey}`);
  check("[A3] descarte e observavel sem virar hard deny", a.decisionPayload.understandingMetadataDropped === 1 && a.decisionPayload.hardDeniesApplied === 0, JSON.stringify(a.decisionPayload));

  const stale = U("select_vehicle", { caps: ["select"], quote: "gostei do segundo", capability: "select" });
  const b = await runCase("Entendi", () => final([text("Perfeito. Se quiser, podemos continuar daqui.")], stale));
  check("[B1] evidence de outro turno nao transforma 'Entendi' em fallback", b.result.status === "committed" && /^brain_/.test(b.result.responseSource) && !b.result.degraded, JSON.stringify(b.result));
  check("[B2] understanding stale e descartada, nao normalizada como verdade", b.result.status === "committed" && !b.result.understandingFromBrain, JSON.stringify(b.decisionPayload));

  const invalidMutation = U("select_vehicle", { caps: ["select"], quote: "2024", capability: "select" });
  const c = await runCase("2024", (_frame, observations) => observations.some((observation) => !observation.ok)
    ? final([text("Qual modelo voce procura?")])
    : final([text("Selecionei o carro.")], invalidMutation, {
      stateMutations: [{ op: "select_vehicle_focus", vehicle: { kind: "vehicle", key: ONIX.vehicleKey, label: "Chevrolet Onix 2020" }, sourceTurnId: "bad" }],
    }));
  check("[C1] mutacao continua exigindo understanding confiavel", c.result.status === "committed" && c.selectedKey == null, `selected=${c.selectedKey}`);
  check("[C2] somente a resposta corrigida passa", !c.text.includes("Selecionei"), c.text);

  const invalidQuery = U("search_stock", { caps: ["stock_search", "select"], quote: "tem carro?", capability: "stock_search" });
  const d = await runCase("tem carro?", (_frame, observations) => observations.some((observation) => !observation.ok)
    ? final([text("Qual tipo de carro voce procura?")])
    : ({ kind: "query", call: { tool: "stock_search", input: {} } as CentralQueryCall, understanding: invalidQuery }));
  check("[D1] query com metadado invalido continua bloqueada antes do adapter", d.result.status === "committed" && d.queryExecutions === 0, `queries=${d.queryExecutions}`);

  const ungrounded = U("select_vehicle", { caps: ["select"], quote: "2024", capability: "select" });
  const e = await runCase("2024", (_frame, observations) => observations.some((observation) => !observation.ok && /aterrad|ground/i.test(observation.error.message))
    ? final([text("Qual modelo voce procura?")])
    : final([text("Temos um Chevrolet Onix 2020 disponivel.")], ungrounded));
  check("[E1] fail-soft nao ignora grounding factual", e.result.status === "committed" && !/Chevrolet Onix/i.test(e.text), e.text);
  check("[E2] resposta aterrada/corrigida continua autorada pela LLM", e.result.status === "committed" && /^brain_/.test(e.result.responseSource), JSON.stringify(e.result));

  const searchU = U("search_stock", { caps: ["stock_search"], quote: "quero um carro automatico", capability: "stock_search", subject: "none" });
  const invalidFinalAfterTool = U("search_stock", { caps: ["stock_search", "select"], quote: "quero um carro automatico", capability: "stock_search" });
  const f = await runCase("quero um carro automatico", (_frame, observations) => observations.some((observation) => observation.tool === "stock_search" && observation.ok)
    ? final([
      text("Encontrei esta opcao:"),
      { type: "vehicle_offer_list", vehicleKeys: [ONIX.vehicleKey] },
    ], invalidFinalAfterTool)
    : ({ kind: "query", call: { tool: "stock_search", input: { cambio: "automatic" } } as CentralQueryCall, understanding: searchU }));
  check("[F1] tool valida executa uma vez", f.queryExecutions === 1, `queries=${f.queryExecutions}`);
  check("[F2] metadado final invalido nao apaga understanding confiavel da tool", f.result.status === "committed" && f.result.understandingFromBrain && f.result.understanding.primaryIntent === "search_stock", JSON.stringify(f.result));
  check("[F3] lista aterrada da LLM e publicada sem fallback", f.result.status === "committed" && /^brain_/.test(f.result.responseSource) && !f.result.degraded && /Onix/i.test(f.text), f.text);

  const validSmalltalk = U("smalltalk", { quote: "obrigado" });
  const g = await runCase("obrigado", () => final([text("Eu que agradeco. Se precisar, estou por aqui.")], validSmalltalk));
  check("[G1] understanding valida de final passivo continua aceita", g.result.status === "committed" && g.result.understandingFromBrain && g.result.understanding.primaryIntent === "smalltalk", JSON.stringify(g.result));
  check("[G2] fail-soft nao mascara metadado valido", g.decisionPayload.understandingMetadataDropped === 0 && g.decisionPayload.hardDeniesApplied === 0, JSON.stringify(g.decisionPayload));

  const invalidMedia = U("select_vehicle", { caps: ["select"], quote: "2024", capability: "select" });
  const h = await runCase("2024", (_frame, observations) => observations.some((observation) => !observation.ok && observation.error.code === "UNDERSTANDING_CONFLICT")
    ? final([text("Qual modelo voce procura?")])
    : final([text("Vou enviar as fotos.")], invalidMedia, {
      effects: [
        reply,
        { kind: "send_media", planId: "photos", order: 1, onSuccess: [], vehicleKey: ONIX.vehicleKey, photoIds: ["photo-1"] } as ProposedEffectPlan,
      ],
    }));
  check("[H1] efeito de midia continua fail-closed com understanding invalida", h.result.status === "committed" && !h.kinds.includes("send_media") && h.decisionPayload.hardDeniesApplied === 1, JSON.stringify(h.decisionPayload));
  check("[H2] metadado de passo operacional nao entra no fail-soft", h.decisionPayload.understandingMetadataDropped === 0, JSON.stringify(h.decisionPayload));

  const passiveTradeIn = U("trade_in");
  const i = await runCase("Tenho um Renegade 2019 com 86 mil km.", () => final([
    text("Entendi. Podemos considerar seu Renegade na negociacao."),
  ], passiveTradeIn));
  check("[I1] intent passivo sem evidence preserva a leitura conversacional da LLM", i.result.status === "committed" && i.result.understandingFromBrain && i.result.understanding.primaryIntent === "trade_in", JSON.stringify(i.result));
  check("[I2] label passivo e observavel, mas permanece nao confiavel para execucao", i.decisionPayload.understandingAuthority === "passive_label" && i.decisionPayload.understandingTrusted === false, JSON.stringify(i.decisionPayload));
  check("[I3] label passivo nao autoriza tool, midia, handoff nem estado", i.queryExecutions === 0 && i.selectedKey == null && i.kinds.length === 1 && i.kinds[0] === "send_message", `queries=${i.queryExecutions} selected=${i.selectedKey} kinds=${i.kinds.join(",")}`);

  const rejectedSearch = U("search_stock", { caps: ["stock_search"], quote: "quero SUV", capability: "stock_search" });
  const correctedTradeIn = { ...U("trade_in"), subjectSource: "current_turn" as const };
  const j = await runCase("Tenho um Renegade 2019 com 86 mil km.", (_frame, observations) => observations.some((observation) => !observation.ok)
    ? final([text("Entendi. Podemos considerar seu Renegade na negociacao.")], correctedTradeIn)
    : ({ kind: "query", call: { tool: "stock_search", input: { modelo: "Renegade" } } as CentralQueryCall, understanding: rejectedSearch }));
  check("[J1] understanding operacional rejeitada nao trava a correcao textual posterior", j.result.status === "committed" && j.result.understanding.primaryIntent === "trade_in", JSON.stringify(j.result));
  check("[J2] tentativa sem autoridade nao executa tool e nao contamina o label passivo", j.queryExecutions === 0 && j.decisionPayload.understandingAuthority === "passive_label", `queries=${j.queryExecutions} payload=${JSON.stringify(j.decisionPayload)}`);
  check("[J3] metadado auxiliar descartado nao autoriza efeito alem da mensagem", j.kinds.length === 1 && j.kinds[0] === "send_message" && j.selectedKey == null, `kinds=${j.kinds.join(",")} selected=${j.selectedKey}`);

  let rejectedOrdinalAttempts = 0;
  const staleOrdinalSelection: TurnUnderstanding = {
    ...U("other", { caps: ["select"], quote: "quero agendar visita", capability: "select" }),
    subject: "selected_vehicle",
    subjectSource: "current_turn",
  };
  const visit = U("visit", { quote: "quero agendar visita" });
  const k = await runCase("quero agendar visita\npra segunda", (_frame, observations) => {
    const conflict = observations.some((observation) => !observation.ok && observation.error.code === "UNDERSTANDING_CONFLICT");
    if (conflict) {
      return final([text("Entendi sua preferencia por segunda. Qual horario fica melhor?")], visit);
    }
    rejectedOrdinalAttempts += 1;
    return final([text("Otima escolha. O segundo carro e uma boa opcao.")], staleOrdinalSelection);
  });
  check("[K1] dia da semana nao autoriza ordinal de veiculo no texto passivo", rejectedOrdinalAttempts === 1 && k.result.status === "committed" && k.result.understanding.primaryIntent === "visit", JSON.stringify(k.result));
  check("[K2] a mesma LLM reautora a visita, sem recovery nem fallback", k.result.status === "committed" && /^brain_/.test(k.result.responseSource) && !k.result.degraded && /segunda/i.test(k.text) && /horario/i.test(k.text) && !/segundo carro/i.test(k.text), `src=${k.result.status === "committed" ? k.result.responseSource : k.result.status} text=${k.text}`);

  let rejectedOrdinalAfterToolAttempts = 0;
  const invalidOrdinalAfterTool = U("select_vehicle", {
    caps: ["select"],
    quote: "quero um carro automatico",
    capability: "select",
    subject: "ordinal_from_last_offer",
    subjectValue: "2",
  });
  const l = await runCase("quero um carro automatico", (_frame, observations) => {
    const stockResolved = observations.some((observation) => observation.tool === "stock_search" && observation.ok);
    const ordinalRejected = observations.some((observation) => !observation.ok
      && observation.error.code === "UNDERSTANDING_CONFLICT"
      && /ordinal|primeiro|segundo|terceiro/i.test(observation.error.message));
    if (!stockResolved) {
      return { kind: "query", call: { tool: "stock_search", input: { cambio: "automatic" } } as CentralQueryCall, understanding: searchU };
    }
    if (!ordinalRejected) {
      rejectedOrdinalAfterToolAttempts += 1;
      return final([text("O segundo carro e uma otima escolha.")], invalidOrdinalAfterTool);
    }
    return final([
      text("Encontrei esta opcao automatica:"),
      { type: "vehicle_offer_list", vehicleKeys: [ONIX.vehicleKey] },
    ], searchU);
  });
  check("[L1] tool valida anterior nao autoriza ordinal inventado no texto final", rejectedOrdinalAfterToolAttempts === 1 && l.result.status === "committed" && l.result.understanding.primaryIntent === "search_stock", JSON.stringify(l.result));
  check("[L2] a LLM corrige o texto usando o fato aterrado, sem fallback", l.result.status === "committed" && l.queryExecutions === 1 && /^brain_/.test(l.result.responseSource) && !l.result.degraded && /Onix/i.test(l.text) && !/segundo carro/i.test(l.text), `queries=${l.queryExecutions} src=${l.result.status === "committed" ? l.result.responseSource : l.result.status} text=${l.text}`);

  console.log(`\nF2.90: ${ok} OK / ${fail} FALHA`);
  if (fail > 0) {
    console.error("FALHAS:\n - " + failures.join("\n - "));
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
