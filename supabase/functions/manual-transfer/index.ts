import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Send a WhatsApp text message via UazAPI / Evolution (3 fallback attempts) */
async function sendWAMessage(instance: any, phone: string, text: string) {
  let dest = phone.replace(/\D/g, "");
  if (dest.length === 10 || dest.length === 11) dest = `55${dest}`;
  const baseUrl = (instance.api_url as string).replace(/\/+$/, "");
  const instKey = instance.api_key_encrypted || instance.api_key || "";
  const remoteJid = `${dest}@s.whatsapp.net`;

  const attempts = [
    { label: "send-text-number", url: `${baseUrl}/send/text`, body: { number: dest, text } },
    { label: "send-text-remotejid", url: `${baseUrl}/send/text`, body: { remoteJid, text } },
    { label: "message-sendText", url: `${baseUrl}/message/sendText/${instance.instance_name}`, body: { number: dest, text } },
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: instKey, apikey: instKey },
        body: JSON.stringify(attempt.body),
      });
      if (res.ok) {
        console.log(`WA send OK (${attempt.label}) to ${dest}`);
        return;
      }
      console.warn(`WA send ${attempt.label} failed: ${res.status}`);
    } catch (err) {
      console.warn(`WA send ${attempt.label} error:`, err);
    }
  }
  console.error(`WA send FAILED all attempts to ${dest}`);
}

/** Upsert lead as wa_contact in Marcos + link to Pedro Leads list */
async function syncLeadToMarcos(supabase: any, userId: string, lead: any, member: any) {
  try {
    const phone = lead.remote_jid.replace(/\D/g, "");
    const name = lead.lead_name || phone;

    // 1. Ensure "Leads Pedro CRM" contact list exists
    const listName = "Leads Pedro CRM";
    let listId: string;
    const { data: existingList } = await supabase
      .from("wa_contact_lists")
      .select("id")
      .eq("user_id", userId)
      .eq("name", listName)
      .maybeSingle();

    if (existingList?.id) {
      listId = existingList.id;
    } else {
      const { data: newList, error: listErr } = await supabase
        .from("wa_contact_lists")
        .insert({ user_id: userId, name: listName, description: "Leads qualificados pelo Pedro SDR" })
        .select("id")
        .single();
      if (listErr) throw listErr;
      listId = newList.id;
    }

    // 2. Upsert contact
    const { data: contact, error: contactErr } = await supabase
      .from("wa_contacts")
      .upsert(
        {
          user_id: userId,
          list_id: listId,
          phone,
          name,
          is_valid: true,
          metadata: {
            lead_status: lead.status,
            lead_summary: lead.summary,
            qualified_by: "Pedro SDR",
            assigned_to: member.name,
            assigned_to_phone: member.whatsapp_number || null,
            transferred_at: new Date().toISOString(),
            transfer_reason: "manual",
            agent_name: lead.agent?.name || "Pedro",
            synced_at: new Date().toISOString(),
          },
        },
        { onConflict: "user_id,list_id,phone", ignoreDuplicates: false }
      )
      .select("id")
      .single();

    if (contactErr) console.warn("wa_contacts upsert warning:", contactErr);
    console.log(`Lead ${phone} synced to Marcos list '${listName}' — vendedor: ${member.name} (${member.whatsapp_number}) — contact: ${contact?.id}`);
  } catch (err) {
    console.warn("syncLeadToMarcos failed (non-critical):", err);
  }
}

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

    // 3. Fetch agent config (for gerente_phone + instance_ids)
    const { data: agentConfig } = await supabase
      .from("wa_ai_agents")
      .select("gerente_phone, name, instance_ids, instance_id")
      .eq("id", lead.agent_id)
      .maybeSingle();

    // 4. Fetch WhatsApp instance — prioriza a instância do agente
    let instance: any = null;
    const agentInstanceIds: string[] = agentConfig?.instance_ids || [];
    if (agentConfig?.instance_id) agentInstanceIds.push(agentConfig.instance_id);

    if (agentInstanceIds.length > 0) {
      const { data: agentInstances } = await supabase
        .from("wa_instances")
        .select("*")
        .in("id", agentInstanceIds)
        .limit(1);
      instance = agentInstances?.[0] || null;
    }

    // Fallback: qualquer instância conectada do usuário
    if (!instance) {
      const { data: fallbackInstances } = await supabase
        .from("wa_instances")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)
        .eq("status", "connected")
        .limit(1);
      instance = fallbackInstances?.[0] || null;
    }

    if (!instance) {
      console.error("[manual-transfer] Nenhuma instância WhatsApp encontrada");
    }

    const phone = lead.remote_jid.replace(/\D/g, "");
    const pushName = lead.lead_name || "Não informado";
    const agentName = agentConfig?.name || lead.agent?.name || "Pedro";
    const transferredAt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

    // 5. Send WhatsApp to SELLER
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

    if (instance) {
      await sendWAMessage(instance, member.whatsapp_number, sellerMsg);
    }

    // 6. Send WhatsApp REPORT to MANAGER (gerente)
    const gerentePhone = agentConfig?.gerente_phone;
    if (instance && gerentePhone) {
      const gerenteMsg = `📊 *RELATÓRIO DE LEAD — ${agentName}*

🕐 *Horário:* ${transferredAt}

👤 *Lead:* ${pushName}
📱 *Telefone:* ${phone}
📊 *Status:* ${lead.status || "qualificado"}
${lead.summary ? `\n📝 *Resumo:* ${lead.summary.substring(0, 300)}` : ""}

━━━━━━━━━━━━━━━━━━━━

🎯 *Enviado para:* ${member.name}
📲 *WhatsApp vendedor:* ${member.whatsapp_number}
${notes ? `\n💬 *Observação:* ${notes}` : ""}

━━━━━━━━━━━━━━━━━━━━
_Gerado automaticamente pelo Pedro SDR_`;

      await sendWAMessage(instance, gerentePhone, gerenteMsg);
    }

    // 7. Update Lead
    await supabase.from("ai_crm_leads").update({
      status: "transferido",
      assigned_to_id: member.id,
      last_interaction_at: new Date().toISOString(),
    }).eq("id", lead.id);

    // 8. Record transfer
    await supabase.from("ai_lead_transfers").insert({
      user_id: userId,
      lead_id: lead.id,
      from_member_id: lead.assigned_to_id,
      to_member_id: member.id,
      transfer_reason: "manual",
      notes: notes,
      is_confirmed: true,
      transfer_status: 'confirmed',
      confirmed_at: new Date().toISOString()
    });

    // 9. Update member stats
    await supabase.from("ai_team_members").update({
      last_lead_received_at: new Date().toISOString(),
    }).eq("id", member.id);

    // 10. Sync lead to Marcos contact list (non-blocking)
    syncLeadToMarcos(supabase, userId, lead, member);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Manual transfer error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
