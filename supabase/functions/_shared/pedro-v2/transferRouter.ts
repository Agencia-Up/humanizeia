import { phonesMatch } from "./phone.ts";
import { resolveTransferFailures } from "./logTransferFailure.ts";
import { resolveLeadInterestVehicle } from "../transfer/interestVehicle.ts";
import { resolveAiKey } from "../aiKeys.ts";
import { uniqueSellersByPhone } from "../transfer/phoneKey.ts";
import { pickRoundRobinSeller } from "./decisionLogic.ts";

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
    .limit(50);

  if (error) throw error;
  // DUAS correcoes combinadas (eu + socio): (1) uniqueSellersByPhone dedup vendedores DUPLICADOS
  // (mesmo telefone em varios agent_id) — sem isso a row antiga domina a fila; (2) pickRoundRobinSeller
  // faz rodizio JUSTO: quem NUNCA recebeu (last_lead_received_at null) vai PRIMEIRO. O `.order(...,
  // nullsFirst:true)` antigo NAO aplicava NULLS FIRST em producao -> vendedor novo caia pro FIM e nunca
  // era escolhido (bug Icom: 4 novos com 0 leads). Dedup -> rodizio. Ambos testados offline ($0).
  const seller = pickRoundRobinSeller(uniqueSellersByPhone(sellers || []));
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

  // Lead finalmente tem dono firme (vendedor confirmou "Ok") — resolve
  // qualquer falha de transferencia ABERTA deste lead no painel de
  // diagnostico. best-effort: nunca lanca, nunca derruba a confirmacao.
  await resolveTransferFailures({
    user_id: input.user_id,
    lead_id: pendingTransfer.lead_id,
    resolved_by: "seller-ack",
  });

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

// Monta um briefing rico para o vendedor humano assumir/retomar o lead. Usa a
// OpenAI quando ha chave + historico de conversa; senao cai para um texto base.
// Anexa os DADOS ESTRUTURADOS coletados pelo agente. Best-effort: NUNCA lanca
// (sempre devolve, no minimo, o texto base) para nao derrubar a transferencia.
async function buildHandoffBriefing(
  supabase: any,
  input: {
    agent_id: string;
    remote_jid: string;
    lead_id?: string | null;
    lead_name?: string | null;
    qualificacao?: Record<string, any> | null;
    veiculo_interesse?: string | null;
  },
  openaiKey?: string,
): Promise<string> {
  let briefing = "Lead avancou na negociacao com o Pedro v2 (qualificado / agendou visita / quer fechar). Retome o atendimento.";
  // Veiculo de interesse CONHECIDO (do anuncio do Facebook ou dos carros ja
  // apresentados). E obrigatorio aparecer no briefing: um lead de anuncio quase
  // nunca digita o modelo (so "tenho interesse"), entao sem isso o briefing saia
  // "VEICULO DE INTERESSE: Nao especificado" mesmo o anuncio dizendo o carro.
  // Se o chamador nao passou, busca no estado da conversa (memoria do Pedro v2).
  const veiculo = String(
    input.veiculo_interesse || (await resolveLeadInterestVehicle(supabase, input.lead_id, input.agent_id)) || "",
  ).trim();
  try {
    // BYOK: usa a chave da conta (cliente > nossa-se-grandfathered). Resolvida no callsite.
    const briefKey = openaiKey || Deno.env.get("OPENAI_API_KEY");
    const { data: chat } = await supabase
      .from("wa_chat_history")
      .select("role, content, created_at")
      .eq("agent_id", input.agent_id)
      .eq("remote_jid", input.remote_jid)
      .order("created_at", { ascending: false })
      .limit(20);
    if (briefKey && Array.isArray(chat) && chat.length > 0) {
      const transcript = chat.reverse().map((m: any) =>
        `${m.role === "user" ? `Cliente (${input.lead_name || "Desconhecido"})` : "Agente IA"}: ${String(m.content || "").substring(0, 400)}`
      ).join("\n");
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${briefKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.3,
          messages: [
            { role: "system", content: `Voce e um analista de vendas automotivo. Gere um briefing objetivo para o vendedor humano assumir um lead QUALIFICADO (avancou na negociacao, agendou visita ou quer fechar).\n\nSecoes obrigatorias:\n*VEICULO DE INTERESSE:*\n*ORIGEM DO LEAD:*\n*PERFIL E SINAIS DE COMPRA:*\n*PROXIMO PASSO SUGERIDO:*\n\nSeja direto. Nao invente informacoes. Se o "Veiculo de interesse conhecido" for informado abaixo, use-o EXATAMENTE na secao VEICULO DE INTERESSE (e o carro do anuncio/conversa).` },
            { role: "user", content: `Conversa:\n${transcript}\n\nVeiculo de interesse conhecido: ${veiculo || "nao informado"}\n\nGere o briefing.` },
          ],
        }),
      });
      if (res.ok) { const d = await res.json(); const t = d?.choices?.[0]?.message?.content; if (t) briefing = t; }
    }
  } catch (_e) { /* silencioso */ }

  const q = input.qualificacao && typeof input.qualificacao === "object" ? input.qualificacao : null;
  {
    const linhas: string[] = [];
    // Garante o veiculo nas primeiras linhas, mesmo que a IA tenha escrito "nao especificado".
    if (veiculo) linhas.push(`Veiculo de interesse: ${veiculo}`);
    if (q?.nome) linhas.push(`Nome: ${q.nome}`);
    if (q?.interesse && String(q.interesse).trim().toLowerCase() !== veiculo.toLowerCase()) linhas.push(`Interesse: ${q.interesse}`);
    if (q?.dia_agendamento) linhas.push(`Agendamento desejado: ${q.dia_agendamento}`);
    if (q?.carro_troca) linhas.push(`Veiculo de troca: ${q.carro_troca}`);
    else if (q?.tem_troca === true) linhas.push("Tem carro na troca: sim");
    else if (q?.tem_troca === false) linhas.push("Tem carro na troca: nao");
    if (q?.valor_entrada) linhas.push(`Valor de entrada: ${q.valor_entrada}`);
    if (q?.forma_pagamento) linhas.push(`Forma de pagamento: ${q.forma_pagamento}`);
    if (q?.sabe_localizacao === true) linhas.push("Conhece a loja: sim");
    else if (q?.sabe_localizacao === false) linhas.push("Conhece a loja: nao");
    if (linhas.length > 0) briefing = `${briefing}\n\n*DADOS COLETADOS PELO AGENTE:*\n${linhas.join("\n")}`;
    // DUVIDAS que o lead perguntou e o agente NAO sabia (adiou "confirmo com a equipe") -> o vendedor
    // precisa responder isso ao assumir. Decisao do dono (lead 98861-9201: garantia/laudo).
    const _dv = Array.isArray((q as any)?.duvidas_pendentes) ? (q as any).duvidas_pendentes.filter(Boolean) : [];
    if (_dv.length > 0) briefing = `${briefing}\n\n*⚠️ DUVIDAS A RESPONDER PRO LEAD (o agente nao tinha a info e disse que confirmaria):*\n- ${_dv.join("\n- ")}`;
  }
  return briefing;
}

// ETAPA C (2026-05-29, revisado 2026-06-02): executa a transferencia de um lead
// QUALIFICADO/AGENDOU a partir do orquestrador do Pedro v2.
//
// CORRECAO 2026-06-02 (transferencia parada apos a migracao v1->v2):
//  (1) O guard antigo so transferia leads com status IN ('novo','interessado') e
//      SEM dono. Apos a migracao, MUITOS leads ja chegavam ao v2 com outro status
//      (em_atendimento/qualificado/etc., herdado do v1 ou do CRM) e NUNCA eram
//      transferidos -> os leads que a IA atendia nao chegavam ao vendedor. O
//      status nao deve mais BLOQUEAR a transferencia (o cerebro so pede transferir
//      quando ha intencao real). Sintoma 1 resolvido.
//  (2) LEAD QUE RETORNOU: se ja tem dono ATIVO, agora re-notifica ESSE vendedor
//      (sem round-robin, sem fila nova), com throttle p/ nao spammar. Antes o
//      guard retornava 'already_handled' em silencio e o vendedor que ja atendia
//      nunca era avisado do retorno. Sintoma 2 resolvido.
//
// Anti-corrida preservado: claim atomico via .is("assigned_to_id", null) + dedup
// por transferencia PENDENTE ainda valida (passo 2). Marca status='transferido'
// (NAO mexe em status_crm) — isso tambem faz o follow-up de inatividade parar.
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
    seller_response_min?: number | null;
    veiculo_interesse?: string | null;
    // Recuperacao por follow-up: vendedor do 1o atendimento, pra rotear de volta pra ele
    // (mesmo sem transferencia confirmada antes). Quando setado e ativo, pula o rodizio.
    preferred_seller_id?: string | null;
  },
): Promise<{ ok: boolean; seller: any; briefing: string; reason: string }> {
  const nowIso = new Date().toISOString();
  const responseMin = Number(input.seller_response_min) > 0 ? Number(input.seller_response_min) : 10;
  // BYOK: chave de IA da conta pro briefing do handoff (cliente paga a propria; grandfathered usa a nossa).
  // So chegamos aqui se a conta tem chave usavel (o gate barra source='none' antes do turno).
  const _briefKey = (await resolveAiKey(supabase, input.user_id, "openai")).key;
  // Throttle do re-aviso ao vendedor de um lead que voltou (evita spammar a cada
  // mensagem). 45min e um bom proxy de "voltou depois de um tempo".
  const RENOTIFY_THROTTLE_MS = 45 * 60000;

  // 0) Estado atual do lead (status + dono).
  const { data: leadRow } = await supabase
    .from("ai_crm_leads")
    .select("id, status, assigned_to_id")
    .eq("id", input.lead_id)
    .maybeSingle();

  // 1) LEAD QUE RETORNOU: ja possui vendedor ATIVO -> re-notifica ESSE vendedor
  //    (nao faz round-robin, nao cria fila nova). Sintoma 2.
  if (leadRow?.assigned_to_id) {
    const { data: owner } = await supabase
      .from("ai_team_members")
      .select("*")
      .eq("id", leadRow.assigned_to_id)
      .eq("is_active", true)
      .maybeSingle();
    if (owner) {
      // Throttle: so re-notifica se a ultima transferencia/aviso deste lead foi
      // ha mais de RENOTIFY_THROTTLE_MS (senao o vendedor ja foi avisado agorinha).
      const { data: lastTransfer } = await supabase
        .from("ai_lead_transfers")
        .select("created_at")
        .eq("lead_id", input.lead_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastMs = lastTransfer?.created_at ? new Date(lastTransfer.created_at).getTime() : 0;
      if (Date.now() - lastMs < RENOTIFY_THROTTLE_MS) {
        return { ok: false, seller: null, briefing: "", reason: "renotify_throttled" };
      }
      const briefing = await buildHandoffBriefing(supabase, {
        agent_id: input.agent_id,
        remote_jid: input.remote_jid,
        lead_id: input.lead_id,
        lead_name: input.lead_name,
        qualificacao: input.qualificacao,
        veiculo_interesse: input.veiculo_interesse,
      }, _briefKey);
      // Registra o aviso como transferencia CONFIRMADA (o lead JA e deste vendedor)
      // — serve de historico e de marco de throttle para a proxima mensagem.
      await supabase.from("ai_lead_transfers").insert({
        user_id: input.user_id,
        lead_id: input.lead_id,
        to_member_id: owner.id,
        transfer_reason: input.reason || "Lead retornou e voltou a demonstrar interesse (Pedro v2)",
        notes: briefing,
        transfer_status: "confirmed",
        is_confirmed: true,
        confirmed_at: nowIso,
        confirmation_timeout_at: nowIso,
      });
      await supabase.from("ai_crm_leads").update({ summary: briefing, last_interaction_at: nowIso }).eq("id", input.lead_id);
      await supabase.from("ai_team_members").update({ last_lead_received_at: nowIso }).eq("id", owner.id);
      return { ok: true, seller: owner, briefing, reason: "returning_lead_renotify" };
    }
    // Dono inativo -> libera a atribuicao e segue para reatribuicao (round-robin).
    await supabase.from("ai_crm_leads").update({ assigned_to_id: null }).eq("id", input.lead_id);
  }

  // 2) Ja existe transferencia PENDENTE ainda dentro do prazo? -> aguarda "Ok" do
  //    vendedor (nao duplica o aviso). Cobre a corrida de turnos concorrentes e o
  //    caso "ja avisado, esperando confirmacao". Uma pendente EXPIRADA NAO bloqueia
  //    (o vendedor anterior nao assumiu -> re-encaminha).
  const { data: activePending } = await supabase
    .from("ai_lead_transfers")
    .select("id, confirmation_timeout_at")
    .eq("lead_id", input.lead_id)
    .eq("transfer_status", "pending")
    .eq("is_confirmed", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activePending) {
    const notExpired = !activePending.confirmation_timeout_at ||
      new Date(activePending.confirmation_timeout_at).getTime() > Date.now();
    if (notExpired) return { ok: false, seller: null, briefing: "", reason: "already_pending" };
  }

  // 3) Escolhe vendedor. RECUPERACAO por follow-up: tenta primeiro o vendedor do 1o
  //    atendimento (preferred_seller_id), mesmo SEM transferencia confirmada antes —
  //    senao cairia no rodizio e iria pra outro vendedor (rule #3). Depois: vendedor
  //    anterior do lead (confirmado/assigned) e, por fim, rodizio.
  let choice: { seller: any; reason: string } | null = null;
  if (input.preferred_seller_id) {
    const { data: pref } = await supabase
      .from("ai_team_members").select("*")
      .eq("id", input.preferred_seller_id).eq("is_active", true).maybeSingle();
    if (pref) choice = { seller: pref, reason: "reactivation_same_seller" };
  }
  if (!choice?.seller) {
    choice = await chooseSellerForPedroTransfer(supabase, {
      user_id: input.user_id,
      agent_id: input.agent_id,
      remote_jid: input.remote_jid,
      lead_id: input.lead_id,
    });
  }
  if (!choice?.seller) return { ok: false, seller: null, briefing: "", reason: "no_active_seller" };

  // 4) Claim atomico anti-corrida: encaminha so se o lead ainda NAO tem dono. O
  //    STATUS NAO BLOQUEIA MAIS (qualquer status sem dono pode ser encaminhado).
  //    Marca 'transferido' para o follow-up de inatividade parar.
  const { data: claimed } = await supabase
    .from("ai_crm_leads")
    .update({ status: "transferido", last_interaction_at: nowIso })
    .eq("id", input.lead_id)
    .is("assigned_to_id", null)
    .select("id");
  if (!claimed || claimed.length === 0) {
    // Lead ganhou dono entre os passos 1 e 4 (corrida com confirmacao) -> tratado.
    return { ok: false, seller: null, briefing: "", reason: "already_handled" };
  }

  // 4b) Cria a transferencia pendente JA (antes do briefing) para FECHAR a janela
  //     de corrida: um turno concorrente vera esta pendente no passo 2 e nao
  //     duplicara o aviso. O briefing rico (lento) e gravado logo abaixo.
  const { data: inserted } = await supabase
    .from("ai_lead_transfers")
    .insert({
      user_id: input.user_id,
      lead_id: input.lead_id,
      to_member_id: choice.seller.id,
      transfer_reason: input.reason || "Lead qualificado/agendou (Pedro v2)",
      notes: "Preparando briefing...",
      transfer_status: "pending",
      is_confirmed: false,
      confirmation_timeout_at: new Date(Date.now() + responseMin * 60000).toISOString(),
    })
    .select("id")
    .maybeSingle();

  // 5) Briefing rico + atualiza a transferencia e o resumo do lead.
  const briefing = await buildHandoffBriefing(supabase, {
    agent_id: input.agent_id,
    remote_jid: input.remote_jid,
    lead_id: input.lead_id,
    lead_name: input.lead_name,
    qualificacao: input.qualificacao,
    veiculo_interesse: input.veiculo_interesse,
  }, _briefKey);
  if (inserted?.id) await supabase.from("ai_lead_transfers").update({ notes: briefing }).eq("id", inserted.id);
  await supabase.from("ai_crm_leads").update({ summary: briefing }).eq("id", input.lead_id);
  await supabase.from("ai_team_members").update({
    last_lead_received_at: nowIso,
    total_leads_received: (choice.seller.total_leads_received || 0) + 1,
  }).eq("id", choice.seller.id);

  return { ok: true, seller: choice.seller, briefing, reason: input.reason || "handoff" };
}

