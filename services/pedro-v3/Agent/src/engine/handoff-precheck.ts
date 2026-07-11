// ============================================================================
// handoff-precheck.ts — MISSÃO PII (P0-C). Avaliação ESTRUTURADA e TESTÁVEL da
// disponibilidade de transferência. Cada etapa observável; PRIMEIRO motivo de
// indisponibilidade tipado; erro SANITIZADO por etapa. Catch silencioso é
// PROIBIDO por construção (o incidente real 2026-07-11 teve plannable=false em
// produção sem motivo registrável). Reprodução obrigatória: vendedor tenant-wide
// ativo com agent_id=null e telefone válido => available=true (fallback M4).
// Nunca PII, nunca segredo — o objeto vai INTEIRO para log + decision_final.
// ============================================================================
import type { TenantAgentRef } from "../domain/read-ports.ts";
import type { TransferSagaStore } from "../adapters/effects/transfer-store.ts";
import { sellerPhoneKey } from "./transfer-templates.ts";
import { sanitizeTurnError } from "../runtime/sanitize-error.ts";

export type HandoffUnavailableReason =
  | "flag_disabled"
  | "transfer_store_missing"
  | "crm_disabled"
  | "lead_unbound"
  | "config_load_failed"
  | "config_not_found"
  | "portal_transfer_disabled"
  | "roster_query_failed"
  | "no_active_seller"
  | "no_seller_with_valid_phone";

export type HandoffPrecheckDiag = {
  readonly flagEnabled: boolean;
  readonly crmEnabled: boolean;
  readonly leadBound: boolean;
  readonly configLoaded: boolean;
  readonly portalTransferEnabled: boolean;
  readonly scopedSellerCount: number;
  readonly tenantFallbackSellerCount: number;
  readonly validPhoneSellerCount: number;
  readonly available: boolean;
  readonly unavailableReason: HandoffUnavailableReason | null;
  readonly stepError: string | null;
};

export async function evaluateHandoffPrecheck(input: {
  readonly flagEnabled: boolean;
  readonly crmEnabled: boolean;
  readonly leadBound: boolean;
  readonly store: TransferSagaStore | null;
  readonly ref: TenantAgentRef;
}): Promise<HandoffPrecheckDiag> {
  const diag = {
    flagEnabled: input.flagEnabled,
    crmEnabled: input.crmEnabled,
    leadBound: input.leadBound,
    configLoaded: false,
    portalTransferEnabled: false,
    scopedSellerCount: 0,
    tenantFallbackSellerCount: 0,
    validPhoneSellerCount: 0,
    available: false,
    unavailableReason: null as HandoffUnavailableReason | null,
    stepError: null as string | null,
  };
  const unavailable = (reason: HandoffUnavailableReason, error?: unknown): HandoffPrecheckDiag => {
    diag.unavailableReason = reason;
    if (error !== undefined) {
      diag.stepError = sanitizeTurnError(error instanceof Error ? `${error.name}:${error.message}` : String(error)).slice(0, 160);
    }
    return diag;
  };

  if (!diag.flagEnabled) return unavailable("flag_disabled");
  if (!input.store) return unavailable("transfer_store_missing");
  if (!diag.crmEnabled) return unavailable("crm_disabled");
  if (!diag.leadBound) return unavailable("lead_unbound");

  let config;
  try {
    config = await input.store.loadAgentConfig(input.ref);
  } catch (error) {
    return unavailable("config_load_failed", error);
  }
  if (!config) return unavailable("config_not_found");
  diag.configLoaded = true;
  diag.portalTransferEnabled = config.rules.transfer.enabled;
  if (!diag.portalTransferEnabled) return unavailable("portal_transfer_disabled");

  let scoped, roster;
  try {
    scoped = await input.store.listActiveSellers(input.ref.tenantId, input.ref.agentId);
    roster = scoped.length > 0 ? scoped : await input.store.listActiveSellers(input.ref.tenantId, null);
  } catch (error) {
    return unavailable("roster_query_failed", error);
  }
  diag.scopedSellerCount = scoped.length;
  diag.tenantFallbackSellerCount = scoped.length > 0 ? 0 : roster.length;
  if (roster.length === 0) return unavailable("no_active_seller");
  diag.validPhoneSellerCount = roster.filter((seller) => seller.isActive && sellerPhoneKey(seller.whatsappNumber) !== "").length;
  if (diag.validPhoneSellerCount === 0) return unavailable("no_seller_with_valid_phone");
  diag.available = true;
  return diag;
}
