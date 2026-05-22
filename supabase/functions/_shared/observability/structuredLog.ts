// =============================================================================
// STRUCTURED LOG — IT-4.3 (observabilidade do Pedro SDR)
// =============================================================================
//
// Resolve RISCO ALTO #2 do DIAGNOSTICO: "Sem observabilidade de custo/qualidade".
// Hoje logs são `console.log` simples e dispersos. Não dá pra:
//   - Agregar por conversa (qual lead deu erro?)
//   - Calcular custo / latência média
//   - Detectar regressão (taxa de cortesia subindo?)
//
// SOLUÇÃO:
//   - `trace_id` único por turno (gerado no início do request)
//   - Função `slog(event, fields)` que serializa em JSON 1-linha
//   - Convenção: `level` + `event` + `trace_id` + campos custom
//   - Output ainda vai pro `console.log` (Supabase Edge captura),
//     mas em JSON parseável por agregadores futuros (Datadog, Logflare).
//
// USO (fonte canônica testável):
//   ```ts
//   import { newTraceId, slog } from './structuredLog';
//
//   const traceId = newTraceId();
//   slog('info', 'turn_start', { trace_id: traceId, lead_phone: phone });
//   // ...
//   slog('info', 'turn_end', { trace_id: traceId, latency_ms: 1234, tokens: 500 });
//   ```
//
// IMPORTANTE: fonte canônica + testes vitest. O webhook
// `uazapi-webhook/index.ts` tem cópia INLINE — qualquer mudança aqui
// precisa ser refletida lá.
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, any> & {
  trace_id?: string;
};

/**
 * Gera trace_id curto (8 chars hex). Suficiente pra agregação por turno
 * sem inflar logs. Em conflito (~ 1 em 4 bilhões) só impacta agregação,
 * não correctness.
 */
export function newTraceId(): string {
  // Crypto.randomUUID() existe em Deno + browser modernos. Fallback:
  // Math.random pra ambientes sem (node < 18 sem polyfill).
  try {
    if (typeof crypto !== "undefined" && (crypto as any).randomUUID) {
      return (crypto as any).randomUUID().replace(/-/g, "").slice(0, 8);
    }
  } catch {}
  return Math.random().toString(16).slice(2, 10).padStart(8, "0");
}

/**
 * Serializa log em JSON 1-linha + escreve via `console[level]`.
 * `event` é a chave principal — agregadores filtram por ele.
 *
 * `consoleFn` injetável pra testes (default usa `console[level]`).
 */
export function slog(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  consoleFn?: (msg: string) => void
): void {
  const record = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };

  let json: string;
  try {
    json = JSON.stringify(record);
  } catch {
    // Fallback: campos com circular refs ou BigInt etc.
    json = JSON.stringify({
      ts: record.ts,
      level,
      event,
      _serialization_error: true,
    });
  }

  if (consoleFn) {
    consoleFn(json);
    return;
  }

  // eslint-disable-next-line no-console
  switch (level) {
    case "error":
      console.error(json);
      break;
    case "warn":
      console.warn(json);
      break;
    case "debug":
      console.debug(json);
      break;
    default:
      console.log(json);
  }
}

/**
 * Helper: cria função `log(event, fields)` pré-bindada com `trace_id`.
 * Útil pra evitar repetir trace_id em todo `slog()` do mesmo turno.
 */
export function makeTurnLogger(
  traceId: string,
  baseFields: LogFields = {}
): (level: LogLevel, event: string, fields?: LogFields) => void {
  return (level, event, fields = {}) => {
    slog(level, event, { trace_id: traceId, ...baseFields, ...fields });
  };
}
