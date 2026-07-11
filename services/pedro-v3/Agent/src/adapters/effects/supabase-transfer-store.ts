// ============================================================================
// supabase-transfer-store.ts — implementação REAL do TransferSagaStore via
// PostgREST (mesmo padrão de segurança do SupabaseCrmLeadStore: HTTPS + host
// allowlist + service key da composição + UUIDs validados + ownership em toda
// seleção/escrita). Tabelas: wa_ai_agents (config), ai_crm_leads (claim/summary),
// ai_team_members (roster/contador), ai_lead_transfers (pendente/confirmada).
// COMPATIBILIDADE (Fase 0/M3): os shapes escritos aqui são EXATAMENTE os que a
// máquina v2 de aceite/rotação (pedro-seller-ack "Ok", cron SEÇÃO 1 e
// transfer-timeout-checker) espera — v3 cria a pendente; a rotação é do v2.
// ============================================================================
import type { TenantAgentRef } from "../../domain/read-ports.ts";
import type { SellerCandidate } from "../../engine/transfer-templates.ts";
import { resolveAutomationRules } from "../../engine/automation-rules.ts";
import type {
  InsertTransferInput, TransferAgentConfig, TransferLeadRow, TransferRow, TransferSagaStore,
} from "./transfer-store.ts";

export type SupabaseTransferStoreOptions = {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly allowedHosts: readonly string[];
  readonly timeoutMs?: number;
};

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CRM_SUMMARY_PREFIX = "[Pedro v3]";

function normalizePhoneDigits(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function sellerFromRow(row: Record<string, unknown>): SellerCandidate {
  return {
    id: String(row.id ?? ""),
    name: typeof row.name === "string" ? row.name : null,
    whatsappNumber: typeof row.whatsapp_number === "string" ? row.whatsapp_number : null,
    isActive: row.is_active === true,
    agentId: typeof row.agent_id === "string" ? row.agent_id : null,
    lastLeadReceivedAt: typeof row.last_lead_received_at === "string" ? row.last_lead_received_at : null,
    totalLeadsReceived: typeof row.total_leads_received === "number" && Number.isFinite(row.total_leads_received)
      ? row.total_leads_received : 0,
  };
}

function transferFromRow(row: Record<string, unknown>): TransferRow {
  return {
    id: String(row.id ?? ""),
    toMemberId: typeof row.to_member_id === "string" ? row.to_member_id : null,
    transferStatus: typeof row.transfer_status === "string" ? row.transfer_status : null,
    isConfirmed: row.is_confirmed === true,
    reason: typeof row.transfer_reason === "string" ? row.transfer_reason : null,
    notes: typeof row.notes === "string" ? row.notes : null,
    confirmationTimeoutAt: typeof row.confirmation_timeout_at === "string" ? row.confirmation_timeout_at : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
  };
}

export class SupabaseTransferStore implements TransferSagaStore {
  private readonly origin: string;
  constructor(private readonly opts: SupabaseTransferStoreOptions) {
    const parsed = new URL(opts.url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("TRANSFER_STORE_URL_INVALID");
    const host = parsed.hostname.toLowerCase();
    if (!opts.allowedHosts.some((h) => h.toLowerCase() === host)) throw new Error("TRANSFER_STORE_HOST_NOT_ALLOWED");
    this.origin = parsed.origin;
  }

  #headers(extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: this.opts.serviceRoleKey,
      authorization: `Bearer ${this.opts.serviceRoleKey}`,
      "content-type": "application/json",
      ...extra,
    };
  }
  #url(table: string, params: URLSearchParams): string {
    return `${this.origin}/rest/v1/${table}?${params}`;
  }
  #signal(): AbortSignal {
    return AbortSignal.timeout(this.opts.timeoutMs ?? 10_000);
  }
  async #getRows(table: string, params: URLSearchParams): Promise<Record<string, unknown>[]> {
    const res = await fetch(this.#url(table, params), { headers: this.#headers(), signal: this.#signal() });
    if (!res.ok) throw new Error(`TRANSFER_${table.toUpperCase()}_HTTP_${res.status}`);
    const rows = await res.json();
    return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
  }

  async loadAgentConfig(ref: TenantAgentRef): Promise<TransferAgentConfig | null> {
    if (!UUID_RX.test(ref.tenantId) || !UUID_RX.test(ref.agentId)) return null;
    const params = new URLSearchParams();
    params.set("id", `eq.${ref.agentId}`);
    params.set("user_id", `eq.${ref.tenantId}`);
    params.set("select", "name,automation_rules,briefing_template_vendedor,briefing_template_gerente,mensagens_sem_emoji,gerente_feedback_completo,gerente_phone,gerente_phone_2");
    params.set("limit", "1");
    const rows = await this.#getRows("wa_ai_agents", params);
    if (rows.length === 0) return null;
    const row = rows[0];
    const gerentes = [row.gerente_phone, row.gerente_phone_2]
      .map((p) => normalizePhoneDigits(p))
      .filter((p) => p.length >= 12 && p.length <= 13);
    return {
      agentName: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Agente",
      rules: resolveAutomationRules(row.automation_rules),
      briefingTemplateVendedor: typeof row.briefing_template_vendedor === "string" ? row.briefing_template_vendedor : null,
      briefingTemplateGerente: typeof row.briefing_template_gerente === "string" ? row.briefing_template_gerente : null,
      mensagensSemEmoji: row.mensagens_sem_emoji === true,
      gerenteFeedbackCompleto: row.gerente_feedback_completo === true,
      gerentePhones: gerentes,
    };
  }

  async fetchOwnedLeadForTransfer(ref: TenantAgentRef, leadId: string): Promise<TransferLeadRow | null> {
    if (!UUID_RX.test(leadId) || !UUID_RX.test(ref.tenantId) || !UUID_RX.test(ref.agentId)) return null;
    const params = new URLSearchParams();
    params.set("id", `eq.${leadId}`);
    params.set("user_id", `eq.${ref.tenantId}`);
    params.set("agent_id", `eq.${ref.agentId}`);
    params.set("select", "id,status,assigned_to_id,lead_name,remote_jid,summary");
    params.set("limit", "1");
    const rows = await this.#getRows("ai_crm_leads", params);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: String(row.id),
      status: typeof row.status === "string" ? row.status : null,
      assignedToId: typeof row.assigned_to_id === "string" ? row.assigned_to_id : null,
      leadName: typeof row.lead_name === "string" ? row.lead_name : null,
      remoteJid: typeof row.remote_jid === "string" ? row.remote_jid : null,
      summary: typeof row.summary === "string" ? row.summary : null,
    };
  }

  async fetchSellerById(tenantId: string, sellerId: string): Promise<SellerCandidate | null> {
    if (!UUID_RX.test(tenantId) || !UUID_RX.test(sellerId)) return null;
    const params = new URLSearchParams();
    params.set("id", `eq.${sellerId}`);
    params.set("user_id", `eq.${tenantId}`);
    params.set("select", "id,name,whatsapp_number,is_active,agent_id,last_lead_received_at,total_leads_received");
    params.set("limit", "1");
    const rows = await this.#getRows("ai_team_members", params);
    return rows.length > 0 ? sellerFromRow(rows[0]) : null;
  }

  async findPreviousSellerId(tenantId: string, remoteJid: string, currentLeadId: string): Promise<string | null> {
    if (!UUID_RX.test(tenantId) || !remoteJid.trim()) return null;
    // (a) leads anteriores do MESMO contato (tenant-wide, como o v2 — qualquer agente).
    const leadParams = new URLSearchParams();
    leadParams.set("user_id", `eq.${tenantId}`);
    leadParams.set("remote_jid", `eq.${remoteJid}`);
    leadParams.set("select", "id,assigned_to_id,created_at,last_interaction_at");
    leadParams.set("order", "created_at.desc");
    leadParams.set("limit", "25");
    const leads = await this.#getRows("ai_crm_leads", leadParams);
    const candidates = leads.filter((l) => String(l.id) !== currentLeadId);
    const candidateIds = candidates.map((l) => String(l.id)).filter((id) => UUID_RX.test(id));
    // (b) último transfer CONFIRMADO desses leads.
    if (candidateIds.length > 0) {
      const tParams = new URLSearchParams();
      tParams.set("lead_id", `in.(${candidateIds.join(",")})`);
      tParams.set("transfer_status", "eq.confirmed");
      tParams.set("select", "lead_id,to_member_id,created_at");
      tParams.set("order", "created_at.desc");
      tParams.set("limit", "25");
      const transfers = await this.#getRows("ai_lead_transfers", tParams);
      const confirmed = transfers.find((t) => typeof t.to_member_id === "string" && UUID_RX.test(String(t.to_member_id)));
      if (confirmed) return String(confirmed.to_member_id);
    }
    // (c) assigned_to_id mais recente entre os leads anteriores.
    const assigned = candidates
      .filter((l) => typeof l.assigned_to_id === "string" && UUID_RX.test(String(l.assigned_to_id)))
      .sort((a, b) => Date.parse(String(b.last_interaction_at ?? b.created_at ?? 0)) - Date.parse(String(a.last_interaction_at ?? a.created_at ?? 0)))[0];
    return assigned ? String(assigned.assigned_to_id) : null;
  }

  async listActiveSellers(tenantId: string, agentId: string | null): Promise<readonly SellerCandidate[]> {
    if (!UUID_RX.test(tenantId) || (agentId !== null && !UUID_RX.test(agentId))) return [];
    const params = new URLSearchParams();
    params.set("user_id", `eq.${tenantId}`);
    params.set("is_active", "eq.true");
    if (agentId !== null) params.set("agent_id", `eq.${agentId}`);
    params.set("select", "id,name,whatsapp_number,is_active,agent_id,last_lead_received_at,total_leads_received");
    params.set("limit", "50");
    const rows = await this.#getRows("ai_team_members", params);
    return rows.map(sellerFromRow);
  }

  async latestTransferForLead(ref: TenantAgentRef, leadId: string): Promise<TransferRow | null> {
    if (!UUID_RX.test(leadId) || !UUID_RX.test(ref.tenantId) || !UUID_RX.test(ref.agentId)) return null;
    const owned = await this.fetchOwnedLeadForTransfer(ref, leadId);
    if (!owned) return null;
    const params = new URLSearchParams();
    params.set("lead_id", `eq.${leadId}`);
    params.set("select", "id,to_member_id,transfer_status,is_confirmed,transfer_reason,notes,confirmation_timeout_at,created_at");
    params.set("order", "created_at.desc");
    params.set("limit", "1");
    const rows = await this.#getRows("ai_lead_transfers", params);
    return rows.length > 0 ? transferFromRow(rows[0]) : null;
  }

  async transferForCorrelation(ref: TenantAgentRef, leadId: string, correlationId: string): Promise<TransferRow | null> {
    if (!UUID_RX.test(leadId) || !UUID_RX.test(ref.tenantId) || !UUID_RX.test(ref.agentId) || !correlationId.trim()) return null;
    const owned = await this.fetchOwnedLeadForTransfer(ref, leadId);
    if (!owned) return null;
    const params = new URLSearchParams();
    params.set("user_id", `eq.${ref.tenantId}`);
    params.set("lead_id", `eq.${leadId}`);
    params.set("transfer_reason", `like.*[${correlationId}]*`);
    params.set("select", "id,to_member_id,transfer_status,is_confirmed,transfer_reason,notes,confirmation_timeout_at,created_at");
    params.set("order", "created_at.desc");
    params.set("limit", "1");
    const rows = await this.#getRows("ai_lead_transfers", params);
    return rows.length > 0 ? transferFromRow(rows[0]) : null;
  }

  async activePendingForLead(ref: TenantAgentRef, leadId: string): Promise<TransferRow | null> {
    if (!UUID_RX.test(leadId) || !UUID_RX.test(ref.tenantId) || !UUID_RX.test(ref.agentId)) return null;
    const owned = await this.fetchOwnedLeadForTransfer(ref, leadId);
    if (!owned) return null;
    const params = new URLSearchParams();
    params.set("lead_id", `eq.${leadId}`);
    params.set("transfer_status", "eq.pending");
    params.set("is_confirmed", "eq.false");
    params.set("select", "id,to_member_id,transfer_status,is_confirmed,transfer_reason,notes,confirmation_timeout_at,created_at");
    params.set("order", "created_at.desc");
    params.set("limit", "1");
    const rows = await this.#getRows("ai_lead_transfers", params);
    return rows.length > 0 ? transferFromRow(rows[0]) : null;
  }

  async claimLeadForTransfer(ref: TenantAgentRef, leadId: string, nowIso: string): Promise<boolean> {
    if (!UUID_RX.test(leadId) || !UUID_RX.test(ref.tenantId) || !UUID_RX.test(ref.agentId)) return false;
    const params = new URLSearchParams();
    params.set("id", `eq.${leadId}`);
    params.set("user_id", `eq.${ref.tenantId}`);
    params.set("agent_id", `eq.${ref.agentId}`);
    params.set("assigned_to_id", "is.null");
    const res = await fetch(this.#url("ai_crm_leads", params), {
      method: "PATCH",
      headers: this.#headers({ prefer: "return=representation" }),
      // M3 (Fase 0): status='transferido' é OBRIGATÓRIO p/ a rotação v2 não expirar a pendente
      // (defesa 1 da SEÇÃO 1 exige qualificado|transferido). NÃO grava origem (v3 nunca inventa).
      body: JSON.stringify({ status: "transferido", last_interaction_at: nowIso }),
      signal: this.#signal(),
    });
    if (!res.ok) throw new Error(`TRANSFER_CLAIM_HTTP_${res.status}`);
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  }

  async revertLeadClaim(ref: TenantAgentRef, leadId: string, previousStatus: string | null): Promise<void> {
    if (!UUID_RX.test(leadId) || !UUID_RX.test(ref.tenantId) || !UUID_RX.test(ref.agentId)) return;
    const params = new URLSearchParams();
    params.set("id", `eq.${leadId}`);
    params.set("user_id", `eq.${ref.tenantId}`);
    params.set("agent_id", `eq.${ref.agentId}`);
    params.set("status", "eq.transferido");     // CAS: só reverte se AINDA está como nós deixamos
    params.set("assigned_to_id", "is.null");
    try {
      await fetch(this.#url("ai_crm_leads", params), {
        method: "PATCH",
        headers: this.#headers({ prefer: "return=minimal" }),
        body: JSON.stringify({ status: previousStatus || "novo" }),
        signal: this.#signal(),
      });
    } catch { /* best-effort: falha fica observável pelo estado 'transferido' sem pendente */ }
  }

  async insertTransfer(input: InsertTransferInput): Promise<string | null> {
    if (!UUID_RX.test(input.userId) || !UUID_RX.test(input.leadId) || !UUID_RX.test(input.toMemberId)) return null;
    const res = await fetch(`${this.origin}/rest/v1/ai_lead_transfers`, {
      method: "POST",
      headers: this.#headers({ prefer: "return=representation" }),
      body: JSON.stringify({
        user_id: input.userId,
        lead_id: input.leadId,
        to_member_id: input.toMemberId,
        transfer_reason: input.reason.slice(0, 200),
        notes: input.notes.slice(0, 4000),
        transfer_status: input.status,
        is_confirmed: input.isConfirmed,
        ...(input.confirmedAt ? { confirmed_at: input.confirmedAt } : {}),
        confirmation_timeout_at: input.confirmationTimeoutAt,
      }),
      signal: this.#signal(),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    const id = Array.isArray(rows) && rows.length > 0 ? String(rows[0]?.id ?? "") : "";
    return UUID_RX.test(id) ? id : null;
  }

  async updateLeadSummaryGuarded(ref: TenantAgentRef, leadId: string, summary: string): Promise<void> {
    if (!UUID_RX.test(leadId) || !summary.trim()) return;
    try {
      const lead = await this.fetchOwnedLeadForTransfer(ref, leadId);
      if (!lead) return;
      const current = String(lead.summary ?? "").trim();
      // Mesma regra do crm_write: só vazio ou autoria própria "[Pedro v3]" pode ser atualizado.
      if (current !== "" && !current.startsWith(CRM_SUMMARY_PREFIX)) return;
      const value = summary.startsWith(CRM_SUMMARY_PREFIX) ? summary : `${CRM_SUMMARY_PREFIX} ${summary}`;
      const params = new URLSearchParams();
      params.set("id", `eq.${leadId}`);
      params.set("user_id", `eq.${ref.tenantId}`);
      params.set("agent_id", `eq.${ref.agentId}`);
      await fetch(this.#url("ai_crm_leads", params), {
        method: "PATCH",
        headers: this.#headers({ prefer: "return=minimal" }),
        body: JSON.stringify({ summary: value.slice(0, 4000) }),
        signal: this.#signal(),
      });
    } catch { /* best-effort: summary nunca derruba a transferência */ }
  }

  async markSellerReceivedLead(sellerId: string, nowIso: string): Promise<void> {
    if (!UUID_RX.test(sellerId)) return;
    // CAS otimista no contador (mission: sem lost update). 2 tentativas; falha final é
    // best-effort (last_lead_received_at ainda é gravado na tentativa seguinte do rodízio).
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const params = new URLSearchParams();
        params.set("id", `eq.${sellerId}`);
        params.set("select", "total_leads_received");
        params.set("limit", "1");
        const rows = await this.#getRows("ai_team_members", params);
        const current = rows.length > 0 && typeof rows[0].total_leads_received === "number"
          ? rows[0].total_leads_received as number : 0;
        const patch = new URLSearchParams();
        patch.set("id", `eq.${sellerId}`);
        patch.set("total_leads_received", `eq.${current}`);
        const res = await fetch(this.#url("ai_team_members", patch), {
          method: "PATCH",
          headers: this.#headers({ prefer: "return=representation" }),
          body: JSON.stringify({ last_lead_received_at: nowIso, total_leads_received: current + 1 }),
          signal: this.#signal(),
        });
        if (!res.ok) return;
        const updated = await res.json();
        if (Array.isArray(updated) && updated.length > 0) return;   // CAS venceu
      } catch { return; }
    }
  }

  async releaseLeadAssignment(ref: TenantAgentRef, leadId: string): Promise<void> {
    if (!UUID_RX.test(leadId) || !UUID_RX.test(ref.tenantId) || !UUID_RX.test(ref.agentId)) return;
    try {
      const params = new URLSearchParams();
      params.set("id", `eq.${leadId}`);
      params.set("user_id", `eq.${ref.tenantId}`);
      params.set("agent_id", `eq.${ref.agentId}`);
      await fetch(this.#url("ai_crm_leads", params), {
        method: "PATCH",
        headers: this.#headers({ prefer: "return=minimal" }),
        body: JSON.stringify({ assigned_to_id: null }),
        signal: this.#signal(),
      });
    } catch { /* best-effort */ }
  }
}
