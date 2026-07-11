// ============================================================================
// transfer-store.ts — PORTAS da saga de transferência (HF-3). Contratos puros;
// a implementação real (PostgREST) fica em supabase-transfer-store.ts e os
// FAKEs de teste implementam as mesmas interfaces. Toda seleção/escrita é
// ownership-scoped (user_id/agent_id do REF da composição — nunca do payload).
// ============================================================================
import type { TenantAgentRef } from "../../domain/read-ports.ts";
import type { SellerCandidate } from "../../engine/transfer-templates.ts";
import type { AutomationRules } from "../../engine/automation-rules.ts";

export type TransferLeadRow = {
  readonly id: string;
  readonly status: string | null;
  readonly assignedToId: string | null;
  readonly leadName: string | null;
  readonly remoteJid: string | null;
  readonly summary: string | null;
};

export type TransferRow = {
  readonly id: string;
  readonly toMemberId: string | null;
  readonly transferStatus: string | null;
  readonly isConfirmed: boolean;
  readonly reason: string | null;
  readonly notes: string | null;
  readonly confirmationTimeoutAt: string | null;
  readonly createdAt: string | null;
};

export type InsertTransferInput = {
  readonly userId: string;
  readonly leadId: string;
  readonly toMemberId: string;
  readonly reason: string;
  readonly notes: string;
  readonly status: "pending" | "confirmed";
  readonly isConfirmed: boolean;
  readonly confirmedAt?: string | null;
  readonly confirmationTimeoutAt: string;
};

// Config de transferência/notificação do agente (portal). Lida FRESCA por turno
// quando a flag de handoff está ativa — respeita mudança do gerente sem redeploy.
export type TransferAgentConfig = {
  readonly agentName: string;
  readonly rules: AutomationRules;
  readonly briefingTemplateVendedor: string | null;
  readonly briefingTemplateGerente: string | null;
  readonly mensagensSemEmoji: boolean;
  readonly gerenteFeedbackCompleto: boolean;
  readonly gerentePhones: readonly string[];   // dígitos, já normalizados; vazio = sem relatório de gerente
};

export interface TransferSagaStore {
  loadAgentConfig(ref: TenantAgentRef): Promise<TransferAgentConfig | null>;
  fetchOwnedLeadForTransfer(ref: TenantAgentRef, leadId: string): Promise<TransferLeadRow | null>;
  fetchSellerById(tenantId: string, sellerId: string): Promise<SellerCandidate | null>;
  // Vendedor "anterior" do lead (tenant-wide por remote_jid, como no v2): último transfer CONFIRMADO
  // de leads anteriores do mesmo contato, senão o assigned_to_id mais recente. null = não há.
  findPreviousSellerId(tenantId: string, remoteJid: string, currentLeadId: string): Promise<string | null>;
  // Roster ativo. agentId presente = escopo do agente; null = tenant inteiro (fallback do cron, M4).
  listActiveSellers(tenantId: string, agentId: string | null): Promise<readonly SellerCandidate[]>;
  latestTransferForLead(ref: TenantAgentRef, leadId: string): Promise<TransferRow | null>;
  transferForCorrelation(ref: TenantAgentRef, leadId: string, correlationId: string): Promise<TransferRow | null>;
  activePendingForLead(ref: TenantAgentRef, leadId: string): Promise<TransferRow | null>;
  // Claim atômico do lead p/ transferência: status='transferido' SÓ se assigned_to_id IS NULL (owned).
  // NÃO grava origem (decisão M3 — v3 nunca inventa origem). Retorna se ESTA chamada claimou.
  claimLeadForTransfer(ref: TenantAgentRef, leadId: string, nowIso: string): Promise<boolean>;
  // Reversão best-effort do claim quando o insert da pendente falhou (compare-and-swap:
  // só volta p/ 'novo' se ainda estiver 'transferido' e sem dono).
  revertLeadClaim(ref: TenantAgentRef, leadId: string, previousStatus: string | null): Promise<void>;
  insertTransfer(input: InsertTransferInput): Promise<string | null>;
  // summary do lead: sobrescreve APENAS vazio ou autoria própria "[Pedro v3]" (mesma regra do crm_write).
  updateLeadSummaryGuarded(ref: TenantAgentRef, leadId: string, summary: string): Promise<void>;
  // last_lead_received_at + contador SEM lost update (CAS otimista em total_leads_received).
  markSellerReceivedLead(sellerId: string, nowIso: string): Promise<void>;
  releaseLeadAssignment(ref: TenantAgentRef, leadId: string): Promise<void>;
}
