// ============================================================================
// F2.87 — DINHEIRO SEMANTICO + NECESSIDADE FACTUAL ORTOGONAL AO ATO
//
// Regressões dos incidentes reais:
//   P0-A) uma proposta/entrada/parcela não pode virar precoMax e esconder o
//         veículo negociado;
//   P0-B) primaryIntent descreve o ato conversacional, mas não pode vetar uma
//         stock_search que a própria LLM declarou com capability+evidência.
//
// Não há detector de frase: a LLM declara o papel do valor; a engine valida o
// valor e o trecho literal. Somente search_budget pode limitar inventário.
//   npx tsx tests/run-f2-87-semantic-money-tool-needs.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { redact } from "../src/domain/effect-intent.ts";
import {
  applyMonetarySemanticsToCurrentConstraints,
  sanitizeStockSearchInputMoney,
  validateMonetarySemantics,
} from "../src/engine/monetary-semantics.ts";
import type { CommercialConstraints } from "../src/engine/commercial-constraints.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import { MONETARY_ROLES } from "../src/domain/agent-brain.ts";
import type { AgentBrainDecision, AgentBrainStep, AgentToolObservation, MonetaryRole, TurnUnderstanding } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponseDraft, ResponsePart, TurnRelation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok += 1; console.log(`  OK  ${name}`); return; }
  fail += 1;
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`);
}

const TENANT = "f49fd48a-4386-4009-95f3-26a5100b84f7";
const AGENT = "aee7e916-31b1-431c-ba6f-f38178fd4899";
const NOW = "2026-07-27T12:00:00.000Z";
const C180: VehicleFact = { vehicleKey: "rm:c180", marca: "Mercedes-Benz", modelo: "C180", ano: 2018, preco: 66500, km: 92000, cambio: "Automatico", cor: "Preto", tipo: "sedan" };
const ONIX: VehicleFact = { vehicleKey: "rm:onix", marca: "Chevrolet", modelo: "Onix", ano: 2020, preco: 59000, km: 60000, cambio: "Automatico", cor: "Branco", tipo: "hatch" };
const STOCK = [C180, ONIX];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aline", companyName: "Loja", promptText: "Atenda naturalmente." } as never);
const makeBusinessInfo = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Loja", source: "test" }; } });

class ComposeSpyLlm implements DecisionLlm {
  async proposeNextQueryOrFinal(): Promise<never> { throw new Error("compose não deveria rodar"); }
  async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; }
}
class RelPreparer implements TurnContextPreparer {
  async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor; catalogDegraded: boolean }> {
    return { interpretation: { relation: "ambiguous" }, tenantCatalog: catalog, claimExtractor: extractor, catalogDegraded: false };
  }
}

const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const txt = (content: string): ResponsePart => ({ type: "text", content });
const ref = (vehicleKey: string): ResponsePart => ({ type: "vehicle_ref", vehicleKey, field: "modelo" } as ResponsePart);

function understanding(over: Partial<TurnUnderstanding>): TurnUnderstanding {
  return {
    primaryIntent: "other",
    requestedCapabilities: [],
    subject: "none",
    subjectValue: null,
    subjectSource: "current_turn",
    evidence: [],
    monetaryMentions: [],
    isTopicChange: false,
    answeredLeadQuestions: [],
    policyDecision: null,
    ...over,
  } as TurnUnderstanding;
}

function responder(u: TurnUnderstanding, proposedInput: Record<string, unknown>): BrainResponder {
  return (_frame, observations: readonly AgentToolObservation[]) => {
    const stock = observations.find((item) => item.tool === "stock_search" && item.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
    if (!stock) return { kind: "query", understanding: u, call: { tool: "stock_search", input: proposedInput } as never } as AgentBrainStep;
    const first = stock.data.items[0];
    return {
      kind: "final",
      understanding: u,
      decision: {
        reasonCode: "stock_confirmed",
        reasonSummary: "fato consultado",
        confidence: 0.94,
        responsePlan: { guidance: "responder à negociação", draft: { parts: first ? [txt("Consultei o estoque e confirmei o veículo:"), ref(first.vehicleKey)] : [txt("Não localizei uma opção nesse recorte agora.")] } },
        proposedEffects: [reply],
        memoryMutations: [],
        stateMutations: [],
      } as AgentBrainDecision,
    } as AgentBrainStep;
  };
}

type RunCapture = {
  executedInputs: Record<string, unknown>[];
  resultKeys: string[];
  committed: boolean;
  responseSource: string | null;
  primaryIntent: string | null;
  activeConstraints: CommercialConstraints | null;
  policyFeedback: readonly string[];
};

async function runTurn(args: {
  lead: string;
  u: TurnUnderstanding;
  proposedInput: Record<string, unknown>;
  active?: CommercialConstraints;
  offered?: VehicleFact[];
}): Promise<RunCapture> {
  const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const conversationId = `wa:f287:${Math.random().toString(36).slice(2)}`;
  const initial = createInitialState({ conversationId, tenantId: TENANT, agentId: AGENT, leadId: null, now: clock.now() });
  const state = {
    ...initial,
    activeSearchConstraints: args.active ?? null,
    lastRenderedOfferContext: args.offered && args.offered.length > 0
      ? { sourceTurnId: "seed", createdAt: NOW, items: args.offered.map((vehicle, index) => ({ ordinal: index + 1, vehicleKey: vehicle.vehicleKey, marca: vehicle.marca, modelo: vehicle.modelo, ano: vehicle.ano, preco: vehicle.preco, tipo: vehicle.tipo })) }
      : null,
  };
  const seed = persistence.begin();
  seed.casState(conversationId, 0, state);
  const seeded = seed.commit();
  if (!seeded.ok) throw new Error(`seed_failed:${seeded.reason}`);

  const executedInputs: Record<string, unknown>[] = [];
  const resultKeys: string[] = [];
  const norm = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const runQuery = async (call: QueryCall): Promise<QueryResult> => {
    if (call.tool !== "stock_search") throw new Error(`tool inesperada: ${call.tool}`);
    const input = call.input as Record<string, unknown>;
    executedInputs.push({ ...input });
    let items = STOCK.slice();
    if (input.marca) items = items.filter((v) => norm(v.marca).includes(norm(String(input.marca))));
    if (input.modelo) {
      const tokens = norm(String(input.modelo)).split(/\s+/).filter(Boolean);
      items = items.filter((v) => tokens.every((token) => norm(`${v.marca} ${v.modelo}`).includes(token)));
    }
    const maxPrice = input.precoMax;
    if (typeof maxPrice === "number") items = items.filter((v) => (v.preco ?? Number.POSITIVE_INFINITY) <= maxPrice);
    resultKeys.push(...items.map((v) => v.vehicleKey));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: input as Record<string, never> }, source: "fake" } as QueryResult;
  };

  const brain = new ScriptedAgentBrain();
  brain.setResponder(responder(args.u, args.proposedInput));
  await persistence.tryInsert({ eventId: `${conversationId}:e1`, conversationId, raw: redact({ text: args.lead }), receivedAt: clock.now() });
  clock.advance(1000);
  const result = await runCentralConversationTurn({
    persistence,
    clock,
    brain,
    llm: new ComposeSpyLlm(),
    runQuery,
    businessInfo: makeBusinessInfo(),
    contextPreparer: new RelPreparer(),
    conversationId,
    tenantId: TENANT,
    agentId: AGENT,
    leadId: null,
    workerId: "w",
    turnId: `${conversationId}:t1`,
    leaseTtlMs: 60_000,
    portalPromptSha256: "sha-f287",
    limits: { maxSteps: 7, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 3,
    brainMaxSteps: 7,
    sdrPolicy,
    allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" },
    singleAuthor: true,
    llmFirst: true,
  } as never) as CentralTurnResult;
  const loaded = await persistence.load(conversationId);
  return {
    executedInputs,
    resultKeys,
    committed: result.status === "committed",
    responseSource: result.status === "committed" ? result.responseSource : null,
    primaryIntent: result.status === "committed" ? result.understanding.primaryIntent : null,
    activeConstraints: (loaded?.state.activeSearchConstraints ?? null) as CommercialConstraints | null,
    policyFeedback: result.status === "committed" ? result.policyFeedback : [],
  };
}

async function main(): Promise<void> {
  console.log("== F2.87: dinheiro semântico + necessidade factual independente ==");

  const offerBlock = "Tenho 60 mil caso aceite.";
  const offerU = understanding({ monetaryMentions: [{ value: 60000, role: "offer", quote: "60 mil caso aceite" }] });
  const budgetU = understanding({ monetaryMentions: [{ value: 60000, role: "search_budget", quote: "até 60 mil" }] });
  const baseConstraint: CommercialConstraints = { modelos: ["C180"], precoMax: 60000 };

  const offerSemantics = validateMonetarySemantics(offerBlock, offerU);
  check("[M1] proposta literal é validada, mas não vira orçamento", offerSemantics.authoritative && offerSemantics.searchBudget == null, JSON.stringify(offerSemantics));
  for (const role of MONETARY_ROLES.filter((candidate) => candidate !== "search_budget")) {
    const roleU = understanding({ monetaryMentions: [{ value: 60000, role: role as MonetaryRole, quote: "60 mil" }] });
    const roleBlock = "Valor informado: 60 mil.";
    check(`[M1-${role}] papel não-orçamento nunca limita estoque`,
      applyMonetarySemanticsToCurrentConstraints({ modelos: ["C180"], precoMax: 60000 }, roleBlock, roleU).precoMax == null
      && sanitizeStockSearchInputMoney({ modelo: "C180", precoMax: 60000 }, roleBlock, roleU).precoMax == null);
  }
  check("[M2] proposta remove somente o teto extraído do bloco", applyMonetarySemanticsToCurrentConstraints(baseConstraint, offerBlock, offerU).precoMax == null, JSON.stringify(applyMonetarySemanticsToCurrentConstraints(baseConstraint, offerBlock, offerU)));
  check("[M2b] proposta preserva orçamento anterior legítimo de outro valor", applyMonetarySemanticsToCurrentConstraints({ modelos: ["C180"], precoMax: 70000 }, offerBlock, offerU).precoMax === 70000);
  check("[M3] proposta copiada pela LLM para a tool é removida", sanitizeStockSearchInputMoney({ modelo: "C180", precoMax: 60000 }, offerBlock, offerU).precoMax == null);
  check("[M3b] proposta não autoriza outro teto inventado na mesma decisão", sanitizeStockSearchInputMoney({ modelo: "C180", precoMax: 70000 }, offerBlock, offerU).precoMax == null);
  check("[M4] search_budget validado preserva/aplica o teto", applyMonetarySemanticsToCurrentConstraints({ modelos: ["C180"] }, "Quero opções até 60 mil.", budgetU).precoMax === 60000);
  check("[M5] search_budget corrige a chamada para o valor semanticamente validado", sanitizeStockSearchInputMoney({ modelo: "C180", precoMax: 70000 }, "Quero opções até 60 mil.", budgetU).precoMax === 60000);

  const incomplete = understanding({ monetaryMentions: [] });
  check("[M6] metadado de produção incompleto não autoriza teto lexical", applyMonetarySemanticsToCurrentConstraints(baseConstraint, offerBlock, incomplete).precoMax == null);
  check("[M7] metadado inválido não derruba o turno nem reintroduz teto", sanitizeStockSearchInputMoney({ modelo: "C180", precoMax: 60000 }, offerBlock, understanding({ monetaryMentions: [{ value: 50000, role: "search_budget", quote: "50 mil" }] })).precoMax == null);
  const legacy = understanding({ monetaryMentions: undefined });
  check("[M8] fakes legados sem o campo continuam compatíveis", applyMonetarySemanticsToCurrentConstraints(baseConstraint, offerBlock, legacy).precoMax === 60000);

  const negotiationLead = "Tenho 60 mil caso aceite. O C180 ainda está disponível?";
  const negotiationU = understanding({
    primaryIntent: "financing",
    requestedCapabilities: ["stock_search"],
    subject: "explicit_model",
    subjectValue: "C180",
    evidence: [{ capability: "stock_search", quote: "C180 ainda está disponível" }],
    monetaryMentions: [{ value: 60000, role: "offer", quote: "60 mil caso aceite" }],
  });
  const p0a = await runTurn({
    lead: negotiationLead,
    u: negotiationU,
    proposedInput: { modelo: "C180", precoMax: 60000 },
    // Simula também um estado contaminado pela versão anterior: a proposta de
    // 60 mil já havia sido persistida como teto. O turno novo deve curá-lo.
    active: { marca: "mercedes-benz", modelos: ["C180"], precoMax: 60000 },
    offered: [C180],
  });
  check("[P0-A1] negociação executa uma única stock_search", p0a.executedInputs.length === 1, JSON.stringify(p0a.executedInputs));
  check("[P0-A2] proposta de 60 mil NÃO chega como precoMax executado", p0a.executedInputs[0]?.precoMax == null, JSON.stringify(p0a.executedInputs[0]));
  check("[P0-A3] C180 de 66,5 mil permanece visível", p0a.resultKeys.includes(C180.vehicleKey), JSON.stringify(p0a.resultKeys));
  check("[P0-A4] escopo persistido não guarda a proposta como teto", p0a.activeConstraints?.precoMax == null, JSON.stringify(p0a.activeConstraints));
  check("[P0-A5] turno termina pela LLM, sem fallback", p0a.committed && (p0a.responseSource === "brain_final" || p0a.responseSource === "brain_retry"), `${p0a.responseSource} ${JSON.stringify(p0a.policyFeedback)}`);
  check("[P0-A6] ato financing permanece financing", p0a.primaryIntent === "financing", String(p0a.primaryIntent));

  const selectionLead = "Quero esse carro. Ele ainda está disponível?";
  const selectionU = understanding({
    primaryIntent: "select_vehicle",
    requestedCapabilities: ["stock_search"],
    subject: "offer_reference",
    subjectValue: "esse carro",
    evidence: [
      { quote: "Quero esse carro" },
      { capability: "stock_search", quote: "ainda está disponível" },
    ],
    monetaryMentions: [],
  });
  const p0b = await runTurn({
    lead: selectionLead,
    u: selectionU,
    proposedInput: { modelo: "C180" },
    active: { marca: "mercedes-benz", modelos: ["C180"] },
    offered: [C180],
  });
  check("[P0-B1] select_vehicle + necessidade factual executa stock_search", p0b.executedInputs.length === 1, JSON.stringify(p0b.executedInputs));
  check("[P0-B2] consulta encontra o veículo selecionado", p0b.resultKeys.includes(C180.vehicleKey), JSON.stringify({ inputs: p0b.executedInputs, keys: p0b.resultKeys }));
  check("[P0-B3] primaryIntent não é reclassificado pela engine", p0b.primaryIntent === "select_vehicle", String(p0b.primaryIntent));
  check("[P0-B4] resposta é autorada pela LLM e não intro vazia/fallback", p0b.committed && (p0b.responseSource === "brain_final" || p0b.responseSource === "brain_retry"), `${p0b.responseSource} ${JSON.stringify(p0b.policyFeedback)}`);

  console.log(`\n== F2.87: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) {
    console.error(`FALHAS:\n - ${failures.join("\n - ")}`);
    process.exit(1);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
