// ============================================================================
// transfer-dispatchers.ts — HF-3. Dois dispatchers de efeito:
//
//  HandoffEffectDispatcher (kind "handoff") — a SAGA de transferência, espelho
//  auditado do v2 (executePedroV2Handoff) com as decisões da Fase 0:
//   0) lead owned (cross-tenant fail-closed);
//   1) lead COM dono ativo -> renotify (throttle 45min) com transfer CONFIRMED
//      de marco (returning_lead_renotify); dono inativo -> solta atribuição;
//   2) pendente VIGENTE (timeout não vencido) -> idempotente: já está na
//      máquina de aceite do v2 (already_pending) — FAILED não-retryable p/ o
//      notify não duplicar aviso;
//   3) escolha do vendedor: anterior (tenant-wide) > roster do agente > roster
//      do tenant (M4, fallback do cron) — dedup por telefone + SEM telefone
//      fora + rodízio justo (nunca-recebeu primeiro);
//   4) claim atômico (status='transferido' where assigned IS NULL; SEM origem);
//   5) INSERT pending com confirmation_timeout_at = now + seller_response_min
//      (regras REAIS do portal) + notes = briefing; falha -> reverte claim
//      (CAS) e devolve outcome_uncertain (retomável);
//   6) summary guardado ([Pedro v3]) + last_lead_received_at/contador (CAS).
//   Receipt "delivered" no sucesso (o PATCH/INSERT confirmado pelo banco É a
//   entrega — mesmo argumento do crm_write); vendedor auditável no receipt.
//
//  NotifySellerEffectDispatcher (kind "notify_seller") — composição da
//  notificação (template do portal OU fallback) + envio ao VENDEDOR resolvido
//  pela saga (lido de ai_lead_transfers — nunca palpite do modelo) + relatório
//  ao(s) GERENTE(s) best-effort (não derruba o efeito). dependsOn garante que
//  roda só APÓS o handoff entregue.
//
// Nenhum texto AO LEAD nasce aqui (P0 LLM-first): estas mensagens são
// operacionais (vendedor/gerente), como no v2.
// ============================================================================
import type { EffectResult, ToolError } from "../../domain/decision.ts";
import type { OutboxRecord } from "../../domain/effect-intent.ts";
import { redact } from "../../domain/effect-intent.ts";
import type { Clock } from "../../domain/ports.ts";
import type { TenantAgentRef } from "../../domain/read-ports.ts";
import type { JsonValue } from "../../domain/types.ts";
import type { EffectDispatcher } from "../../engine/outbox-dispatcher.ts";
import {
  composeManagerMessage, composeSellerMessage, isHandoffReasonKind, parseTransferReasonTag,
  pickFairRoundRobin, sellerPhoneKey, transferReasonTag, uniqueSellersByPhone,
  type HandoffReasonKind, type SellerCandidate,
} from "../../engine/transfer-templates.ts";
import type { TransferSagaStore } from "./transfer-store.ts";
import type { WhatsAppSendPort } from "./whatsapp-dispatcher.ts";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RENOTIFY_THROTTLE_MS = 45 * 60_000;
// Janela p/ o notify aceitar a transfer como "desta transferência" (criada pela saga
// segundos antes; retry/uncertain pode chegar minutos depois — folga sem pegar antiga).
const NOTIFY_TRANSFER_MAX_AGE_MS = 30 * 60_000;

function toolError(code: ToolError["code"], message: string, retryable: boolean): ToolError {
  return { code, message, retryable };
}
function failed(record: OutboxRecord, code: ToolError["code"], message: string, retryable: boolean): EffectResult {
  return { status: "failed", effectId: record.effectId, error: toolError(code, message, retryable) };
}
function uncertain(record: OutboxRecord, reason: string): EffectResult {
  return { status: "outcome_uncertain", effectId: record.effectId, metadata: redact({ reason } satisfies { [k: string]: JsonValue }) };
}
function delivered(record: OutboxRecord, clock: Clock, providerMessageId: string): EffectResult {
  return {
    status: "succeeded",
    effectId: record.effectId,
    receipt: { effectId: record.effectId, level: "delivered", at: clock.now(), providerMessageId: providerMessageId.slice(0, 160) },
  };
}

type HandoffPayload = { leadId: string; reason: HandoffReasonKind; briefing: string; correlationId: string };
function decodeHandoffPayload(record: OutboxRecord): HandoffPayload | null {
  const { __redacted: _r, ...p } = record.payload as Record<string, unknown>;
  const leadId = typeof p.leadId === "string" && UUID_RX.test(p.leadId) ? p.leadId : null;
  const reason = isHandoffReasonKind(p.reason) ? p.reason : null;
  const briefing = typeof p.briefing === "string" ? p.briefing : "";
  const correlationId = typeof p.correlationId === "string" ? p.correlationId.trim() : "";
  if (!leadId || !reason || !correlationId) return null;
  return { leadId, reason, briefing, correlationId };
}

export type HandoffDispatcherOptions = {
  readonly ref: TenantAgentRef;
  readonly clock: Clock;
  readonly store: TransferSagaStore;
};

export class HandoffEffectDispatcher implements EffectDispatcher {
  constructor(private readonly opts: HandoffDispatcherOptions) {}

  async dispatch(record: OutboxRecord): Promise<EffectResult> {
    if (record.kind !== "handoff") return failed(record, "FORBIDDEN", `unsupported_effect_kind:${record.kind}`, false);
    const payload = decodeHandoffPayload(record);
    if (!payload) return failed(record, "VALIDATION", "invalid_handoff_payload", false);
    const { ref, clock, store } = this.opts;
    const nowIso = clock.now();
    const nowMs = Date.parse(nowIso);

    // Config FRESCA do portal (transfer.enabled/seller_response_min podem mudar sem redeploy).
    let config;
    try {
      config = await store.loadAgentConfig(ref);
    } catch (error) {
      return uncertain(record, `transfer_config_exception:${error instanceof Error ? error.name : "Error"}`);
    }
    if (!config) return failed(record, "FORBIDDEN", "agent_config_not_found", false);
    if (!config.rules.transfer.enabled) return failed(record, "FORBIDDEN", "transfer_disabled_by_manager", false);

    // 0) lead owned (fail-closed).
    let lead;
    try {
      lead = await store.fetchOwnedLeadForTransfer(ref, payload.leadId);
    } catch (error) {
      return uncertain(record, `transfer_lead_fetch_exception:${error instanceof Error ? error.name : "Error"}`);
    }
    if (!lead) return failed(record, "FORBIDDEN", "lead_not_owned_or_missing", false);

    try {
      // 1) LEAD QUE RETORNOU: dono ATIVO -> renotify com throttle; dono inativo -> solta e segue.
      if (lead.assignedToId) {
        const owner = await store.fetchSellerById(ref.tenantId, lead.assignedToId);
        if (owner && owner.isActive) {
          const last = await store.latestTransferForLead(ref, payload.leadId);
          const lastMs = last?.createdAt ? Date.parse(last.createdAt) : 0;
          if (Number.isFinite(lastMs) && nowMs - lastMs < RENOTIFY_THROTTLE_MS) {
            return failed(record, "FORBIDDEN", "renotify_throttled", false);
          }
          const markerId = await store.insertTransfer({
            userId: ref.tenantId, leadId: payload.leadId, toMemberId: owner.id,
            reason: `${transferReasonTag("returning_lead_renotify")} [${payload.correlationId}]`,
            notes: payload.briefing, status: "confirmed", isConfirmed: true,
            confirmedAt: nowIso, confirmationTimeoutAt: nowIso,
          });
          if (!markerId) return uncertain(record, "renotify_marker_insert_failed");
          await store.updateLeadSummaryGuarded(ref, payload.leadId, payload.briefing);
          await store.markSellerReceivedLead(owner.id, nowIso);
          return delivered(record, clock, `transfer:${markerId}:seller:${owner.id}:renotify`);
        }
        if (owner && !owner.isActive) await store.releaseLeadAssignment(ref, payload.leadId);
      }

      // 2) pendente VIGENTE -> idempotente: a máquina de aceite do v2 já está rodando.
      //    FAILED não-retryable de propósito: o notify dependente é SKIPPED (o aviso da
      //    pendente original já foi/será dado por quem a criou — nunca duplica).
      const pending = await store.activePendingForLead(ref, payload.leadId);
      if (pending) {
        const timeout = pending.confirmationTimeoutAt ? Date.parse(pending.confirmationTimeoutAt) : Number.NaN;
        if (!Number.isFinite(timeout) || timeout > nowMs) {
          return failed(record, "FORBIDDEN", "transfer_already_pending", false);
        }
      }

      // 3) escolha do vendedor (anterior > roster do agente > roster do tenant; sem telefone fora).
      const seller = await this.#chooseSeller(lead.remoteJid ?? "", payload.leadId);
      if (!seller) return failed(record, "FORBIDDEN", "no_active_seller", false);

      // 4) claim atômico (0 linhas = corrida perdida: outro fluxo assumiu — não duplica).
      const claimed = await store.claimLeadForTransfer(ref, payload.leadId, nowIso);
      if (!claimed) return failed(record, "FORBIDDEN", "handoff_already_handled", false);

      // 5) pendente compatível com o aceite/rotação do v2.
      const timeoutIso = new Date(nowMs + config.rules.transfer.sellerResponseMin * 60_000).toISOString();
      const transferId = await store.insertTransfer({
        userId: ref.tenantId, leadId: payload.leadId, toMemberId: seller.id,
        reason: `${transferReasonTag(payload.reason)} [${payload.correlationId}]`,
        notes: payload.briefing, status: "pending", isConfirmed: false,
        confirmationTimeoutAt: timeoutIso,
      });
      if (!transferId) {
        await store.revertLeadClaim(ref, payload.leadId, lead.status);   // restaura o status factual anterior
        return uncertain(record, "transfer_insert_failed_claim_reverted");
      }

      // 6) summary + rodízio (best-effort; nunca derrubam a transferência já criada).
      await store.updateLeadSummaryGuarded(ref, payload.leadId, payload.briefing);
      await store.markSellerReceivedLead(seller.id, nowIso);
      return delivered(record, clock, `transfer:${transferId}:seller:${seller.id}:${payload.reason}`);
    } catch (error) {
      return uncertain(record, `handoff_saga_exception:${error instanceof Error ? error.name : "Error"}`);
    }
  }

  async #chooseSeller(remoteJid: string, currentLeadId: string): Promise<SellerCandidate | null> {
    const { ref, store } = this.opts;
    // vendedor anterior do CONTATO (tenant-wide, como o v2) — precisa estar ativo e com telefone.
    if (remoteJid.trim()) {
      const previousId = await store.findPreviousSellerId(ref.tenantId, remoteJid, currentLeadId);
      if (previousId) {
        const previous = await store.fetchSellerById(ref.tenantId, previousId);
        if (previous && previous.isActive && sellerPhoneKey(previous.whatsappNumber)) return previous;
      }
    }
    // roster do agente; vazio -> fallback tenant-wide (M4 — espelha o CRON, motor real de hoje).
    const scoped = await store.listActiveSellers(ref.tenantId, ref.agentId);
    let roster = uniqueSellersByPhone(scoped).filter((s) => sellerPhoneKey(s.whatsappNumber) !== "");
    if (roster.length === 0) {
      const tenantWide = await store.listActiveSellers(ref.tenantId, null);
      roster = uniqueSellersByPhone(tenantWide).filter((s) => sellerPhoneKey(s.whatsappNumber) !== "");
    }
    return pickFairRoundRobin(roster);
  }
}

type NotifyPayload = { leadId: string; reason: HandoffReasonKind; etiquetas: Record<string, string>; correlationId: string };
function decodeNotifyPayload(record: OutboxRecord): NotifyPayload | null {
  const { __redacted: _r, ...p } = record.payload as Record<string, unknown>;
  const leadId = typeof p.leadId === "string" && UUID_RX.test(p.leadId) ? p.leadId : null;
  const reason = isHandoffReasonKind(p.reason) ? p.reason : null;
  const rawEtiquetas = p.etiquetas;
  const correlationId = typeof p.correlationId === "string" ? p.correlationId.trim() : "";
  if (!leadId || !reason || !correlationId || typeof rawEtiquetas !== "object" || rawEtiquetas === null || Array.isArray(rawEtiquetas)) return null;
  const etiquetas: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawEtiquetas as Record<string, unknown>)) {
    if (typeof v === "string") etiquetas[k] = v;
  }
  return { leadId, reason, etiquetas, correlationId };
}

export type NotifySellerDispatcherOptions = {
  readonly ref: TenantAgentRef;
  readonly clock: Clock;
  readonly store: TransferSagaStore;
  readonly sender: WhatsAppSendPort;
};

export class NotifySellerEffectDispatcher implements EffectDispatcher {
  constructor(private readonly opts: NotifySellerDispatcherOptions) {}

  async dispatch(record: OutboxRecord): Promise<EffectResult> {
    if (record.kind !== "notify_seller") return failed(record, "FORBIDDEN", `unsupported_effect_kind:${record.kind}`, false);
    const payload = decodeNotifyPayload(record);
    if (!payload) return failed(record, "VALIDATION", "invalid_notify_payload", false);
    const { ref, clock, store, sender } = this.opts;

    let config;
    try {
      config = await store.loadAgentConfig(ref);
    } catch (error) {
      return uncertain(record, `notify_config_exception:${error instanceof Error ? error.name : "Error"}`);
    }
    if (!config) return failed(record, "FORBIDDEN", "agent_config_not_found", false);

    // Vendedor EFETIVAMENTE resolvido pela saga: a última transfer do lead, recente.
    // Nunca palpite do modelo (o payload não tem sellerId por construção).
    let transfer;
    try {
      transfer = await store.transferForCorrelation(ref, payload.leadId, payload.correlationId);
    } catch (error) {
      return uncertain(record, `notify_transfer_fetch_exception:${error instanceof Error ? error.name : "Error"}`);
    }
    const createdMs = transfer?.createdAt ? Date.parse(transfer.createdAt) : Number.NaN;
    const fresh = Number.isFinite(createdMs) && Date.parse(clock.now()) - createdMs <= NOTIFY_TRANSFER_MAX_AGE_MS;
    if (!transfer || !transfer.toMemberId || !fresh) {
      return failed(record, "VALIDATION", "transfer_record_not_found_for_notify", false);
    }
    const reason = parseTransferReasonTag(transfer.reason) ?? payload.reason;

    const seller = await store.fetchSellerById(ref.tenantId, transfer.toMemberId);
    const sellerDigits = String(seller?.whatsappNumber ?? "").replace(/\D/g, "");
    if (!seller || sellerDigits.length < 10) {
      return failed(record, "VALIDATION", "seller_without_valid_phone", false);
    }

    // Composição (template do portal OU fallback v2-compatível). O briefing integral vem
    // das notes da transfer (autoria da saga — determinístico e auditável no banco).
    const etiquetas: Record<string, string> = {
      ...payload.etiquetas,
      vendedor: seller.name ?? payload.etiquetas.vendedor ?? "",
      telefone_vendedor: seller.whatsappNumber ?? payload.etiquetas.telefone_vendedor ?? "",
      resumo: (transfer.notes ?? payload.etiquetas.resumo ?? "").substring(0, 300),
    };
    const sellerMessage = composeSellerMessage({
      template: config.briefingTemplateVendedor,
      mensagensSemEmoji: config.mensagensSemEmoji,
      etiquetas,
      reason,
      leadDisplayName: payload.etiquetas.nome ?? null,
      leadPhone: payload.etiquetas.telefone ?? null,
      agentName: config.agentName,
      briefing: transfer.notes ?? "",
      classificacaoLine: etiquetas.classificacao ? `🏷️ *Status:* ${etiquetas.classificacao}` : "",
    });

    const sent = await sender.sendText({ to: sellerDigits, text: sellerMessage, idempotencyKey: record.idempotencyKey });
    if (!sent.ok) {
      return sent.retryable
        ? uncertain(record, `notify_send_${sent.code.toLowerCase()}`)
        : failed(record, "UPSTREAM", `notify_send_${sent.code.toLowerCase()}`, false);
    }

    // Gerente(s): best-effort e NUNCA em renotify (mesma regra do v2 — sem relatório repetido).
    let managersNotified = 0;
    if (reason !== "returning_lead_renotify" && config.gerentePhones.length > 0) {
      const managerMessage = composeManagerMessage({
        template: config.briefingTemplateGerente,
        mensagensSemEmoji: config.mensagensSemEmoji,
        gerenteFeedbackCompleto: config.gerenteFeedbackCompleto,
        etiquetas,
        sellerMessage,
        sellerName: seller.name,
        sellerPhone: seller.whatsappNumber,
        agentName: config.agentName,
        leadDisplayName: payload.etiquetas.nome ?? null,
        leadPhone: payload.etiquetas.telefone ?? null,
        classificacaoText: etiquetas.classificacao ?? "",
        horario: payload.etiquetas.horario ?? "",
      });
      for (const phone of config.gerentePhones) {
        try {
          const ok = await sender.sendText({ to: phone, text: managerMessage, idempotencyKey: `${record.idempotencyKey}:mgr:${phone.slice(-4)}` });
          if (ok.ok) managersNotified += 1;
        } catch { /* best-effort: gerente nunca derruba o aviso do vendedor */ }
      }
    }

    return {
      status: "succeeded",
      effectId: record.effectId,
      receipt: {
        effectId: record.effectId,
        level: sent.level,
        at: clock.now(),
        providerMessageId: sent.providerMessageId,
      },
    };
  }
}
