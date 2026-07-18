import type {
  ModelHttpRequest,
  ModelHttpResponse,
  ModelHttpTransport,
} from "../adapters/llm/structured-json-model.ts";
import type {
  UazapiHttpRequest,
  UazapiHttpResponse,
  UazapiHttpTransport,
} from "../adapters/effects/uazapi-whatsapp-sender.ts";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

// ⭐Fase 4 (retry/backoff de provedor): parse do header Retry-After (segundos OU HTTP-date). Teto de 30s p/ nunca
// travar o turno. Retorna undefined quando ausente/ilegível -> o transporte cai no backoff exponencial.
function parseRetryAfterMs(header: string | null, nowMs: number): number | undefined {
  if (header == null || header.trim() === "") return undefined;
  const secs = Number(header.trim());
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 30_000);
  const when = Date.parse(header);
  if (Number.isFinite(when)) { const delta = when - nowMs; return delta > 0 ? Math.min(delta, 30_000) : 0; }
  return undefined;
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("HTTP_RESPONSE_TOO_LARGE");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error("HTTP_RESPONSE_TOO_LARGE");
    }
    return text;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("HTTP_RESPONSE_TOO_LARGE").catch(() => undefined);
        throw new Error("HTTP_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The stream can already be released after cancellation.
    }
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

export class FetchModelHttpTransport implements ModelHttpTransport {
  constructor(private readonly maxResponseBytes = DEFAULT_MAX_BYTES) {}

  async postJson(url: string, request: ModelHttpRequest): Promise<ModelHttpResponse> {
    const response = await fetch(url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "error",
      signal: request.signal,
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      bodyText: await readBounded(response, this.maxResponseBytes),
      retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after"), Date.now()),
    };
  }
}

// ⭐Fase 4 (retry/backoff real no runtime). O runtime instanciava FetchModelHttpTransport cru: um 429/5xx/erro de rede
// virava falha de turno (=> "instabilidade") e o loop do engine re-chamava a LLM 6-8x SEM espera, aprofundando o
// throttle (retry-storm). Este transporte envolve o inner e:
//  - só re-tenta 429, 5xx e erro de rede/transporte (NUNCA 2xx/4xx≠429 — resposta válida/erro do cliente não repete);
//  - NUNCA re-tenta abort (timeout/cancelamento do chamador) — respeita request.signal.aborted;
//  - honra Retry-After (retryAfterMs) do provedor; senão backoff exponencial + jitter determinístico (sem Math.random);
//  - teto baixo de tentativas (default 2 retries => no máx. 3 chamadas) pra não virar amplificador de carga.
// Idempotência: só re-tenta o POST de geração de resposta da LLM, que não executa tools nem efeitos (o engine é quem
// dispara efeitos, DEPOIS, uma única vez). Portanto re-tentar aqui não reexecuta tool nem duplica mensagem ao lead.
export type RetryingTransportOptions = {
  readonly maxRetries?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => { clearTimeout(timer); resolve(); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class RetryingModelHttpTransport implements ModelHttpTransport {
  readonly #inner: ModelHttpTransport;
  readonly #maxRetries: number;
  readonly #baseDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #sleep: (ms: number, signal: AbortSignal) => Promise<void>;

  constructor(inner: ModelHttpTransport, options: RetryingTransportOptions = {}) {
    this.#inner = inner;
    this.#maxRetries = clampInt(options.maxRetries ?? 2, 0, 4);
    this.#baseDelayMs = clampInt(options.baseDelayMs ?? 500, 0, 10_000);
    this.#maxDelayMs = clampInt(options.maxDelayMs ?? 8_000, this.#baseDelayMs, 30_000);
    this.#sleep = options.sleep ?? defaultSleep;
  }

  async postJson(url: string, request: ModelHttpRequest): Promise<ModelHttpResponse> {
    let attempt = 0;
    while (true) {
      // Chamador já cancelou (timeout do modelo) => não gaste mais tentativas.
      if (request.signal.aborted) return this.#inner.postJson(url, request);

      let response: ModelHttpResponse | undefined;
      let transportError: unknown;
      try {
        response = await this.#inner.postJson(url, request);
      } catch (error) {
        transportError = error;
      }

      const retriable = response
        ? isRetriableStatus(response.status)
        : !request.signal.aborted; // erro de rede/transporte, sem ser abort

      if (!retriable || attempt >= this.#maxRetries) {
        if (response) return response;
        throw transportError;
      }

      const backoff = Math.min(this.#baseDelayMs * 2 ** attempt, this.#maxDelayMs);
      // jitter determinístico (0–25% do backoff) por tentativa — sem Math.random (indisponível no harness/workflow).
      const jitter = Math.trunc((backoff / 4) * (((attempt * 37) % 100) / 100));
      const suggested = response?.retryAfterMs;
      const waitMs = typeof suggested === "number" && suggested >= 0
        ? Math.min(suggested, this.#maxDelayMs)
        : Math.min(backoff + jitter, this.#maxDelayMs);

      await this.#sleep(waitMs, request.signal);
      attempt += 1;
    }
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const rounded = Math.trunc(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

export class FetchUazapiHttpTransport implements UazapiHttpTransport {
  constructor(private readonly maxResponseBytes = DEFAULT_MAX_BYTES) {}

  async postJson(url: string, request: UazapiHttpRequest): Promise<UazapiHttpResponse> {
    const response = await fetch(url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "error",
      signal: request.signal,
    });
    const text = await readBounded(response, this.maxResponseBytes);
    let json: unknown;
    if (text.trim() !== "") {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = undefined;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      json,
      text,
    };
  }
}
