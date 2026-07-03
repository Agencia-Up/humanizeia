import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { PostgresPersistence } from "../adapters/persistence/postgres-store.ts";
import { SupabaseReadOnlyDatabase } from "../adapters/read/supabase-read-database.ts";
import { V2PlaintextApiKeyReader } from "../adapters/read/v2-api-key-reader.ts";
import { PilotActiveRoot, type PilotBrainMode } from "../engine/pilot-active-root.ts";
import { ingestPilotMessage } from "../engine/pilot-ingest.ts";
import { applyProviderDeliveryReceipt } from "../engine/provider-delivery-receipt.ts";
import { createOpenAiModelFactory } from "../engine/openai-canary-root.ts";
import { OpenAiAgentBrain } from "../adapters/llm/openai-agent-brain.ts";
import type { TenantRuntimeConfig } from "../domain/read-ports.ts";
import { resolveTenantOpenAiSecret } from "../adapters/read/tenant-openai-key.ts";
import { resolveDebounceConfig, type DebounceConfig } from "../engine/debounce-policy.ts";
import { DebouncePoller } from "./debounce-poller.ts";
import { PEDRO_V3_PILOT_TENANT_ID } from "../domain/pilot-scope.ts";
import type { SettledConversation } from "../domain/ports.ts";
import { RealClock } from "./real-clock.ts";
import { sanitizeTurnError } from "./sanitize-error.ts";
import { FetchModelHttpTransport, FetchUazapiHttpTransport } from "./fetch-transports.ts";
import { SupabaseServiceGateway } from "./supabase-service-gateway.ts";
import {
  PilotHttpApp,
  PilotTurnRuntimeError,
  type PilotHttpResponse,
  type PilotReceiptPayload,
  type PilotReceiptRunner,
  type PilotTurnPayload,
  type PilotTurnRunner,
} from "./pilot-http-app.ts";

const PILOT_TURN_LIMITS = {
  maxSteps: 4,
  totalTimeoutMs: 70_000,
  proposeTimeoutMs: 25_000,
  queryTimeoutMs: 20_000,
  composeTimeoutMs: 25_000,
} as const;

const MAX_REQUEST_BYTES = 32 * 1024;

const CENTRAL_BRAIN_ALLOWED_TOOLS = ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"] as const;

// R13-D/4: modo do cérebro do piloto (default OFF). central_active só vale dentro do escopo do piloto (Douglas),
// que o próprio runtime já garante (PEDRO_V3_PILOT_TENANT_ID). Rollback imediato = voltar a env p/ off.
function resolveBrainMode(): PilotBrainMode {
  const value = process.env.PEDRO_V3_BRAIN_MODE?.trim();
  return value === "central_active" || value === "central_shadow" ? value : "off";
}

class RuntimeConfigError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "RuntimeConfigError";
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new RuntimeConfigError(`ENV_${name}_MISSING`);
  return value;
}

function commaList(name: string): readonly string[] {
  const values = requiredEnv(name).split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (values.length === 0) throw new RuntimeConfigError(`ENV_${name}_INVALID`);
  return Object.freeze([...new Set(values)]);
}

function supabaseHost(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RuntimeConfigError("ENV_SUPABASE_URL_INVALID");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new RuntimeConfigError("ENV_SUPABASE_URL_INVALID");
  }
  return parsed.hostname.toLowerCase();
}

class ProductionPilotRunner implements PilotTurnRunner, PilotReceiptRunner {
  readonly #supabaseUrl: string;
  readonly #serviceRoleKey: string;
  readonly #modelOverride: string;
  readonly #allowedUazapiHosts: readonly string[];
  readonly #clock = new RealClock();
  readonly #debounce: DebounceConfig;
  #turnSeq = 0;

  constructor() {
    this.#supabaseUrl = requiredEnv("SUPABASE_URL");
    this.#serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    // F2.6J: a chave OpenAI NAO vem de env global. E resolvida por tenant (BYOK) via Vault/RPC.
    this.#modelOverride = process.env.PEDRO_V3_OPENAI_MODEL?.trim() || "gpt-4.1-mini";
    this.#allowedUazapiHosts = commaList("PEDRO_V3_ALLOWED_UAZAPI_HOSTS");
    // F2.7.6: janela de debounce + intervalo do poller (defaults 6000/12000/2000ms).
    this.#debounce = resolveDebounceConfig(process.env);
  }

  get debounceConfig(): DebounceConfig {
    return this.#debounce;
  }

  #gateway(): SupabaseServiceGateway {
    return new SupabaseServiceGateway({
      url: this.#supabaseUrl,
      serviceRoleKey: this.#serviceRoleKey,
      allowedHosts: [supabaseHost(this.#supabaseUrl)],
      timeoutMs: 20_000,
      maxResponseBytes: 8 * 1024 * 1024,
    });
  }

  async applyReceipt(payload: PilotReceiptPayload) {
    const persistence = new PostgresPersistence(this.#gateway(), {
      tenantId: payload.tenantId,
      clock: this.#clock,
    });
    return applyProviderDeliveryReceipt({
      persistence,
      clock: this.#clock,
      receipt: {
        providerMessageId: payload.providerMessageId,
        status: payload.status,
        at: payload.occurredAt,
      },
    });
  }

  // F2.7.6: /v1/pilot/turn agora SO INGERE (rapido). O processamento real (decidir +
  // despachar) fica p/ o poller quando a conversa "assenta" (debounce). Resposta
  // {status:"accepted", ingested:true} -> o bridge mantem routed: pedro_v3 (contrato intacto).
  async run(payload: PilotTurnPayload) {
    const persistence = new PostgresPersistence(this.#gateway(), {
      tenantId: payload.tenantId,
      clock: this.#clock,
    });
    try {
      const ingest = await ingestPilotMessage(persistence, this.#clock, {
        eventId: payload.eventId,
        conversationId: payload.conversationId,
        agentId: payload.agentId,
        leadId: payload.leadId ?? null,
        toAddr: payload.to,
        messageText: payload.messageText,
        receivedAt: payload.receivedAt,
      });
      if (ingest.decision === "duplicate") {
        return { status: "duplicate" as const, inserted: false as const, turnId: payload.turnId, dispatched: 0 as const };
      }
      return { status: "accepted" as const, inserted: true as const, dispatched: 0 as const };
    } catch {
      // Falha ANTES de ingerir (rota/banco): ingested=false -> bridge faz fallback p/ o v2.
      throw new PilotTurnRuntimeError("PILOT_TURN_FAILED", false);
    }
  }

  // F2.7.6: o poller pergunta quais conversas do tenant do piloto ja assentaram.
  async findSettled(nowIso: string): Promise<SettledConversation[]> {
    const persistence = new PostgresPersistence(this.#gateway(), {
      tenantId: PEDRO_V3_PILOT_TENANT_ID,
      clock: this.#clock,
    });
    return persistence.findSettledConversations(nowIso, this.#debounce.debounceMs, this.#debounce.maxWaitMs, 20);
  }

  async #createRoot(agentId: string, leadId: string | null, gateway: SupabaseServiceGateway): Promise<PilotActiveRoot> {
    const readDb = SupabaseReadOnlyDatabase.create({
      url: this.#supabaseUrl,
      apiKey: this.#serviceRoleKey,
      allowedHosts: [supabaseHost(this.#supabaseUrl)],
      timeoutMs: 15_000,
      maxResponseBytes: 4 * 1024 * 1024,
    });
    const openAiSecret = await resolveTenantOpenAiSecret({ gateway, tenantId: PEDRO_V3_PILOT_TENANT_ID });
    const brainMode = resolveBrainMode();
    // R13-D/4: AgentBrain REAL (OpenAI) só é fabricado quando o modo pede. Planner em temp baixa (0.2). Segredo por
    // tenant (mesmo openAiSecret do compose); prompt integral vai no system do brain (prova por SHA no adapter).
    const agentBrainFactory = brainMode !== "off"
      ? (config: TenantRuntimeConfig) => new OpenAiAgentBrain(openAiSecret, new FetchModelHttpTransport(), config.promptText, {
          model: this.#modelOverride, temperature: 0.2, maxCompletionTokens: 1_200, timeoutMs: 45_000,
          allowedTools: [...CENTRAL_BRAIN_ALLOWED_TOOLS],
        })
      : undefined;
    return PilotActiveRoot.create({
      mode: "active",
      tenantId: PEDRO_V3_PILOT_TENANT_ID,
      agentId,
      leadId,
    }, {
      db: readDb,
      decryptor: new V2PlaintextApiKeyReader(),
      clock: this.#clock,
      modelFactory: createOpenAiModelFactory({
        openAiSecret,
        modelTransport: new FetchModelHttpTransport(),
        modelOptions: {
          modelOverride: this.#modelOverride,
          timeoutMs: 30_000,
          maxResponseBytes: 2 * 1024 * 1024,
          maxCompletionTokens: 1_200,
        },
      }),
      whatsappTransport: new FetchUazapiHttpTransport(),
      allowedUazapiHosts: this.#allowedUazapiHosts,
      brainMode,
      agentBrainFactory,
    });
  }

  // F2.7.6: processa UMA conversa assentada (claim do BLOCO -> decide -> dispatch).
  // Falha de bootstrap (ex.: sem chave do tenant) NAO derruba o poller: deixa pendente p/ o proximo tick.
  async processSettled(settled: SettledConversation): Promise<void> {
    const gateway = this.#gateway();
    const persistence = new PostgresPersistence(gateway, {
      tenantId: PEDRO_V3_PILOT_TENANT_ID,
      clock: this.#clock,
    });
    let root: PilotActiveRoot;
    try {
      root = await this.#createRoot(settled.agentId, settled.leadId, gateway);
    } catch {
      return;
    }
    this.#turnSeq += 1;
    const turnId = `poll-${this.#turnSeq}-${randomUUID()}`;
    const processed = await root.processConversation({
      persistence,
      conversationId: settled.conversationId,
      to: settled.toAddr,
      workerId: "poll-worker",
      turnId,
      limits: PILOT_TURN_LIMITS,
      maxValidationAttempts: 3, // R10: 1 tentativa + 2 retries c/ guidance específico -> menos terminal-safe
    });
    if (processed.status === "commit_failed" && processed.engine.status === "commit_failed") {
      console.error(JSON.stringify({
        event: "pedro_v3_turn_commit_failed",
        conversationId: settled.conversationId,
        reason: sanitizeTurnError(processed.engine.reason),
      }));
    }
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(response: ServerResponse, result: PilotHttpResponse): void {
  response.writeHead(result.status, result.headers);
  response.end(result.body);
}

const port = Number(process.env.PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new RuntimeConfigError("ENV_PORT_INVALID");

const runtime = new ProductionPilotRunner();
const app = new PilotHttpApp(requiredEnv("PEDRO_V3_BRIDGE_SECRET"), runtime, runtime, () => ({ configuredBrainMode: resolveBrainMode() }));
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const bodyText = request.method === "POST" ? await readBody(request) : "";
    const result = await app.handle({
      method: request.method ?? "GET",
      pathname: url.pathname,
      authorization: request.headers.authorization,
      contentType: request.headers["content-type"],
      bodyText,
    });
    send(response, result);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "REQUEST_TOO_LARGE";
    send(response, {
      status: tooLarge ? 413 : 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      body: JSON.stringify({ ok: false, error: tooLarge ? "request_too_large" : "server_error", ingested: false }),
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "pedro_v3_service_started", port, mode: "pilot", brainMode: resolveBrainMode() }));
});

// F2.7.6: poller de debounce — processa as conversas que ja assentaram (quietas >= debounce
// OU pendente mais antiga >= max). Robusto: estado no Postgres (v3_inbox + routing), recupera
// no restart. Um tick nunca sobrepoe o anterior; falha de uma conversa nao derruba o laço.
const poller = new DebouncePoller(
  (nowIso) => runtime.findSettled(nowIso),
  (settled) => runtime.processSettled(settled),
  new RealClock(),
  (event) => {
    if (event.kind === "error") {
      console.error(JSON.stringify({ event: "pedro_v3_poll_error", context: event.context, reason: sanitizeTurnError(event.detail) }));
    }
  },
);
const stopPoller = poller.start(runtime.debounceConfig.pollIntervalMs);
console.log(JSON.stringify({
  event: "pedro_v3_debounce_poller_started",
  debounceMs: runtime.debounceConfig.debounceMs,
  maxWaitMs: runtime.debounceConfig.maxWaitMs,
  pollIntervalMs: runtime.debounceConfig.pollIntervalMs,
}));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    stopPoller();
    server.close(() => process.exit(0));
  });
}
