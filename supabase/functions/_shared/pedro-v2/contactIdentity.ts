import { PedroV2Identity } from "./types.ts";
import { phonesMatch, remoteJidToPhone } from "./phone.ts";

export async function identifyPedroContact(
  supabase: any,
  input: { user_id: string; agent_id?: string | null; remote_jid: string },
): Promise<PedroV2Identity> {
  const phone = remoteJidToPhone(input.remote_jid);
  const { data: sellers, error } = await supabase
    .from("ai_team_members")
    .select("id, user_id, agent_id, name, whatsapp_number, is_active, auth_user_id, total_leads_received, last_lead_received_at")
    .eq("user_id", input.user_id)
    .eq("is_active", true)
    .limit(500);

  if (error) {
    return {
      kind: "unknown",
      phone,
      remote_jid: input.remote_jid,
      reason: `seller_lookup_error:${error.message}`,
    };
  }

  const matches = (sellers || [])
    .filter((seller: any) => phonesMatch(seller.whatsapp_number, phone))
    .sort((a: any, b: any) => {
      const aSameAgent = a.agent_id === input.agent_id ? 1 : 0;
      const bSameAgent = b.agent_id === input.agent_id ? 1 : 0;
      if (aSameAgent !== bSameAgent) return bSameAgent - aSameAgent;
      return Number(Boolean(b.auth_user_id)) - Number(Boolean(a.auth_user_id));
    });

  if (matches.length > 0) {
    return {
      kind: "seller",
      phone,
      remote_jid: input.remote_jid,
      seller: matches[0],
      seller_matches: matches,
      reason: "phone_matches_active_seller",
    };
  }

  return {
    kind: "lead",
    phone,
    remote_jid: input.remote_jid,
    reason: "no_seller_phone_match",
  };
}

