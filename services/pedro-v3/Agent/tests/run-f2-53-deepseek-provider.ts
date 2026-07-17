import { readFileSync } from "node:fs";
import { OpenAiAgentBrain } from "../src/adapters/llm/openai-agent-brain.ts";
import { OpenAiChatCompletionsModel } from "../src/adapters/llm/openai-chat-model.ts";
import { resolveTenantAiSecret, type TenantSecretGateway } from "../src/adapters/read/tenant-openai-key.ts";
import { AiProviderConfigError, AiRuntimeSecret, resolveAiProviderRuntime, resolveProviderEnvironmentSecret } from "../src/runtime/ai-provider.ts";
import type { ModelHttpRequest, ModelHttpResponse, ModelHttpTransport } from "../src/adapters/llm/structured-json-model.ts";
import type { TurnFrame } from "../src/domain/agent-brain.ts";
import type { DatabaseFilters, DatabaseRow } from "../src/domain/database-gateway.ts";
import type { JsonValue } from "../src/domain/types.ts";

let ok = 0, fail = 0;
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; console.error(`  RED ${name}${detail ? ` - ${detail}` : ""}`); }
}

class RecordingTransport implements ModelHttpTransport {
  readonly calls: Array<{ url: string; request: ModelHttpRequest; body: Record<string, unknown> }> = [];
  constructor(private readonly responseBody: (body: Record<string, unknown>) => unknown) {}
  async postJson(url: string, request: ModelHttpRequest): Promise<ModelHttpResponse> {
    const body = JSON.parse(request.body) as Record<string, unknown>;
    this.calls.push({ url, request, body });
    return { status: 200, contentType: "application/json", bodyText: JSON.stringify(this.responseBody(body)) };
  }
}

function frame(): TurnFrame {
  return {
    turnId: "t-deepseek", now: "2026-07-12T12:00:00.000Z", block: "Boa tarde", portalPromptSha256: "sha",
    signals: {}, workingMemory: { version: 1, selectedVehicle: null, recentTurns: [], toolResults: [] }, recentTranscript: [],
    conversationContext: {
      lastAgentMessage: null, pendingAgentQuestion: null, selectedVehicle: null,
      lastVisibleOffer: null, lastResolvedSlotAnswer: null, conversationSummary: null,
    },
    currentTurnFacts: {
      expectedAnswer: { slot: null, lastAgentQuestion: null }, extracted: [], offerReference: null,
    },
  } as unknown as TurnFrame;
}

function fakeGateway(calls: Array<{ name: string; args: DatabaseRow }>): TenantSecretGateway {
  return {
    async rpc<T extends JsonValue>(name: string, args: DatabaseRow): Promise<T> {
      calls.push({ name, args });
      if (name === "get_client_ai_key" && args.p_provider === "deepseek") return "ds-client-secret" as unknown as T;
      return "" as unknown as T;
    },
    async selectOne(_table: string, _filters: DatabaseFilters): Promise<DatabaseRow | null> {
      return { created_at: "2026-01-01T00:00:00.000Z" };
    },
  };
}

async function main(): Promise<void> {
  console.log("== F2.53: DeepSeek provider sem alterar o engine ==");

  const openai = resolveAiProviderRuntime({});
  check("[P-1] default permanece OpenAI", openai.provider === "openai" && openai.tokenParameter === "max_completion_tokens");
  const deepseek = resolveAiProviderRuntime({ PEDRO_V3_AI_PROVIDER: "deepseek" });
  check("[P-2] DeepSeek usa endpoint/host/model esperados", deepseek.provider === "deepseek" && deepseek.endpointUrl === "https://api.deepseek.com/chat/completions" && deepseek.allowedHosts[0] === "api.deepseek.com" && deepseek.model === "deepseek-chat");
  check("[P-3] DeepSeek usa max_tokens", deepseek.tokenParameter === "max_tokens");
  let invalid = false;
  try { resolveAiProviderRuntime({ PEDRO_V3_AI_PROVIDER: "qualquer" }); } catch (error) { invalid = error instanceof AiProviderConfigError && error.code === "AI_PROVIDER_INVALID"; }
  check("[P-4] provider desconhecido falha fechado", invalid);

  const secret = AiRuntimeSecret.fromString("deepseek", "ds-DO-NOT-LEAK");
  check("[S-1] segredo DeepSeek nao vaza em JSON", !JSON.stringify(secret).includes("DO-NOT-LEAK") && JSON.stringify(secret).includes("deepseek"));
  const envSecret = resolveProviderEnvironmentSecret({ DEEPSEEK_API_KEY: "ds-env-secret" }, "deepseek");
  check("[S-1b] DeepSeek aceita segredo opaco do Easypanel", envSecret !== null && !JSON.stringify(envSecret).includes("ds-env-secret"));
  check("[S-1c] OpenAI nunca usa DEEPSEEK_API_KEY", resolveProviderEnvironmentSecret({ DEEPSEEK_API_KEY: "ds-env-secret" }, "openai") === null);
  let invalidEnvRejected = false;
  try { resolveProviderEnvironmentSecret({ DEEPSEEK_API_KEY: "ds-invalid\nheader" }, "deepseek"); } catch { invalidEnvRejected = true; }
  check("[S-1d] segredo com whitespace falha fechado", invalidEnvRejected);
  const keyCalls: Array<{ name: string; args: DatabaseRow }> = [];
  const resolved = await resolveTenantAiSecret({ gateway: fakeGateway(keyCalls), tenantId: "tenant", provider: "deepseek" });
  check("[S-2] BYOK consulta o provider DeepSeek do tenant", keyCalls.some((call) => call.name === "get_client_ai_key" && call.args.p_provider === "deepseek"));
  check("[S-3] chave resolvida continua opaca", !JSON.stringify(resolved).includes("ds-client-secret"));

  const brainTransport = new RecordingTransport(() => ({ choices: [{ message: { content: JSON.stringify({
    kind: "final",
    understanding: { primaryIntent: "smalltalk", requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [] },
    reasonCode: "greeting", reasonSummary: "saudacao", confidence: 0.9,
    responsePlan: { guidance: "cumprimentar", draft: { parts: [{ type: "text", content: "Boa tarde!" }] } },
    proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] }], memoryMutations: [], stateMutations: [],
  }) } }] }));
  const brain = new OpenAiAgentBrain(resolved, brainTransport, "Prompt real do portal", {
    model: deepseek.model, retryModel: deepseek.retryModel, endpointUrl: deepseek.endpointUrl,
    allowedHosts: deepseek.allowedHosts, tokenParameter: deepseek.tokenParameter,
  });
  const step = await brain.proposeNextStep(frame(), []);
  const brainCall = brainTransport.calls[0];
  check("[B-1] brain usa endpoint DeepSeek", brainCall.url === deepseek.endpointUrl);
  check("[B-2] brain envia max_tokens e nao max_completion_tokens", brainCall.body.max_tokens === 1200 && !("max_completion_tokens" in brainCall.body));
  check("[B-3] authorization fica so no header", brainCall.request.headers.authorization === "Bearer ds-client-secret" && !brainCall.request.body.includes("ds-client-secret"));
  check("[B-4] DeepSeek decodifica o mesmo AgentBrainStep", step.kind === "final" && step.understanding?.primaryIntent === "smalltalk");

  const modelTransport = new RecordingTransport(() => ({ choices: [{ message: { content: JSON.stringify({ relation: "ambiguous" }) } }] }));
  const model = new OpenAiChatCompletionsModel({
    apiKey: "ds-model-secret", endpointUrl: deepseek.endpointUrl, allowedHosts: deepseek.allowedHosts,
    model: deepseek.model, tokenParameter: deepseek.tokenParameter,
  }, modelTransport);
  await model.interpret({ binding: { systemPrompt: "Prompt", temperature: 0.2 } } as never);
  const modelCall = modelTransport.calls[0];
  check("[M-1] interpret/compose compartilham endpoint DeepSeek", modelCall.url === deepseek.endpointUrl);
  check("[M-2] model adapter tambem usa max_tokens", modelCall.body.max_tokens === 1200 && !("max_completion_tokens" in modelCall.body));

  const server = readFileSync(new URL("../src/runtime/server.ts", import.meta.url), "utf8");
  check("[W-1] runtime resolve provider e chave genericos", /resolveAiProviderRuntime/.test(server) && /resolveTenantAiSecret/.test(server));
  check("[W-1b] runtime aceita DeepSeek do Easypanel sem habilitar OpenAI global", /resolveProviderEnvironmentSecret/.test(server) && !/OPENAI_API_KEY/.test(server));
  check("[W-2] health expoe provider/model sem segredo", /aiProvider:/.test(server) && /aiModel:/.test(server));

  console.log(`\n== F2.53: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) process.exit(1);
}

void main();
