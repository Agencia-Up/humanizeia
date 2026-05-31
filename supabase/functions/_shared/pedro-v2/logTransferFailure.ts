// ============================================================
// logTransferFailure — diagnostico "por que o lead NAO foi transferido"
// ------------------------------------------------------------
// Alimenta o painel "Leads sem Transferencia — Diagnostico".
//
// REGRA DE OURO: este modulo NUNCA pode lancar excecao nem alterar o
// fluxo vivo de transferencia do Pedro/Marcos. Toda chamada e
// envolvida em try/catch e qualquer erro vira apenas console.warn.
//
// Implementacao 100% auto-contida (fetch direto ao endpoint RPC do
// PostgREST), pra NAO depender do formato do client. Os clients inline
// das crons (cron-lead-followup, transfer-timeout-checker) NAO tem
// metodo .rpc(); o uazapi-webhook tem; o supabase-js tem. Fazendo
// fetch direto, o comportamento e identico em todas as funcoes.
//
// A deduplicacao (1 falha ABERTA por user+lead+motivo, incrementando
// attempt_count) vive na RPC pedro_log_transfer_failure
// (migration 20260531123000). Aqui so repassamos os campos.
// ============================================================

export type TransferFailureReason =
  | "lead_nao_qualificado"
  | "lead_inativo"
  | "sem_vendedor_disponivel"
  | "erro_tecnico"
  | "funil_timeout"
  | "regra_nao_atingida"
  | "agente_nao_executou"
  | "outros";

export interface LogTransferFailureInput {
  user_id: string;
  reason_code: TransferFailureReason;
  mode?: "pedro" | "marcos";
  lead_id?: string | null;
  agent_id?: string | null;
  member_id?: string | null;
  lead_name?: string | null;
  remote_jid?: string | null;
  reason_detail?: string | null;
  lead_status?: string | null;
  lead_status_crm?: string | null;
  attempted_transfer?: boolean;
  source?: string | null;
}

export interface LogTransferFailureCreds {
  url?: string;
  serviceKey?: string;
}

function resolveCreds(opts?: LogTransferFailureCreds): { url: string; key: string } | null {
  try {
    const url = opts?.url || (globalThis as any)?.Deno?.env?.get?.("SUPABASE_URL") || "";
    const key = opts?.serviceKey ||
      (globalThis as any)?.Deno?.env?.get?.("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !key) return null;
    return { url: url.replace(/\/+$/, ""), key };
  } catch {
    return null;
  }
}

async function callRpc(
  fn: string,
  body: Record<string, unknown>,
  opts?: LogTransferFailureCreds,
): Promise<boolean> {
  const creds = resolveCreds(opts);
  if (!creds) {
    console.warn("[transfer-failure-log] sem credenciais (SUPABASE_URL/SERVICE_ROLE_KEY) — ignorado");
    return false;
  }
  try {
    const res = await fetch(`${creds.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "apikey": creds.key,
        "Authorization": `Bearer ${creds.key}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn(`[transfer-failure-log] ${fn} HTTP ${res.status} (ignorado):`, txt.slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    // NUNCA deixar o diagnostico derrubar a transferencia.
    console.warn(`[transfer-failure-log] ${fn} excecao ignorada:`, (err as any)?.message || err);
    return false;
  }
}

/**
 * Registra (ou incrementa) uma falha de transferencia. Nunca lanca.
 * Retorna true se a RPC respondeu sem erro — o chamador pode ignorar.
 */
export async function logTransferFailure(
  input: LogTransferFailureInput,
  opts?: LogTransferFailureCreds,
): Promise<boolean> {
  if (!input || !input.user_id || !input.reason_code) return false;
  return await callRpc("pedro_log_transfer_failure", {
    p_user_id: input.user_id,
    p_reason_code: input.reason_code,
    p_mode: input.mode ?? "pedro",
    p_lead_id: input.lead_id ?? null,
    p_agent_id: input.agent_id ?? null,
    p_member_id: input.member_id ?? null,
    p_lead_name: input.lead_name ?? null,
    p_remote_jid: input.remote_jid ?? null,
    p_reason_detail: input.reason_detail ?? null,
    p_lead_status: input.lead_status ?? null,
    p_lead_status_crm: input.lead_status_crm ?? null,
    p_attempted_transfer: input.attempted_transfer ?? false,
    p_source: input.source ?? null,
  }, opts);
}

/**
 * Marca como resolvidas todas as falhas ABERTAS de um lead (chamado
 * quando o lead finalmente e transferido). Nunca lanca.
 */
export async function resolveTransferFailures(
  input: { user_id: string; lead_id: string; resolved_by?: string | null },
  opts?: LogTransferFailureCreds,
): Promise<boolean> {
  if (!input || !input.user_id || !input.lead_id) return false;
  return await callRpc("pedro_resolve_transfer_failures", {
    p_user_id: input.user_id,
    p_lead_id: input.lead_id,
    p_resolved_by: input.resolved_by ?? null,
  }, opts);
}
