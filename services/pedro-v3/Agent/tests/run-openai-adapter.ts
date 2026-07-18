// run-openai-adapter.ts - F2.5.6
//
// Adapter especifico OpenAI Chat Completions, ainda offline/fake-first.
// SEM chamada real de rede, SEM leitura de OPENAI_API_KEY, SEM fallback de provider.

import {
  OpenAiChatCompletionsModel,
  OpenAiChatModelError,
  resolveOpenAiModelName,
} from "../src/adapters/llm/openai-chat-model.ts";
import type { ModelHttpRequest, ModelHttpResponse, ModelHttpTransport } from "../src/adapters/llm/structured-json-model.ts";
import { PromptBoundConversationAdapter } from "../src/adapters/llm/prompt-bound-conversation.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { TenantRuntimeConfig } from "../src/domain/read-ports.ts";
import type { ComposeModelRequest, InterpretModelRequest, ProposeModelRequest } from "../src/domain/conversation-model.ts";
import type { ProposedDecision, TurnInterpretation } from "../src/domain/decision.ts";
import type { TurnContext } from "../src/domain/context.ts";

let ok = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    ok += 1;
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.error(`  RED ${name}${detail ? `: ${detail}` : ""}`);
  }
}

async function expectThrow(name: string, fn: () => Promise<unknown> | unknown, contains: string): Promise<void> {
  try {
    await fn();
    check(name, false, "deveria lancar");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, message.includes(contains), message);
  }
}

const NOW = "2026-06-28T18:00:00.000Z";
const TENANT = "tenant-openai";
const AGENT = "agent-openai";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const API_KEY = "sk-test-OPENAI-SECRET-DO-NOT-LEAK";

const runtimeConfig: TenantRuntimeConfig = Object.freeze({
  tenantId: TENANT,
  agentId: AGENT,
  agentName: "Aloan",
  companyName: null,
  instanceId: null,
  promptText: "Prompt vivo do portal. Atue como SDR automotivo sem inventar estoque.",
  promptSource: "raw_system_prompt",
  versionStamp: "agent:v-openai|integration:v1",
  model: "openai/gpt-4.1-mini",
  temperature: 0.25,
  sdrGoal: "agendar",
  qualificationQuestions: ["nome", "pagamento"],
  sellsMotorcycles: false,
  blockedCategories: [],
  ragRestricted: false,
  stockProvider: "none",
  stockSecretRef: null,
  stockIntegrations: [],
});

class RecordingOpenAiTransport implements ModelHttpTransport {
  readonly requests: Array<{ url: string; request: ModelHttpRequest }> = [];
  response: ModelHttpResponse = {
    status: 200,
    contentType: "application/json",
    bodyText: JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ relation: "ambiguous", intentSummary: "ok" }) } }],
    }),
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

function model(transport: ModelHttpTransport, over: Partial<ConstructorParameters<typeof OpenAiChatCompletionsModel>[0]> = {}) {
  return new OpenAiChatCompletionsModel({
    apiKey: over.apiKey ?? API_KEY,
    endpointUrl: over.endpointUrl,
    allowedHosts: over.allowedHosts,
    model: over.model ?? runtimeConfig.model,
    temperature: over.temperature,
    timeoutMs: over.timeoutMs ?? 100,
    maxResponseBytes: over.maxResponseBytes ?? 4096,
    maxCompletionTokens: over.maxCompletionTokens ?? 1200,
  }, transport);
}

function baseState() {
  return createInitialState({ conversationId: "conv-openai", tenantId: TENANT, agentId: AGENT, leadId: "lead-openai", now: NOW });
}

function interpretRequest(): InterpretModelRequest {
  const backend = model(new RecordingOpenAiTransport());
  return {
    operation: "interpret",
    binding: new PromptBoundConversationAdapter(runtimeConfig, backend).binding,
    turn: {
      turnId: "turn-openai",
      now: NOW,
      leadMessage: "boa noite",
      state: baseState(),
      tenantCatalog: { entries: [] },
    },
  };
}

function turnContext(): TurnContext {
  return {
    state: baseState(),
    turnId: "turn-openai",
    leadMessage: "boa noite",
    now: NOW,
    interpretation: { relation: "ambiguous" },
    tenantCatalog: { entries: [] },
    claimExtractor: new CatalogClaimExtractor({ entries: [] }),
  };
}

function responseBody(payload: unknown): string {
  return JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] });
}

async function main(): Promise<void> {
  console.log("F2.5.6 OpenAI Chat Completions adapter:");

  check("modelo default e gpt-4.1-mini", resolveOpenAiModelName(null) === "gpt-4.1-mini");
  check("prefixo openai/ e normalizado", resolveOpenAiModelName("openai/gpt-4.1-mini") === "gpt-4.1-mini");
  await expectThrow("modelo de outro provider falha fechado", () => resolveOpenAiModelName("anthropic/claude-sonnet"), "OPENAI_MODEL_INVALID");

  await expectThrow("endpoint http e rejeitado", () => model(new RecordingOpenAiTransport(), { endpointUrl: "http://api.openai.com/v1/chat/completions" }), "OPENAI_ENDPOINT_INVALID");
  await expectThrow("endpoint fora de chat/completions e rejeitado", () => model(new RecordingOpenAiTransport(), { endpointUrl: "https://api.openai.com/v1/responses" }), "OPENAI_ENDPOINT_INVALID");
  await expectThrow("host fora da allowlist e rejeitado", () => model(new RecordingOpenAiTransport(), { endpointUrl: "https://evil.example.com/v1/chat/completions" }), "OPENAI_HOST_NOT_ALLOWED");
  await expectThrow("endpoint com query e rejeitado", () => model(new RecordingOpenAiTransport(), { endpointUrl: "https://api.openai.com/v1/chat/completions?api_key=x" }), "OPENAI_ENDPOINT_INVALID");
  await expectThrow("endpoint com credencial embutida e rejeitado", () => model(new RecordingOpenAiTransport(), { endpointUrl: "https://user:pass@api.openai.com/v1/chat/completions" }), "OPENAI_ENDPOINT_INVALID");
  await expectThrow("apiKey vazia falha fechado", () => model(new RecordingOpenAiTransport(), { apiKey: "" }), "OPENAI_API_KEY_MISSING");
  await expectThrow("temperature invalida falha fechado", () => model(new RecordingOpenAiTransport(), { temperature: 3 }), "OPENAI_CONFIG_INVALID");
  await expectThrow("max tokens invalido falha fechado", () => model(new RecordingOpenAiTransport(), { maxCompletionTokens: 0 }), "OPENAI_CONFIG_INVALID");

  {
    const transport = new RecordingOpenAiTransport();
    const out = await model(transport).interpret(interpretRequest());
    const sent = transport.requests[0];
    const body = JSON.parse(sent.request.body) as Record<string, unknown>;
    check("POST vai para chat/completions OpenAI", sent.url === OPENAI_ENDPOINT);
    check("modelo enviado e gpt-4.1-mini", body.model === "gpt-4.1-mini");
    const rf = body.response_format as { type?: string; json_schema?: { name?: string; strict?: boolean } } | undefined;
    check("response_format usa json_schema (interpret)", rf?.type === "json_schema" && rf.json_schema?.name === "turn_interpretation" && rf.json_schema?.strict === false);
    check("mensagens system+user sao enviadas", Array.isArray(body.messages) && body.messages.length === 2);
    check("prompt do portal vai no system", JSON.stringify(body.messages).includes("Prompt vivo do portal"));
    const messages = body.messages as Array<{ role: string; content: string }>;
    check("operacao interpret vai no user payload", messages[1].content.includes("\"operation\":\"interpret\""));
    check("temperature vem do binding quando config nao sobrescreve", body.temperature === 0.25);
    check("authorization fica so no header", sent.request.headers.authorization === `Bearer ${API_KEY}` && !sent.request.body.includes(API_KEY));
    check("JSON.stringify do adapter nao vaza chave", !JSON.stringify(model(transport)).includes(API_KEY));
    check("payload de choices message.content e extraido", (out as TurnInterpretation).relation === "ambiguous");
  }

  {
    const transport = new RecordingOpenAiTransport();
    await model(transport, { temperature: 0.1 }).interpret(interpretRequest());
    const body = JSON.parse(transport.requests[0].request.body) as Record<string, unknown>;
    check("temperature explicita do config vence binding", body.temperature === 0.1);
  }

  {
    const transport = new RecordingOpenAiTransport();
    transport.response = {
      status: 200,
      contentType: "application/json; charset=utf-8",
      bodyText: JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: JSON.stringify({ relation: "continues_offer" }) }] } }] }),
    };
    const out = await model(transport).interpret(interpretRequest());
    check("content array textual tambem e aceito", (out as TurnInterpretation).relation === "continues_offer");
  }

  {
    const transport = new RecordingOpenAiTransport();
    const proposal: ProposedDecision = {
      proposedAction: "reply",
      facts: [],
      proposedEffects: [],
      responsePlan: { guidance: "ok" },
      reasonCode: "OK",
      reasonSummary: "ok",
      confidence: 0.92,
    };
    transport.response = { status: 200, contentType: "application/json", bodyText: responseBody({ kind: "final", proposal }) };
    const adapter = new PromptBoundConversationAdapter(runtimeConfig, model(transport));
    const step = await adapter.proposeNextQueryOrFinal(turnContext(), []);
    check("OpenAI adapter integra com PromptBound decoder", step.kind === "final" && step.proposal.reasonCode === "OK");
  }

  {
    const bad = new RecordingOpenAiTransport();
    bad.response = { status: 500, contentType: "application/json", bodyText: JSON.stringify({ error: `leak ${API_KEY}` }) };
    await expectThrow("HTTP nao-2xx vira erro sanitizado", () => model(bad).interpret(interpretRequest()), "OPENAI_HTTP_FAILURE");
  }

  {
    const bad = new RecordingOpenAiTransport();
    bad.response = { status: 200, contentType: "text/plain", bodyText: "{}" };
    await expectThrow("content-type nao JSON e rejeitado", () => model(bad).interpret(interpretRequest()), "OPENAI_RESPONSE_NOT_JSON");
  }

  {
    const bad = new RecordingOpenAiTransport();
    bad.response = { status: 200, contentType: "application/json", bodyText: "not-json" };
    await expectThrow("resposta OpenAI invalida como JSON e rejeitada", () => model(bad).interpret(interpretRequest()), "OPENAI_RESPONSE_NOT_JSON");
  }

  {
    const bad = new RecordingOpenAiTransport();
    bad.response = { status: 200, contentType: "application/json", bodyText: JSON.stringify({ nope: true }) };
    await expectThrow("shape sem choices e rejeitado", () => model(bad).interpret(interpretRequest()), "OPENAI_RESPONSE_SHAPE_INVALID");
  }

  {
    const bad = new RecordingOpenAiTransport();
    bad.response = { status: 200, contentType: "application/json", bodyText: JSON.stringify({ choices: [{ message: { content: "texto solto" } }] }) };
    await expectThrow("conteudo nao-JSON do modelo e rejeitado", () => model(bad).interpret(interpretRequest()), "OPENAI_RESPONSE_NOT_JSON");
  }

  {
    const bad = new RecordingOpenAiTransport();
    bad.response = { status: 200, contentType: "application/json", bodyText: responseBody({ relation: "ambiguous", big: "x".repeat(500) }) };
    await expectThrow("resposta acima do limite e rejeitada", () => model(bad, { maxResponseBytes: 64 }).interpret(interpretRequest()), "OPENAI_RESPONSE_TOO_LARGE");
  }

  {
    const slow = new NeverResolvingTransport();
    await expectThrow("timeout aborta transporte travado", () => model(slow, { timeoutMs: 15 }).interpret(interpretRequest()), "OPENAI_TIMEOUT");
    check("AbortSignal e acionado no timeout OpenAI", slow.signalSeen?.aborted === true);
  }

  if (failed > 0) {
    console.error(`=== OPENAI ADAPTER: ${ok} OK | ${failed} FALHA ===`);
    process.exit(1);
  }
  console.log(`=== OPENAI ADAPTER: ${ok} OK | 0 FALHA ===`);
}

main().catch((error) => {
  if (error instanceof OpenAiChatModelError) {
    console.error(error.code);
  } else {
    console.error(error);
  }
  process.exit(1);
});
