// =============================================================================
// TYPING SIMULATOR — IT-1.2 (humanização do Pedro SDR)
// =============================================================================
//
// Calcula delay realista pra simular humano digitando, e tenta enviar
// indicador "digitando…" via UazAPI (best-effort — falha não bloqueia).
//
// FÓRMULA (alinhada com process-whatsapp-queue/index.ts:449-451):
//   typingSpeedCps = 18 + rand(0..10)   → 18-28 chars/segundo
//   ms = (len / cps) * 1000
//   clamp [800ms, 4000ms]
//
// USO (fonte canônica testável):
//   ```ts
//   import { calculateTypingDelayMs, sendTypingPresence } from './typingSimulator';
//
//   const delay = calculateTypingDelayMs(text);
//   await sendTypingPresence(baseUrl, instKey, phone, 'composing');
//   await sleep(delay);
//   await sendTypingPresence(baseUrl, instKey, phone, 'paused');
//   ```
//
// IMPORTANTE: fonte canônica + testes vitest. O webhook
// `uazapi-webhook/index.ts` tem cópia INLINE — qualquer mudança aqui
// precisa ser refletida lá (Edge Functions Supabase não importam
// cross-function).
// =============================================================================

export type TypingDelayOptions = {
  /** ms mínimo (default 800ms) */
  minMs?: number;
  /** ms máximo (default 4000ms) */
  maxMs?: number;
  /** chars/seg base (default 18) */
  baseCps?: number;
  /** jitter cps adicional (default 10, sorteado 0..jitter) */
  jitterCps?: number;
  /** Injectable rand pra testes determinísticos (default Math.random) */
  randomFn?: () => number;
};

const DEFAULTS: Required<TypingDelayOptions> = {
  minMs: 800,
  maxMs: 4000,
  baseCps: 18,
  jitterCps: 10,
  randomFn: Math.random,
};

/**
 * Calcula delay (ms) realista pra simular o tempo que um humano gastaria
 * digitando o `text`. Sempre retorna valor dentro de [minMs, maxMs].
 */
export function calculateTypingDelayMs(
  text: string,
  opts?: TypingDelayOptions
): number {
  const { minMs, maxMs, baseCps, jitterCps, randomFn } = { ...DEFAULTS, ...opts };
  const len = (text ?? "").length;
  if (len === 0) return minMs;

  const cps = baseCps + randomFn() * jitterCps;
  const raw = (len / cps) * 1000;
  return Math.max(minMs, Math.min(raw, maxMs));
}

/**
 * Tenta enviar indicador de presence na conversa (composing/paused/available).
 * BEST-EFFORT: erro de rede ou endpoint indisponível NÃO joga exceção.
 *
 * Tenta 2 formatos comuns:
 *   1. POST {baseUrl}/message/presence   body: { number, presence }
 *   2. POST {baseUrl}/chat/presence      body: { number, presence }
 *
 * Se ambos falharem, retorna false silenciosamente.
 */
export async function sendTypingPresence(
  baseUrl: string,
  instKey: string,
  phoneNumber: string,
  presence: "composing" | "paused" | "available" = "composing",
  fetchFn: typeof fetch = fetch
): Promise<boolean> {
  const headers = { "Content-Type": "application/json", token: instKey };
  const body = JSON.stringify({ number: phoneNumber, presence });
  const endpoints = [`${baseUrl}/message/presence`, `${baseUrl}/chat/presence`];

  for (const url of endpoints) {
    try {
      const res = await fetchFn(url, { method: "POST", headers, body });
      if (res.ok) return true;
    } catch {
      // ignora, tenta proximo
    }
  }
  return false;
}
