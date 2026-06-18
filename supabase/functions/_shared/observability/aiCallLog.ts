// =============================================================================
// AUDIT — logAiCall: registra 1 linha em `ai_call_log` por turno/chamada de IA.
// =============================================================================
// REGRA DE OURO: este helper NUNCA pode derrubar o atendimento.
//   - NUNCA lanca (todo o corpo e try/catch; erros viram console.warn)
//   - e `async` e retorna Promise<void>: os call sites podem `await` com
//     seguranca. Awaitar e proposital — em Edge Functions uma promessa "solta"
//     (sem await) e cortada quando o isolate congela apos a resposta, e o
//     registro se perderia. No Pedro o `await` roda DEPOIS de a resposta ja ter
//     sido enviada ao cliente, entao nao atrasa nada que o usuario perceba.
//
// Funciona tanto com supabase-js quanto com o cliente PostgREST inline do cron
// (ambos expoem `.from(table).insert(row)` que resolve para `{ error }`).
//
// custo_usd NAO vai daqui: o trigger `ai_call_log_fill_cost` calcula no banco
// via `preco_modelo` (e aproxima pelo split quando so vem total).
// =============================================================================

export type AiDisparoTipo =
  | "inbound_pedro"
  | "followup_auto"
  | "reativacao"
  | "broadcast_marcos"
  | "jose_apollo"
  | "social_media"
  | "claude_chat"
  | "transcricao_audio"
  | "embedding"
  | "manual_test"
  | "outro";

export type AiCallStatus = "ok" | "error" | "partial" | "fallback";

export interface AiCallLogInput {
  userId: string; // TENANT (conta master) — obrigatorio
  disparoTipo: AiDisparoTipo;
  modelo: string; // obrigatorio (ex.: 'gpt-4o', 'gpt-4o-mini')
  provedor?: string; // default 'openai'
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number; // se ausente, soma input+output
  nSubcalls?: number; // default 1 (Pedro: nº de chamadas agregadas no turno)
  agentId?: string | null;
  agentName?: string | null;
  traceId?: string | null;
  eventoOrigem?: string | null; // wa_message_id / lead_id / jid mascarado
  latenciaMs?: number | null;
  status?: AiCallStatus;
  meta?: Record<string, unknown> | null;
}

const TABLE = "ai_call_log";

/**
 * Registra (best-effort) uma operacao de IA na tabela de auditoria.
 * NUNCA lanca. Seguro para `await` no caminho de resposta (roda depois do envio).
 *
 * @param client Supabase client (service_role) OU cliente inline com `.from().insert()`
 */
export async function logAiCall(client: any, input: AiCallLogInput): Promise<void> {
  try {
    if (!client || !input || !input.userId || !input.modelo) {
      // sem o minimo (tenant + modelo) nao da pra registrar; nao e erro fatal
      return;
    }

    const inTok = toInt(input.inputTokens);
    const outTok = toInt(input.outputTokens);
    const total = input.totalTokens != null ? toInt(input.totalTokens) : inTok + outTok;

    const row: Record<string, unknown> = {
      user_id: input.userId,
      disparo_tipo: input.disparoTipo || "outro",
      provedor: input.provedor || "openai",
      modelo: input.modelo,
      input_tokens: inTok,
      output_tokens: outTok,
      total_tokens: total,
      n_subcalls: input.nSubcalls != null ? toInt(input.nSubcalls) : 1,
      agent_id: input.agentId ?? null,
      agent_name: input.agentName ?? null,
      trace_id: input.traceId ?? null,
      evento_origem: input.eventoOrigem ?? null,
      latencia_ms: input.latenciaMs != null ? toInt(input.latenciaMs) : null,
      status: input.status || "ok",
      meta: input.meta ?? null,
      // custo_usd OMITIDO de proposito — trigger no banco calcula via preco_modelo
    };

    const res: any = await client.from(TABLE).insert(row);
    if (res && res.error) {
      warn("insert retornou erro (ignorado): " + (res.error.message || JSON.stringify(res.error)));
    }
  } catch (err: any) {
    warn("falha ao registrar (ignorado): " + (err?.message || String(err)));
  }
}

function toInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function warn(msg: string): void {
  try {
    // eslint-disable-next-line no-console
    console.warn("[aiCallLog] " + msg);
  } catch {
    /* nunca propaga */
  }
}
