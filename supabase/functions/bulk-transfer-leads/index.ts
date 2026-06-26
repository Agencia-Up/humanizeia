import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { managerPhones } from "../_shared/transfer/managers.ts";
import { composeSellerMsg, composeGerenteMsg, buildEtiquetas, maybeStripEmojis } from "../_shared/transfer/messageTemplates.ts";

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
    // FASE 5 BUG-17: aceita mais status além de 'qualificado'. Antes pegava
    // só leads com status='qualificado', deixando órfãos com pouco/medio
    // qualificado fora da redistribuição. Master agora consegue redistribuir
    // qualquer lead "em jogo" que ficou sem vendedor.
    const { data: unassigned, error: leadsErr } = await supabase
      .from("ai_crm_leads")
      .select("id, remote_jid, lead_name, summary, agent_id, status, created_at")
      .eq("user_id", effectiveUserId)
      .in("status", ["qualificado", "medio_qualificado", "pouco_qualificado", "transferido"])
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
      .order("total_leads_received", { ascending: true })
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
        .order("total_leads_received", { ascending: true })
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

    // 3b. Busca gerentes (ate 2) dos agentes presentes nos leads (cache por agent_id)
    const uniqueAgentIds = [...new Set((unassigned || []).map((l: any) => l.agent_id).filter(Boolean))];
    const agentMap = new Map<string, any>();
    if (uniqueAgentIds.length > 0) {
      const { data: agentsData } = await supabase
        .from("wa_ai_agents")
        .select("id, gerente_phone, gerente_phone_2, name, gerente_feedback_completo, mensagens_sem_emoji, briefing_template_vendedor, briefing_template_gerente")
        .in("id", uniqueAgentIds);
      for (const ag of agentsData || []) {
        agentMap.set(ag.id, ag);
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

        // 4c. Atualiza stats do vendedor — a fila usa menor total_leads_received
        //     e, em empate, o last_lead_received_at mais antigo.
        const { error: memErr } = await supabase.from("ai_team_members").update({
          last_lead_received_at: now,
          total_leads_received: (seller.total_leads_received || 0) + 1,
        }).eq("id", seller.id);
        if (memErr) throw memErr;
        // Atualiza em memória para próximas iterações
        sellerQueue[i % sellerQueue.length] = {
          ...seller,
          last_lead_received_at: now,
          total_leads_received: (seller.total_leads_received || 0) + 1,
        };

        // 4d. Notifica vendedor via WhatsApp (respeita template/sem-emoji do agente)
        const phone = lead.remote_jid.replace(/\D/g, "");
        const _ag = lead.agent_id ? agentMap.get(lead.agent_id) : null;
        const _hora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
        const _msgVars = buildEtiquetas({ lead: { telefone: phone } }, {
          agentName: _ag?.name, leadName: lead.lead_name, leadPhone: phone,
          sellerName: seller.name, sellerPhone: seller.whatsapp_number,
          resumo: lead.summary, horario: _hora,
        });
        const _msgInline =
          `🚨 *LEAD QUALIFICADO — REDISTRIBUIÇÃO*\n\n` +
          `👤 *Nome:* ${lead.lead_name || "Sem nome"}\n` +
          `📱 *Contato:* wa.me/${phone}\n` +
          `${lead.summary ? `📝 *Resumo:* ${lead.summary.substring(0, 300)}\n` : ""}` +
          `\n⚡ *Atenda agora:* https://wa.me/${phone}`;
        // Mensagem do vendedor (com template se houver). A MESMA vai pro gerente no completo.
        const _sellerFinal = composeSellerMsg(_ag, _msgVars, _msgInline);
        if (instance && seller.whatsapp_number) {
          await sendWAMessage(instance, seller.whatsapp_number, maybeStripEmojis(_ag, _sellerFinal));
        }

        // 4e. Notifica Gerente(s) via WhatsApp (ate 2) — completo/template/sem-emoji
        const gerentes = managerPhones(_ag);
        if (instance && gerentes.length > 0) {
          const _gNum = String(seller.whatsapp_number || "").replace(/\D/g, "");
          const _gerenteInline =
            `📊 *RELATÓRIO DE LEAD — REDISTRIBUIÇÃO*\n\n` +
            `🕐 *Horário:* ${_hora}\n\n` +
            `👤 *Lead:* ${lead.lead_name || "Sem nome"}\n` +
            `📱 *Telefone:* wa.me/${phone}\n` +
            `${lead.summary ? `📝 *Resumo:* ${lead.summary.substring(0, 300)}\n` : ""}` +
            `\n━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🎯 *Enviado para:* ${seller.name}\n` +
            `📲 *WhatsApp vendedor:* ${seller.whatsapp_number}\n` +
            `\n━━━━━━━━━━━━━━━━━━━━\n` +
            `_Gerado automaticamente pelo Pedro SDR (redistribuição em massa)_`;
          // COMPLETO = a MESMA mensagem que foi pro vendedor + so a linha de qual vendedor recebeu.
          const _gerenteCompleto =
            `🧑‍💼 *Vendedor atribuído:* ${seller.name}${_gNum ? ` — wa.me/${_gNum}` : ""}\n\n` +
            _sellerFinal;
          const _gerenteBase = (_ag?.gerente_feedback_completo === true)
            ? _gerenteCompleto
            : composeGerenteMsg(_ag, _msgVars, _gerenteInline);
          const gerenteMsg = maybeStripEmojis(_ag, _gerenteBase);
          for (const gerentePhone of gerentes) {
            await sendWAMessage(instance, gerentePhone, gerenteMsg);
          }
          console.log(`[BulkTransfer] ${gerentes.length} gerente(s) notificado(s) sobre lead ${lead.lead_name}`);
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
