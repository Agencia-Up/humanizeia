import type {
  ComposeModelRequest,
  InterpretModelRequest,
  ProposeModelRequest,
  StructuredConversationModel,
} from "../../domain/conversation-model.ts";
import type { ModelHttpRequest, ModelHttpResponse, ModelHttpTransport } from "./structured-json-model.ts";

export type OpenAiChatOperation = "interpret" | "propose" | "compose";

export type OpenAiChatModelConfig = {
  readonly endpointUrl?: string;
  readonly allowedHosts?: readonly string[];
  readonly apiKey: string;
  readonly model?: string | null;
  readonly temperature?: number | null;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxCompletionTokens?: number;
};

export class OpenAiChatModelError extends Error {
  constructor(public readonly code:
    | "OPENAI_ENDPOINT_INVALID"
    | "OPENAI_HOST_NOT_ALLOWED"
    | "OPENAI_API_KEY_MISSING"
    | "OPENAI_MODEL_INVALID"
    | "OPENAI_CONFIG_INVALID"
    | "OPENAI_HTTP_FAILURE"
    | "OPENAI_TIMEOUT"
    | "OPENAI_RESPONSE_TOO_LARGE"
    | "OPENAI_RESPONSE_NOT_JSON"
    | "OPENAI_RESPONSE_SHAPE_INVALID") {
    super(code);
    this.name = "OpenAiChatModelError";
  }
}

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_HOSTS = ["api.openai.com"] as const;
const DEFAULT_MODEL = "gpt-4.1-mini";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertIntegerInRange(value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new OpenAiChatModelError("OPENAI_CONFIG_INVALID");
  }
}

function parseEndpoint(endpointUrl: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(endpointUrl);
  } catch {
    throw new OpenAiChatModelError("OPENAI_ENDPOINT_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new OpenAiChatModelError("OPENAI_ENDPOINT_INVALID");
  }
  if (url.pathname !== "/v1/chat/completions") {
    throw new OpenAiChatModelError("OPENAI_ENDPOINT_INVALID");
  }
  const hosts = new Set(allowedHosts.map((host) => host.toLowerCase()));
  if (!hosts.has(url.hostname.toLowerCase())) throw new OpenAiChatModelError("OPENAI_HOST_NOT_ALLOWED");
  return url;
}

export function resolveOpenAiModelName(model: string | null | undefined): string {
  const raw = typeof model === "string" ? model.trim() : "";
  const withoutProvider = raw.toLowerCase().startsWith("openai/") ? raw.slice("openai/".length).trim() : raw;
  const resolved = withoutProvider || DEFAULT_MODEL;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(resolved)) {
    throw new OpenAiChatModelError("OPENAI_MODEL_INVALID");
  }
  return resolved;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OpenAiChatModelError("OPENAI_RESPONSE_NOT_JSON");
  }
}

function operationInstructions(operation: OpenAiChatOperation): string {
  if (operation === "interpret") {
    return [
      "Return one JSON object matching TurnInterpretation.",
      "Allowed relation values: answers_pending, direction_change, continues_offer, asks_vehicle_detail, ambiguous, unrelated.",
      "Do not decide actions, do not call tools, do not compose a customer reply.",
    ].join(" ");
  }
  if (operation === "propose") {
    return [
      "Return one JSON object matching DecisionStep.",
      "Use kind=query only when a read-only tool is needed; otherwise use kind=final with one ProposedDecision.",
      "Do not fabricate stock, prices, photos, CRM facts, or delivery outcomes.",
    ].join(" ");
  }
  return [
    "Return one JSON object matching ResponseDraft.",
    "For vehicle facts use vehicle_ref parts; for money use money_ref parts.",
    "Do not place vehicle names or prices as free commercial claims inside plain text.",
  ].join(" ");
}

function systemMessageFor(operation: OpenAiChatOperation, prompt: string): string {
  return [
    "You are the structured model adapter for Pedro v3, a WhatsApp automotive SDR.",
    "You are not the final authority: the deterministic engine, policies, tools, and outbox decide what is allowed.",
    "Return only valid JSON. No markdown, no prose outside JSON, no tool side effects.",
    operationInstructions(operation),
    "",
    "Client prompt from the portal:",
    prompt,
  ].join("\n");
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const chunks = content
      .map((part) => isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : "")
      .filter((part) => part !== "");
    if (chunks.length > 0) return chunks.join("");
  }
  throw new OpenAiChatModelError("OPENAI_RESPONSE_SHAPE_INVALID");
}

function extractChatCompletionPayload(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    throw new OpenAiChatModelError("OPENAI_RESPONSE_SHAPE_INVALID");
  }
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    throw new OpenAiChatModelError("OPENAI_RESPONSE_SHAPE_INVALID");
  }
  return parseJson(contentText(first.message.content));
}

function resolveTemperature(configTemperature: number | null | undefined, requestTemperature: number | null | undefined): number | undefined {
  const value = configTemperature ?? requestTemperature ?? undefined;
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2) {
    throw new OpenAiChatModelError("OPENAI_CONFIG_INVALID");
  }
  return value;
}

export class OpenAiChatCompletionsModel implements StructuredConversationModel {
  readonly endpointUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxCompletionTokens: number;

  readonly #apiKey: string;
  readonly #temperature: number | null | undefined;
  readonly #transport: ModelHttpTransport;

  constructor(config: OpenAiChatModelConfig, transport: ModelHttpTransport) {
    if (typeof config.apiKey !== "string" || config.apiKey.trim() === "") {
      throw new OpenAiChatModelError("OPENAI_API_KEY_MISSING");
    }
    const allowedHosts = config.allowedHosts ?? DEFAULT_HOSTS;
    if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
      throw new OpenAiChatModelError("OPENAI_HOST_NOT_ALLOWED");
    }
    const endpoint = parseEndpoint(config.endpointUrl ?? DEFAULT_ENDPOINT, allowedHosts);
    const timeoutMs = config.timeoutMs ?? 15_000;
    const maxResponseBytes = config.maxResponseBytes ?? 1_000_000;
    const maxCompletionTokens = config.maxCompletionTokens ?? 1_200;
    assertIntegerInRange(timeoutMs, 1, 120_000);
    assertIntegerInRange(maxResponseBytes, 1, 5_000_000);
    assertIntegerInRange(maxCompletionTokens, 1, 16_000);
    if (config.temperature !== undefined && config.temperature !== null) {
      resolveTemperature(config.temperature, undefined);
    }
    this.endpointUrl = endpoint.toString();
    this.model = resolveOpenAiModelName(config.model);
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
    this.maxCompletionTokens = maxCompletionTokens;
    this.#apiKey = config.apiKey;
    this.#temperature = config.temperature;
    this.#transport = transport;
  }

  toJSON(): Record<string, unknown> {
    return {
      endpointUrl: this.endpointUrl,
      model: this.model,
      timeoutMs: this.timeoutMs,
      maxResponseBytes: this.maxResponseBytes,
      maxCompletionTokens: this.maxCompletionTokens,
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

  private async call(operation: OpenAiChatOperation, request: InterpretModelRequest | ProposeModelRequest | ComposeModelRequest): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const body = JSON.stringify({
      model: this.model,
      temperature: resolveTemperature(this.#temperature, request.binding.temperature),
      max_completion_tokens: this.maxCompletionTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemMessageFor(operation, request.binding.systemPrompt) },
        {
          role: "user",
          content: JSON.stringify({
            operation,
            expectedOutput: operationInstructions(operation),
            request,
          }),
        },
      ],
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
          controller.signal.addEventListener("abort", () => reject(new OpenAiChatModelError("OPENAI_TIMEOUT")), { once: true });
        }),
      ]);
      return this.parseResponse(response);
    } catch (error) {
      if (error instanceof OpenAiChatModelError) throw error;
      if (controller.signal.aborted) throw new OpenAiChatModelError("OPENAI_TIMEOUT");
      throw new OpenAiChatModelError("OPENAI_HTTP_FAILURE");
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseResponse(response: ModelHttpResponse): unknown {
    if (response.status < 200 || response.status >= 300) {
      throw new OpenAiChatModelError("OPENAI_HTTP_FAILURE");
    }
    if (!response.contentType.toLowerCase().includes("application/json")) {
      throw new OpenAiChatModelError("OPENAI_RESPONSE_NOT_JSON");
    }
    if (byteLength(response.bodyText) > this.maxResponseBytes) {
      throw new OpenAiChatModelError("OPENAI_RESPONSE_TOO_LARGE");
    }
    return extractChatCompletionPayload(parseJson(response.bodyText));
  }
}
