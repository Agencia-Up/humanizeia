import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FIVE_MIN_MESSAGES = [
  "Oie, voce ainda esta por ai? Posso te ajudar com mais alguma duvida?",
  "Tudo certo por ai? Se precisar de mais alguma informacao, e so me falar!",
  "Ainda tem interesse? Estou aqui se precisar de ajuda com os detalhes!"
];

async function sendUazapiTextMessage(baseUrl: string, instKey: string, instanceName: string, phoneNumber: string, remoteJid: string, text: string) {
  const attempts = [
    { label: 'send-text-number', url: `${baseUrl}/send/text`, body: { number: phoneNumber, text } },
    { label: 'send-text-remotejid', url: `${baseUrl}/send/text`, body: { remoteJid, text } },
    { label: 'message-sendText', url: `${baseUrl}/message/sendText/${instanceName}`, body: { number: phoneNumber, text } }
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': instKey, 'apikey': instKey },
        body: JSON.stringify(attempt.body),
      });
      if (res.ok) return true;
    } catch (err) {
      // continua tentando
    }
  }
  return false;
}

function sellerPhoneKey(seller: any): string {
  const digits = String(seller?.whatsapp_number || '').replace(/\D/g, '');
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11 && local[2] === '9') return `${local.slice(0, 2)}${local.slice(3)}`;
  return local.slice(-10);
}

function uniqueSellersByPhone(sellers: any[] = [], excludeId?: string, excludePhoneKey?: string): any[] {
  const seenPhones = new Set<string>();
  return sellers.filter((seller) => {
    const phoneKey = sellerPhoneKey(seller);
    if (!seller.is_active || seller.id === excludeId || (excludePhoneKey && phoneKey === excludePhoneKey)) return false;
    if (phoneKey && seenPhones.has(phoneKey)) return false;
    if (phoneKey) seenPhones.add(phoneKey);
    return true;
  });
}

/**
 * Verifica se o horário atual está dentro da janela de rodízio vendedor -> vendedor.
 * Regra de negócio: 10:11 até 19:00 (horário de Brasília).
 * A transferência inicial do lead para o primeiro vendedor segue ativa 24h.
 */
function isDentroDoHorarioOperacional(now: Date): boolean {
  // Converte para horário de Brasília (UTC-3)
  const nowBrasilia = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const hora = nowBrasilia.getUTCHours();
  const minuto = nowBrasilia.getUTCMinutes();
  const minutosDoDia = hora * 60 + minuto;

  const inicioRodizio = 10 * 60 + 11; // 10:11
  const fimRodizio = 19 * 60;         // 19:00
  const ativo = minutosDoDia >= inicioRodizio && minutosDoDia <= fimRodizio;
  console.log(`[Cron] Hora Brasília: ${hora}:${String(minuto).padStart(2, '0')} | Horário operacional: ${ativo ? 'SIM ✅' : 'NÃO ⛔'}`);
  return ativo;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const now = new Date();
    const fiveMinsAgo = new Date(now.getTime() - 5 * 60000).toISOString();
    const tenMinsAgo = new Date(now.getTime() - 10 * 60000).toISOString();

    console.log(`[Cron] Iniciando varredura. Agora: ${now.toISOString()} | 5m ago: ${fiveMinsAgo} | 10m ago: ${tenMinsAgo}`);

    const operacional = isDentroDoHorarioOperacional(now);

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 1: ROTATIVIDADE DE VENDEDORES (transferência pendente > 10 min)
    // REGRA: O vendedor tem 10 minutos para responder "Ok" a partir do momento
    //        em que RECEBEU a notificação (ai_lead_transfers.created_at).
    //        Usa ai_lead_transfers como fonte de verdade, NÃO last_interaction_at.
    //        Só executa dentro do horário operacional (10:10 - 21:30 Brasília).
    // ════════════════════════════════════════════════════════════════
    if (operacional) {
      // Buscar transferências pendentes onde o vendedor NÃO confirmou em 10 minutos
      const { data: pendingTransfers } = await supabase
        .from('ai_lead_transfers')
        .select('*, lead:ai_crm_leads(*, wa_ai_agents(id, name, instance_id, instance_ids))')
        .eq('is_confirmed', false)
        .eq('transfer_status', 'pending')
        .lte('created_at', tenMinsAgo); // A notificação foi criada há mais de 10 minutos

      if (pendingTransfers && pendingTransfers.length > 0) {
        console.log(`[Cron] Encontradas ${pendingTransfers.length} transferências pendentes há mais de 10 min.`);
        const { data: allInstances } = await supabase.from('wa_instances').select('*');

        for (const transfer of pendingTransfers) {
          const lead = transfer.lead;
          if (!lead) {
            console.warn(`[Cron] Transferência ${transfer.id} sem lead associado. Pulando.`);
            continue;
          }

          // Verificar se o lead ainda está 'qualificado' (vendedor pode ter confirmado manualmente)
          const { data: freshLead } = await supabase
            .from('ai_crm_leads')
            .select('id, status, assigned_to_id')
            .eq('id', lead.id)
            .maybeSingle();

          if (!freshLead || freshLead.status !== 'qualificado') {
            console.log(`[Cron] Lead ${lead.id} não está mais qualificado (status: ${freshLead?.status}). Marcando transferência como expirada e pulando.`);
            await supabase.from('ai_lead_transfers')
              .update({ transfer_status: 'expired' })
              .eq('id', transfer.id);
            continue;
          }

          const agentId = lead.agent_id;
          const currentSellerId = transfer.to_member_id;

          // Marcar a transferência atual como expirada ATOMICAMENTE antes de repassar
          const { data: expireResult } = await supabase
            .from('ai_lead_transfers')
            .update({ transfer_status: 'expired' })
            .eq('id', transfer.id)
            .eq('transfer_status', 'pending') // SÓ expira se ainda for pending
            .select('id');

          if (!expireResult || expireResult.length === 0) {
            console.log(`[Cron] Transferência ${transfer.id} já foi processada por outro worker. Pulando.`);
            continue;
          }

          // Buscar próximo vendedor na fila (excluindo o atual que não respondeu)
          const { data: teamMembers } = await supabase
            .from('ai_team_members')
            .select('*')
            .eq('user_id', lead.user_id)
            .eq('is_active', true)
            .order('last_lead_received_at', { ascending: true, nullsFirst: true })
            .limit(50);

          const availableSellers = uniqueSellersByPhone(
            teamMembers || [],
            currentSellerId,
            sellerPhoneKey({ whatsapp_number: transfer.ai_team_members?.whatsapp_number })
          );

          if (availableSellers.length === 0) {
            console.log(`[Cron] Nenhum outro vendedor disponível para o agente ${agentId}. Lead ${lead.id} permanece com vendedor atual.`);
            // Repassar de volta para o mesmo (sem outros disponíveis)
            await supabase.from('ai_lead_transfers')
              .update({ transfer_status: 'pending' })
              .eq('id', transfer.id);
            continue;
          }

          const nextSeller = availableSellers[0];
          console.log(`[Cron] Repassando lead ${lead.id} de ${currentSellerId} para ${nextSeller.name} (não respondeu em 10min).`);

          // Atualizar lead com novo vendedor
          await supabase.from('ai_crm_leads').update({
            assigned_to_id: nextSeller.id,
          }).eq('id', lead.id).eq('status', 'qualificado');

          // Atualizar timestamp do novo vendedor
          await supabase.from('ai_team_members').update({
            last_lead_received_at: now.toISOString(),
          }).eq('id', nextSeller.id);

          // Criar nova transferência para o próximo vendedor
          await supabase.from('ai_lead_transfers').insert({
            user_id: lead.user_id,
            lead_id: lead.id,
            from_member_id: currentSellerId,
            to_member_id: nextSeller.id,
            transfer_reason: 'Rodízio por Inatividade do Vendedor (10min)',
            notes: `Repassado de ${currentSellerId} para ${nextSeller.name} por falta de resposta em 10 minutos`,
            transfer_status: 'pending',
            is_confirmed: false,
            confirmation_timeout_at: new Date(now.getTime() + 15 * 60000).toISOString(),
          });

          // Notificar próximo vendedor
          const agentData = lead.wa_ai_agents;
          let targetInstanceId = agentData?.instance_id;
          if (!targetInstanceId && agentData?.instance_ids?.length > 0) targetInstanceId = agentData.instance_ids[0];
          const instance = allInstances?.find((i: any) => i.id === targetInstanceId);

          if (instance && nextSeller.whatsapp_number) {
            const baseUrl = instance.api_url?.replace(/\/$/, '');
            const instKey = instance.api_key_encrypted || instance.api_key;
            const cleanSellerNum = nextSeller.whatsapp_number.replace(/\D/g, '');
            const phoneNumber = lead.remote_jid.split('@')[0];

            // Gerar resumo para o próximo vendedor
            let aiGeneratedSummary = lead.summary || 'Lead qualificado aguardando atendimento.';
            try {
              const { data: fullChat } = await supabase
                .from('wa_chat_history')
                .select('role, content, created_at')
                .eq('agent_id', agentId)
                .eq('remote_jid', lead.remote_jid)
                .order('created_at', { ascending: false })
                .limit(20);

              const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
              if (openaiApiKey && fullChat && fullChat.length > 0) {
                const chatTranscript = fullChat.reverse().map((m: any) =>
                  `${m.role === 'user' ? `Cliente (${lead.lead_name || 'Desconhecido'})` : 'Agente IA'}: ${String(m.content || '').substring(0, 400)}`
                ).join('\n');

                const summaryRes = await fetch('https://api.openai.com/v1/chat/completions', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
                  body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    temperature: 0.3,
                    messages: [
                      { role: 'system', content: `Gere um briefing curto e objetivo para um vendedor de carros que está recebendo um lead repassado. Inclua: veículo de interesse, perfil do cliente e dica de abordagem. Máximo 5 linhas.` },
                      { role: 'user', content: `Conversa:\n${chatTranscript}\n\nGere o briefing.` }
                    ]
                  })
                });
                if (summaryRes.ok) {
                  const sd = await summaryRes.json();
                  const gt = sd.choices?.[0]?.message?.content;
                  if (gt) aiGeneratedSummary = gt;
                }
              }
            } catch (e) { /* silencioso */ }

            const notificationMsg = `🚨 *LEAD REPASSADO (Vendedor anterior não respondeu em 10min)*\n\n👤 *Nome:* ${lead.lead_name || 'Desconhecido'}\n📱 *Número:* +${phoneNumber}\n🤖 *Agente IA:* ${agentData?.name || 'Assistente'}\n\n━━━━━━━━━━━━━━━━━━━━\n📊 *ANÁLISE DO LEAD PELA IA:*\n${aiGeneratedSummary}\n\n━━━━━━━━━━━━━━━━━━━━\n\n👉 *Atender agora:* https://wa.me/${phoneNumber}\n\n*Responda "Ok" para assumir este atendimento!* ⏳`;

            await sendUazapiTextMessage(baseUrl, instKey, instance.instance_name, cleanSellerNum, `${cleanSellerNum}@s.whatsapp.net`, notificationMsg);
            console.log(`[Cron] Notificação enviada para ${nextSeller.name}.`);
          }
        }
      } else {
        console.log('[Cron] Nenhuma transferência pendente com timeout.');
      }
    } else {
      console.log('[Cron] Fora do horário operacional. Seção 1 (rodízio) ignorada.');
    }

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 2: FOLLOW-UP + TRANSFERÊNCIA POR INATIVIDADE DO CLIENTE
    // 5 min → ping de follow-up (funciona 24h)
    // 10 min → transferência para vendedor (só dentro do horário operacional)
    // ════════════════════════════════════════════════════════════════
    const { data: leads, error } = await supabase
      .from('ai_crm_leads')
      .select('*, wa_ai_agents(id, name, instance_id, instance_ids)')
      .in('status', ['novo', 'interessado'])
      .is('assigned_to_id', null)
      .not('last_agent_reply_at', 'is', null)
      .not('last_user_reply_at', 'is', null)
      .lte('last_agent_reply_at', fiveMinsAgo);

    if (error) throw error;
    if (!leads || leads.length === 0) {
      console.log('[Cron] Nenhum lead inativo encontrado.');
      return new Response(JSON.stringify({ message: "Nenhum lead inativo." }), { headers: corsHeaders, status: 200 });
    }

    console.log(`[Cron] Encontrados ${leads.length} leads inativos. Processando...`);
    const { data: instances } = await supabase.from('wa_instances').select('*');

    let processed5Min = 0;
    let processed10Min = 0;

    for (const lead of leads) {
      // Ignorar se o usuario falou depois do agente
      if (new Date(lead.last_user_reply_at) >= new Date(lead.last_agent_reply_at)) continue;

      const agentData = lead.wa_ai_agents;
      let targetInstanceId = agentData?.instance_id;
      if (!targetInstanceId && agentData?.instance_ids?.length > 0) targetInstanceId = agentData.instance_ids[0];

      const instance = instances?.find((i: any) => i.id === targetInstanceId);
      if (!instance) continue;

      const baseUrl = instance.api_url?.replace(/\/$/, '');
      const instKey = instance.api_key_encrypted || instance.api_key;
      const instanceName = instance.instance_name;
      const remoteJid = lead.remote_jid;
      const phoneNumber = remoteJid.split('@')[0];
      const agentId = lead.agent_id;

      const is10MinPassed = new Date(lead.last_agent_reply_at) <= new Date(tenMinsAgo);

      if (is10MinPassed) {
        // --- REGRA DE 10 MINUTOS: TRANSFERÊNCIA PARA VENDEDOR (Funciona 24/7) ---
        // Sempre envia o lead inicial para o funil do vendedor, independente do horário.
        const { data: updatedRows, error: updateError } = await supabase
          .from('ai_crm_leads')
          .update({
            status: 'qualificado',
            last_interaction_at: now.toISOString()
          })
          .in('status', ['novo', 'interessado'])
          .eq('id', lead.id)
          .select('id');

        if (updateError || !updatedRows || updatedRows.length === 0) {
          console.log(`[Cron] Lead ${phoneNumber} já foi processado. Pulando.`);
          continue;
        }

        console.log(`[Cron] Lead ${phoneNumber} inativo há 10 min. Status → qualificado. Buscando vendedor...`);

        const { data: teamMembers } = await supabase
          .from('ai_team_members')
          .select('*')
          .eq('user_id', lead.user_id)
          .eq('is_active', true)
          .order('last_lead_received_at', { ascending: true, nullsFirst: true })
          .limit(50);

        let selectedSellerId = null;
        let sellerName = 'Especialista';
        const availableSellers = uniqueSellersByPhone(teamMembers || []);

        if (availableSellers.length > 0) {
          let seller = availableSellers[0];
          const { data: previousLeadSeller } = await supabase
            .from('ai_crm_leads')
            .select('assigned_to_id')
            .eq('user_id', lead.user_id)
            .eq('remote_jid', lead.remote_jid)
            .not('assigned_to_id', 'is', null)
            .order('last_interaction_at', { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();
          const previousSeller = availableSellers.find((member: any) => member.id === previousLeadSeller?.assigned_to_id);
          if (previousSeller) {
            seller = previousSeller;
            console.log(`[Cron] Lead recorrente ${phoneNumber}. Mantendo vendedor anterior: ${seller.name}`);
          }
          selectedSellerId = seller.id;
          sellerName = seller.name;

          await supabase.from('ai_crm_leads').update({
            status: 'qualificado',
            assigned_to_id: seller.id,
            followup_5min_sent: true,
            last_interaction_at: now.toISOString()
          }).eq('id', lead.id);

          await supabase.from('ai_lead_transfers').insert({
            user_id: lead.user_id,
            lead_id: lead.id,
            to_member_id: seller.id,
            transfer_reason: 'Inatividade do cliente (10 minutos)',
            notes: `Transferido automaticamente para ${seller.name} via cron`,
            transfer_status: 'pending',
            is_confirmed: false,
            confirmation_timeout_at: new Date(now.getTime() + 15 * 60000).toISOString(),
          });

          await supabase.from('ai_team_members').update({
            last_lead_received_at: now.toISOString(),
          }).eq('id', seller.id);

          if (seller.whatsapp_number) {
            const cleanSellerNum = seller.whatsapp_number.replace(/\D/g, '');

            const { data: fullChat } = await supabase
              .from('wa_chat_history')
              .select('role, content, created_at')
              .eq('agent_id', agentId)
              .eq('remote_jid', remoteJid)
              .order('created_at', { ascending: false })
              .limit(20);

            let aiGeneratedSummary = lead.summary || 'O cliente demonstrou interesse e parou de responder durante a conversa.';
            try {
              const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
              if (openaiApiKey && fullChat && fullChat.length > 0) {
                const chatTranscript = fullChat.reverse().map((m: any) =>
                  `${m.role === 'user' ? `Cliente (${lead.lead_name || 'Desconhecido'})` : 'Agente IA'}: ${String(m.content || '').substring(0, 400)}`
                ).join('\n');

                const summaryRes = await fetch('https://api.openai.com/v1/chat/completions', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
                  body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    temperature: 0.3,
                    messages: [
                      { role: 'system', content: `Você é um analista de vendas especialista em mercado automotivo. Gere um briefing objetivo para o vendedor humano que vai assumir o atendimento. O cliente parou de responder.\n\nSeções obrigatórias:\n🚗 *VEÍCULO DE INTERESSE:*\n📢 *ORIGEM DO LEAD:*\n👤 *PERFIL DO CLIENTE:*\n💡 *DICA PARA RETOMADA:*\n\nSeja direto. Não invente informações.` },
                      { role: 'user', content: `Conversa:\n${chatTranscript}\n\nGere o briefing.` }
                    ]
                  })
                });
                if (summaryRes.ok) {
                  const sd = await summaryRes.json();
                  const gt = sd.choices?.[0]?.message?.content;
                  if (gt) aiGeneratedSummary = gt;
                }
              }
            } catch (e) { /* silencioso */ }

            const notificationMsg = `🔥 *NOVO LEAD QUALIFICADO (Inatividade)*\n\n👤 *Cliente:* ${lead.lead_name || 'Desconhecido'}\n📱 *Contato:* +${phoneNumber}\n🤖 *Agente IA:* ${agentData?.name || 'Agente'}\n\n━━━━━━━━━━━━━━━━━━━━\n📊 *ANÁLISE DO LEAD PELA IA:*\n${aiGeneratedSummary}\n\n━━━━━━━━━━━━━━━━━━━━\n\n👉 *Atender agora:* https://wa.me/${phoneNumber}\n\n*Responda "Ok" para assumir este atendimento!* ⏳`;

            await sendUazapiTextMessage(baseUrl, instKey, instanceName, cleanSellerNum, `${cleanSellerNum}@s.whatsapp.net`, notificationMsg);
          }
        }
        // Mensagem de despedida para o cliente
        const byeMsg = "Estarei te transferindo para um dos nossos especialistas em vendas!";
        await sendUazapiTextMessage(baseUrl, instKey, instanceName, phoneNumber, remoteJid, byeMsg);
        processed10Min++;

      } else if (!lead.followup_5min_sent) {
        // --- REGRA DE 5 MINUTOS (FOLLOW-UP) — Funciona 24h ---
        console.log(`[Cron] Lead ${phoneNumber} inativo há 5 min. Enviando ping...`);
        const randomMsg = FIVE_MIN_MESSAGES[Math.floor(Math.random() * FIVE_MIN_MESSAGES.length)];

        const sent = await sendUazapiTextMessage(baseUrl, instKey, instanceName, phoneNumber, remoteJid, randomMsg);

        if (sent) {
          await supabase.from('ai_crm_leads').update({
            followup_5min_sent: true
          }).eq('id', lead.id);

          await supabase.from('wa_chat_history').insert({
            user_id: lead.user_id, agent_id: agentId, instance_id: instanceName,
            remote_jid: remoteJid, role: 'assistant', content: randomMsg
          });

          processed5Min++;
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      horario_operacional: operacional,
      processed_5_min: processed5Min,
      processed_10_min: processed10Min
    }), { headers: corsHeaders, status: 200 })

  } catch (err: any) {
    console.error("[Cron] Falha:", err);
    return new Response(JSON.stringify({ error: err.message }), { headers: corsHeaders, status: 500 })
  }
})


