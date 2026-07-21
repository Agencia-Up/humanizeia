// supabase-read-database.ts — F2.5.4A / A.1
//
// Wrapper REAL read-only do Supabase (PostgREST) atrás do contrato `V2ReadDatabase`.
// Não importa o SDK `@supabase/*` e não chama `fetch` diretamente — usa um
// `HttpTransport` injetável. Em teste o transporte é um fake; em produção é o
// `RealHttpTransport`. NESTA FATIA nada roda contra o Supabase remoto.
//
// A.1 — endurecimentos da auditoria:
//  - MATRIZ ESTRITA por (tabela, operação, colunas, filtros) — não há allowlist global.
//    `api_key_encrypted`/`api_key` so podem ser lidos em projections especificas:
//    platform_integrations/selectOne com id+user_id+is_active=true, ou
//    wa_instances/selectOne com id+user_id. PROIBIDO em selectMany e fora da matriz.
//  - corpo limitado por bytes (header content-length E leitura real em stream);
//  - projeção LOCAL: cada linha é reduzida às colunas pedidas (sem vazar campos extras);
//  - rejeição ATÔMICA se qualquer linha não for objeto válido (nada de filtrar-e-ignorar);
//  - chave 100% PRIVADA (`#apiKey`) materializada só dentro do adapter — sem método público.

import type { HttpTransport } from "./http-client.ts";
import { RealHttpTransport } from "./http-client.ts";
import type {
  V2ColumnName,
  V2ReadDatabase,
  V2TableName,
  V2WhereEquals,
} from "./supabase-v2-read-adapter.ts";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024; // 4 MB — leituras de config são pequenas

type ReadOp = "selectOne" | "selectMany";

type Capability = {
  readonly table: V2TableName;
  readonly op: ReadOp;
  readonly allowedColumns: ReadonlySet<V2ColumnName>;
  readonly allowedFilterColumns: ReadonlySet<V2ColumnName>;
  readonly requiredStringFilters: readonly V2ColumnName[]; // presentes + string não-vazia
  readonly requiredTrueFilters: readonly V2ColumnName[]; // presentes + === true
  readonly allowsSecret: boolean; // api_key_encrypted permitido
};

function set(cols: readonly V2ColumnName[]): ReadonlySet<V2ColumnName> {
  return new Set(cols);
}

const AGENT_COLUMNS: readonly V2ColumnName[] = [
  "id", "user_id", "instance_id", "name",
  "agent_type", "system_prompt", "use_funnel_config", "company_name",
  "model", "temperature", "sdr_goal", "qualification_questions", "sells_motorcycles",
  "blocked_categories", "rag_restricted", "is_active", "updated_at",
  "business_hours_only", "business_hours_start", "business_hours_end", "automation_rules",
];
const FUNNEL_COLUMNS: readonly V2ColumnName[] = ["agent_id", "user_id", "generated_system_prompt", "tenant_policies", "updated_at"];
const METADATA_COLUMNS: readonly V2ColumnName[] = ["id", "user_id", "platform", "is_active", "updated_at"];
const SECRET_COLUMNS: readonly V2ColumnName[] = ["id", "user_id", "platform", "api_key_encrypted", "is_active"];
const WA_INSTANCE_COLUMNS: readonly V2ColumnName[] = ["id", "user_id", "instance_name", "api_url", "provider"];
const WA_INSTANCE_SECRET_COLUMNS: readonly V2ColumnName[] = ["id", "user_id", "provider", "api_key_encrypted", "api_key"];
const CRM_COLUMNS: readonly V2ColumnName[] = [
  "id", "user_id", "agent_id", "lead_name", "client_name", "vehicle_interest", "stage", "created_at", "updated_at",
];

// MATRIZ AUTORITATIVA: cada leitura precisa casar EXATAMENTE uma capability.
const CAPABILITIES: readonly Capability[] = Object.freeze([
  {
    table: "wa_ai_agents", op: "selectOne",
    allowedColumns: set(AGENT_COLUMNS), allowedFilterColumns: set(["id", "user_id"]),
    requiredStringFilters: ["id", "user_id"], requiredTrueFilters: [], allowsSecret: false,
  },
  {
    table: "agent_funnel_config", op: "selectOne",
    allowedColumns: set(FUNNEL_COLUMNS), allowedFilterColumns: set(["agent_id", "user_id"]),
    requiredStringFilters: ["agent_id", "user_id"], requiredTrueFilters: [], allowsSecret: false,
  },
  {
    table: "platform_integrations", op: "selectMany",
    allowedColumns: set(METADATA_COLUMNS), allowedFilterColumns: set(["user_id", "is_active"]),
    requiredStringFilters: ["user_id"], requiredTrueFilters: ["is_active"], allowsSecret: false,
  },
  {
    table: "platform_integrations", op: "selectOne",
    allowedColumns: set(SECRET_COLUMNS), allowedFilterColumns: set(["id", "user_id", "is_active"]),
    requiredStringFilters: ["id", "user_id"], requiredTrueFilters: ["is_active"], allowsSecret: true,
  },
  {
    table: "wa_instances", op: "selectOne",
    allowedColumns: set(WA_INSTANCE_COLUMNS), allowedFilterColumns: set(["id", "user_id"]),
    requiredStringFilters: ["id", "user_id"], requiredTrueFilters: [], allowsSecret: false,
  },
  {
    table: "wa_instances", op: "selectOne",
    allowedColumns: set(WA_INSTANCE_SECRET_COLUMNS), allowedFilterColumns: set(["id", "user_id"]),
    requiredStringFilters: ["id", "user_id"], requiredTrueFilters: [], allowsSecret: true,
  },  {
    table: "ai_crm_leads", op: "selectOne",
    allowedColumns: set(CRM_COLUMNS), allowedFilterColumns: set(["id", "user_id", "agent_id"]),
    requiredStringFilters: ["id", "user_id", "agent_id"], requiredTrueFilters: [], allowsSecret: false,
  },
]);

export type SupabaseReadConfigCode =
  | "SUPABASE_URL_INVALID"
  | "SUPABASE_URL_NOT_HTTPS"
  | "SUPABASE_HOST_NOT_ALLOWED"
  | "SUPABASE_KEY_MISSING"
  | "SUPABASE_ALLOWED_HOSTS_MISSING";

export class SupabaseReadConfigError extends Error {
  constructor(public readonly code: SupabaseReadConfigCode) {
    super(code);
    this.name = "SupabaseReadConfigError";
  }
}

function sanitizedFailure(): Error {
  // Mensagem fixa: nunca contém URL, token, corpo de resposta nem segredo.
  return new Error("SUPABASE_READ_FAILURE");
}

class OptionalFunnelColumnMissingError extends Error {
  constructor() {
    super("OPTIONAL_FUNNEL_COLUMN_MISSING");
    this.name = "OptionalFunnelColumnMissingError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeWhereValue(value: string | boolean): string {
  return encodeURIComponent(typeof value === "boolean" ? String(value) : value);
}

export type SupabaseReadInput = {
  readonly url: string;
  readonly apiKey: string;
  readonly allowedHosts: readonly string[];
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
};

export class SupabaseReadOnlyDatabase implements V2ReadDatabase {
  readonly endpoint: string; // metadados públicos (sem segredo)
  readonly host: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly #apiKey: string; // PRIVADO de verdade (runtime), nunca exposto
  readonly #transport: HttpTransport;

  private constructor(endpoint: string, host: string, timeoutMs: number, maxResponseBytes: number, apiKey: string, transport: HttpTransport) {
    this.endpoint = endpoint;
    this.host = host;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
    this.#apiKey = apiKey;
    this.#transport = transport;
  }

  // Único ponto de entrada: valida HTTPS + host permitido + chave presente (fail-closed).
  static create(input: SupabaseReadInput, transport: HttpTransport = new RealHttpTransport()): SupabaseReadOnlyDatabase {
    if (!Array.isArray(input?.allowedHosts) || input.allowedHosts.length === 0) {
      throw new SupabaseReadConfigError("SUPABASE_ALLOWED_HOSTS_MISSING");
    }
    if (typeof input?.apiKey !== "string" || input.apiKey.trim() === "") {
      throw new SupabaseReadConfigError("SUPABASE_KEY_MISSING");
    }
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      throw new SupabaseReadConfigError("SUPABASE_URL_INVALID");
    }
    if (parsed.protocol !== "https:") throw new SupabaseReadConfigError("SUPABASE_URL_NOT_HTTPS");
    const host = parsed.hostname.toLowerCase();
    if (!new Set(input.allowedHosts.map((h) => h.toLowerCase())).has(host)) {
      throw new SupabaseReadConfigError("SUPABASE_HOST_NOT_ALLOWED");
    }
    const timeoutMs = typeof input.timeoutMs === "number" && input.timeoutMs > 0 ? input.timeoutMs : DEFAULT_TIMEOUT_MS;
    const maxBytes = typeof input.maxResponseBytes === "number" && input.maxResponseBytes > 0 ? input.maxResponseBytes : DEFAULT_MAX_RESPONSE_BYTES;
    return new SupabaseReadOnlyDatabase(`https://${host}/rest/v1`, host, timeoutMs, maxBytes, input.apiKey.trim(), transport);
  }

  // Serialização segura: somente metadados públicos, NUNCA a chave.
  toJSON(): { host: string; endpoint: string; timeoutMs: number } {
    return { host: this.host, endpoint: this.endpoint, timeoutMs: this.timeoutMs };
  }

  async selectOne(table: V2TableName, columns: readonly V2ColumnName[], where: V2WhereEquals): Promise<Record<string, unknown> | null> {
    let rows: Record<string, unknown>[];
    try {
      rows = await this.query(table, "selectOne", columns, where, 1);
    } catch (error) {
      // Rolling deploy compatibility: the policy column is additive. Until its
      // migration reaches every Supabase project, keep reading the portal prompt.
      if (!(error instanceof OptionalFunnelColumnMissingError)
        || table !== "agent_funnel_config"
        || !columns.includes("tenant_policies")) throw error;
      const legacyColumns = columns.filter((column) => column !== "tenant_policies");
      rows = await this.query(table, "selectOne", legacyColumns, where, 1);
    }
    return rows[0] ?? null;
  }

  async selectMany(table: V2TableName, columns: readonly V2ColumnName[], where: V2WhereEquals): Promise<readonly Record<string, unknown>[]> {
    return this.query(table, "selectMany", columns, where, null);
  }

  #authHeaders(): Record<string, string> {
    return { apikey: this.#apiKey, Authorization: `Bearer ${this.#apiKey}`, Accept: "application/json" };
  }

  // Casa a leitura contra a MATRIZ. Sem capability correspondente → fail-closed.
  private matchCapability(table: V2TableName, op: ReadOp, columns: readonly V2ColumnName[], where: V2WhereEquals): Capability {
    if (columns.length === 0) throw sanitizedFailure();
    const usesSecret = columns.includes("api_key_encrypted") || columns.includes("api_key");
    for (const cap of CAPABILITIES) {
      if (cap.table !== table || cap.op !== op) continue;
      if (usesSecret && !cap.allowsSecret) continue;
      if (!columns.every((c) => cap.allowedColumns.has(c))) continue;
      if (!Object.keys(where).every((k) => cap.allowedFilterColumns.has(k as V2ColumnName))) continue;
      if (!cap.requiredStringFilters.every((c) => typeof where[c] === "string" && (where[c] as string).trim() !== "")) continue;
      if (!cap.requiredTrueFilters.every((c) => where[c] === true)) continue;
      return cap;
    }
    throw sanitizedFailure();
  }

  private buildUrl(table: V2TableName, columns: readonly V2ColumnName[], where: V2WhereEquals, limit: number | null): string {
    const params: string[] = [`select=${columns.map((c) => encodeURIComponent(c)).join(",")}`];
    for (const [key, value] of Object.entries(where)) {
      if (typeof value !== "string" && typeof value !== "boolean") throw sanitizedFailure();
      params.push(`${encodeURIComponent(key)}=eq.${encodeWhereValue(value)}`);
    }
    if (limit !== null) params.push(`limit=${limit}`);
    return `${this.endpoint}/${table}?${params.join("&")}`;
  }

  // Lê o corpo com limite REAL de bytes (header + stream). Erros sanitizados.
  private async readBounded(res: Response, signal: AbortSignal): Promise<string> {
    const cl = res.headers.get("content-length");
    if (cl) {
      const n = Number(cl);
      if (Number.isFinite(n) && n > this.maxResponseBytes) throw sanitizedFailure();
    }
    const reader = res.body?.getReader();
    if (!reader) {
      if (signal.aborted) throw sanitizedFailure();
      const text = await Promise.race([
        res.text(),
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(sanitizedFailure()), { once: true });
        }),
      ]);
      if (Buffer.byteLength(text) > this.maxResponseBytes) throw sanitizedFailure();
      return text;
    }

    let rejectOnAbort: ((reason?: unknown) => void) | null = null;
    const aborted = new Promise<never>((_, reject) => {
      rejectOnAbort = reject;
    });
    const onAbort = () => {
      void reader.cancel("SUPABASE_READ_TIMEOUT").catch(() => undefined);
      rejectOnAbort?.(sanitizedFailure());
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });

    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        if (value) {
          bytes += value.byteLength;
          if (bytes > this.maxResponseBytes) throw sanitizedFailure();
          chunks.push(value);
        }
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        void reader.cancel("SUPABASE_READ_TIMEOUT").catch(() => undefined);
      }
      try { reader.releaseLock(); } catch { /* pending read is being cancelled */ }
    }
    const out = new Uint8Array(bytes);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    return new TextDecoder().decode(out);
  }

  private async query(
    table: V2TableName,
    op: ReadOp,
    columns: readonly V2ColumnName[],
    where: V2WhereEquals,
    limit: number | null,
  ): Promise<Record<string, unknown>[]> {
    this.matchCapability(table, op, columns, where); // fail-closed se não casar a matriz
    const url = this.buildUrl(table, columns, where, limit);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.#transport.fetch(url, { method: "GET", headers: this.#authHeaders(), redirect: "error", signal: controller.signal });
    } catch {
      clearTimeout(timer);
      throw sanitizedFailure();
    }

    try {
      if (!res.ok) {
        const errorBody = await this.readBounded(res, controller.signal).catch(() => "");
        if (res.status === 400 && errorBody.includes("column agent_funnel_config.tenant_policies does not exist")) {
          throw new OptionalFunnelColumnMissingError();
        }
        throw sanitizedFailure();
      }
      if (!(res.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) throw sanitizedFailure();

      const text = await this.readBounded(res, controller.signal);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw sanitizedFailure();
      }
      if (!Array.isArray(body)) throw sanitizedFailure();

      // Rejeição ATÔMICA: qualquer linha malformada invalida toda a resposta.
      for (const row of body) {
        if (!isPlainObject(row)) throw sanitizedFailure();
      }

      // Projeção LOCAL: só as colunas pedidas; campos extras do servidor são descartados.
      return (body as Record<string, unknown>[]).map((row) => {
        const projected: Record<string, unknown> = {};
        for (const col of columns) {
          if (Object.prototype.hasOwnProperty.call(row, col)) projected[col] = row[col];
        }
        return projected;
      });
    } catch (error) {
      if (error instanceof OptionalFunnelColumnMissingError) throw error;
      throw sanitizedFailure();
    } finally {
      // O deadline cobre fetch, headers e o consumo COMPLETO do corpo.
      clearTimeout(timer);
    }
  }
}
