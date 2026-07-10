// ============================================================================
// crm-write-dispatcher.ts — FASE 1 do CRM/Handoff. Despacha effects `crm_write`
// contra o CRM real (ai_crm_leads) com as garantias da missão:
//
//  - MERGE NÃO-DESTRUTIVO (fill-only-if-empty): um campo já preenchido no CRM
//    NUNCA é sobrescrito — não importa quem o preencheu (vendedor/humano/v2).
//    Exceção ÚNICA: `summary` prefixado "[Pedro v3]" (autoria nossa por
//    construção) pode ser atualizado; summary de OUTRA autoria não é tocado.
//  - NUNCA apaga: null/vazio jamais entra no UPDATE (o builder já omite).
//  - CROSS-TENANT FAIL-CLOSED: o SELECT e o UPDATE filtram por user_id+agent_id
//    do REF DO DISPATCHER (autoridade da composição, nunca do payload). Lead de
//    outro tenant/agente => FORBIDDEN não-retryable, zero linhas tocadas.
//  - IDEMPOTENTE: re-dispatch do mesmo effect (retry/uncertain) reaplica o
//    mesmo fill-if-empty — a 2ª passada vira no-op (campos já preenchidos).
//  - FALHA NÃO SILENCIA O LEAD: este effect roda DEPOIS do send_message (order
//    alto no plan) e nada depende dele; erro aqui nunca afeta a resposta.
// ============================================================================
import type { EffectResult, ToolError } from "../../domain/decision.ts";
import type { OutboxRecord } from "../../domain/effect-intent.ts";
import { redact } from "../../domain/effect-intent.ts";
import type { Clock } from "../../domain/ports.ts";
import type { TenantAgentRef } from "../../domain/read-ports.ts";
import type { JsonValue } from "../../domain/types.ts";
import type { EffectDispatcher } from "../../engine/outbox-dispatcher.ts";

export const CRM_SUMMARY_PREFIX = "[Pedro v3]";

// Colunas que a Fase 1 tem permissão de escrever (allowlist dura — qualquer
// outra chave no payload é IGNORADA, nunca escrita).
export const CRM_WRITABLE_COLUMNS = new Set([
  "client_name", "vehicle_interest", "payment_method", "down_payment", "desired_installment",
  "trade_in_vehicle", "client_city", "visit_scheduled", "budget", "origem", "summary",
]);

export type CrmLeadRow = { id: string; fields: Record<string, string | null> };

// Porta de acesso ao CRM. A implementação REAL (Supabase/PostgREST) e o FAKE de
// teste implementam a mesma interface; ambas DEVEM aplicar o filtro de
// ownership (user_id/agent_id do ref) no SELECT e no UPDATE.
export interface CrmLeadStore {
  fetchOwnedLead(ref: TenantAgentRef, leadId: string): Promise<CrmLeadRow | null>;
  updateOwnedLead(ref: TenantAgentRef, leadId: string, fields: Record<string, string>): Promise<{ ok: boolean; updatedRows: number; error?: string }>;
}

function toolError(code: ToolError["code"], message: string, retryable: boolean): ToolError {
  return { code, message, retryable };
}
function failed(record: OutboxRecord, code: ToolError["code"], message: string, retryable: boolean): EffectResult {
  return { status: "failed", effectId: record.effectId, error: toolError(code, message, retryable) };
}
function isBlank(v: string | null | undefined): boolean {
  return v == null || String(v).trim() === "" || String(v).trim().toLowerCase() === "null";
}

export type CrmWriteDispatcherOptions = {
  readonly ref: TenantAgentRef;
  readonly clock: Clock;
  readonly store: CrmLeadStore;
};

export class CrmWriteEffectDispatcher implements EffectDispatcher {
  constructor(private readonly opts: CrmWriteDispatcherOptions) {}

  async dispatch(record: OutboxRecord): Promise<EffectResult> {
    if (record.kind !== "crm_write") {
      return failed(record, "FORBIDDEN", `unsupported_effect_kind:${record.kind}`, false);
    }
    const { __redacted: _r, ...payload } = record.payload as Record<string, unknown>;
    const leadId = typeof payload.leadId === "string" && payload.leadId.trim() !== "" ? payload.leadId.trim() : null;
    const rawFields = payload.fields;
    if (!leadId || typeof rawFields !== "object" || rawFields === null || Array.isArray(rawFields)) {
      return failed(record, "VALIDATION", "invalid_crm_payload", false);
    }

    // Allowlist dura + só strings não-vazias (nunca null/apagar; nunca coluna fora da Fase 1).
    const requested: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawFields as Record<string, unknown>)) {
      if (!CRM_WRITABLE_COLUMNS.has(k)) continue;
      if (typeof v !== "string" || v.trim() === "") continue;
      requested[k] = v.trim();
    }
    if (Object.keys(requested).length === 0) {
      return this.succeed(record, { written: [], skippedExisting: [], reason: "no_writable_fields" });
    }

    // Cross-tenant fail-closed: lead precisa EXISTIR e pertencer ao ref do dispatcher.
    let lead: CrmLeadRow | null;
    try {
      lead = await this.opts.store.fetchOwnedLead(this.opts.ref, leadId);
    } catch (error) {
      return this.uncertain(record, `crm_fetch_exception:${error instanceof Error ? error.name : "Error"}`);
    }
    if (!lead) return failed(record, "FORBIDDEN", "lead_not_owned_or_missing", false);

    // MERGE NÃO-DESTRUTIVO: só preenche campo VAZIO. summary "[Pedro v3]" (autoria
    // nossa por construção) pode atualizar; summary alheio não é tocado.
    const toWrite: Record<string, string> = {};
    const skippedExisting: string[] = [];
    for (const [col, value] of Object.entries(requested)) {
      const current = lead.fields[col] ?? null;
      if (isBlank(current)) { toWrite[col] = value; continue; }
      if (col === "summary" && String(current).startsWith(CRM_SUMMARY_PREFIX) && value.startsWith(CRM_SUMMARY_PREFIX)) {
        if (String(current).trim() !== value.trim()) toWrite[col] = value;
        continue;
      }
      skippedExisting.push(col);   // campo humano/preexistente: intocado
    }
    if (Object.keys(toWrite).length === 0) {
      return this.succeed(record, { written: [], skippedExisting, reason: "all_fields_preserved" });
    }

    let result: { ok: boolean; updatedRows: number; error?: string };
    try {
      result = await this.opts.store.updateOwnedLead(this.opts.ref, leadId, toWrite);
    } catch (error) {
      return this.uncertain(record, `crm_update_exception:${error instanceof Error ? error.name : "Error"}`);
    }
    if (!result.ok) return this.uncertain(record, `crm_update_failed:${(result.error ?? "unknown").slice(0, 80)}`);
    if (result.updatedRows === 0) return failed(record, "FORBIDDEN", "lead_update_zero_rows", false);
    return this.succeed(record, { written: Object.keys(toWrite), skippedExisting, reason: "written" });
  }

  private succeed(record: OutboxRecord, meta: { written: string[]; skippedExisting: string[]; reason: string }): EffectResult {
    return {
      status: "succeeded",
      effectId: record.effectId,
      receipt: {
        effectId: record.effectId,
        // ⭐Audit Codex (Fase 1): crm_write é efeito CRÍTICO (effect-policy exige receipt "delivered" p/ satisfazer
        // dependências — isEffectSatisfiedForDependency). O PATCH no CRM é SÍNCRONO e confirmado pelo banco: o
        // sucesso aqui É a entrega (não há "aceito mas não entregue" como no WhatsApp). Sem isto, um handoff/
        // notify_seller da Fase 3 que dependesse do crm_write ficaria bloqueado para sempre.
        level: "delivered",
        at: this.opts.clock.now(),
        providerMessageId: `crm:${meta.reason}:${meta.written.length}w:${meta.skippedExisting.length}s`,
      },
    };
  }

  private uncertain(record: OutboxRecord, reason: string): EffectResult {
    return { status: "outcome_uncertain", effectId: record.effectId, metadata: redact({ reason } satisfies { [k: string]: JsonValue }) };
  }
}

// ── Roteador por kind: send_* -> WhatsApp; crm_write -> CRM. Kind sem rota
//    falha FECHADO (nunca despacha efeito desconhecido em provider errado). ──
export class CompositeEffectDispatcher implements EffectDispatcher {
  constructor(private readonly routes: Partial<Record<OutboxRecord["kind"], EffectDispatcher>>) {}
  async dispatch(record: OutboxRecord): Promise<EffectResult> {
    const route = this.routes[record.kind];
    if (!route) return failed(record, "FORBIDDEN", `no_dispatcher_for_kind:${record.kind}`, false);
    return route.dispatch(record);
  }
}
