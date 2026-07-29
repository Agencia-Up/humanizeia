// ============================================================================
// F2.90 — metadado semantico auxiliar nunca derruba uma decisao valida.
//
// Understanding ajuda memoria e telemetria, mas nao e uma segunda autorizacao
// para texto, tool ou efeito escolhidos pela LLM. Quando invalido, somente o
// metadado e suas mutacoes semanticas sao descartados. Tools, referencias e
// efeitos continuam submetidos as suas proprias validacoes factuais.
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
  check("[C2] texto nao sofre retry semantico, mas nao ganha autoridade de estado", c.text.includes("Selecionei") && c.decisionPayload.understandingMetadataDropped === 1, `${c.text} payload=${JSON.stringify(c.decisionPayload)}`);

  const invalidQuery = U("search_stock", { caps: ["stock_search", "select"], quote: "tem carro?", capability: "stock_search" });
  const d = await runCase("tem carro?", (_frame, observations) => observations.some((observation) => observation.tool === "stock_search")
    ? final([text("Encontrei uma opcao para voce."), { type: "vehicle_offer_list", vehicleKeys: [ONIX.vehicleKey] }])
    : ({ kind: "query", call: { tool: "stock_search", input: {} } as CentralQueryCall, understanding: invalidQuery }));
  check("[D1] chamada direta da LLM executa pela propria autoridade factual", d.result.status === "committed" && d.queryExecutions === 1 && /Onix/i.test(d.text), `queries=${d.queryExecutions} text=${d.text}`);
  check("[D2] metadado invalido da query e descartado sem autorizar selecao semantica", d.result.status === "committed" && !d.result.understandingFromBrain && Number(d.decisionPayload.understandingMetadataDropped ?? 0) >= 1, JSON.stringify(d.decisionPayload));

  const ungrounded = U("select_vehicle", { caps: ["select"], quote: "2024", capability: "select" });
  const e = await runCase("2024", (_frame, observations) => observations.some((observation) => !observation.ok && /aterrad|ground/i.test(observation.error.message))
    ? final([text("Qual modelo voce procura?")])
    : final([text("Temos um Chevrolet Onix 2020 disponivel.")], ungrounded));
  check("[E1] central_active nao atua como critico lexical de texto livre", e.result.status === "committed" && /Chevrolet Onix/i.test(e.text) && e.decisionPayload.hardDeniesApplied === 0, `${e.text} payload=${JSON.stringify(e.decisionPayload)}`);
  check("[E2] referencias estruturadas seguem com grounding proprio, sem reautoria lexical", e.result.status === "committed" && /^brain_/.test(e.result.responseSource) && !e.result.degraded, JSON.stringify(e.result));

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
  check("[H1] midia sem resultado factual da tool continua fail-closed", h.result.status === "committed" && !h.kinds.includes("send_media") && h.result.degraded && Number(h.decisionPayload.hardDeniesApplied ?? 0) >= 1, JSON.stringify(h.decisionPayload));
  check("[H2] causa do veto e o efeito inexequivel, nao o metadado semantico", Number(h.decisionPayload.understandingMetadataDropped ?? 0) >= 1 && JSON.stringify(h.decisionPayload.policyFeedback ?? []).includes("vehicle_photos_resolve"), JSON.stringify(h.decisionPayload));

  const passiveTradeIn = U("trade_in");
  const i = await runCase("Tenho um Renegade 2019 com 86 mil km.", () => final([
    text("Entendi. Podemos considerar seu Renegade na negociacao."),
  ], passiveTradeIn));
  check("[I1] texto conversacional passa mesmo com label auxiliar sem evidencia", i.result.status === "committed" && !i.result.degraded && !i.result.understandingFromBrain && /Renegade/i.test(i.text), JSON.stringify(i.result));
  check("[I2] label invalido e descartado e observado, nunca persistido como autoridade", i.decisionPayload.understandingAuthority === "fallback" && i.decisionPayload.understandingMetadataDropped === 1 && i.decisionPayload.hardDeniesApplied === 0, JSON.stringify(i.decisionPayload));
  check("[I3] label passivo nao autoriza tool, midia, handoff nem estado", i.queryExecutions === 0 && i.selectedKey == null && i.kinds.length === 1 && i.kinds[0] === "send_message", `queries=${i.queryExecutions} selected=${i.selectedKey} kinds=${i.kinds.join(",")}`);

  const rejectedSearch = U("search_stock", { caps: ["stock_search"], quote: "quero SUV", capability: "stock_search" });
  const correctedTradeIn = { ...U("trade_in"), subjectSource: "current_turn" as const };
  const j = await runCase("Tenho um Renegade 2019 com 86 mil km.", (_frame, observations) => observations.some((observation) => observation.tool === "stock_search")
    ? final([text("Entendi. Podemos considerar seu Renegade na negociacao.")], correctedTradeIn)
    : ({ kind: "query", call: { tool: "stock_search", input: { modelo: "Renegade" } } as CentralQueryCall, understanding: rejectedSearch }));
  check("[J1] metadado invalido nao trava tool nem resposta posterior", j.result.status === "committed" && !j.result.degraded && /Renegade/i.test(j.text), JSON.stringify(j.result));
  check("[J2] tool direta executa uma vez e labels invalidos nao viram autoridade", j.queryExecutions === 1 && j.result.status === "committed" && !j.result.understandingFromBrain && j.decisionPayload.understandingAuthority === "fallback" && Number(j.decisionPayload.understandingMetadataDropped ?? 0) >= 1, `queries=${j.queryExecutions} payload=${JSON.stringify(j.decisionPayload)}`);
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
    return final([text("Entendi sua preferencia por segunda. Qual horario fica melhor?")], staleOrdinalSelection);
  });
  check("[K1] dia da semana nao autoriza mutacao ordinal de veiculo", rejectedOrdinalAttempts === 1 && k.result.status === "committed" && !k.result.understandingFromBrain && k.selectedKey == null, JSON.stringify(k.result));
  check("[K2] resposta correta da LLM passa sem retry semantico nem fallback", k.result.status === "committed" && /^brain_/.test(k.result.responseSource) && !k.result.degraded && /segunda/i.test(k.text) && /horario/i.test(k.text), `src=${k.result.status === "committed" ? k.result.responseSource : k.result.status} text=${k.text}`);

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
      return final([
        text("Encontrei esta opcao automatica:"),
        { type: "vehicle_offer_list", vehicleKeys: [ONIX.vehicleKey] },
      ], invalidOrdinalAfterTool);
    }
    return final([
      text("Encontrei esta opcao automatica:"),
      { type: "vehicle_offer_list", vehicleKeys: [ONIX.vehicleKey] },
    ], searchU);
  });
  check("[L1] tool valida anterior nao transforma metadado ordinal invalido em estado", rejectedOrdinalAfterToolAttempts === 1 && l.result.status === "committed" && l.result.understanding.primaryIntent === "search_stock" && l.result.understanding.subject === "none" && l.result.understanding.subjectValue == null, JSON.stringify(l.result));
  check("[L2] resposta estruturada e aterrada passa sem retry semantico", l.result.status === "committed" && l.queryExecutions === 1 && /^brain_/.test(l.result.responseSource) && !l.result.degraded && /Onix/i.test(l.text), `queries=${l.queryExecutions} src=${l.result.status === "committed" ? l.result.responseSource : l.result.status} text=${l.text}`);

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
