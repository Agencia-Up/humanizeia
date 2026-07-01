// run-model-adapter.ts - F2.5.5
//
// Adapter provider-agnostic para modelo estruturado + extrator semantico
// independente. SEM chamada real de rede, SEM provider real, SEM efeito externo.

import { StructuredJsonConversationModel, type ModelHttpRequest, type ModelHttpResponse, type ModelHttpTransport } from "../src/adapters/llm/structured-json-model.ts";
import { PromptBoundConversationAdapter, ModelOutputError } from "../src/adapters/llm/prompt-bound-conversation.ts";
import { CompositeClaimExtractor, LexiconAutomotiveClaimExtractor } from "../src/engine/automotive-claim-extractor.ts";
import { CatalogClaimExtractor, ConversationTurnContextPreparer, type TenantCatalogSource } from "../src/engine/turn-context-preparer.ts";
import { PolicyEngine } from "../src/engine/policy-engine.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { TenantRuntimeConfig, TenantAgentRef } from "../src/domain/read-ports.ts";
import type { ComposeModelRequest, InterpretModelRequest, ProposeModelRequest, TurnUnderstanding } from "../src/domain/conversation-model.ts";
import type { ClaimExtractor, ProposedDecision, QueryResult, RenderedResponse, TenantCatalog, TurnDecision, TurnInterpretation } from "../src/domain/decision.ts";
import type { TurnContext } from "../src/domain/context.ts";

let ok = 0;
let failed = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { ok += 1; console.log(`  OK  ${name}`); }
  else { failed += 1; console.error(`  RED ${name}${detail ? `: ${detail}` : ""}`); }
}
async function expectThrow(name: string, fn: () => Promise<unknown> | unknown, contains: string): Promise<void> {
  try { await fn(); check(name, false, "deveria lancar"); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, message.includes(contains), message);
  }
}

const NOW = "2026-06-28T12:00:00.000Z";
const TENANT = "tenant-model";
const AGENT = "agent-model";
const ENDPOINT = "https://api.openai.com/v1/responses";
const API_KEY = "sk-test-SECRET-DO-NOT-LEAK";

const runtimeConfig: TenantRuntimeConfig = Object.freeze({
  tenantId: TENANT,
  agentId: AGENT,
  agentName: "Aloan",
  companyName: null,
  instanceId: null,
  promptText: "Prompt vivo do portal.",
  promptSource: "raw_system_prompt",
  versionStamp: "agent:v1|integration:v1",
  model: "gpt-test",
  temperature: 0.2,
  sdrGoal: "agendar",
  qualificationQuestions: ["nome", "pagamento"],
  sellsMotorcycles: false,
  blockedCategories: [],
  ragRestricted: false,
  stockProvider: "none",
  stockSecretRef: null,
  stockIntegrations: [],
});

class RecordingModelTransport implements ModelHttpTransport {
  readonly requests: Array<{ url: string; request: ModelHttpRequest }> = [];
  response: ModelHttpResponse = {
    status: 200,
    contentType: "application/json",
    bodyText: JSON.stringify({ output: { relation: "ambiguous", intentSummary: "ok" } }),
  };
  async postJson(url: string, request: ModelHttpRequest): Promise<ModelHttpResponse> {
    this.requests.push({ url, request });
    return this.response;
  }
}

class NeverResolvingTransport implements ModelHttpTransport {
  signalSeen: AbortSignal | null = null;
  async postJson(_url: string, request: ModelHttpRequest): Promise<ModelHttpResponse> {
    this.signalSeen = request.signal;
    return new Promise<ModelHttpResponse>(() => undefined);
  }
}

function model(transport: ModelHttpTransport, over: Partial<ConstructorParameters<typeof StructuredJsonConversationModel>[0]> = {}) {
  return new StructuredJsonConversationModel({
    endpointUrl: over.endpointUrl ?? ENDPOINT,
    allowedHosts: over.allowedHosts ?? ["api.openai.com"],
    apiKey: over.apiKey ?? API_KEY,
    model: over.model ?? "gpt-test",
    timeoutMs: over.timeoutMs ?? 100,
    maxResponseBytes: over.maxResponseBytes ?? 4096,
  }, transport);
}

function baseState() {
  return createInitialState({ conversationId: "conv-model", tenantId: TENANT, agentId: AGENT, leadId: "lead-model", now: NOW });
}

function turnContext(claimExtractor: ClaimExtractor, catalog: TenantCatalog = { entries: [] }): TurnContext {
  return {
    state: baseState(),
    turnId: "turn-model",
    leadMessage: "boa noite",
    now: NOW,
    interpretation: { relation: "ambiguous" },
    tenantCatalog: catalog,
    claimExtractor,
  };
}

const decision: TurnDecision = {
  turnId: "turn-model",
  action: "reply",
  reasonCode: "TEST",
  reasonSummary: "teste",
  confidence: 1,
  decisionMutations: [],
  effectPlan: [],
  responsePlan: { guidance: "responder" },
  policyChecks: [],
};

async function main(): Promise<void> {
  console.log("F2.5.5 structured model adapter + semantic claims:");

  await expectThrow("endpoint http e rejeitado", () => model(new RecordingModelTransport(), { endpointUrl: "http://api.openai.com/v1/responses" }), "MODEL_ENDPOINT_INVALID");
  await expectThrow("host fora da allowlist e rejeitado", () => model(new RecordingModelTransport(), { endpointUrl: "https://evil.example.com/v1/responses" }), "MODEL_HOST_NOT_ALLOWED");
  await expectThrow("endpoint com credencial embutida e rejeitado", () => model(new RecordingModelTransport(), { endpointUrl: "https://user:secret@api.openai.com/v1/responses" }), "MODEL_ENDPOINT_INVALID");
  await expectThrow("endpoint com query e rejeitado", () => model(new RecordingModelTransport(), { endpointUrl: "https://api.openai.com/v1/responses?api_key=secret" }), "MODEL_ENDPOINT_INVALID");
  await expectThrow("apiKey vazia falha fechado", () => model(new RecordingModelTransport(), { apiKey: "" }), "MODEL_API_KEY_MISSING");
  await expectThrow("timeout invalido falha fechado", () => model(new RecordingModelTransport(), { timeoutMs: 0 }), "MODEL_CONFIG_INVALID");
  await expectThrow("limite de resposta invalido falha fechado", () => model(new RecordingModelTransport(), { maxResponseBytes: -1 }), "MODEL_CONFIG_INVALID");

  {
    const transport = new RecordingModelTransport();
    const m = model(transport);
    const out = await m.interpret({
      operation: "interpret",
      binding: new PromptBoundConversationAdapter(runtimeConfig, m).binding,
      turn: {
        turnId: "turn-model",
        now: NOW,
        leadMessage: "oi",
        state: baseState(),
        tenantCatalog: { entries: [] },
      },
    });
    const body = JSON.parse(transport.requests[0].request.body) as Record<string, unknown>;
    check("transport recebe POST JSON com operacao interpret", transport.requests[0].url === ENDPOINT && body.operation === "interpret");
    check("authorization existe so no header do request", transport.requests[0].request.headers.authorization === `Bearer ${API_KEY}`);
    check("JSON.stringify do adapter nao vaza apiKey", !JSON.stringify(m).includes(API_KEY));
    check("payload estruturado e extraido de output", (out as TurnInterpretation).relation === "ambiguous");
  }

  {
    const transport = new RecordingModelTransport();
    transport.response = {
      status: 200,
      contentType: "application/json; charset=utf-8",
      bodyText: JSON.stringify({ output_text: JSON.stringify({ relation: "continues_offer", intentSummary: "quer seguir" }) }),
    };
    const out = await model(transport).interpret({
      operation: "interpret",
      binding: new PromptBoundConversationAdapter(runtimeConfig, model(new RecordingModelTransport())).binding,
      turn: { turnId: "t", now: NOW, leadMessage: "gostei", state: baseState(), tenantCatalog: { entries: [] } },
    });
    check("payload pode vir como output_text JSON", (out as TurnInterpretation).relation === "continues_offer");
  }

  {
    const transport = new RecordingModelTransport();
    const proposal: ProposedDecision = {
      proposedAction: "reply",
      facts: [],
      proposedEffects: [],
      responsePlan: { guidance: "ok" },
      reasonCode: "OK",
      reasonSummary: "ok",
      confidence: 0.9,
    };
    transport.response = { status: 200, contentType: "application/json", bodyText: JSON.stringify({ output: { kind: "final", proposal } }) };
    const adapter = new PromptBoundConversationAdapter(runtimeConfig, model(transport));
    const step = await adapter.proposeNextQueryOrFinal(turnContext(new CatalogClaimExtractor({ entries: [] })), []);
    check("StructuredJsonConversationModel integra com PromptBound decoder", step.kind === "final" && step.proposal.reasonCode === "OK");
  }

  {
    const transport = new RecordingModelTransport();
    const proposal = {
      proposedAction: "reply", facts: [], proposedEffects: [], responsePlan: { guidance: "perguntar interesse" }, confidence: 0.9,
    };
    transport.response = { status: 200, contentType: "application/json", bodyText: JSON.stringify({ output: { kind: "final", proposal } }) };
    const adapter = new PromptBoundConversationAdapter(runtimeConfig, model(transport));
    const step = await adapter.proposeNextQueryOrFinal(turnContext(new CatalogClaimExtractor({ entries: [] })), []);
    check("metadado diagnostico ausente nao derruba decisao valida", step.kind === "final" && step.proposal.reasonCode === "model_decision");
  }
  {
    // FIX D (Fase 0): confidence e METADADO -> fora de [0,1] NAO derruba o turno, clampa (era a raiz do turno-3).
    const transport = new RecordingModelTransport();
    const proposal = { proposedAction: "reply", facts: [], proposedEffects: [], responsePlan: { guidance: "ok" }, reasonCode: "OK", reasonSummary: "ok", confidence: 1.5 };
    transport.response = { status: 200, contentType: "application/json", bodyText: JSON.stringify({ output: { kind: "final", proposal } }) };
    const adapter = new PromptBoundConversationAdapter(runtimeConfig, model(transport));
    const step = await adapter.proposeNextQueryOrFinal(turnContext(new CatalogClaimExtractor({ entries: [] })), []);
    check("FIX D: confidence>1 nao derruba turno (clampa em 1)", step.kind === "final" && step.proposal.confidence === 1, JSON.stringify(step.kind === "final" ? step.proposal.confidence : step.kind));
  }
  {
    // FIX D (Fase 0): confidence ausente/nao-numerico -> default seguro, turno segue vivo.
    const transport = new RecordingModelTransport();
    const proposal = { proposedAction: "reply", facts: [], proposedEffects: [], responsePlan: { guidance: "ok" }, reasonCode: "OK", reasonSummary: "ok" };
    transport.response = { status: 200, contentType: "application/json", bodyText: JSON.stringify({ output: { kind: "final", proposal } }) };
    const adapter = new PromptBoundConversationAdapter(runtimeConfig, model(transport));
    const step = await adapter.proposeNextQueryOrFinal(turnContext(new CatalogClaimExtractor({ entries: [] })), []);
    check("FIX D: confidence ausente nao derruba turno (default 0.7)", step.kind === "final" && step.proposal.confidence === 0.7, JSON.stringify(step.kind === "final" ? step.proposal.confidence : step.kind));
  }
  {
    // F2.6R: proposta final SEM proposedEffects -> decoder rejeita E aponta o campo (observabilidade).
    const transport = new RecordingModelTransport();
    transport.response = { status: 200, contentType: "application/json", bodyText: JSON.stringify({ output: { kind: "final", proposal: { proposedAction: "reply", facts: [], responsePlan: { guidance: "x" }, reasonCode: "OK", reasonSummary: "ok", confidence: 0.5 } } }) };
    const adapter = new PromptBoundConversationAdapter(runtimeConfig, model(transport));
    let err: unknown = null;
    try { await adapter.proposeNextQueryOrFinal(turnContext(new CatalogClaimExtractor({ entries: [] })), []); } catch (e) { err = e; }
    check("F2.6R: decoder aponta o campo invalido (proposedEffects)", err instanceof ModelOutputError && err.code === "MODEL_DECISION_INVALID" && err.detail === "proposedEffects", String(err));
  }

  {
    const bad = new RecordingModelTransport();
    bad.response = { status: 500, contentType: "application/json", bodyText: JSON.stringify({ error: `leak ${API_KEY}` }) };
    await expectThrow("HTTP nao-2xx vira erro sanitizado", () => model(bad).interpret({
      operation: "interpret",
      binding: new PromptBoundConversationAdapter(runtimeConfig, model(new RecordingModelTransport())).binding,
      turn: { turnId: "t", now: NOW, leadMessage: "oi", state: baseState(), tenantCatalog: { entries: [] } },
    }), "MODEL_HTTP_FAILURE");
  }

  {
    const bad = new RecordingModelTransport();
    bad.response = { status: 200, contentType: "text/plain", bodyText: "{}" };
    await expectThrow("content-type nao JSON e rejeitado", () => model(bad).compose({} as ComposeModelRequest), "MODEL_RESPONSE_NOT_JSON");
  }

  {
    const bad = new RecordingModelTransport();
    bad.response = { status: 200, contentType: "application/json", bodyText: "not-json" };
    await expectThrow("JSON invalido e rejeitado", () => model(bad).propose({} as ProposeModelRequest), "MODEL_RESPONSE_NOT_JSON");
  }

  {
    const bad = new RecordingModelTransport();
    bad.response = { status: 200, contentType: "application/json", bodyText: JSON.stringify({ output: { x: "y".repeat(500) } }) };
    await expectThrow("resposta acima do limite e rejeitada", () => model(bad, { maxResponseBytes: 32 }).propose({} as ProposeModelRequest), "MODEL_RESPONSE_TOO_LARGE");
  }

  {
    const slow = new NeverResolvingTransport();
    await expectThrow("timeout independe do transporte cooperar", () => model(slow, { timeoutMs: 15 }).interpret({} as InterpretModelRequest), "MODEL_TIMEOUT");
    check("AbortSignal e acionado no timeout", slow.signalSeen?.aborted === true);
  }

  {
    const extractor = new LexiconAutomotiveClaimExtractor([
      { kind: "brand_model", term: "Zeekr X", aliases: ["zeekr-x"] },
      { kind: "model", term: "XC60", aliases: ["xc 60"] },
    ]);
    const claims = extractor.extractClaims("Tenho um Zeekr-X e um Volvo XC 60 aqui.");
    check("extrator semantico detecta brand_model por alias", claims.some((c) => c.kind === "brand_model" && c.normalized === "zeekr x"));
    check("extrator semantico detecta modelo por alias", claims.some((c) => c.kind === "model" && c.normalized === "xc60"));
  }

  await expectThrow("lexicon invalido falha fechado", () => new LexiconAutomotiveClaimExtractor([{ kind: "model", term: "" }]), "AUTOMOTIVE_LEXICON_INVALID");
  await expectThrow("composite vazio falha fechado", () => new CompositeClaimExtractor([]), "CLAIM_EXTRACTOR_INVALID");

  {
    const mutable: ClaimExtractor[] = [new LexiconAutomotiveClaimExtractor([{ kind: "model", term: "XC60" }])];
    const composite = new CompositeClaimExtractor(mutable);
    mutable.length = 0;
    check("composite isola a lista externa mutavel", composite.extractClaims("XC60").length === 1);
  }

  {
    const semantic = new LexiconAutomotiveClaimExtractor([{ kind: "brand_model", term: "Zeekr X" }]);
    const rendered: RenderedResponse = { draft: { parts: [{ type: "text", content: "Temos Zeekr X por aqui." }] }, text: "Temos Zeekr X por aqui." };
    const verdicts = PolicyEngine.validateResponse(rendered, [] as QueryResult[], decision, turnContext(semantic));
    check("claim independente bloqueia veiculo inventado fora do catalogo", verdicts.some((v) => v.outcome === "deny" && v.policyId === "POL-GROUND-STOCK"));
  }

  {
    const catalog: TenantCatalog = { entries: [{ vehicleKey: "revendamais:1", brand: "Jeep", model: "Renegade", aliases: ["Jeep Renegade"] }] };
    const semantic = new LexiconAutomotiveClaimExtractor([{ kind: "brand_model", term: "Zeekr X" }]);
    const understanding: TurnUnderstanding = {
      async interpret(): Promise<TurnInterpretation> { return { relation: "ambiguous", intentSummary: "ok" }; },
    };
    const catalogs: TenantCatalogSource = { async loadCatalog(_ref: TenantAgentRef): Promise<TenantCatalog> { return catalog; } };
    const prepared = await new ConversationTurnContextPreparer({ tenantId: TENANT, agentId: AGENT }, understanding, catalogs, semantic)
      .prepare({ state: baseState(), turnId: "turn-model", leadMessage: "oi", now: NOW });
    const claims = prepared.claimExtractor.extractClaims("Jeep Renegade e Zeekr X");
    check("preparador combina claims do catalogo e semanticos", claims.some((c) => c.normalized === "renegade") && claims.some((c) => c.normalized === "zeekr x"));
  }

  if (failed > 0) {
    console.error(`=== MODEL ADAPTER: ${ok} OK | ${failed} FALHA ===`);
    process.exit(1);
  }
  console.log(`=== MODEL ADAPTER: ${ok} OK | 0 FALHA ===`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
