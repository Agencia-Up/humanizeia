import { phonesMatch } from "./phone.ts";

export async function findPreviousSellerForLead(
  supabase: any,
  input: { user_id: string; remote_jid: string; current_lead_id?: string | null },
) {
  const { data: leads } = await supabase
    .from("ai_crm_leads")
    .select("id, assigned_to_id, created_at, last_interaction_at")
    .eq("user_id", input.user_id)
    .eq("remote_jid", input.remote_jid)
    .order("created_at", { ascending: false })
    .limit(25);

  const candidates = (leads || []).filter((lead: any) => lead.id !== input.current_lead_id);
  const candidateIds = candidates.map((lead: any) => lead.id).filter(Boolean);

  if (candidateIds.length > 0) {
    const { data: confirmedTransfers } = await supabase
      .from("ai_lead_transfers")
      .select("lead_id, to_member_id, transfer_status, is_confirmed, created_at")
      .in("lead_id", candidateIds)
      .eq("transfer_status", "confirmed")
      .order("created_at", { ascending: false })
      .limit(25);

    const lastConfirmed = (confirmedTransfers || []).find((transfer: any) => transfer.to_member_id);
    if (lastConfirmed?.to_member_id) {
      const { data: seller } = await supabase
        .from("ai_team_members")
        .select("*")
        .eq("id", lastConfirmed.to_member_id)
        .eq("is_active", true)
        .maybeSingle();
      if (seller) return { seller, reason: "previous_confirmed_transfer" };
    }
  }

  const assignedLead = candidates
    .filter((lead: any) => lead.assigned_to_id)
    .sort((a: any, b: any) =>
      new Date(b.last_interaction_at || b.created_at || 0).getTime() -
      new Date(a.last_interaction_at || a.created_at || 0).getTime()
    )[0];

  if (assignedLead?.assigned_to_id) {
    const { data: seller } = await supabase
      .from("ai_team_members")
      .select("*")
      .eq("id", assignedLead.assigned_to_id)
      .eq("is_active", true)
      .maybeSingle();
    if (seller) return { seller, reason: "previous_assigned_lead" };
  }

  return { seller: null, reason: "no_previous_seller" };
}

export async function chooseSellerForPedroTransfer(
  supabase: any,
  input: { user_id: string; agent_id: string; remote_jid: string; lead_id?: string | null },
) {
  const previous = await findPreviousSellerForLead(supabase, {
    user_id: input.user_id,
    remote_jid: input.remote_jid,
    current_lead_id: input.lead_id,
  });
  if (previous.seller) return previous;

  const { data: sellers, error } = await supabase
    .from("ai_team_members")
    .select("*")
    .eq("user_id", input.user_id)
    .eq("agent_id", input.agent_id)
    .eq("is_active", true)
    .order("total_leads_received", { ascending: true })
    .order("last_lead_received_at", { ascending: true, nullsFirst: true })
    .limit(50);

  if (error) throw error;
  const seller = (sellers || [])[0] || null;
  return { seller, reason: seller ? "round_robin_next_seller" : "no_active_seller" };
}

export async function confirmSellerAck(
  supabase: any,
  input: { user_id: string; agent_id?: string | null; seller_phone: string; commit: boolean },
) {
  const { data: sellers } = await supabase
    .from("ai_team_members")
    .select("id, name, whatsapp_number, agent_id, auth_user_id")
    .eq("user_id", input.user_id)
    .eq("is_active", true)
    .limit(500);

  const matches = (sellers || []).filter((seller: any) => phonesMatch(seller.whatsapp_number, input.seller_phone));
  if (matches.length === 0) return { ok: false, reason: "seller_not_found" };

  const sellerIds = matches.map((seller: any) => seller.id);
  const { data: pendingTransfer } = await supabase
    .from("ai_lead_transfers")
    .select("id, lead_id, to_member_id, transfer_status, is_confirmed, created_at")
    .in("to_member_id", sellerIds)
    .eq("transfer_status", "pending")
    .eq("is_confirmed", false)
    .not("lead_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pendingTransfer) return { ok: true, seller: matches[0], confirmed: false, reason: "no_pending_transfer" };
  if (!input.commit) return { ok: true, seller: matches[0], transfer: pendingTransfer, confirmed: false, dry_run: true };

  const now = new Date().toISOString();
  await supabase
    .from("ai_lead_transfers")
    .update({ transfer_status: "confirmed", is_confirmed: true, confirmed_at: now })
    .eq("id", pendingTransfer.id);

  await supabase
    .from("ai_crm_leads")
    .update({
      assigned_to_id: pendingTransfer.to_member_id || matches[0].id,
      status: "em_atendimento",
      last_interaction_at: now,
    })
    .eq("id", pendingTransfer.lead_id);

  await supabase
    .from("ai_team_members")
    .update({ last_lead_received_at: now })
    .eq("id", pendingTransfer.to_member_id || matches[0].id);

  return { ok: true, seller: matches[0], transfer: pendingTransfer, confirmed: true };
}

