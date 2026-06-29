import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PostgresPersistence } from "../adapters/persistence/postgres-store.ts";
import { SupabaseReadOnlyDatabase } from "../adapters/read/supabase-read-database.ts";
import { V2PlaintextApiKeyReader } from "../adapters/read/v2-api-key-reader.ts";
import { PilotActiveRoot } from "../engine/pilot-active-root.ts";
import { createOpenAiModelFactory, OpenAiRuntimeSecret } from "../engine/openai-canary-root.ts";
import { RealClock } from "./real-clock.ts";
import { FetchModelHttpTransport, FetchUazapiHttpTransport } from "./fetch-transports.ts";
import { SupabaseServiceGateway } from "./supabase-service-gateway.ts";
import {
  PilotHttpApp,
  PilotTurnRuntimeError,
  type PilotHttpResponse,
  type PilotTurnPayload,
  type PilotTurnRunner,
} from "./pilot-http-app.ts";

const MAX_REQUEST_BYTES = 32 * 1024;

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

class ProductionPilotRunner implements PilotTurnRunner {
  readonly #supabaseUrl: string;
  readonly #serviceRoleKey: string;
  readonly #openAiKey: string;
  readonly #modelOverride: string;
  readonly #allowedUazapiHosts: readonly string[];
  readonly #clock = new RealClock();

  constructor() {
    this.#supabaseUrl = requiredEnv("SUPABASE_URL");
    this.#serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    this.#openAiKey = requiredEnv("OPENAI_API_KEY");
    this.#modelOverride = process.env.PEDRO_V3_OPENAI_MODEL?.trim() || "gpt-4.1-mini";
    this.#allowedUazapiHosts = commaList("PEDRO_V3_ALLOWED_UAZAPI_HOSTS");
  }

  async run(payload: PilotTurnPayload) {
    const host = supabaseHost(this.#supabaseUrl);
    const readDb = SupabaseReadOnlyDatabase.create({
      url: this.#supabaseUrl,
      apiKey: this.#serviceRoleKey,
      allowedHosts: [host],
      timeoutMs: 15_000,
      maxResponseBytes: 4 * 1024 * 1024,
    });
    const gateway = new SupabaseServiceGateway({
      url: this.#supabaseUrl,
      serviceRoleKey: this.#serviceRoleKey,
      allowedHosts: [host],
      timeoutMs: 20_000,
      maxResponseBytes: 8 * 1024 * 1024,
    });
    const persistence = new PostgresPersistence(gateway, {
      tenantId: payload.tenantId,
      clock: this.#clock,
    });

    let root: PilotActiveRoot;
    try {
      root = await PilotActiveRoot.create({
        mode: "active",
        tenantId: payload.tenantId,
        agentId: payload.agentId,
        leadId: payload.leadId ?? null,
      }, {
        db: readDb,
        decryptor: new V2PlaintextApiKeyReader(),
        clock: this.#clock,
        modelFactory: createOpenAiModelFactory({
          openAiSecret: OpenAiRuntimeSecret.fromString(this.#openAiKey),
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
      });
    } catch {
      throw new PilotTurnRuntimeError("PILOT_BOOTSTRAP_FAILED", false);
    }

    try {
      return await root.runTurn({
        persistence,
        conversationId: payload.conversationId,
        to: payload.to,
        workerId: payload.workerId,
        turnId: payload.turnId,
        eventId: payload.eventId,
        messageText: payload.messageText,
        receivedAt: payload.receivedAt,
        limits: {
          maxSteps: 4,
          totalTimeoutMs: 70_000,
          proposeTimeoutMs: 25_000,
          queryTimeoutMs: 20_000,
          composeTimeoutMs: 25_000,
        },
        maxValidationAttempts: 2,
      });
    } catch {
      let ingested: boolean | "unknown" = "unknown";
      try {
        ingested = (await persistence.get(payload.eventId)) !== null;
      } catch {
        ingested = "unknown";
      }
      throw new PilotTurnRuntimeError("PILOT_TURN_FAILED", ingested);
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

const app = new PilotHttpApp(requiredEnv("PEDRO_V3_BRIDGE_SECRET"), new ProductionPilotRunner());
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
  console.log(JSON.stringify({ event: "pedro_v3_service_started", port, mode: "pilot" }));
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
