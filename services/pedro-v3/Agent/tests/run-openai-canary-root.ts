// run-openai-canary-root.ts - F2.5.7
//
// Wiring controlado do OpenAI adapter no CanaryShadowRoot.
// SEM rede real, SEM Supabase remoto, SEM WhatsApp/CRM-write/handoff/agenda.

import {
  createOpenAiCanaryShadowRoot,
  createOpenAiModelFactory,
  OpenAiCanaryRootError,
  OpenAiRuntimeSecret,
  redactedOpenAiCanaryDepsSummary,
} from "../src/engine/openai-canary-root.ts";
import { SupabaseReadOnlyDatabase } from "../src/adapters/read/supabase-read-database.ts";
import { V2PlaintextApiKeyReader } from "../src/adapters/read/v2-api-key-reader.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import type { HttpTransport } from "../src/adapters/read/http-client.ts";
import type { ModelHttpRequest, ModelHttpResponse, ModelHttpTransport } from "../src/adapters/llm/structured-json-model.ts";
import { InMemoryEffectGate } from "../src/engine/effect-gate.ts";
import type { ProposedDecision } from "../src/domain/decision.ts";

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

const NOW = "2026-06-28T20:00:00.000Z";
const HOST = "test.supabase.co";
const URL_OK = `https://${HOST}`;
const SUPABASE_KEY = "test-supabase-key-NOT-REAL";
const OPENAI_KEY = "sk-test-F2-5-7-DO-NOT-LEAK";
const TENANT = "tenant-openai-canary";
const AGENT = "agent-openai-canary";
const AGENT_NULL_MODEL = "agent-openai-null-model";
const AGENT_BAD_PROVIDER = "agent-openai-bad-provider";
const LEAD = "22222222-2222-4222-8222-222222222222";

class FakeSupabaseTransport implements HttpTransport {
  readonly calls: string[] = [];
  constructor(private readonly tables: Record<string, Record<string, unknown>[]>) {}
  async fetch(url: string): Promise<Response> {
    this.calls.push(url);
    const u = new URL(url);
    const table = u.pathname.split("/").pop() ?? "";
    const rows = this.tables[table] ?? [];
    const filters: Array<[string, string]> = [];
    let limit: number | null = null;
    for (const [k, v] of u.searchParams.entries()) {
      if (k === "select") continue;
      if (k === "limit") {
        limit = Number(v);
        continue;
      }
      const m = /^eq\.(.*)$/s.exec(v);
      if (m) filters.push([k, m[1]]);
    }
    let matched = rows.filter((row) => filters.every(([col, val]) => String(row[col]) === val));
    if (limit !== null) matched = matched.slice(0, limit);
    return new Response(JSON.stringify(matched), { status: 200, headers: { "content-type": "application/json" } });
  }
}

class RecordingOpenAiTransport implements ModelHttpTransport {
  readonly requests: Array<{ url: string; request: ModelHttpRequest; parsedBody: Record<string, unknown> }> = [];
  async postJson(url: string, request: ModelHttpRequest): Promise<ModelHttpResponse> {
    const parsedBody = JSON.parse(request.body) as Record<string, unknown>;
    this.requests.push({ url, request, parsedBody });
    const messages = parsedBody.messages as Array<{ role: string; content: string }>;
    const userPayload = JSON.parse(messages[1].content) as { operation: string };
    return {
      status: 200,
      contentType: "application/json",
      bodyText: JSON.stringify({
        choices: [{ message: { content: JSON.stringify(outputFor(userPayload.operation)) } }],
      }),
    };
  }
}

function outputFor(operation: string): unknown {
  if (operation === "interpret") return { relation: "ambiguous", intentSummary: "saudacao" };
  if (operation === "propose") {
    const proposal: ProposedDecision = {
      proposedAction: "reply",
      facts: [],
      proposedEffects: [{ kind: "send_message", planId: "m-openai", order: 1, onSuccess: [] }],
      responsePlan: { guidance: "Responder saudacao." },
      reasonCode: "openai_shadow_reply",
      reasonSummary: "resposta shadow via adapter openai",
      confidence: 0.9,
    };
    return { kind: "final", proposal };
  }
  if (operation === "compose") return { parts: [{ type: "text", content: "Ola, posso ajudar com seu veiculo?" }] };
  return { relation: "ambiguous" };
}

function seed(): Record<string, Record<string, unknown>[]> {
  const baseAgent = {
    user_id: TENANT,
    instance_id: null,
    name: "Aloan",
    system_prompt: "Prompt vivo do portal para o Pedro v3.",
    use_funnel_config: false,
    company_name: "",
    temperature: 0.3,
    sdr_goal: "agendar",
    qualification_questions: [] as string[],
    sells_motorcycles: false,
    blocked_categories: [] as string[],
    rag_restricted: false,
    is_active: true,
    updated_at: NOW,
  };
  return {
    wa_ai_agents: [
      { ...baseAgent, id: AGENT, model: "openai/gpt-4.1-mini" },
      { ...baseAgent, id: AGENT_NULL_MODEL, model: null },
      { ...baseAgent, id: AGENT_BAD_PROVIDER, model: "anthropic/claude-sonnet" },
    ],
    platform_integrations: [],
    ai_crm_leads: [{ id: LEAD, user_id: TENANT, agent_id: AGENT, lead_name: "Lead Teste", vehicle_interest: null, stage: "novo", created_at: NOW, updated_at: NOW }],
    agent_funnel_config: [],
  };
}

function db(transport = new FakeSupabaseTransport(seed())): SupabaseReadOnlyDatabase {
  return SupabaseReadOnlyDatabase.create({ url: URL_OK, apiKey: SUPABASE_KEY, allowedHosts: [HOST] }, transport);
}

async function main(): Promise<void> {
  console.log("F2.5.7 OpenAI canary root wiring:");

  await expectThrow("OpenAiRuntimeSecret vazio falha fechado", () => OpenAiRuntimeSecret.fromString(""), "OPENAI_SECRET_MISSING");
  {
    const secret = OpenAiRuntimeSecret.fromString(OPENAI_KEY);
    check("OpenAiRuntimeSecret nao vaza em JSON.stringify", !JSON.stringify(secret).includes(OPENAI_KEY));
  }
  await expectThrow("modelFactory sem transporte falha fechado", () => createOpenAiModelFactory({
    openAiSecret: OpenAiRuntimeSecret.fromString(OPENAI_KEY),
    modelTransport: null as unknown as ModelHttpTransport,
  }), "OPENAI_TRANSPORT_MISSING");

  {
    const secret = OpenAiRuntimeSecret.fromString(OPENAI_KEY);
    const transport = new RecordingOpenAiTransport();
    const gate = new InMemoryEffectGate();
    const root = await createOpenAiCanaryShadowRoot(
      { mode: "shadow", tenantId: TENANT, agentId: AGENT, leadId: LEAD },
      {
        db: db(),
        decryptor: new V2PlaintextApiKeyReader(),
        clock: new FakeClock(NOW),
        openAiSecret: secret,
        modelTransport: transport,
        effectGate: gate,
        modelOptions: { timeoutMs: 1000, maxResponseBytes: 64_000 },
      },
    );
    const result = await root.runTurn({
      persistence: new InMemoryPersistence(new FakeClock(NOW), new FakeIdGen()),
      clock: new FakeClock(NOW),
      conversationId: "c-openai-root",
      workerId: "w-openai-root",
      turnId: "t-openai-root",
      eventId: "e-openai-root",
      messageText: "boa noite",
      limits: { maxSteps: 2, totalTimeoutMs: 5000, proposeTimeoutMs: 1000, composeTimeoutMs: 1000 },
      maxValidationAttempts: 1,
      expected: { action: "reply", reasonCode: "openai_shadow_reply" },
    });

    check("root OpenAI commita turno em shadow", result.engine.status === "committed", JSON.stringify(result.engine));
    check("shadow continua sem dispatch real", result.dispatchAttempts === 0);
    check("outbox shadow fica skipped sem aplicar outcome", result.outboxAfterDispatch.every((record) => record.status === "skipped" && record.outcomeAppliedAt === null), JSON.stringify(result.outboxAfterDispatch));
    check("OpenAI transport recebeu interpret/propose/compose", transport.requests.length === 3);
    check("modelo vem do TenantRuntimeConfig normalizado", transport.requests.every((call) => call.parsedBody.model === "gpt-4.1-mini"));
    check("prompt do portal foi para system", JSON.stringify(transport.requests[0].parsedBody.messages).includes("Prompt vivo do portal"));
    check("chave OpenAI so aparece no header", transport.requests.every((call) => call.request.headers.authorization === `Bearer ${OPENAI_KEY}` && !call.request.body.includes(OPENAI_KEY)));
    check("resultado completo nao vaza chave OpenAI", !JSON.stringify(result).includes(OPENAI_KEY));
    check("root/config nao vazam chave OpenAI", !JSON.stringify(root).includes(OPENAI_KEY) && !JSON.stringify(root.tenantConfig).includes(OPENAI_KEY));
  }

  {
    const transport = new RecordingOpenAiTransport();
    const root = await createOpenAiCanaryShadowRoot(
      { mode: "shadow", tenantId: TENANT, agentId: AGENT_NULL_MODEL },
      {
        db: db(),
        decryptor: new V2PlaintextApiKeyReader(),
        clock: new FakeClock(NOW),
        openAiSecret: OpenAiRuntimeSecret.fromString(OPENAI_KEY),
        modelTransport: transport,
      },
    );
    await root.runTurn({
      persistence: new InMemoryPersistence(new FakeClock(NOW), new FakeIdGen()),
      clock: new FakeClock(NOW),
      conversationId: "c-openai-null-model",
      workerId: "w-openai-null-model",
      turnId: "t-openai-null-model",
      eventId: "e-openai-null-model",
      messageText: "oi",
      limits: { maxSteps: 2, totalTimeoutMs: 5000 },
      maxValidationAttempts: 1,
    });
    check("modelo null no tenant usa default gpt-4.1-mini", transport.requests.every((call) => call.parsedBody.model === "gpt-4.1-mini"));
  }

  await expectThrow("modelo de outro provider no tenant bloqueia create", () => createOpenAiCanaryShadowRoot(
    { mode: "shadow", tenantId: TENANT, agentId: AGENT_BAD_PROVIDER },
    {
      db: db(),
      decryptor: new V2PlaintextApiKeyReader(),
      clock: new FakeClock(NOW),
      openAiSecret: OpenAiRuntimeSecret.fromString(OPENAI_KEY),
      modelTransport: new RecordingOpenAiTransport(),
    },
  ), "OPENAI_MODEL_INVALID");

  {
    const summary = redactedOpenAiCanaryDepsSummary({
      db: db(),
      decryptor: new V2PlaintextApiKeyReader(),
      clock: new FakeClock(NOW),
      openAiSecret: OpenAiRuntimeSecret.fromString(OPENAI_KEY),
      modelTransport: new RecordingOpenAiTransport(),
      modelOptions: { modelOverride: "gpt-4.1-mini", temperatureOverride: 0.2 },
    });
    check("summary operacional e redigido", !JSON.stringify(summary).includes(OPENAI_KEY) && JSON.stringify(summary).includes("openai_runtime_secret"));
  }

  if (failed > 0) {
    console.error(`=== OPENAI CANARY ROOT: ${ok} OK | ${failed} FALHA ===`);
    process.exit(1);
  }
  console.log(`=== OPENAI CANARY ROOT: ${ok} OK | 0 FALHA ===`);
}

main().catch((error) => {
  if (error instanceof OpenAiCanaryRootError) console.error(error.code);
  else console.error(error);
  process.exit(1);
});
