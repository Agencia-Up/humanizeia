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
      "Return ONE JSON object (TurnInterpretation) with this exact shape:",
      '{"relation": <one of: answers_pending | direction_change | continues_offer | asks_vehicle_detail | ambiguous | unrelated>,',
      ' "intentSummary"?: string, "extractedEntities"?: {"model"?: string, "price"?: number}}',
      "Only classify the lead's last message relative to the conversation. Do NOT decide actions, call tools, or write a reply.",
      'Example: {"relation":"unrelated","intentSummary":"Cliente pergunta se tem um modelo."}',
    ].join("\n");
  }
  if (operation === "propose") {
    return [
      "Return ONE JSON object that is a DecisionStep. EXACTLY one of two shapes:",
      "",
      "(A) Fetch read-only data BEFORE deciding (only when you still lack data you need):",
      '{"kind":"query","call":{"tool":<T>,"input":{...}}}  where:',
      '  - tool="stock_search", input:{ "tipo"?: "suv"|"sedan"|"hatch"|"pickup"|"unknown", "precoMax"?: number>0, "modelo"?: string, "broad"?: boolean, "excludeKeys"?: string[] }',
      '  - tool="vehicle_details", input:{ "vehicleKey": string }',
      '  - tool="vehicle_photos_resolve", input:{ "vehicleRef":{ "kind":"vehicle", "key": string } }',
      '  - tool="crm_read", input:{ "leadId": string }',
      "  Query ONLY for data you do not already have in the provided facts/state. Never query the same thing twice. Never invent stock/prices/photos.",
      "",
      "(B) Finish the turn:",
      '{"kind":"final","proposal":{',
      '  "proposedAction": <one of: reply | clarify | collect_slot | search_stock | send_photos | answer_vehicle_question | schedule_visit | handoff | close | no_op>,',
      '  "facts": [],',
      '  "proposedEffects": [ ... ],',
      '  "responsePlan": { "guidance": <pt-BR plan for the message. FIRST directly answer whatever the lead just asked, using ONLY real facts/state; THEN add ONE useful funnel question if qualification is still incomplete> },',
      '  "reasonCode": <short_snake_case string>, "reasonSummary": <one short sentence>, "confidence": <number 0..1> }}',
      "",
      "RULES for the final proposal:",
      '  - To actually send a WhatsApp reply you MUST include a send_message effect in proposedEffects: {"kind":"send_message","planId":"reply","order":0,"onSuccess":[]}. Without it NO message is sent. Do NOT put the message text here — it is written in a later step from responsePlan.guidance.',
      '  - ANSWER FIRST: if the lead asked anything (e.g., do you have a given model? is it automatic? what is the price? send a photo?), the reply MUST address it directly — NEVER ignore a question to push the funnel. If you lack the data to answer, do a query first. Then qualify by appending ONE useful funnel question AFTER the answer, not instead of it.',
      '  - NO EMPTY CONTENT: every message must carry real information or a purposeful question. Never pad with vacuous affirmations.',
      '  - Keep "facts": [] (do not emit state mutations) unless you are certain of the exact schema.',
      '  - Use proposedEffects:[] with proposedAction:"no_op" ONLY when nothing should be sent.',
      "  - Do not fabricate stock, prices, photos, CRM facts, or delivery outcomes; use a query to get real data first.",
      "",
      'Example (reply needing no extra data): {"kind":"final","proposal":{"proposedAction":"reply","facts":[],"proposedEffects":[{"kind":"send_message","planId":"reply","order":0,"onSuccess":[]}],"responsePlan":{"guidance":"Cumprimentar o cliente e perguntar que tipo de veiculo ele procura."},"reasonCode":"greeting","reasonSummary":"Saudar e abrir a descoberta.","confidence":0.8}}',
    ].join("\n");
  }
  return [
    "Return ONE JSON object that is a ResponseDraft with this exact shape: {\"parts\": [ ... ]}.",
    "Each part is EXACTLY one of:",
    '  {"type":"text","content": <string, the message text in pt-BR>}',
    '  {"type":"vehicle_ref","vehicleKey": <string>, "field":"marca"|"modelo"|"ano"}',
    '  {"type":"money_ref","role":"vehicle_price"|"down_payment"|"installment"|"budget","source": {"kind":"vehicle_fact","vehicleKey":<string>} | {"kind":"slot_value","slotName":<string>}}',
    "Write the actual customer message as text parts, following responsePlan.guidance. For specific vehicle facts (marca/modelo/ano) use vehicle_ref parts; for monetary values use money_ref parts. Never write vehicle names or prices as free commercial claims inside plain text.",
    'ANSWER FIRST, then qualify: open with the direct answer to what the lead asked; add at most ONE funnel question when qualification is still pending. Do NOT open with an empty affirmation that adds no information (e.g., "Que otimo", "Perfeito <nome>", "Otimo", "Que bom", "Maravilha"). A short acknowledgment is allowed ONLY when it carries real information. Every message must be useful.',
    'Example: {"parts":[{"type":"text","content":"Oi! Tudo bem? Me conta: que tipo de carro voce procura?"}]}',
  ].join("\n");
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
