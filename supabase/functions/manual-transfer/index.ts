import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildConversationBriefing, buildMarcosBriefing, buildManagerReport } from "../_shared/transfer/buildBriefing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LEAD_SELECT = "*, agent:wa_ai_agents!ai_crm_leads_agent_id_fkey(*)";

/** Send a WhatsApp text message via UazAPI (3 fallback attempts) */
async function sendWAMessage(instance: any, phone: string, text: string) {
  if (!instance?.api_url) {
    throw new Error("Instancia WhatsApp sem URL da API configurada");
  }
  if (!phone) {
    throw new Error("Vendedor sem numero de WhatsApp configurado");
  }

  let dest = phone.replace(/\D/g, "");
  if (dest.length === 10 || dest.length === 11) dest = `55${dest}`;
  const baseUrl = (instance.api_url as string).replace(/\/+$/, "");
  const instKey = instance.api_key_encrypted || instance.api_key || "";
  if (!instKey) {
    throw new Error("Instancia WhatsApp sem token configurado");
  }

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
  throw new Error(`Falha ao enviar WhatsApp para ${dest}`);
}

async function resolveEffectiveUserId(supabase: any, userId: string) {
  const { data: profileData } = await supabase
    .from("profiles")
    .select("role, manager_id")
    .eq("id", userId)
    .maybeSingle();

  if (profileData?.role === "seller" && profileData?.manager_id) {
    return profileData.manager_id;
  }

  const { data: memberData } = await supabase
    .from("ai_team_members")
    .select("user_id")
    .eq("auth_user_id", userId)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return memberData?.user_id || userId;
}

async function canAccessLeadOwner(supabase: any, userId: string, effectiveUserId: string, ownerId: string) {
  if (!ownerId) return false;
  if (ownerId === userId || ownerId === effectiveUserId) return true;

  const { data: profileData } = await supabase
    .from("profiles")
    .select("role, manager_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileData?.role === "seller" && profileData?.manager_id === ownerId) return true;

  const { data: memberData } = await supabase
    .from("ai_team_members")
    .select("id")
    .eq("auth_user_id", userId)
    .eq("user_id", ownerId)
    .limit(1)
    .maybeSingle();

  return !!memberData?.id;
}

function digitsOnly(value: any) {
  return String(value || "").replace(/\D/g, "");
}

function maybeLeadIdLooksLikePhone(value: any) {
  return digitsOnly(value).length >= 8;
}

function maybeLeadIdLooksLikeName(value: any) {
  const text = String(value || "").trim();
  return text.length >= 3 && !/^[0-9a-f-]{20,}$/i.test(text);
}

function extractUuid(value: any) {
  const match = String(value || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match?.[0] || null;
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

// ============================================================================
// MARCOS — Transferência manual de lead Marcos com briefing e notificação gerente
// ----------------------------------------------------------------------------
// FASE 2 do PLANO_CORRECAO_BUGS_2026-05-27 (BUG-16). Estende manual-transfer
// pra aceitar leads do Marcos (crm_leads), antes só Pedro (ai_crm_leads).
//
// Diferenças em relação ao fluxo Pedro:
//   - Tabela origem é crm_leads (não ai_crm_leads).
//   - Marcos não tem agente IA → sem wa_chat_history → briefing usa só
//     campos do crm_leads (origem, cidade, veiculo, etc).
//   - Gerente é resolvido via manager_feedback_config.gerente_phone_marcos
//     (coluna dedicada, não wa_ai_agents.gerente_phone).
//   - Atribuição é IMEDIATA E FIRME (sem aguardar Ok do vendedor). Marcos
//     é manual desde o início; não existe rodízio automático que possa
//     reescalonar. Diferente do Pedro que vai virar opção A na FASE 3.
//   - Não grava em ai_lead_transfers (essa tabela é específica de Pedro).
//     Histórico do Marcos vive em crm_activities (já tem trigger).
// ============================================================================
async function handleMarcosTransfer(
  supabase: any,
  body: {
    crmLeadId: string;
    memberId: string;
    notes?: string;
  },
): Promise<Response> {
  const { crmLeadId, memberId, notes } = body;

  // 1. Buscar lead Marcos
  const { data: lead, error: leadErr } = await supabase
    .from("crm_leads")
    .select("id, user_id, name, phone, summary, origem, vehicle_interest, client_city, payment_method, custom_fields, assigned_to")
    .eq("id", crmLeadId)
    .maybeSingle();

  if (leadErr || !lead) {
    console.error("[manual-transfer/marcos] lead nao encontrado", { crmLeadId, leadErr });
    return new Response(JSON.stringify({ error: "Lead Marcos nao encontrado" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Buscar vendedor + validar
  const { data: member, error: memberErr } = await supabase
    .from("ai_team_members")
    .select("id, user_id, name, whatsapp_number, is_active, auth_user_id")
    .eq("id", memberId)
    .maybeSingle();

  if (memberErr || !member) {
    return new Response(JSON.stringify({ error: "Vendedor nao encontrado" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!member.is_active) {
    return new Response(JSON.stringify({ error: "Vendedor inativo. Reative em Pedro > Vendedores antes de atribuir." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!member.whatsapp_number) {
    return new Response(JSON.stringify({ error: "Vendedor sem WhatsApp cadastrado. Configure em Pedro > Vendedores antes de atribuir." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // FASE 3 BUG-14 — dedup ANTES de enviar mensagens. Marcos não usa
  //   ai_lead_transfers, então a janela é validada pelos custom_fields
  //   do próprio lead: se seller_assigned_at é < 30s atrás e mesmo vendedor,
  //   trata como clique duplo. Janela é mais permissiva que Pedro porque
  //   Marcos pode legitimamente ter atribuição troca-troca em segundos.
  const lastAssignedAt = lead.custom_fields?.seller_assigned_at;
  const lastAssignedTo = lead.custom_fields?.seller_member_id;
  if (lastAssignedAt && lastAssignedTo === memberId) {
    const elapsedMs = Date.now() - new Date(lastAssignedAt).getTime();
    if (elapsedMs < 30 * 1000) {
      console.warn(`[manual-transfer/marcos] Dedup: lead ${crmLeadId} já atribuído ao mesmo vendedor há ${Math.round(elapsedMs / 1000)}s. Retornando sucesso sem reenviar.`);
      return new Response(JSON.stringify({
        success: true,
        crmLeadId,
        memberId,
        source: "marcos",
        deduplicated: true,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // 3. Encontrar instância pra enviar mensagens
  //    Prioridade: instância do vendedor (auth_user_id dele) > instância do master > qualquer ativa
  let instance: any = null;
  if (member.auth_user_id) {
    const { data: sellerInst } = await supabase
      .from("wa_instances")
      .select("*")
      .eq("user_id", member.auth_user_id)
      .eq("is_active", true)
      .eq("status", "connected")
      .order("health_score", { ascending: false })
      .limit(1)
      .maybeSingle();
    instance = sellerInst;
  }
  if (!instance) {
    const { data: masterInst } = await supabase
      .from("wa_instances")
      .select("*")
      .eq("user_id", lead.user_id)
      .eq("is_active", true)
      .eq("status", "connected")
      .order("health_score", { ascending: false })
      .limit(1)
      .maybeSingle();
    instance = masterInst;
  }

  if (!instance) {
    return new Response(JSON.stringify({ error: "Nenhuma instancia WhatsApp conectada para enviar a transferencia. Conecte uma instancia em Pedro > Instancias." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 4. Montar briefing pra vendedor (usa helper compartilhado)
  const briefing = buildMarcosBriefing({
    name: lead.name,
    phone: lead.phone,
    summary: lead.summary,
    origem: lead.origem,
    vehicle_interest: lead.vehicle_interest,
    city: lead.client_city,
    payment_method: lead.payment_method,
    custom_fields: lead.custom_fields,
  });

  const sellerMsg = `🚨 *TRANSFERÊNCIA DE LEAD MARCOS*

${briefing}
${notes ? `\n💬 *Observação do master:* ${notes}\n` : ""}
⚡ O cliente está aguardando seu contato!`;

  await sendWAMessage(instance, member.whatsapp_number, sellerMsg);

  // 5. Notificar gerente (se configurado em manager_feedback_config.gerente_phone_marcos)
  const { data: feedbackCfg } = await supabase
    .from("manager_feedback_config")
    .select("gerente_phone_marcos")
    .eq("user_id", lead.user_id)
    .maybeSingle();

  const gerentePhone = feedbackCfg?.gerente_phone_marcos || null;
  if (gerentePhone) {
    const managerReport = buildManagerReport({
      leadName: lead.name || "Sem nome",
      leadPhone: lead.phone || "",
      status: "atribuido_manualmente",
      summary: lead.summary,
      sellerName: member.name,
      sellerPhone: member.whatsapp_number,
      origin: "manual",
      source: "marcos",
    });
    try {
      await sendWAMessage(instance, gerentePhone, managerReport);
    } catch (err) {
      console.warn("[manual-transfer/marcos] Falha ao enviar relatorio ao gerente Marcos (nao bloqueante):", err);
    }
  } else {
    console.log("[manual-transfer/marcos] Sem gerente_phone_marcos configurado — pulando notificacao");
  }

  // 6. Atualizar lead — atribuição imediata e firme (sem timeout)
  //    Marcos não tem rodízio automático nem confirmação por Ok do vendedor.
  const nextCustomFields = {
    ...(lead.custom_fields || {}),
    seller_member_id: memberId,
    seller_name: member.name,
    seller_assigned_at: new Date().toISOString(),
    seller_assigned_via: "manual-transfer-edge-function",
  };

  const { error: updateErr } = await supabase
    .from("crm_leads")
    .update({
      assigned_to: memberId,
      custom_fields: nextCustomFields,
    })
    .eq("id", crmLeadId);

  if (updateErr) {
    console.error("[manual-transfer/marcos] erro ao atualizar crm_leads.assigned_to", updateErr);
    return new Response(JSON.stringify({ error: `Mensagens enviadas, mas falha ao atualizar lead: ${updateErr.message}` }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 7. Atualizar last_lead_received_at do vendedor (round-robin global)
  await supabase
    .from("ai_team_members")
    .update({ last_lead_received_at: new Date().toISOString() })
    .eq("id", memberId);

  return new Response(JSON.stringify({
    success: true,
    crmLeadId,
    memberId,
    source: "marcos",
    gerente_notificado: !!gerentePhone,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

    // Resolve o dono real dos dados. Alguns vendedores existem como login separado
    // em ai_team_members, mesmo quando o profile antigo nao esta completo.
    const effectiveUserId = await resolveEffectiveUserId(supabase, userId);

    const { leadId, crmLeadId, memberId, notes, remoteJid, agentId, leadName, ownerUserId: bodyOwnerUserId } = await req.json();

    // FASE 2 — branch Marcos. Lead vive em crm_leads (não ai_crm_leads).
    // Quando o frontend Marcos chama esta edge function, passa crmLeadId em
    // vez de leadId. Mesma função, fluxo separado pra não bagunçar Pedro.
    if (crmLeadId && memberId) {
      return await handleMarcosTransfer(supabase, { crmLeadId, memberId, notes });
    }

    if (!leadId || !memberId) {
      return new Response(JSON.stringify({ error: "leadId (ou crmLeadId) e memberId sao obrigatorios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Busca o vendedor cedo para termos um dono confiavel mesmo quando o
    // frontend antigo envia um leadId incorreto/incompleto.
    const { data: memberCandidate, error: memberCandidateErr } = await supabase
      .from("ai_team_members")
      .select("*")
      .eq("id", memberId)
      .maybeSingle();

    if (memberCandidateErr || !memberCandidate) {
      return new Response(JSON.stringify({ error: "Member not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const inferredOwnerUserId = bodyOwnerUserId || memberCandidate.user_id || effectiveUserId;

    // 1. Fetch lead details. Primeiro busca por ID; depois valida o acesso.
    // Isso evita falso "Lead not found" quando o usuário logado é vendedor
    // ou quando o lead pertence ao master mas o effectiveUserId foi resolvido diferente.
    const canonicalLeadId = extractUuid(leadId) || leadId;
    let { data: lead, error: leadErr } = await supabase
      .from("ai_crm_leads")
      .select(LEAD_SELECT)
      .eq("id", canonicalLeadId)
      .maybeSingle();

    if (!lead && remoteJid) {
      let leadQuery = supabase
        .from("ai_crm_leads")
        .select(LEAD_SELECT)
        .eq("remote_jid", remoteJid)
        .order("last_interaction_at", { ascending: false, nullsFirst: false })
        .limit(1);
      if (agentId) leadQuery = leadQuery.eq("agent_id", agentId);
      if (inferredOwnerUserId) leadQuery = leadQuery.eq("user_id", inferredOwnerUserId);

      const fallback = await leadQuery.maybeSingle();
      lead = fallback.data;
      leadErr = fallback.error;
      if (lead) {
        console.warn(`[manual-transfer] leadId ${leadId} nao encontrado; usando fallback por remote_jid=${remoteJid}, lead=${lead.id}`);
      }
    }

    if (!lead && leadName && inferredOwnerUserId) {
      const fallback = await supabase
        .from("ai_crm_leads")
        .select(LEAD_SELECT)
        .eq("user_id", inferredOwnerUserId)
        .eq("lead_name", leadName)
        .order("last_interaction_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      lead = fallback.data;
      leadErr = fallback.error;
      if (lead) {
        console.warn(`[manual-transfer] leadId ${leadId} nao encontrado; usando fallback por lead_name=${leadName}, lead=${lead.id}`);
      }
    }

    // Compatibilidade com bundles antigos: se o botao antigo enviou telefone,
    // remote_jid ou nome no campo leadId, tenta localizar dentro do mesmo dono.
    if (!lead && inferredOwnerUserId && maybeLeadIdLooksLikePhone(leadId)) {
      const phoneTail = digitsOnly(leadId).slice(-8);
      let phoneQuery = supabase
        .from("ai_crm_leads")
        .select(LEAD_SELECT)
        .eq("user_id", inferredOwnerUserId)
        .ilike("remote_jid", `%${phoneTail}%`)
        .order("last_interaction_at", { ascending: false, nullsFirst: false })
        .limit(2);
      if (agentId) phoneQuery = phoneQuery.eq("agent_id", agentId);

      const fallback = await phoneQuery;
      leadErr = fallback.error;
      if (!leadErr && fallback.data?.length === 1) {
        lead = fallback.data[0];
        console.warn(`[manual-transfer] leadId ${leadId} nao encontrado; usando fallback por telefone, lead=${lead.id}`);
      }
    }

    if (!lead && inferredOwnerUserId && maybeLeadIdLooksLikeName(leadId)) {
      let nameQuery = supabase
        .from("ai_crm_leads")
        .select(LEAD_SELECT)
        .eq("user_id", inferredOwnerUserId)
        .ilike("lead_name", `%${String(leadId).trim()}%`)
        .order("last_interaction_at", { ascending: false, nullsFirst: false })
        .limit(2);
      if (agentId) nameQuery = nameQuery.eq("agent_id", agentId);

      const fallback = await nameQuery;
      leadErr = fallback.error;
      if (!leadErr && fallback.data?.length === 1) {
        lead = fallback.data[0];
        console.warn(`[manual-transfer] leadId ${leadId} nao encontrado; usando fallback por nome, lead=${lead.id}`);
      }
    }

    // Ultimo recurso seguro para o caso atual do CRM ao vivo: se o payload antigo
    // nao identifica o lead, mas existe exatamente um lead aberto atribuido ao
    // vendedor selecionado, usa esse registro. Se houver mais de um, aborta para
    // evitar transferir a pessoa errada.
    if (!lead && inferredOwnerUserId) {
      const fallback = await supabase
        .from("ai_crm_leads")
        .select(LEAD_SELECT)
        .eq("user_id", inferredOwnerUserId)
        .eq("assigned_to_id", memberCandidate.id)
        .in("status", ["novo", "interessado", "pouco_qualificado", "medio_qualificado", "qualificado", "em_atendimento"])
        .order("last_interaction_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(2);

      leadErr = fallback.error;
      if (!leadErr && fallback.data?.length === 1) {
        lead = fallback.data[0];
        console.warn(`[manual-transfer] leadId ${leadId} nao encontrado; usando fallback unico por vendedor=${memberCandidate.id}, lead=${lead.id}`);
      } else if (!leadErr && (fallback.data?.length || 0) > 1) {
        console.error("[manual-transfer] Lead ambiguo por vendedor", {
          leadId,
          memberId,
          candidates: fallback.data.map((item: any) => item.id),
        });
        return new Response(JSON.stringify({
          error: "Nao consegui identificar o lead exato. Atualize a pagina com Ctrl+F5 e tente novamente.",
          details: { leadId, memberId, candidateCount: fallback.data.length },
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (leadErr || !lead) {
      console.error("[manual-transfer] Lead not found", { leadId, remoteJid, agentId, leadName, bodyOwnerUserId, inferredOwnerUserId, memberId, leadErr });
      return new Response(JSON.stringify({ error: "Lead not found", details: { leadId, remoteJid, agentId, leadName, memberId } }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ownerUserId = lead.user_id || inferredOwnerUserId || effectiveUserId;
    const canAccess = await canAccessLeadOwner(supabase, userId, effectiveUserId, ownerUserId);
    if (!canAccess) {
      return new Response(JSON.stringify({ error: "Sem permissao para transferir este lead" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // FASE 3 BUG-14 — dedup ANTES de qualquer envio de WhatsApp.
    // Master clicando 2x rapidamente OU dois operadores agindo simultâneo
    // no mesmo lead/vendedor → sem dedup, criaria 2 transfers, mandaria 2
    // mensagens ao vendedor + 2 relatórios ao gerente. Janela 30s é
    // suficiente pra absorver clique duplo sem bloquear retransferências
    // legítimas.
    const dedupCutoff = new Date(Date.now() - 30 * 1000).toISOString();
    const { data: recentDup } = await supabase
      .from("ai_lead_transfers")
      .select("id, created_at, to_member_id")
      .eq("lead_id", lead.id)
      .eq("to_member_id", memberCandidate.id)
      .gte("created_at", dedupCutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentDup) {
      console.warn(`[manual-transfer] Dedup: transfer ${recentDup.id} criado em ${recentDup.created_at} para mesmo lead/vendedor < 30s. Retornando sucesso sem reenviar.`);
      return new Response(JSON.stringify({
        success: true,
        leadId: lead.id,
        memberId: memberCandidate.id,
        deduplicated: true,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Validate member details
    const member = memberCandidate;
    if (member.user_id !== ownerUserId) {
      return new Response(JSON.stringify({ error: "Member not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!member.is_active) {
      return new Response(JSON.stringify({ error: "Vendedor inativo na fila" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!member.whatsapp_number) {
      return new Response(JSON.stringify({ error: "Vendedor sem numero de WhatsApp configurado" }), {
        status: 400,
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
        .eq("user_id", ownerUserId)
        .eq("is_active", true)
        .eq("status", "connected")
        .limit(1);
      instance = fallbackInstances?.[0] || null;
    }

    if (!instance) {
      console.error("[manual-transfer] Nenhuma instancia WhatsApp encontrada");
      return new Response(JSON.stringify({ error: "Nenhuma instancia WhatsApp conectada para enviar a transferencia" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const phone = lead.remote_jid.replace(/\D/g, "");
    const pushName = lead.lead_name || "Não informado";
    const agentName = agentConfig?.name || lead.agent?.name || "Pedro";
    const transferredAt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const conversationBriefing = await buildConversationBriefing(supabase, lead);

    // 5. Send WhatsApp to SELLER (mensagem completa com resumo da conversa)
    const sellerMsg = `🚨 *TRANSFERÊNCIA DE LEAD*

👤 *Nome do Cliente:* ${pushName}
📱 *Contato:* ${phone}
🤖 *Agente IA:* ${agentName}
🕐 *Horário:* ${transferredAt}
📊 *Status:* ${lead.status || "qualificado"}

━━━━━━━━━━━━━━━━━━━━
📝 *Feedback da conversa:*
${conversationBriefing}
━━━━━━━━━━━━━━━━━━━━
${notes ? `\n💬 *Observação:* ${notes}\n\n━━━━━━━━━━━━━━━━━━━━\n` : ""}
👉 *Atender agora:* https://wa.me/${phone}

⚡ O cliente está aguardando seu contato!
⏰ *Responda em até 15 minutos para confirmar o recebimento.*`;

    await sendWAMessage(instance, member.whatsapp_number, sellerMsg);

    // 6. Send WhatsApp REPORT to MANAGER (gerente)
    const gerentePhone = agentConfig?.gerente_phone;
    if (gerentePhone) {
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

      try {
        await sendWAMessage(instance, gerentePhone, gerenteMsg);
      } catch (err) {
        console.warn("[manual-transfer] Falha ao enviar relatorio ao gerente (nao bloqueante):", err);
      }
    }

    // 7. Update Lead — FASE 3 BUG-13 opção A: NÃO seta assigned_to_id agora.
    //    Atribuição firme acontece quando vendedor confirma com "Ok" via
    //    handler maybeHandleSellerAck em uazapi-webhook (que seta assigned_to_id
    //    + status='em_atendimento'). Se vendedor não responde em 15min,
    //    transfer-timeout-checker escala pro próximo do rodízio.
    //    Alinha comportamento com auto-transfer (que também não atribui até "Ok").
    await supabase.from("ai_crm_leads").update({
      status: "transferido",
      last_interaction_at: new Date().toISOString(),
    }).eq("id", lead.id);

    // 8. Record transfer (dedup já validado lá em cima antes do envio)
    await supabase.from("ai_lead_transfers").insert({
      user_id: ownerUserId,
      lead_id: lead.id,
      from_member_id: lead.assigned_to_id,
      to_member_id: member.id,
      transfer_reason: "manual",
      notes: notes || conversationBriefing,
      is_confirmed: false,
      transfer_status: "pending",
      confirmation_timeout_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    // 9. Update member stats
    await supabase.from("ai_team_members").update({
      last_lead_received_at: new Date().toISOString(),
    }).eq("id", member.id);

    // 10. Sync lead to Marcos contact list (non-blocking)
    syncLeadToMarcos(supabase, ownerUserId, lead, member);

    return new Response(JSON.stringify({ success: true, leadId: lead.id, memberId: member.id }), {
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
