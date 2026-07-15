import { remoteJidToPhone } from "./phone.ts";

export const POST_TRANSFER_SILENCE_MS = 30 * 60_000;
export const POST_TRANSFER_HOLD_MS = 24 * 60 * 60_000;

export type PostTransferAction = "continue" | "silence" | "notice_once" | "hold";

export function evaluatePostTransferAction(input: {
  transferCreatedAt: string | null;
  transferStatus: string | null;
  leadNoticeAt?: string | null;
  sellerNoticeAt?: string | null;
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
  if (ageMs < POST_TRANSFER_SILENCE_MS) {
    return { action: "silence", notifyLead: false, notifySeller: false };
  }
  const leadNoticeMs = input.leadNoticeAt ? Date.parse(input.leadNoticeAt) : Number.NaN;
  const sellerNoticeMs = input.sellerNoticeAt ? Date.parse(input.sellerNoticeAt) : Number.NaN;
  const notifyLead = !Number.isFinite(leadNoticeMs) || leadNoticeMs < transferMs;
  const notifySeller = !Number.isFinite(sellerNoticeMs) || sellerNoticeMs < transferMs;
  return { action: notifyLead || notifySeller ? "notice_once" : "hold", notifyLead, notifySeller };
}

export type PostTransferPlan = {
  readonly action: Exclude<PostTransferAction, "continue">;
  readonly tenantId: string;
  readonly agentId: string;
  readonly leadId: string;
  readonly leadName: string;
  readonly remoteJid: string;
  readonly sellerId: string | null;
  readonly transferCreatedAt: string;
  readonly notifyLead: boolean;
  readonly notifySeller: boolean;
  readonly state: Record<string, any>;
};

export async function resolvePostTransferPlan(input: {
  supabase: any;
  tenantId: string;
  agentId: string;
  remoteJid: string;
  nowMs?: number;
}): Promise<PostTransferPlan | null> {
  const { supabase, tenantId, agentId, remoteJid } = input;
  const { data: lead } = await supabase.from("ai_crm_leads")
    .select("id,lead_name,remote_jid")
    .eq("user_id", tenantId).eq("agent_id", agentId).eq("remote_jid", remoteJid)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!lead?.id) return null;

  const { data: transfer } = await supabase.from("ai_lead_transfers")
    .select("created_at,transfer_status,to_member_id")
    .eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!transfer?.created_at) return null;

  const { data: memoryRow } = await supabase.from("pedro_conversation_state")
    .select("state").eq("lead_id", lead.id).eq("agent_id", agentId).maybeSingle();
  const state = memoryRow?.state && typeof memoryRow.state === "object" ? memoryRow.state : {};
  const atendimento = state?.atendimento && typeof state.atendimento === "object" ? state.atendimento : {};
  const evaluated = evaluatePostTransferAction({
    transferCreatedAt: transfer.created_at,
    transferStatus: transfer.transfer_status,
    leadNoticeAt: atendimento.transfer_notice_at,
    sellerNoticeAt: atendimento.transfer_seller_renotified_at,
    nowMs: input.nowMs ?? Date.now(),
  });
  if (evaluated.action === "continue") return null;
  const sellerId = typeof transfer.to_member_id === "string" ? transfer.to_member_id : null;
  const notifySeller = evaluated.notifySeller && sellerId !== null;
  const action = evaluated.action === "notice_once" && !evaluated.notifyLead && !notifySeller
    ? "hold"
    : evaluated.action;
  return {
    action,
    tenantId, agentId, leadId: lead.id,
    leadName: String(lead.lead_name || "O lead"),
    remoteJid,
    sellerId,
    transferCreatedAt: transfer.created_at,
    notifyLead: evaluated.notifyLead,
    notifySeller,
    state,
  };
}

export async function executePostTransferPlan(input: {
  supabase: any;
  instance: any;
  plan: PostTransferPlan;
  nowIso?: string;
  sendText: (instance: any, input: { to: string; text: string }, options?: { humanize?: boolean }) => Promise<any>;
}): Promise<void> {
  const { supabase, instance, plan, sendText } = input;
  if (plan.action !== "notice_once") return;
  const nowIso = input.nowIso || new Date().toISOString();
  const atendimento = plan.state?.atendimento && typeof plan.state.atendimento === "object"
    ? { ...plan.state.atendimento }
    : {};

  if (plan.notifyLead) {
    const result = await sendText(instance, {
      to: remoteJidToPhone(plan.remoteJid),
      text: "Seu atendimento ja esta com um dos nossos consultores de vendas. Ele entrara em contato com voce; e so aguardar um momento.",
    }, { humanize: false }).catch(() => null);
    if (result?.ok) atendimento.transfer_notice_at = nowIso;
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
      if (result?.ok) atendimento.transfer_seller_renotified_at = nowIso;
    }
  }

  await supabase.from("pedro_conversation_state").upsert({
    lead_id: plan.leadId,
    agent_id: plan.agentId,
    user_id: plan.tenantId,
    state: { ...plan.state, atendimento },
    updated_at: nowIso,
  }, { onConflict: "lead_id,agent_id" });
}
