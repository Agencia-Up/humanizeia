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
  // v2-parity (P0 bloco-do-lead): lead DIGITANDO/GRAVANDO -> aguarda o fim do bloco (nunca responde no meio de uma
  // rajada). Opcional/retrocompat: ausente => comportamento anterior (só tempo). O anti-starvation (maxWait) SEMPRE
  // vence — presença nunca trava pra sempre.
  readonly leadPresenceActive?: boolean;
}): boolean {
  const quiet = args.nowMs - args.newestPendingMs >= args.debounceMs;
  const starved = args.nowMs - args.oldestPendingMs >= args.maxWaitMs;
  if (starved) return true;                    // teto de espera vence tudo (não trava pra sempre)
  if (args.leadPresenceActive) return false;   // digitando/gravando e ainda não starved -> espera o bloco terminar
  return quiet;
}

// Presença do lead expira após esta janela (v2-parity: 15s). Um evento "composing"/"recording" mais antigo que isto é
// tratado como PAUSA (o lead parou) — o debounce prossegue.
export const LEAD_PRESENCE_ACTIVE_MS = 15_000;

export type LeadPresenceState = "composing" | "recording" | "paused" | "available" | null | undefined;

// A presença do lead está ATIVA (segurar a resposta) se ele está digitando/gravando E o evento é recente. PURO.
export function isLeadPresenceActive(args: {
  readonly nowMs: number;
  readonly state: LeadPresenceState;
  readonly updatedAtMs: number | null;
  readonly activeWindowMs?: number;
}): boolean {
  if (args.state !== "composing" && args.state !== "recording") return false;
  if (args.updatedAtMs == null || !Number.isFinite(args.updatedAtMs)) return false;
  const windowMs = args.activeWindowMs ?? LEAD_PRESENCE_ACTIVE_MS;
  return args.nowMs - args.updatedAtMs < windowMs;
}

// ── TRAVA ANTI-PARCIAL (P0 bloco-do-lead) ────────────────────────────────────
// Depois que o turno DECIDIU mas ANTES de despachar: se chegou mensagem NOVA (pending) durante o processamento do
// cérebro, o bloco cresceu — a resposta pronta seria PARCIAL (respondia só parte da rajada). Nesse caso NÃO despacha:
// devolve o claim e deixa o poller reagrupar o bloco completo. Exceção: se o bloco já passou do teto (starved),
// processa mesmo assim (a msg nova vira o PRÓXIMO turno) — senão uma rajada infinita travaria a conversa pra sempre.
// PURO: mesma entrada -> mesma decisão.
export function shouldSupersedeStaleBlock(args: {
  readonly newlyPendingCount: number;
  readonly blockAgeMs: number;
  readonly maxWaitMs: number;
}): boolean {
  if (args.newlyPendingCount <= 0) return false;          // nada novo -> despacha normal
  if (args.blockAgeMs >= args.maxWaitMs) return false;    // bloco velho (starved) -> processa p/ não travar (forever-lock)
  return true;                                            // msg nova + bloco jovem -> reagrupa (não despacha parcial)
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
