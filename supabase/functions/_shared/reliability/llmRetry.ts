// =============================================================================
// LLM RETRY + CORTESIA — IT-4.1 (confiabilidade do Pedro SDR)
// =============================================================================
//
// Resolve RISCO ALTO #1 do DIAGNOSTICO: "Conversa morre silenciosamente se
// OpenAI falhar". Hoje quando openai.chat.completions retorna !ok, o webhook
// devolve HTTP 500 e abandona o cliente. Sem retry, sem cortesia.
//
// SOLUÇÃO:
//   1. Retry com backoff exponencial em 5xx e network errors (3 tentativas)
//   2. NÃO retry em 4xx (401/400 = problema permanente, não temporário)
//   3. Quando todas as tentativas falham, em vez de HTTP 500 ao webhook
//      origin (UazAPI), retorna mensagem de cortesia pro cliente.
//
// USO (fonte canônica testável):
//   ```ts
//   import { fetchWithRetry, COURTESY_MESSAGE } from './llmRetry';
//
//   const { res, attempts } = await fetchWithRetry(url, init);
//   if (!res.ok) {
//     // todas as tentativas falharam — envia cortesia ao cliente
//     return { content: COURTESY_MESSAGE };
//   }
//   ```
//
// IMPORTANTE: fonte canônica + testes vitest. O webhook
// `uazapi-webhook/index.ts` tem cópia INLINE — qualquer mudança aqui
// precisa ser refletida lá.
// =============================================================================

export type RetryOptions = {
  /** Máx tentativas (default 3). */
  maxAttempts?: number;
  /** Delay base em ms (default 1000). Backoff: base * 2^attempt. */
  baseDelayMs?: number;
  /** Statuses que disparam retry (default 5xx + 429). */
  retryableStatuses?: number[];
  /** fetch injetável pra testes. */
  fetchFn?: typeof fetch;
  /** setTimeout injetável pra testes (não esperar de verdade). */
  setTimeoutFn?: typeof setTimeout;
};

const DEFAULT_RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

/**
 * Mensagem de cortesia enviada ao cliente quando todas as tentativas falham.
 * Curta, em pt-BR, tom de SDR humano (não robótico).
 */
export const COURTESY_MESSAGE =
  "Pera ai, tive uma instabilidade aqui. Pode me mandar de novo daqui uns 2 minutinhos? 🙏";

/**
 * fetch com retry + backoff exponencial. Retorna `{ res, attempts }`.
 * `res` pode ser !ok (caller decide o que fazer).
 *
 * - 5xx + 429 → retry com backoff
 * - 4xx (exceto 429) → NÃO retry (problema permanente)
 * - network error → retry
 *
 * Se TODAS as tentativas falharem com network error, joga a exceção da
 * última tentativa.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts?: RetryOptions
): Promise<{ res: Response; attempts: number }> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 1000;
  const retryableStatuses = opts?.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES;
  const fetchFn = opts?.fetchFn ?? fetch;
  const setTimeoutFn = opts?.setTimeoutFn ?? setTimeout;

  let lastError: any = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise<void>((resolve) => setTimeoutFn(() => resolve(), delay));
    }
    try {
      const res = await fetchFn(url, init);
      // Sucesso ou erro não-retryable → retorna imediatamente
      if (res.ok || !retryableStatuses.includes(res.status)) {
        return { res, attempts: attempt + 1 };
      }
      // Retryable status → continua loop (a menos que seja última tentativa)
      if (attempt === maxAttempts - 1) {
        return { res, attempts: attempt + 1 };
      }
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts - 1) {
        throw err;
      }
    }
  }
  // Não deveria chegar aqui, mas TS exige path de retorno
  throw lastError || new Error("fetchWithRetry: unexpected end");
}
