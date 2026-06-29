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
    };
  }
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
