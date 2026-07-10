// ============================================================================
// crm-lead-binding.ts — decide o VÍNCULO lead↔conversa do turno (Opção A do
// bloqueio 2026-07-10: o bridge entrega leadId=null e ninguém cria a linha).
//
// Fonte DURÁVEL do vínculo = ConversationState.leadId (o jsonb do state; o
// v3_commit_turn espelha na coluna lead_id). A routing (v3_conversation_routing)
// NÃO é durável hoje: o RPC do ingest sobrescreve lead_id com o null do bridge
// a cada mensagem — por isso ela entra aqui só como sinal de conferência e é
// re-hidratada best-effort pelo caller após o resolve.
//
// Regras (auditoria Codex):
//  - identity ausente (flag OFF) => zero IO no CRM, comportamento idêntico ao atual.
//  - state JÁ vinculado: mesmo UUID (ou routing null) => usa; routing com UUID
//    DIFERENTE => fail-closed p/ CRM neste turno (nunca regride/troca o vínculo).
//  - state SEM vínculo: resolve/cria pela identidade canônica (jid) com
//    ownership do REF (nunca payload). Primeiro vínculo => bootstrapSync=true
//    (o 1º crm_write sincroniza o SNAPSHOT acumulado, não só o delta do turno —
//    turnos anteriores sem vínculo não perdem nome/interesse/troca/entrada).
//  - Falha de resolução NUNCA silencia o lead: o turno segue com leadId null e
//    crm desligado; a próxima execução converge (ensure idempotente).
// ============================================================================
import type { TenantAgentRef } from "../domain/read-ports.ts";
import { canonicalWhatsappRemoteJid } from "../domain/whatsapp-jid.ts";
import type { CrmLeadIdentityStore } from "../adapters/effects/crm-lead-identity-store.ts";

export type LeadBindingNote =
  | "crm_off"
  | "bound_existing"            // state já vinculado; segue normal (delta)
  | "bound_new"                 // 1º vínculo; linha criada agora
  | "resolved_existing_lead"    // 1º vínculo DESTA conversa; linha já existia (v2/da outra conversa)
  | "routing_state_mismatch"    // routing aponta outro UUID => fail-closed p/ CRM
  | "resolved_conflicts_routing"// resolve devolveu UUID != routing não-nula => fail-closed
  | "invalid_jid"
  | "foreign_tenant_conflict"
  | "transient_resolution_failure";

export type LeadBindingDecision = {
  readonly leadId: string | null;      // leadId que o turno usa (ref/engine/commit)
  readonly crmEnabled: boolean;        // false => nenhum crm_write neste turno (fail-closed)
  readonly bootstrapSync: boolean;     // true => 1º vínculo: snapshot completo, não delta
  readonly note: LeadBindingNote;
};

export async function resolveConversationLeadBinding(args: {
  readonly identity: CrmLeadIdentityStore | null;
  readonly ref: TenantAgentRef;
  readonly toAddr: string;                 // telefone normalizado do routing (fonte do jid canônico)
  readonly settledLeadId: string | null;   // lead_id da routing (pode ter regredido p/ null)
  readonly stateLeadId: string | null;     // vínculo durável (ConversationState.leadId)
}): Promise<LeadBindingDecision> {
  // Flag OFF: zero SELECT/INSERT — o caller nem deveria ter carregado nada além do que já carrega hoje.
  if (args.identity == null) {
    return { leadId: args.settledLeadId, crmEnabled: false, bootstrapSync: false, note: "crm_off" };
  }

  // Vínculo durável existente: nunca re-resolve, nunca regride.
  if (args.stateLeadId != null) {
    if (args.settledLeadId != null && args.settledLeadId !== args.stateLeadId) {
      // Routing aponta OUTRO lead: suspeito => CRM fail-closed neste turno; o state (durável) prevalece
      // como identidade do turno para o commit não regredir o vínculo.
      return { leadId: args.stateLeadId, crmEnabled: false, bootstrapSync: false, note: "routing_state_mismatch" };
    }
    return { leadId: args.stateLeadId, crmEnabled: true, bootstrapSync: false, note: "bound_existing" };
  }

  // Sem vínculo: identidade canônica primeiro (nenhum jid inválido vira consulta).
  const jid = canonicalWhatsappRemoteJid(args.toAddr);
  if (!jid) return { leadId: null, crmEnabled: false, bootstrapSync: false, note: "invalid_jid" };

  let resolution: Awaited<ReturnType<CrmLeadIdentityStore["resolveOrEnsureOwnedLead"]>>;
  try {
    resolution = await args.identity.resolveOrEnsureOwnedLead(args.ref, jid);
  } catch {
    return { leadId: null, crmEnabled: false, bootstrapSync: false, note: "transient_resolution_failure" };
  }
  if (!resolution.ok) {
    const note: LeadBindingNote = resolution.reason === "invalid_jid"
      ? "invalid_jid"
      : resolution.reason === "foreign_tenant_conflict"
        ? "foreign_tenant_conflict"
        : "transient_resolution_failure";
    return { leadId: null, crmEnabled: false, bootstrapSync: false, note };
  }
  // Routing não-nula divergente do resolve (raro: lixo de routing) => conflito suspeito, fail-closed.
  if (args.settledLeadId != null && args.settledLeadId !== resolution.leadId) {
    return { leadId: null, crmEnabled: false, bootstrapSync: false, note: "resolved_conflicts_routing" };
  }
  return {
    leadId: resolution.leadId,
    crmEnabled: true,
    bootstrapSync: true,   // 1º vínculo desta conversa: sincroniza o acumulado
    note: resolution.created ? "bound_new" : "resolved_existing_lead",
  };
}
