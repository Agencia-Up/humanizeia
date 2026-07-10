// ============================================================================
// supabase-crm-lead-store.ts — CrmLeadStore REAL (ai_crm_leads via PostgREST).
// FASE 1 do CRM. Ownership em TODA operação: user_id (tenant) + agent_id do
// REF entram como filtro no SELECT e no UPDATE — cross-tenant é fail-closed
// no banco (zero linhas), nunca só na aplicação. HTTPS + host allowlist como
// no SupabaseServiceGateway. NUNCA insere/deleta: update-only (Fase 1).
// ============================================================================
import type { TenantAgentRef } from "../../domain/read-ports.ts";
import { CRM_WRITABLE_COLUMNS, type CrmLeadRow, type CrmLeadStore } from "./crm-write-dispatcher.ts";

export type SupabaseCrmLeadStoreOptions = {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly allowedHosts: readonly string[];
  readonly timeoutMs?: number;
};

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT_COLUMNS = ["id", ...CRM_WRITABLE_COLUMNS].join(",");

export class SupabaseCrmLeadStore implements CrmLeadStore {
  private readonly base: string;
  constructor(private readonly opts: SupabaseCrmLeadStoreOptions) {
    const parsed = new URL(opts.url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("CRM_STORE_URL_INVALID");
    const host = parsed.hostname.toLowerCase();
    if (!opts.allowedHosts.some((h) => h.toLowerCase() === host)) throw new Error("CRM_STORE_HOST_NOT_ALLOWED");
    this.base = `${parsed.origin}/rest/v1/ai_crm_leads`;
  }

  #headers(extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: this.opts.serviceRoleKey,
      authorization: `Bearer ${this.opts.serviceRoleKey}`,
      "content-type": "application/json",
      ...extra,
    };
  }

  #ownershipParams(ref: TenantAgentRef, leadId: string): URLSearchParams | null {
    if (!UUID_RX.test(leadId) || !UUID_RX.test(ref.tenantId) || !UUID_RX.test(ref.agentId)) return null;
    const params = new URLSearchParams();
    params.set("id", `eq.${leadId}`);
    params.set("user_id", `eq.${ref.tenantId}`);
    params.set("agent_id", `eq.${ref.agentId}`);
    return params;
  }

  async fetchOwnedLead(ref: TenantAgentRef, leadId: string): Promise<CrmLeadRow | null> {
    const params = this.#ownershipParams(ref, leadId);
    if (!params) return null;   // id malformado = fail-closed (nunca vira filtro frouxo)
    params.set("select", SELECT_COLUMNS);
    params.set("limit", "1");
    const res = await fetch(`${this.base}?${params}`, {
      headers: this.#headers(),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    });
    if (!res.ok) throw new Error(`CRM_FETCH_HTTP_${res.status}`);
    const rows = await res.json() as Record<string, unknown>[];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0];
    const fields: Record<string, string | null> = {};
    for (const col of CRM_WRITABLE_COLUMNS) {
      const v = row[col];
      fields[col] = typeof v === "string" ? v : v == null ? null : String(v);
    }
    return { id: String(row.id), fields };
  }

  async updateOwnedLead(ref: TenantAgentRef, leadId: string, fields: Record<string, string>): Promise<{ ok: boolean; updatedRows: number; error?: string }> {
    const params = this.#ownershipParams(ref, leadId);
    if (!params) return { ok: false, updatedRows: 0, error: "invalid_ids" };
    // Defesa em profundidade: allowlist de coluna DE NOVO no store (o dispatcher já filtrou).
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (CRM_WRITABLE_COLUMNS.has(k) && typeof v === "string" && v.trim() !== "") body[k] = v;
    }
    if (Object.keys(body).length === 0) return { ok: true, updatedRows: 0 };
    const res = await fetch(`${this.base}?${params}`, {
      method: "PATCH",
      headers: this.#headers({ prefer: "return=representation" }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    });
    if (!res.ok) return { ok: false, updatedRows: 0, error: `http_${res.status}` };
    const rows = await res.json() as unknown[];
    return { ok: true, updatedRows: Array.isArray(rows) ? rows.length : 0 };
  }
}
