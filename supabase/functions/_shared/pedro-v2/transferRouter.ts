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

  // Expira transfers IRMAOS ainda pendentes do MESMO lead (duplicatas, outros
  // fluxos ou escalacoes em voo), para o timeout-checker NAO repassar o lead
  // que ESTE vendedor acabou de aceitar para o proximo da fila.
  await supabase
    .from("ai_lead_transfers")
    .update({ transfer_status: "expired" })
    .eq("lead_id", pendingTransfer.lead_id)
    .eq("transfer_status", "pending")
    .neq("id", pendingTransfer.id);

  return { ok: true, seller: matches[0], transfer: pendingTransfer, confirmed: true };
}

// ETAPA C (2026-05-29): executa a transferencia de um lead QUALIFICADO/AGENDOU
// a partir do orquestrador do Pedro v2. Reusa a mesma fila/round-robin/briefing
// do fluxo de inatividade. Marca status='transferido' (NAO mexe em status_crm)
// — isso tambem faz o follow-up de inatividade parar (o cron so pega novo/interessado).
// Guard atomico evita transferencia em dobro. Retorna o vendedor + briefing para
// o orquestrador notificar via WhatsApp.
export async function executePedroV2Handoff(
  supabase: any,
  input: {
    user_id: string;
    agent_id: string;
    lead_id: string;
    remote_jid: string;
    lead_name?: string | null;
    reason?: string | null;
    qualificacao?: Record<string, any> | null;
  },
): Promise<{ ok: boolean; seller: any; briefing: string; reason: string }> {
  // 1) Precisa ter vendedor disponivel ANTES de mexer no status (senao o lead
  //    ficaria "transferido" sem destino e sem follow-up).
  const choice = await chooseSellerForPedroTransfer(supabase, {
    user_id: input.user_id,
    agent_id: input.agent_id,
    remote_jid: input.remote_jid,
    lead_id: input.lead_id,
  });
  if (!choice?.seller) return { ok: false, seller: null, briefing: "", reason: "no_active_seller" };

  // 2) Guard atomico: so transfere se o lead ainda estiver novo/interessado e sem
  //    vendedor (evita transferir duas vezes em turnos concorrentes).
  const nowIso = new Date().toISOString();
  const { data: claimed } = await supabase
    .from("ai_crm_leads")
    .update({ status: "transferido", last_interaction_at: nowIso })
    .eq("id", input.lead_id)
    .is("assigned_to_id", null)
    .in("status", ["novo", "interessado"])
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: false, seller: null, briefing: "", reason: "already_handled" };

  // 3) Briefing rico para o vendedor (mesmo padrao do fluxo de inatividade).
  let briefing = "Lead avancou na negociacao com o Pedro v2 (qualificado / agendou visita / quer fechar). Retome o atendimento.";
  try {
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const { data: chat } = await supabase
      .from("wa_chat_history")
      .select("role, content, created_at")
      .eq("agent_id", input.agent_id)
      .eq("remote_jid", input.remote_jid)
      .order("created_at", { ascending: false })
      .limit(20);
    if (openaiKey && Array.isArray(chat) && chat.length > 0) {
      const transcript = chat.reverse().map((m: any) =>
        `${m.role === "user" ? `Cliente (${input.lead_name || "Desconhecido"})` : "Agente IA"}: ${String(m.content || "").substring(0, 400)}`
      ).join("\n");
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.3,
          messages: [
            { role: "system", content: `Voce e um analista de vendas automotivo. Gere um briefing objetivo para o vendedor humano assumir um lead QUALIFICADO (avancou na negociacao, agendou visita ou quer fechar).\n\nSecoes obrigatorias:\n*VEICULO DE INTERESSE:*\n*ORIGEM DO LEAD:*\n*PERFIL E SINAIS DE COMPRA:*\n*PROXIMO PASSO SUGERIDO:*\n\nSeja direto. Nao invente informacoes.` },
            { role: "user", content: `Conversa:\n${transcript}\n\nGere o briefing.` },
          ],
        }),
      });
      if (res.ok) { const d = await res.json(); const t = d?.choices?.[0]?.message?.content; if (t) briefing = t; }
    }
  } catch (_e) { /* silencioso */ }

  // 3.1) Anexa os DADOS ESTRUTURADOS coletados pelo agente (vao no briefing do vendedor).
  const q = input.qualificacao && typeof input.qualificacao === "object" ? input.qualificacao : null;
  if (q) {
    const linhas: string[] = [];
    if (q.nome) linhas.push(`Nome: ${q.nome}`);
    if (q.interesse) linhas.push(`Interesse: ${q.interesse}`);
    if (q.dia_agendamento) linhas.push(`Agendamento desejado: ${q.dia_agendamento}`);
    if (q.carro_troca) linhas.push(`Veiculo de troca: ${q.carro_troca}`);
    else if (q.tem_troca === true) linhas.push("Tem carro na troca: sim");
    else if (q.tem_troca === false) linhas.push("Tem carro na troca: nao");
    if (q.valor_entrada) linhas.push(`Valor de entrada: ${q.valor_entrada}`);
    if (q.forma_pagamento) linhas.push(`Forma de pagamento: ${q.forma_pagamento}`);
    if (q.sabe_localizacao === true) linhas.push("Conhece a loja: sim");
    else if (q.sabe_localizacao === false) linhas.push("Conhece a loja: nao");
    if (linhas.length > 0) briefing = `${briefing}\n\n*DADOS COLETADOS PELO AGENTE:*\n${linhas.join("\n")}`;
  }

  // 4) Cria a transferencia (mesma estrutura/fila do fluxo atual) e grava o resumo.
  await supabase.from("ai_lead_transfers").insert({
    user_id: input.user_id,
    lead_id: input.lead_id,
    to_member_id: choice.seller.id,
    transfer_reason: input.reason || "Lead qualificado/agendou (Pedro v2)",
    notes: briefing,
    transfer_status: "pending",
    is_confirmed: false,
    confirmation_timeout_at: new Date(Date.now() + 15 * 60000).toISOString(),
  });
  await supabase.from("ai_crm_leads").update({ summary: briefing }).eq("id", input.lead_id);
  await supabase.from("ai_team_members").update({ last_lead_received_at: nowIso }).eq("id", choice.seller.id);

  return { ok: true, seller: choice.seller, briefing, reason: input.reason || "handoff" };
}

