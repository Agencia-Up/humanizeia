import { remoteJidToPhone } from "./phone.ts";

export const POST_TRANSFER_SILENCE_MS = 30 * 60_000;
export const POST_TRANSFER_HOLD_MS = 24 * 60 * 60_000;
export const POST_TRANSFER_LEAD_RECEIPT_TEXT =
  "Seu atendimento já está com um dos nossos consultores, que dará continuidade ao contato. Obrigado pela preferência!";

export type PostTransferAction = "continue" | "silence" | "notice_once" | "hold";

type SendText = (
  instance: any,
  input: { to: string; text: string },
  options?: { humanize?: boolean },
) => Promise<any>;

function isConfirmedTransfer(input: { transferStatus: string | null; transferConfirmed?: boolean | null }): boolean {
  return input.transferConfirmed === true || String(input.transferStatus || "").toLowerCase() === "confirmed";
}

function noticeBelongsToTransfer(input: {
  transferId?: string | null;
  transferCreatedAt: string | null;
  noticeTransferId?: string | null;
  noticeAt?: string | null;
}): boolean {
  if (input.transferId && input.noticeTransferId) return input.transferId === input.noticeTransferId;
  const transferMs = input.transferCreatedAt ? Date.parse(input.transferCreatedAt) : Number.NaN;
  const noticeMs = input.noticeAt ? Date.parse(input.noticeAt) : Number.NaN;
  return Number.isFinite(transferMs) && Number.isFinite(noticeMs) && noticeMs >= transferMs;
}

export function evaluatePostTransferAction(input: {
  transferId?: string | null;
  transferCreatedAt: string | null;
  transferStatus: string | null;
  transferConfirmed?: boolean | null;
  leadNoticeAt?: string | null;
  leadNoticeTransferId?: string | null;
  sellerNoticeAt?: string | null;
  sellerNoticeTransferId?: string | null;
  nowMs: number;
}): { action: PostTransferAction; notifyLead: boolean; notifySeller: boolean } {
  const transferMs = input.transferCreatedAt ? Date.parse(input.transferCreatedAt) : Number.NaN;
  const status = String(input.transferStatus || "").toLowerCase();
  if (!Number.isFinite(transferMs) || ["expired", "failed", "rejected", "canceled", "cancelled"].includes(status)) {
    return { action: "continue", notifyLead: false, notifySeller: false };
  }

  const ageMs = input.nowMs - transferMs;
  if (ageMs < 0 || ageMs >= POST_TRANSFER_HOLD_MS) {
    return { action: "continue", notifyLead: false, notifySeller: false };
  }

  // A transferência pendente ainda pode expirar e rodar para outro vendedor. Antes
  // do OK não existe dono firme, portanto nunca informamos ao cliente que já existe.
  if (!isConfirmedTransfer(input)) {
    return {
      action: ageMs < POST_TRANSFER_SILENCE_MS ? "silence" : "hold",
      notifyLead: false,
      notifySeller: false,
    };
  }

  const leadWasNotified = noticeBelongsToTransfer({
    transferId: input.transferId,
    transferCreatedAt: input.transferCreatedAt,
    noticeTransferId: input.leadNoticeTransferId,
    noticeAt: input.leadNoticeAt,
  });
  const sellerWasNotified = noticeBelongsToTransfer({
    transferId: input.transferId,
    transferCreatedAt: input.transferCreatedAt,
    noticeTransferId: input.sellerNoticeTransferId,
    noticeAt: input.sellerNoticeAt,
  });

  // O recibo ao cliente nasce assim que o vendedor confirma. A re-notificação do
  // vendedor continua independente e só vence depois da janela já existente.
  const notifyLead = !leadWasNotified;
  const notifySeller = ageMs >= POST_TRANSFER_SILENCE_MS && !sellerWasNotified;
  if (notifyLead || notifySeller) {
    return { action: "notice_once", notifyLead, notifySeller };
  }
  return {
    action: ageMs < POST_TRANSFER_SILENCE_MS ? "silence" : "hold",
    notifyLead: false,
    notifySeller: false,
  };
}

export type PostTransferPlan = {
  readonly action: Exclude<PostTransferAction, "continue">;
  readonly tenantId: string;
  readonly agentId: string;
  readonly leadId: string;
  readonly leadName: string;
  readonly remoteJid: string;
  readonly sellerId: string | null;
  readonly transferId: string;
  readonly transferCreatedAt: string;
  readonly notifyLead: boolean;
  readonly notifySeller: boolean;
};

async function loadConversationState(input: {
  supabase: any;
  leadId: string;
  agentId: string;
}): Promise<Record<string, any>> {
  const { data: memoryRow } = await input.supabase.from("pedro_conversation_state")
    .select("state").eq("lead_id", input.leadId).eq("agent_id", input.agentId).maybeSingle();
  return memoryRow?.state && typeof memoryRow.state === "object" ? memoryRow.state : {};
}

async function recordPostTransferMarkers(input: {
  supabase: any;
  tenantId: string;
  agentId: string;
  leadId: string;
  transferId: string;
  nowIso: string;
  leadNotified?: boolean;
  sellerNotified?: boolean;
}): Promise<boolean> {
  if (!input.leadNotified && !input.sellerNotified) return true;
  const state = await loadConversationState(input);
  const atendimento = state?.atendimento && typeof state.atendimento === "object"
    ? { ...state.atendimento }
    : {};
  if (input.leadNotified) {
    atendimento.transfer_notice_at = input.nowIso;
    atendimento.transfer_notice_transfer_id = input.transferId;
  }
  if (input.sellerNotified) {
    atendimento.transfer_seller_renotified_at = input.nowIso;
    atendimento.transfer_seller_renotified_transfer_id = input.transferId;
  }
  const { error } = await input.supabase.from("pedro_conversation_state").upsert({
    lead_id: input.leadId,
    agent_id: input.agentId,
    user_id: input.tenantId,
    state: { ...state, atendimento },
    updated_at: input.nowIso,
  }, { onConflict: "lead_id,agent_id" });
  return !error;
}

export async function resolvePostTransferPlan(input: {
  supabase: any;
  tenantId: string;
  agentId: string;
  remoteJid: string;
  nowMs?: number;
}): Promise<PostTransferPlan | null> {
  const { supabase, tenantId, agentId, remoteJid } = input;
  const { data: lead } = await supabase.from("ai_crm_leads")
    .select("id,lead_name,remote_jid,assigned_to_id")
    .eq("user_id", tenantId).eq("agent_id", agentId).eq("remote_jid", remoteJid)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!lead?.id) return null;

  const { data: transfer } = await supabase.from("ai_lead_transfers")
    .select("id,created_at,transfer_status,is_confirmed,to_member_id")
    .eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!transfer?.id || !transfer?.created_at) return null;

  const state = await loadConversationState({ supabase, leadId: lead.id, agentId });
  const atendimento = state?.atendimento && typeof state.atendimento === "object" ? state.atendimento : {};
  const evaluated = evaluatePostTransferAction({
    transferId: transfer.id,
    transferCreatedAt: transfer.created_at,
    transferStatus: transfer.transfer_status,
    transferConfirmed: transfer.is_confirmed,
    leadNoticeAt: atendimento.transfer_notice_at,
    leadNoticeTransferId: atendimento.transfer_notice_transfer_id,
    sellerNoticeAt: atendimento.transfer_seller_renotified_at,
    sellerNoticeTransferId: atendimento.transfer_seller_renotified_transfer_id,
    nowMs: input.nowMs ?? Date.now(),
  });
  if (evaluated.action === "continue") return null;
  const sellerId = typeof transfer.to_member_id === "string" ? transfer.to_member_id : null;
  // Uma transfer confirmada e a atribuicao do CRM precisam apontar para o mesmo
  // vendedor. Se o banco estiver parcialmente inconsistente, mantemos o hold,
  // mas nunca afirmamos posse ao cliente nem notificamos o vendedor errado.
  const assignmentMatches = sellerId !== null && lead.assigned_to_id === sellerId;
  const notifyLead = evaluated.notifyLead && assignmentMatches;
  const notifySeller = evaluated.notifySeller && assignmentMatches;
  const action = evaluated.action === "notice_once" && !notifyLead && !notifySeller
    ? "hold"
    : evaluated.action;
  return {
    action,
    tenantId,
    agentId,
    leadId: lead.id,
    leadName: String(lead.lead_name || "O lead"),
    remoteJid,
    sellerId,
    transferId: transfer.id,
    transferCreatedAt: transfer.created_at,
    notifyLead,
    notifySeller,
  };
}

export type LeadTransferReceiptResult = {
  status:
    | "sent"
    | "already_sent"
    | "not_confirmed"
    | "seller_mismatch"
    | "transfer_not_found"
    | "lead_not_found"
    | "lead_not_assigned"
    | "lead_instance_not_found"
    | "send_failed"
    | "sent_unrecorded";
  ok: boolean;
  transferId: string;
};

export async function sendLeadTransferConfirmationReceipt(input: {
  supabase: any;
  instance: any;
  tenantId: string;
  transferId: string;
  sellerId?: string | null;
  nowIso?: string;
  sendText: SendText;
}): Promise<LeadTransferReceiptResult> {
  const base = { transferId: input.transferId };
  const { data: transfer } = await input.supabase.from("ai_lead_transfers")
    .select("id,lead_id,to_member_id,transfer_status,is_confirmed,created_at")
    .eq("id", input.transferId).eq("user_id", input.tenantId).maybeSingle();
  if (!transfer?.id || !transfer?.lead_id) return { ...base, ok: false, status: "transfer_not_found" };
  if (!isConfirmedTransfer({ transferStatus: transfer.transfer_status, transferConfirmed: transfer.is_confirmed })) {
    return { ...base, ok: false, status: "not_confirmed" };
  }
  if (input.sellerId && transfer.to_member_id && input.sellerId !== transfer.to_member_id) {
    return { ...base, ok: false, status: "seller_mismatch" };
  }

  const { data: lead } = await input.supabase.from("ai_crm_leads")
    .select("id,agent_id,remote_jid,assigned_to_id,instance_id")
    .eq("id", transfer.lead_id).eq("user_id", input.tenantId).maybeSingle();
  if (!lead?.id || !lead?.agent_id || !lead?.remote_jid) return { ...base, ok: false, status: "lead_not_found" };
  if (!transfer.to_member_id || lead.assigned_to_id !== transfer.to_member_id) {
    return { ...base, ok: false, status: "lead_not_assigned" };
  }

  const state = await loadConversationState({ supabase: input.supabase, leadId: lead.id, agentId: lead.agent_id });
  const atendimento = state?.atendimento && typeof state.atendimento === "object" ? state.atendimento : {};
  if (noticeBelongsToTransfer({
    transferId: transfer.id,
    transferCreatedAt: transfer.created_at,
    noticeTransferId: atendimento.transfer_notice_transfer_id,
    noticeAt: atendimento.transfer_notice_at,
  })) {
    return { ...base, ok: true, status: "already_sent" };
  }

  // O "Ok" pode chegar pela linha particular do vendedor. O recibo ao cliente
  // precisa, contudo, sair pela instancia que originou a conversa do lead. Se a
  // instancia original esta registrada e nao pode ser resolvida, falhamos sem
  // enviar por outro numero — usar a linha do vendedor seria uma troca silenciosa.
  let deliveryInstance = input.instance;
  const leadInstanceId = typeof lead.instance_id === "string" && lead.instance_id.trim()
    ? lead.instance_id.trim()
    : null;
  if (leadInstanceId && input.instance?.id !== leadInstanceId) {
    const { data: leadInstance } = await input.supabase.from("wa_instances")
      .select("*")
      .eq("id", leadInstanceId)
      .eq("user_id", input.tenantId)
      .maybeSingle();
    if (!leadInstance?.id) return { ...base, ok: false, status: "lead_instance_not_found" };
    deliveryInstance = leadInstance;
  }
  if (!deliveryInstance) return { ...base, ok: false, status: "lead_instance_not_found" };

  const result = await input.sendText(deliveryInstance, {
    to: remoteJidToPhone(lead.remote_jid),
    text: POST_TRANSFER_LEAD_RECEIPT_TEXT,
  }, { humanize: false }).catch(() => null);
  if (!result?.ok) return { ...base, ok: false, status: "send_failed" };

  const recorded = await recordPostTransferMarkers({
    supabase: input.supabase,
    tenantId: input.tenantId,
    agentId: lead.agent_id,
    leadId: lead.id,
    transferId: transfer.id,
    nowIso: input.nowIso || new Date().toISOString(),
    leadNotified: true,
  });
  return { ...base, ok: recorded, status: recorded ? "sent" : "sent_unrecorded" };
}

export async function executePostTransferPlan(input: {
  supabase: any;
  instance: any;
  plan: PostTransferPlan;
  nowIso?: string;
  sendText: SendText;
}): Promise<void> {
  const { supabase, instance, plan, sendText } = input;
  if (plan.action !== "notice_once") return;
  const nowIso = input.nowIso || new Date().toISOString();
  let leadNotified = false;
  let sellerNotified = false;

  if (plan.notifyLead) {
    const result = await sendText(instance, {
      to: remoteJidToPhone(plan.remoteJid),
      text: POST_TRANSFER_LEAD_RECEIPT_TEXT,
    }, { humanize: false }).catch(() => null);
    leadNotified = result?.ok === true;
  }

  if (plan.notifySeller && plan.sellerId) {
    const { data: seller } = await supabase.from("ai_team_members")
      .select("whatsapp_number").eq("id", plan.sellerId).eq("user_id", plan.tenantId).maybeSingle();
    if (seller?.whatsapp_number) {
      const phone = remoteJidToPhone(plan.remoteJid);
      const result = await sendText(instance, {
        to: seller.whatsapp_number,
        text: `O lead ${plan.leadName} voltou a responder. Confira a conversa quando puder.\n\nAtender: https://wa.me/${phone}`,
      }, { humanize: false }).catch(() => null);
      sellerNotified = result?.ok === true;
    }
  }

  if (leadNotified || sellerNotified) {
    const recorded = await recordPostTransferMarkers({
      supabase,
      tenantId: plan.tenantId,
      agentId: plan.agentId,
      leadId: plan.leadId,
      transferId: plan.transferId,
      nowIso,
      leadNotified,
      sellerNotified,
    });
    if (!recorded) {
      console.error(`[pedro-v3-post-transfer] marker_write_failed transfer=${plan.transferId} lead=${plan.leadId}`);
    }
  }
}
