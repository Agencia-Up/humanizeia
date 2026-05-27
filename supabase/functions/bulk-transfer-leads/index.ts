import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendWAMessage(instance: any, phone: string, text: string) {
  let dest = phone.replace(/\D/g, "");
  if (dest.length === 10 || dest.length === 11) dest = `55${dest}`;
  const apiUrl = (instance.api_url as string).replace(/\/+$/, "");
  const apiKey = instance.api_key_encrypted as string;

  const remoteJid = `${dest}@s.whatsapp.net`;
  const attempts = [
    { label: "send-text-number", url: `${apiUrl}/send/text`, body: { number: dest, text } },
    { label: "send-text-remotejid", url: `${apiUrl}/send/text`, body: { remoteJid, text } },
    { label: "message-sendText", url: `${apiUrl}/message/sendText/${instance.instance_name}`, body: { number: dest, text } },
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: apiKey, apikey: apiKey },
        body: JSON.stringify(attempt.body),
      });
      if (res.ok) {
        console.log(`WA send OK (${attempt.label}) to ${dest}`);
        return;
      }
      console.warn(`WA send ${attempt.label} failed to ${dest}: ${res.status}`);
    } catch (e) {
      console.warn(`WA send ${attempt.label} exception to ${dest}:`, e);
    }
  }
  console.error(`WA send FAILED all attempts to ${dest}`);
}

function sellerPhoneKey(seller: any): string {
  const digits = String(seller?.whatsapp_number || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits;
}

function uniqueSellersByPhone(sellers: any[] = []): any[] {
  const seen = new Set<string>();
  const result: any[] = [];
  for (const seller of sellers || []) {
    const key = sellerPhoneKey(seller) || String(seller?.id || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(seller);
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: userData, error: authErr } = await supabase.auth.getUser(authHeader.split(" ")[1]);
  if (authErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = userData.user.id;

  // Seller detection: if user is a seller, use their manager's ID for data queries
  const { data: profileData } = await supabase
    .from("profiles")
    .select("role, manager_id")
    .eq("id", userId)
    .single();

  const isSeller = profileData?.role === "seller" && !!profileData?.manager_id;
  const effectiveUserId = isSeller ? profileData.manager_id : userId;

  try {
    // 1. Busca todos os leads qualificados SEM vendedor atribuído
    const { data: unassigned, error: leadsErr } = await supabase
      .from("ai_crm_leads")
      .select("id, remote_jid, lead_name, summary, agent_id, status, created_at")
      .eq("user_id", effectiveUserId)
      .in("status", ["qualificado"])
      .is("assigned_to_id", null)
      .order("created_at", { ascending: true });

    if (leadsErr) throw leadsErr;

    if (!unassigned?.length) {
      return new Response(JSON.stringify({
        success: true, transferred: 0,
        message: "Nenhum lead qualificado sem vendedor encontrado.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[BulkTransfer] ${unassigned.length} leads para distribuir`);

    // 2. Busca vendedores ativos, ordenados por round-robin (quem recebeu há mais tempo vem primeiro)
    const leadAgentIds = [...new Set((unassigned || []).map((l: any) => l.agent_id).filter(Boolean))];
    let sellersQuery = supabase
      .from("ai_team_members")
      .select("*")
      .eq("user_id", effectiveUserId)
      .eq("is_active", true)
      .order("last_lead_received_at", { ascending: true, nullsFirst: true });
    if (leadAgentIds.length > 0) sellersQuery = sellersQuery.in("agent_id", leadAgentIds);

    let { data: sellers, error: sellersErr } = await sellersQuery;

    if (sellersErr) throw sellersErr;
    if (!sellers?.length) {
      const fallback = await supabase
        .from("ai_team_members")
        .select("*")
        .eq("user_id", effectiveUserId)
        .eq("is_active", true)
        .order("last_lead_received_at", { ascending: true, nullsFirst: true });
      sellers = fallback.data;
      sellersErr = fallback.error;
      if (sellersErr) throw sellersErr;
    }
    sellers = uniqueSellersByPhone(sellers || []);
    if (!sellers?.length) {
      return new Response(JSON.stringify({ error: "Nenhum vendedor ativo encontrado." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[BulkTransfer] ${sellers.length} vendedores ativos: ${sellers.map((s: any) => s.name).join(", ")}`);

    // 3. Busca instância WhatsApp conectada
    const { data: instances } = await supabase
      .from("wa_instances")
      .select("*")
      .eq("user_id", effectiveUserId)
      .eq("is_active", true)
      .eq("status", "connected")
      .limit(1);
    const instance = instances?.[0] || null;

    // 3b. Busca gerente_phone dos agentes presentes nos leads (cache por agent_id)
    const uniqueAgentIds = [...new Set((unassigned || []).map((l: any) => l.agent_id).filter(Boolean))];
    const agentGerenteMap = new Map<string, string | null>();
    if (uniqueAgentIds.length > 0) {
      const { data: agentsData } = await supabase
        .from("wa_ai_agents")
        .select("id, gerente_phone, name")
        .in("id", uniqueAgentIds);
      for (const ag of agentsData || []) {
        agentGerenteMap.set(ag.id, ag.gerente_phone || null);
      }
    }

    // 4. Distribui em round-robin
    const now = new Date().toISOString();
    const results: any[] = [];
    // Cópia mutável dos vendedores com timestamp atualizado em memória
    const sellerQueue = [...sellers];

    for (let i = 0; i < unassigned.length; i++) {
      const lead = unassigned[i];
      const seller = sellerQueue[i % sellerQueue.length];

      try {
        // 4a. Atualiza lead — SEM transferred_at/transfer_reason
        //     (essas colunas vivem em ai_lead_transfers, NÃO em ai_crm_leads).
        //     Os UPDATEs anteriores quebravam silenciosamente PostgREST.
        const { error: leadErr } = await supabase.from("ai_crm_leads").update({
          status: "transferido",
          assigned_to_id: seller.id,
          last_interaction_at: now,
        }).eq("id", lead.id);
        if (leadErr) throw leadErr;

        // 4b. Registra transfer
        const { error: trErr } = await supabase.from("ai_lead_transfers").insert({
          user_id: effectiveUserId,
          lead_id: lead.id,
          to_member_id: seller.id,
          transfer_reason: "bulk_reassign",
          notes: "Redistribuição em massa — leads qualificados sem vendedor",
          transfer_status: "confirmed",
          is_confirmed: true,
          confirmed_at: now,
        });
        if (trErr) throw trErr;

        // 4c. Atualiza stats do vendedor — SEM total_leads_received
        //     (coluna que não existe; round-robin usa só last_lead_received_at).
        const { error: memErr } = await supabase.from("ai_team_members").update({
          last_lead_received_at: now,
        }).eq("id", seller.id);
        if (memErr) throw memErr;
        // Atualiza em memória para próximas iterações
        sellerQueue[i % sellerQueue.length] = {
          ...seller,
          last_lead_received_at: now,
        };

        // 4d. Notifica vendedor via WhatsApp
        const phone = lead.remote_jid.replace(/\D/g, "");
        if (instance && seller.whatsapp_number) {
          const msg =
            `🚨 *LEAD QUALIFICADO — REDISTRIBUIÇÃO*\n\n` +
            `👤 *Nome:* ${lead.lead_name || "Sem nome"}\n` +
            `📱 *Contato:* wa.me/${phone}\n` +
            `${lead.summary ? `📝 *Resumo:* ${lead.summary.substring(0, 300)}\n` : ""}` +
            `\n⚡ *Atenda agora:* https://wa.me/${phone}`;
          await sendWAMessage(instance, seller.whatsapp_number, msg);
        }

        // 4e. Notifica Gerente via WhatsApp
        const gerentePhone = lead.agent_id ? agentGerenteMap.get(lead.agent_id) : null;
        if (instance && gerentePhone) {
          const transferredAt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
          const gerenteMsg =
            `📊 *RELATÓRIO DE LEAD — REDISTRIBUIÇÃO*\n\n` +
            `🕐 *Horário:* ${transferredAt}\n\n` +
            `👤 *Lead:* ${lead.lead_name || "Sem nome"}\n` +
            `📱 *Telefone:* wa.me/${phone}\n` +
            `${lead.summary ? `📝 *Resumo:* ${lead.summary.substring(0, 300)}\n` : ""}` +
            `\n━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🎯 *Enviado para:* ${seller.name}\n` +
            `📲 *WhatsApp vendedor:* ${seller.whatsapp_number}\n` +
            `\n━━━━━━━━━━━━━━━━━━━━\n` +
            `_Gerado automaticamente pelo Pedro SDR (redistribuição em massa)_`;
          await sendWAMessage(instance, gerentePhone, gerenteMsg);
          console.log(`[BulkTransfer] Gerente notificado sobre lead ${lead.lead_name}`);
        }

        results.push({ lead_id: lead.id, lead_name: lead.lead_name, seller: seller.name, ok: true });
        console.log(`[BulkTransfer] Lead ${lead.lead_name} → ${seller.name} ✓`);
      } catch (innerErr: any) {
        console.error(`[BulkTransfer] Erro no lead ${lead.id}:`, innerErr);
        results.push({ lead_id: lead.id, lead_name: lead.lead_name, seller: seller.name, ok: false, error: innerErr.message });
      }
    }

    const transferred = results.filter(r => r.ok).length;
    console.log(`[BulkTransfer] Concluído: ${transferred}/${unassigned.length} transferidos`);

    return new Response(JSON.stringify({
      success: true,
      transferred,
      total: unassigned.length,
      details: results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[BulkTransfer] Erro crítico:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
