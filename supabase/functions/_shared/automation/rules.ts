// ════════════════════════════════════════════════════════════════════════════
// Regras de automacao do Pedro v2 (follow-up + transferencia), configuraveis por
// agente via portal (wa_ai_agents.automation_rules JSONB). Fonte UNICA de verdade
// + defaults. Modulo PURO (sem dependencias externas) para ser importado tanto
// pelas edge functions com client inline (cron-lead-followup, transfer-timeout-
// checker) quanto pelo bundle do pedro-webhook-v2.
//
// REGRA DE OURO: agente SEM automation_rules (NULL) = comportamento LEGADO
// (follow-up 5/8/12, 3o transfere, timeout 15min, janela de repasse fixa).
// `window` so e considerado configurado quando o objeto existe; senao usa a
// janela legada (3 faixas hardcoded no transfer-timeout-checker).
// ════════════════════════════════════════════════════════════════════════════

export type FollowupRules = {
  enabled: boolean;
  t1_min: number;
  t2_min: number;
  t3_min: number;
  t3_transfers: boolean;
};

export type RepassWindow = { enabled: boolean; start: string; end: string };

export type TransferRules = {
  enabled: boolean;
  seller_response_min: number;
  window: RepassWindow | null; // null = janela legada
};

export type AutomationRules = {
  followup: FollowupRules;
  transfer: TransferRules;
  configured: boolean; // true quando o agente tem automation_rules salvo
};

export const DEFAULT_FOLLOWUP: FollowupRules = {
  enabled: true,
  t1_min: 5,
  t2_min: 8,
  t3_min: 12,
  t3_transfers: true,
};

// seller_response_min default = 10: e o tempo EFETIVO de hoje (cron-lead-followup
// SECAO 1 escala em created_at + 10min, e o motor que dispara primeiro). O
// confirmation_timeout_at (+15min legado) era secundario (transfer-timeout-checker).
export const DEFAULT_TRANSFER: TransferRules = {
  enabled: true,
  seller_response_min: 10,
  window: null,
};

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

function asTime(value: unknown, fallback: string): string {
  return typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value.trim()) ? value.trim() : fallback;
}

/**
 * Normaliza o JSON cru de wa_ai_agents.automation_rules para uma estrutura
 * completa e segura, aplicando defaults legados quando faltar qualquer campo.
 * Tambem CORRIGE silenciosamente tempos fora de ordem (t1<t2<t3) para nunca
 * bugar o cron.
 */
export function resolveAutomationRules(raw: unknown): AutomationRules {
  const root = raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
  const f = root?.followup && typeof root.followup === "object" ? root.followup : {};
  const t = root?.transfer && typeof root.transfer === "object" ? root.transfer : {};

  let t1 = asInt(f.t1_min, DEFAULT_FOLLOWUP.t1_min, 1, 1440);
  let t2 = asInt(f.t2_min, DEFAULT_FOLLOWUP.t2_min, 1, 1440);
  let t3 = asInt(f.t3_min, DEFAULT_FOLLOWUP.t3_min, 1, 1440);
  if (t2 <= t1) t2 = t1 + 1;
  if (t3 <= t2) t3 = t2 + 1;

  const w = t.window && typeof t.window === "object" ? t.window : null;

  return {
    followup: {
      enabled: asBool(f.enabled, DEFAULT_FOLLOWUP.enabled),
      t1_min: t1,
      t2_min: t2,
      t3_min: t3,
      t3_transfers: asBool(f.t3_transfers, DEFAULT_FOLLOWUP.t3_transfers),
    },
    transfer: {
      enabled: asBool(t.enabled, DEFAULT_TRANSFER.enabled),
      seller_response_min: asInt(t.seller_response_min, DEFAULT_TRANSFER.seller_response_min, 1, 1440),
      window: w
        ? { enabled: asBool(w.enabled, true), start: asTime(w.start, "10:11"), end: asTime(w.end, "19:29") }
        : null,
    },
    configured: !!root,
  };
}

/** Minutos do dia (0-1439) em Brasilia (UTC-3) para um Date UTC. */
export function brasiliaMinutesOfDay(dt: Date): number {
  const utcMin = dt.getUTCHours() * 60 + dt.getUTCMinutes();
  return ((utcMin - 180) + 1440) % 1440;
}

function parseHHMM(value: string): number {
  const [h, m] = value.split(":").map((x) => parseInt(x, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * O `now` (UTC) esta dentro da janela de repasse CONFIGURADA do agente?
 * - window === null  -> retorna null (caller deve usar a janela LEGADA).
 * - window.enabled === false -> sempre true (repassa a qualquer hora).
 * - window.enabled === true  -> true somente entre start e end (horario Brasilia).
 */
export function isWithinConfiguredWindow(window: RepassWindow | null, now: Date): boolean | null {
  if (!window) return null;
  if (!window.enabled) return true;
  const min = brasiliaMinutesOfDay(now);
  return min >= parseHHMM(window.start) && min <= parseHHMM(window.end);
}
