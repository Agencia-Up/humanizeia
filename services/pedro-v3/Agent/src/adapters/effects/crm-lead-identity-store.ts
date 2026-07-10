// ============================================================================
// crm-lead-identity-store.ts — porta de IDENTIDADE do lead no CRM (audit Codex
// da Opção A): resolução/criação idempotente da linha em ai_crm_leads.
//
// Contrato SEPARADO do CrmLeadStore (update fill-only da Fase 1) de propósito:
// o store de escrita continua update-only; criar a identidade é INFRAESTRUTURA
// do composition root (nunca decisão da LLM, nunca resposta comercial). Uma
// mesma classe pode implementar as duas portas, mas os contratos não se misturam.
//
// Invariantes:
//  - Ownership em toda SELEÇÃO FINAL: user_id (tenant do root) + agent_id +
//    remote_jid canônico. A unique real do banco é (agent_id, remote_jid) e
//    pode ancorar o onConflict — mas o UUID retornado SEMPRE sai de um SELECT
//    final owned (nunca do retorno do INSERT: com ignore-duplicates outro
//    worker pode ter ganhado a corrida e o insert volta vazio).
//  - Mesmo (agent_id, remote_jid) com user_id DIFERENTE = conflito de tenant:
//    fail-closed ("foreign_tenant_conflict"), nunca reutiliza/atualiza.
//  - Criação MÍNIMA: nunca inventa origem (fica null até haver autoridade
//    factual — adContext do turno via crm_write fill-only).
//  - Convergente: duas execuções concorrentes retornam o MESMO UUID; retry
//    após falha incerta converge para a mesma linha.
// ============================================================================
import type { TenantAgentRef } from "../../domain/read-ports.ts";

export type LeadIdentityResolution =
  | { readonly ok: true; readonly leadId: string; readonly created: boolean }
  | { readonly ok: false; readonly reason: "invalid_jid" | "foreign_tenant_conflict" | "transient" };

export interface CrmLeadIdentityStore {
  // SELECT owned (tenant+agent+jid) -> UUID ou null. Erros de IO lançam (o
  // orquestrador converte em "transient"; nunca silencia o lead).
  resolveOwnedLead(ref: TenantAgentRef, remoteJid: string): Promise<string | null>;
  // Cria a linha mínima se não existir (idempotente por (agent_id, remote_jid))
  // e devolve o UUID confirmado por SELECT final owned.
  ensureOwnedLead(ref: TenantAgentRef, remoteJid: string): Promise<LeadIdentityResolution>;
  // resolve -> (se ausente) ensure. Caminho único usado pelo runtime.
  resolveOrEnsureOwnedLead(ref: TenantAgentRef, remoteJid: string): Promise<LeadIdentityResolution>;
}
