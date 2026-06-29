import type {
  DatabaseFilters,
  DatabaseOrder,
  DatabaseRow,
  V3DatabaseGateway,
} from "../domain/database-gateway.ts";
import type { JsonValue } from "../domain/types.ts";

const RPC_ALLOWLIST = new Set([
  "v3_ingest_inbox",
  "v3_acquire_lease",
  "v3_renew_lease",
  "v3_release_lease",
  "v3_claim_inbox_burst",
  "v3_release_inbox_claim",
  "v3_commit_turn",
  "v3_claim_outbox_for_conversation",
  "v3_record_outbox_result",
  "v3_requeue_outbox_guarded",
  "v3_skip_outbox_guarded",
  "v3_fail_outbox_guarded",
  "v3_commit_effect_outcome",
  "v3_find_outbox_by_provider_message_id",
  // BYOK (F2.6J): chave OpenAI do tenant via Vault, mesma RPC service-role do v2 (aiKeys.ts).
  "get_client_ai_key",
]);

const TABLE_ALLOWLIST = new Set([
  "v3_inbox",
  "v3_conversation_state",
  "v3_effect_outbox",
]);

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export type SupabaseServiceGatewayConfig = {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly allowedHosts: readonly string[];
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
};

export interface GatewayHttpTransport {
  fetch(url: string, init: RequestInit): Promise<Response>;
}

class RealGatewayHttpTransport implements GatewayHttpTransport {
  fetch(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, init);
  }
}

export class SupabaseServiceGatewayError extends Error {
  constructor(public readonly code:
    | "CONFIG_INVALID"
    | "HOST_NOT_ALLOWED"
    | "OPERATION_NOT_ALLOWED"
    | "HTTP_FAILURE"
    | "RESPONSE_INVALID"
    | "RESPONSE_TOO_LARGE"
    | "TIMEOUT") {
    super(code);
    this.name = "SupabaseServiceGatewayError";
  }
}

function encodeFilter(value: JsonValue): string {
  if (value === null) return "is.null";
  if (typeof value === "object") throw new SupabaseServiceGatewayError("OPERATION_NOT_ALLOWED");
  return `eq.${encodeURIComponent(String(value))}`;
}

function isObject(value: unknown): value is DatabaseRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeColumns(columns: string): string {
  if (columns === "*") return columns;
  const parts = columns.split(",").map((item) => item.trim());
  if (parts.length === 0 || parts.some((item) => !/^[a-z_][a-z0-9_]*$/i.test(item))) {
    throw new SupabaseServiceGatewayError("OPERATION_NOT_ALLOWED");
  }
  return parts.join(",");
}

async function readBounded(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    throw new SupabaseServiceGatewayError("RESPONSE_TOO_LARGE");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new SupabaseServiceGatewayError("RESPONSE_TOO_LARGE");
    return new TextDecoder().decode(buffer);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  let rejectOnAbort: ((reason?: unknown) => void) | null = null;
  const aborted = new Promise<never>((_, reject) => { rejectOnAbort = reject; });
  const onAbort = () => {
    void reader.cancel("TIMEOUT").catch(() => undefined);
    rejectOnAbort?.(new DOMException("TIMEOUT", "AbortError"));
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (signal.aborted) throw new DOMException("TIMEOUT", "AbortError");
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("RESPONSE_TOO_LARGE").catch(() => undefined);
        throw new SupabaseServiceGatewayError("RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    try { reader.releaseLock(); } catch { /* stream already released */ }
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

export class SupabaseServiceGateway implements V3DatabaseGateway {
  readonly endpoint: string;
  readonly host: string;
  readonly #serviceRoleKey: string;
  readonly #transport: GatewayHttpTransport;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;

  constructor(
    config: SupabaseServiceGatewayConfig,
    transport: GatewayHttpTransport = new RealGatewayHttpTransport(),
  ) {
    let url: URL;
    try {
      url = new URL(config.url);
    } catch {
      throw new SupabaseServiceGatewayError("CONFIG_INVALID");
    }
    const allowed = new Set(config.allowedHosts.map((item) => item.trim().toLowerCase()).filter(Boolean));
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.search
      || url.hash
      || allowed.size === 0
      || typeof config.serviceRoleKey !== "string"
      || config.serviceRoleKey.trim() === ""
    ) {
      throw new SupabaseServiceGatewayError("CONFIG_INVALID");
    }
    if (!allowed.has(url.hostname.toLowerCase())) {
      throw new SupabaseServiceGatewayError("HOST_NOT_ALLOWED");
    }
    this.host = url.hostname.toLowerCase();
    this.endpoint = `https://${this.host}/rest/v1`;
    this.#serviceRoleKey = config.serviceRoleKey.trim();
    this.#transport = transport;
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 120_000) {
      throw new SupabaseServiceGatewayError("CONFIG_INVALID");
    }
    if (!Number.isInteger(this.#maxResponseBytes) || this.#maxResponseBytes < 1) {
      throw new SupabaseServiceGatewayError("CONFIG_INVALID");
    }
  }

  toJSON(): Record<string, unknown> {
    return { host: this.host, endpoint: this.endpoint, timeoutMs: this.#timeoutMs };
  }

  async rpc<T extends JsonValue>(name: string, args: DatabaseRow): Promise<T> {
    if (!RPC_ALLOWLIST.has(name)) throw new SupabaseServiceGatewayError("OPERATION_NOT_ALLOWED");
    return this.request<T>(`${this.endpoint}/rpc/${name}`, {
      method: "POST",
      headers: this.headers({ Prefer: "return=representation" }),
      body: JSON.stringify(args),
    });
  }

  async selectOne(table: string, filters: DatabaseFilters, columns = "*"): Promise<DatabaseRow | null> {
    const rows = await this.selectMany(table, filters, { columns, limit: 1 });
    return rows[0] ?? null;
  }

  async selectMany(
    table: string,
    filters: DatabaseFilters,
    options: { columns?: string; order?: DatabaseOrder[]; limit?: number } = {},
  ): Promise<DatabaseRow[]> {
    this.assertTable(table);
    const params = new URLSearchParams();
    params.set("select", sanitizeColumns(options.columns ?? "*"));
    for (const [column, value] of Object.entries(filters)) {
      if (!/^[a-z_][a-z0-9_]*$/i.test(column)) {
        throw new SupabaseServiceGatewayError("OPERATION_NOT_ALLOWED");
      }
      params.set(column, encodeFilter(value));
    }
    for (const item of options.order ?? []) {
      if (!/^[a-z_][a-z0-9_]*$/i.test(item.column)) {
        throw new SupabaseServiceGatewayError("OPERATION_NOT_ALLOWED");
      }
      params.append("order", `${item.column}.${item.ascending === false ? "desc" : "asc"}`);
    }
    if (options.limit !== undefined) {
      if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 500) {
        throw new SupabaseServiceGatewayError("OPERATION_NOT_ALLOWED");
      }
      params.set("limit", String(options.limit));
    }
    const value = await this.request<unknown>(`${this.endpoint}/${table}?${params.toString()}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!Array.isArray(value) || value.some((row) => !isObject(row))) {
      throw new SupabaseServiceGatewayError("RESPONSE_INVALID");
    }
    return value as DatabaseRow[];
  }

  async count(table: string, filters: DatabaseFilters): Promise<number> {
    this.assertTable(table);
    const params = new URLSearchParams({ select: "event_id", limit: "1" });
    for (const [column, value] of Object.entries(filters)) {
      if (!/^[a-z_][a-z0-9_]*$/i.test(column)) {
        throw new SupabaseServiceGatewayError("OPERATION_NOT_ALLOWED");
      }
      params.set(column, encodeFilter(value));
    }
    const response = await this.rawRequest(`${this.endpoint}/${table}?${params.toString()}`, {
      method: "GET",
      headers: this.headers({ Prefer: "count=exact" }),
    });
    const range = response.headers.get("content-range") ?? "";
    const match = /\/(\d+)$/.exec(range);
    if (!match) throw new SupabaseServiceGatewayError("RESPONSE_INVALID");
    return Number(match[1]);
  }

  private assertTable(table: string): void {
    if (!TABLE_ALLOWLIST.has(table)) throw new SupabaseServiceGatewayError("OPERATION_NOT_ALLOWED");
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.#serviceRoleKey,
      Authorization: `Bearer ${this.#serviceRoleKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...extra,
    };
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const response = await this.rawRequest(url, init);
    if (response.text.trim() === "") return null as T;
    try {
      return JSON.parse(response.text) as T;
    } catch {
      throw new SupabaseServiceGatewayError("RESPONSE_INVALID");
    }
  }

  private async rawRequest(
    url: string,
    init: RequestInit,
  ): Promise<{ readonly headers: Headers; readonly text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#transport.fetch(url, {
        ...init,
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new SupabaseServiceGatewayError("HTTP_FAILURE");
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.includes("application/json")) {
        throw new SupabaseServiceGatewayError("RESPONSE_INVALID");
      }
      return {
        headers: response.headers,
        text: await readBounded(response, this.#maxResponseBytes, controller.signal),
      };
    } catch (error) {
      if (error instanceof SupabaseServiceGatewayError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new SupabaseServiceGatewayError("TIMEOUT");
      }
      throw new SupabaseServiceGatewayError("HTTP_FAILURE");
    } finally {
      clearTimeout(timer);
    }
  }
}
