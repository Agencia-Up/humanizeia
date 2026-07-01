// ============================================================================
// debounce-policy.ts — F2.7.6. Politica PURA do debounce/burst do lead.
// Uma conversa esta "assentada" (pronta p/ virar UM turno) quando:
//   - ficou QUIETA por >= debounceMs (sem mensagem nova na janela), OU
//   - a mensagem pendente mais ANTIGA ja espera >= maxWaitMs (anti-starvation:
//     o lead nao para de digitar, mas nao podemos travar pra sempre).
// Sem Redis, sem setTimeout: o serviço v3 consulta isso periodicamente sobre o
// estado do v3_inbox (Postgres). Determinístico: mesmas entradas -> mesma decisão.
// ============================================================================

export type DebounceConfig = {
  readonly debounceMs: number;
  readonly maxWaitMs: number;
  readonly pollIntervalMs: number;
};

export const DEFAULT_DEBOUNCE_CONFIG: DebounceConfig = Object.freeze({
  debounceMs: 10_000,
  maxWaitMs: 20_000,
  pollIntervalMs: 2000,
});

export function isConversationSettled(args: {
  readonly nowMs: number;
  readonly oldestPendingMs: number;
  readonly newestPendingMs: number;
  readonly debounceMs: number;
  readonly maxWaitMs: number;
}): boolean {
  const quiet = args.nowMs - args.newestPendingMs >= args.debounceMs;
  const starved = args.nowMs - args.oldestPendingMs >= args.maxWaitMs;
  return quiet || starved;
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) return fallback;
  const i = Math.round(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

// Le PEDRO_V3_DEBOUNCE_MS (default 10000), PEDRO_V3_DEBOUNCE_MAX_MS (default 20000),
// PEDRO_V3_POLL_INTERVAL_MS (default 2000). maxWaitMs nunca menor que debounceMs.
export function resolveDebounceConfig(env: Record<string, string | undefined>): DebounceConfig {
  const debounceMs = clampInt(env.PEDRO_V3_DEBOUNCE_MS, DEFAULT_DEBOUNCE_CONFIG.debounceMs, 0, 60_000);
  const maxRaw = clampInt(env.PEDRO_V3_DEBOUNCE_MAX_MS, DEFAULT_DEBOUNCE_CONFIG.maxWaitMs, 0, 120_000);
  const maxWaitMs = Math.max(maxRaw, debounceMs); // anti-starvation nunca antes do debounce
  const pollIntervalMs = clampInt(env.PEDRO_V3_POLL_INTERVAL_MS, DEFAULT_DEBOUNCE_CONFIG.pollIntervalMs, 250, 30_000);
  return Object.freeze({ debounceMs, maxWaitMs, pollIntervalMs });
}
