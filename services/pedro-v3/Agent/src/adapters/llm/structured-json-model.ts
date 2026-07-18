import type {
  ComposeModelRequest,
  InterpretModelRequest,
  ProposeModelRequest,
  StructuredConversationModel,
} from "../../domain/conversation-model.ts";

export type StructuredJsonModelOperation = "interpret" | "propose" | "compose";

export type StructuredJsonModelConfig = {
  readonly endpointUrl: string;
  readonly allowedHosts: readonly string[];
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
};

export type ModelHttpRequest = {
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal;
};

export type ModelHttpResponse = {
  readonly status: number;
  readonly contentType: string;
  readonly bodyText: string;
  // ⭐Fase 4 (retry/backoff de provedor): ms sugeridos pelo header Retry-After (429/503). Aditivo/opcional —
  // o transporte com retry honra este valor; ausência => backoff exponencial.
  readonly retryAfterMs?: number;
};

export interface ModelHttpTransport {
  postJson(url: string, request: ModelHttpRequest): Promise<ModelHttpResponse>;
}

export class StructuredJsonModelError extends Error {
  constructor(public readonly code:
    | "MODEL_ENDPOINT_INVALID"
    | "MODEL_HOST_NOT_ALLOWED"
    | "MODEL_API_KEY_MISSING"
    | "MODEL_CONFIG_INVALID"
    | "MODEL_HTTP_FAILURE"
    | "MODEL_TIMEOUT"
    | "MODEL_RESPONSE_TOO_LARGE"
    | "MODEL_RESPONSE_NOT_JSON"
    | "MODEL_RESPONSE_SHAPE_INVALID") {
    super(code);
    this.name = "StructuredJsonModelError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEndpoint(endpointUrl: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(endpointUrl);
  } catch {
    throw new StructuredJsonModelError("MODEL_ENDPOINT_INVALID");
  }
  if (url.protocol !== "https:") throw new StructuredJsonModelError("MODEL_ENDPOINT_INVALID");
  if (url.username || url.password || url.search || url.hash) {
    throw new StructuredJsonModelError("MODEL_ENDPOINT_INVALID");
  }
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));
  if (!allowed.has(url.hostname.toLowerCase())) throw new StructuredJsonModelError("MODEL_HOST_NOT_ALLOWED");
  return url;
}

function assertConfig(config: StructuredJsonModelConfig): URL {
  if (typeof config.apiKey !== "string" || config.apiKey.trim() === "") {
    throw new StructuredJsonModelError("MODEL_API_KEY_MISSING");
  }
  if (typeof config.model !== "string" || config.model.trim() === "") {
    throw new StructuredJsonModelError("MODEL_ENDPOINT_INVALID");
  }
  if (!Array.isArray(config.allowedHosts) || config.allowedHosts.length === 0) {
    throw new StructuredJsonModelError("MODEL_HOST_NOT_ALLOWED");
  }
  return parseEndpoint(config.endpointUrl, config.allowedHosts);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function jsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new StructuredJsonModelError("MODEL_RESPONSE_NOT_JSON");
  }
}

function extractProviderPayload(value: unknown): unknown {
  if (!isRecord(value)) throw new StructuredJsonModelError("MODEL_RESPONSE_SHAPE_INVALID");
  if ("output" in value) return value.output;
  if (typeof value.output_text === "string") return jsonParse(value.output_text);
  if (Array.isArray(value.choices)) {
    const first = value.choices[0];
    if (isRecord(first) && isRecord(first.message)) {
      const content = first.message.content;
      if (typeof content === "string") return jsonParse(content);
    }
  }
  throw new StructuredJsonModelError("MODEL_RESPONSE_SHAPE_INVALID");
}

function operationInstructions(operation: StructuredJsonModelOperation): string {
  if (operation === "interpret") {
    return "Return only the TurnInterpretation JSON object for this lead turn.";
  }
  if (operation === "propose") {
    return "Return only one DecisionStep JSON object: either a bounded query request or the final commercial proposal.";
  }
  return "Return only the ResponseDraft JSON object. Use vehicle_ref and money_ref for commercial facts.";
}

export class StructuredJsonConversationModel implements StructuredConversationModel {
  readonly endpointUrl: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;

  readonly #apiKey: string;
  readonly #model: string;
  readonly #transport: ModelHttpTransport;

  constructor(config: StructuredJsonModelConfig, transport: ModelHttpTransport) {
    const endpoint = assertConfig(config);
    const timeoutMs = config.timeoutMs ?? 15_000;
    const maxResponseBytes = config.maxResponseBytes ?? 1_000_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      throw new StructuredJsonModelError("MODEL_CONFIG_INVALID");
    }
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 5_000_000) {
      throw new StructuredJsonModelError("MODEL_CONFIG_INVALID");
    }
    this.endpointUrl = endpoint.toString();
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
    this.#apiKey = config.apiKey;
    this.#model = config.model;
    this.#transport = transport;
  }

  toJSON(): Record<string, unknown> {
    return {
      endpointUrl: this.endpointUrl,
      timeoutMs: this.timeoutMs,
      maxResponseBytes: this.maxResponseBytes,
    };
  }

  interpret(request: InterpretModelRequest): Promise<unknown> {
    return this.call("interpret", request);
  }

  propose(request: ProposeModelRequest): Promise<unknown> {
    return this.call("propose", request);
  }

  compose(request: ComposeModelRequest): Promise<unknown> {
    return this.call("compose", request);
  }

  private async call(operation: StructuredJsonModelOperation, request: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const body = JSON.stringify({
      model: this.#model,
      operation,
      instructions: operationInstructions(operation),
      input: request,
      response_format: { type: "json_object" },
    });

    try {
      const response = await Promise.race([
        this.#transport.postJson(this.endpointUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.#apiKey}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body,
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(new StructuredJsonModelError("MODEL_TIMEOUT")), { once: true });
        }),
      ]);

      if (response.status < 200 || response.status >= 300) throw new StructuredJsonModelError("MODEL_HTTP_FAILURE");
      if (!response.contentType.toLowerCase().includes("application/json")) {
        throw new StructuredJsonModelError("MODEL_RESPONSE_NOT_JSON");
      }
      if (byteLength(response.bodyText) > this.maxResponseBytes) {
        throw new StructuredJsonModelError("MODEL_RESPONSE_TOO_LARGE");
      }
      return extractProviderPayload(jsonParse(response.bodyText));
    } catch (error) {
      if (error instanceof StructuredJsonModelError) throw error;
      if (controller.signal.aborted) throw new StructuredJsonModelError("MODEL_TIMEOUT");
      throw new StructuredJsonModelError("MODEL_HTTP_FAILURE");
    } finally {
      clearTimeout(timeout);
    }
  }
}
