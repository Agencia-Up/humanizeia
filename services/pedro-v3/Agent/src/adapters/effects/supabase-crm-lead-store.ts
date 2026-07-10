// ============================================================================
// supabase-crm-lead-store.ts — implementação REAL (ai_crm_leads via PostgREST)
// de DUAS portas com contratos separados (audit Codex):
//  - CrmLeadStore (Fase 1): leitura + UPDATE fill-only. Nunca deleta.
//  - CrmLeadIdentityStore (Opção A): resolução/CRIAÇÃO idempotente da linha
//    mínima do lead — infraestrutura de identidade, nunca decisão da LLM.
// Ownership em TODA seleção final: user_id (tenant) + agent_id do REF (+ jid
// canônico na identidade) — cross-tenant é fail-closed no banco, nunca só na
// aplicação. HTTPS + host allowlist como no SupabaseServiceGateway.
// ============================================================================
import type { TenantAgentRef } from "../../domain/read-ports.ts";
import { canonicalWhatsappRemoteJid } from "../../domain/whatsapp-jid.ts";
import { CRM_WRITABLE_COLUMNS, type CrmLeadRow, type CrmLeadStore } from "./crm-write-dispatcher.ts";
import type { CrmLeadIdentityStore, LeadIdentityResolution } from "./crm-lead-identity-store.ts";

export type SupabaseCrmLeadStoreOptions = {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly allowedHosts: readonly string[];
  readonly timeoutMs?: number;
};

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT_COLUMNS = ["id", ...CRM_WRITABLE_COLUMNS].join(",");

export class SupabaseCrmLeadStore implements CrmLeadStore, CrmLeadIdentityStore {
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

  // ── CrmLeadIdentityStore (Opção A) ──────────────────────────────────────────

  #identityParams(ref: TenantAgentRef, jid: string): URLSearchParams | null {
    if (!UUID_RX.test(ref.tenantId) || !UUID_RX.test(ref.agentId)) return null;
    const params = new URLSearchParams();
    params.set("user_id", `eq.${ref.tenantId}`);
    params.set("agent_id", `eq.${ref.agentId}`);
    params.set("remote_jid", `eq.${jid}`);
    return params;
  }

  async resolveOwnedLead(ref: TenantAgentRef, remoteJid: string): Promise<string | null> {
    const jid = canonicalWhatsappRemoteJid(remoteJid);
    if (!jid) return null;   // jid inválido NUNCA vira consulta (fail-closed)
    const params = this.#identityParams(ref, jid);
    if (!params) return null;
    params.set("select", "id");
    params.set("limit", "1");
    const res = await fetch(`${this.base}?${params}`, {
      headers: this.#headers(),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    });
    if (!res.ok) throw new Error(`CRM_IDENTITY_FETCH_HTTP_${res.status}`);
    const rows = await res.json() as Array<{ id?: unknown }>;
    const id = Array.isArray(rows) && rows.length > 0 ? String(rows[0]?.id ?? "") : "";
    return UUID_RX.test(id) ? id : null;
  }

  // Existe (agent_id, remote_jid) fora do tenant do ref? Só CONTA (HEAD) — nunca
  // lê dados de outro tenant. Usado p/ distinguir conflito de tenant de transiente.
  async #foreignRowExists(ref: TenantAgentRef, jid: string): Promise<boolean> {
    const params = new URLSearchParams();
    params.set("agent_id", `eq.${ref.agentId}`);
    params.set("remote_jid", `eq.${jid}`);
    params.set("select", "id");
    const res = await fetch(`${this.base}?${params}`, {
      method: "HEAD",
      headers: this.#headers({ prefer: "count=exact", range: "0-0" }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    });
    if (!res.ok) throw new Error(`CRM_IDENTITY_COUNT_HTTP_${res.status}`);
    const range = res.headers.get("content-range") ?? "";
    const total = Number(range.split("/")[1] ?? "0");
    return Number.isFinite(total) && total > 0;
  }

  async ensureOwnedLead(ref: TenantAgentRef, remoteJid: string): Promise<LeadIdentityResolution> {
    const jid = canonicalWhatsappRemoteJid(remoteJid);
    if (!jid || !UUID_RX.test(ref.tenantId) || !UUID_RX.test(ref.agentId)) return { ok: false, reason: "invalid_jid" };
    try {
      const existing = await this.resolveOwnedLead(ref, jid);
      if (existing) return { ok: true, leadId: existing, created: false };

      // INSERT mínimo idempotente na unique REAL (agent_id, remote_jid). ignore-duplicates:
      // se outro worker ganhar a corrida, o insert volta vazio — por isso o UUID NUNCA sai
      // daqui; sai do SELECT final owned abaixo. `origem` fica NULL de propósito (nunca
      // inventada; o crm_write fill-only a preenche quando houver adContext factual).
      const now = new Date().toISOString();
      const insert = await fetch(`${this.base}?on_conflict=agent_id,remote_jid`, {
        method: "POST",
        headers: this.#headers({ prefer: "resolution=ignore-duplicates,return=minimal" }),
        body: JSON.stringify({
          user_id: ref.tenantId,
          agent_id: ref.agentId,
          remote_jid: jid,
          lead_name: "Lead",          // placeholder promovível (contrato lead_name: nunca regride nome real)
          status: "novo",
          status_crm: "novo",
          message_count: 1,
          followup_5min_sent: false,
          last_user_reply_at: now,
          last_interaction_at: now,
        }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      });
      if (!insert.ok && insert.status !== 409) return { ok: false, reason: "transient" };

      // Seleção FINAL sempre owned (tenant+agent+jid) — a única fonte do UUID.
      const confirmed = await this.resolveOwnedLead(ref, jid);
      if (confirmed) return { ok: true, leadId: confirmed, created: insert.ok };

      // Insert "ok" mas nada owned: a linha (agent_id, remote_jid) pertence a OUTRO tenant.
      const foreign = await this.#foreignRowExists(ref, jid);
      return foreign ? { ok: false, reason: "foreign_tenant_conflict" } : { ok: false, reason: "transient" };
    } catch {
      return { ok: false, reason: "transient" };
    }
  }

  async resolveOrEnsureOwnedLead(ref: TenantAgentRef, remoteJid: string): Promise<LeadIdentityResolution> {
    return this.ensureOwnedLead(ref, remoteJid);   // ensure já começa pelo resolve (caminho único)
  }
}
