// ============================================================================
// automation-rules.ts — porta PURA (v3) de `_shared/automation/rules.ts` do v2.
// MESMA semântica, MESMOS defaults legados (5/8/12, t3 transfere, 10min de
// resposta do vendedor, janela legada = null). Fonte ÚNICA para a saga de
// transferência (seller_response_min/transfer.enabled) e para o follow-up
// T1/T2/T3 (HF-4). NUNCA hardcodar 5/8/12 fora daqui.
// ============================================================================

export type FollowupRules = {
  readonly enabled: boolean;
  readonly t1Min: number;
  readonly t2Min: number;
  readonly t3Min: number;
  readonly t3Transfers: boolean;
};

export type TransferRules = {
  readonly enabled: boolean;
  readonly sellerResponseMin: number;
};

export type AutomationRules = {
  readonly followup: FollowupRules;
  readonly transfer: TransferRules;
  readonly configured: boolean;
};

export const DEFAULT_FOLLOWUP: FollowupRules = Object.freeze({
  enabled: true, t1Min: 5, t2Min: 8, t3Min: 12, t3Transfers: true,
});
export const DEFAULT_TRANSFER: TransferRules = Object.freeze({
  enabled: true, sellerResponseMin: 10,
});

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// Normaliza o JSON cru de wa_ai_agents.automation_rules (mesma correção
// silenciosa de tempos fora de ordem t1<t2<t3 do v2). A janela de REPASSE
// (transfer.window) NÃO é modelada aqui de propósito: a rotação/repasse é dos
// motores v2 (cron SEÇÃO 1 + transfer-timeout-checker) — o v3 só cria a
// pendente compatível e nunca rotaciona (regra de propriedade única, M11).
export function resolveAutomationRules(raw: unknown): AutomationRules {
  const root = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const f = root?.followup && typeof root.followup === "object" ? root.followup as Record<string, unknown> : {};
  const t = root?.transfer && typeof root.transfer === "object" ? root.transfer as Record<string, unknown> : {};

  let t1 = asInt(f.t1_min, DEFAULT_FOLLOWUP.t1Min, 1, 1440);
  let t2 = asInt(f.t2_min, DEFAULT_FOLLOWUP.t2Min, 1, 1440);
  let t3 = asInt(f.t3_min, DEFAULT_FOLLOWUP.t3Min, 1, 1440);
  if (t2 <= t1) t2 = t1 + 1;
  if (t3 <= t2) t3 = t2 + 1;

  return {
    followup: {
      enabled: asBool(f.enabled, DEFAULT_FOLLOWUP.enabled),
      t1Min: t1, t2Min: t2, t3Min: t3,
      t3Transfers: asBool(f.t3_transfers, DEFAULT_FOLLOWUP.t3Transfers),
    },
    transfer: {
      enabled: asBool(t.enabled, DEFAULT_TRANSFER.enabled),
      sellerResponseMin: asInt(t.seller_response_min, DEFAULT_TRANSFER.sellerResponseMin, 1, 1440),
    },
    configured: !!root,
  };
}
