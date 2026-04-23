import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.split(" ")[1]);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { leadId, memberId, notes } = await req.json();

    if (!leadId || !memberId) {
      return new Response(JSON.stringify({ error: "leadId and memberId are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Fetch lead details
    const { data: lead, error: leadErr } = await supabase
      .from("ai_crm_leads")
      .select("*, agent:wa_ai_agents(*)")
      .eq("id", leadId)
      .eq("user_id", userId)
      .single();

    if (leadErr || !lead) {
      return new Response(JSON.stringify({ error: "Lead not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch member details
    const { data: member, error: memberErr } = await supabase
      .from("ai_team_members")
      .select("*")
      .eq("id", memberId)
      .eq("user_id", userId)
      .single();

    if (memberErr || !member) {
      return new Response(JSON.stringify({ error: "Member not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Fetch instance for sending
    const { data: instance, error: instErr } = await supabase
      .from("wa_instances")
      .select("*")
      .eq("user_id", userId)
      .limit(1)
      .single();

    if (instErr || !instance) {
      return new Response(JSON.stringify({ error: "WhatsApp instance not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const phone = lead.remote_jid.replace(/\D/g, "");
    const pushName = lead.lead_name || "Não informado";
    const agentName = lead.agent?.name || "Pedro";
    
    const sellerMsg = `🚨 *TRANSFERÊNCIA MANUAL DE LEAD*

👤 *Nome do Cliente:* ${pushName}
📱 *Contato:* ${phone}
🤖 *Agente IA:* ${agentName}

━━━━━━━━━━━━━━━━━━━━

📝 *Observação:*
${notes || "Sem observações adicionais."}

━━━━━━━━━━━━━━━━━━━━

👉 *Atender agora:* https://wa.me/${phone}

⚡ O cliente está aguardando seu contato!`;

    // 4. Send message to seller
    let sellerPhone = member.whatsapp_number.replace(/\D/g, "");
    if (sellerPhone.length === 10 || sellerPhone.length === 11) {
      sellerPhone = `55${sellerPhone}`;
    }

    const apiUrl = (instance.api_url as string).replace(/\/+$/, "");
    const apiKey = instance.api_key_encrypted as string;

    const sRes = await fetch(`${apiUrl}/message/sendText/${instance.instance_name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({ number: sellerPhone, text: sellerMsg }),
    });

    if (!sRes.ok) {
      console.error(`Error sending to seller: ${sRes.status} - ${await sRes.text()}`);
    }

    // 5. Update Lead
    await supabase.from("ai_crm_leads").update({
      status: "transferido",
      assigned_to_member_id: member.id,
      transferred_at: new Date().toISOString(),
      transfer_reason: `Transferência manual para ${member.name}`,
      last_interaction_at: new Date().toISOString(),
    }).eq("id", lead.id);

    // 6. Record transfer
    await supabase.from("ai_lead_transfers").insert({
      user_id: userId,
      lead_id: lead.id,
      from_agent_id: lead.agent_id,
      to_member_id: member.id,
      transfer_reason: "manual",
      notes: notes,
    });

    // 7. Update member stats
    await supabase.from("ai_team_members").update({
      last_lead_received_at: new Date().toISOString(),
      total_leads_received: (member.total_leads_received || 0) + 1,
    }).eq("id", member.id);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Manual transfer error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
