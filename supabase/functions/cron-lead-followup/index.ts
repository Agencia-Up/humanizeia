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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Pegar a hora atual
    const now = new Date();
    
    // Calcular thresholds
    const fiveMinsAgo = new Date(now.getTime() - 5 * 60000).toISOString();
    const tenMinsAgo = new Date(now.getTime() - 10 * 60000).toISOString();

    console.log(`[Cron] Iniciando varredura. 5 mins ago: ${fiveMinsAgo} | 10 mins ago: ${tenMinsAgo}`);

    // --- ROTATIVIDADE DE VENDEDORES (5 MIN) ---
    const { data: timeoutLeads } = await supabase
      .from('ai_crm_leads')
      .select('*, wa_ai_agents(id, name, instance_id, instance_ids)')
      .eq('status', 'qualificado')
      .not('assigned_to_id', 'is', null)
      .lte('last_interaction_at', fiveMinsAgo);

    if (timeoutLeads && timeoutLeads.length > 0) {
      console.log(`[Cron] Encontrados ${timeoutLeads.length} leads qualificados aguardando vendedor ha mais de 5 min.`);
      const { data: instances } = await supabase.from('wa_instances').select('*');

      for (const lead of timeoutLeads) {
        const agentId = lead.agent_id;
        const currentSellerId = lead.assigned_to_id;
        
        // Buscar proximo vendedor (excluindo o atual)
        const { data: teamMembers } = await supabase
          .from('ai_team_members')
          .select('*')
          .eq('agent_id', agentId)
          .eq('is_active', true)
          .neq('id', currentSellerId)
          .order('last_lead_received_at', { ascending: true, nullsFirst: true })
          .limit(1);

        if (teamMembers && teamMembers.length > 0) {
          const nextSeller = teamMembers[0];
          
          await supabase.from('ai_crm_leads').update({
            assigned_to_id: nextSeller.id,
            last_interaction_at: now.toISOString() // Reseta o timer para o novo vendedor
          }).eq('id', lead.id);

          await supabase.from('ai_team_members').update({ 
            last_lead_received_at: now.toISOString(), 
            total_leads_received: (nextSeller.total_leads_received || 0) + 1 
          }).eq('id', nextSeller.id);

          const agentData = lead.wa_ai_agents;
          let targetInstanceId = agentData?.instance_id;
          if (!targetInstanceId && agentData?.instance_ids?.length > 0) targetInstanceId = agentData.instance_ids[0];
          const instance = instances?.find((i: any) => i.id === targetInstanceId);

          if (instance && nextSeller.whatsapp_number) {
            const baseUrl = instance.api_url?.replace(/\/$/, '');
            const instKey = instance.api_key_encrypted || instance.api_key;
            const cleanSellerNum = nextSeller.whatsapp_number.replace(/\D/g, '');
            const phoneNumber = lead.remote_jid.split('@')[0];
            
            const notificationMsg = `🚨 *LEAD REPASSADO (Vendedor Anterior Não Respondeu)*\n\n*Nome:* ${lead.lead_name || 'Desconhecido'}\n*Numero:* +${phoneNumber}\n*Resumo:* ${lead.summary || 'Sem resumo'}\n\n👉 *Atender agora:* https://wa.me/${phoneNumber}\n\nResponda "Ok" para assumir este atendimento!`;
            await sendUazapiTextMessage(baseUrl, instKey, instance.instance_name, cleanSellerNum, `${cleanSellerNum}@s.whatsapp.net`, notificationMsg);
            console.log(`[Cron] Lead ${lead.id} repassado para ${nextSeller.name}`);
          }
        }
      }
    }

    // Buscar leads que precisam de follow-up (5 mins) ou transferencia (10 mins)
    // Regras: 
    // - status: em_atendimento ou novo
    // - last_agent_reply_at > last_user_reply_at (o bot foi o ultimo a falar)
    // - last_agent_reply_at <= fiveMinsAgo (passou 5 min desde a ultima msg do bot)
    const { data: leads, error } = await supabase
      .from('ai_crm_leads')
      .select('*, wa_ai_agents(id, name, instance_id, instance_ids)')
      .in('status', ['novo', 'interessado'])
      .not('last_agent_reply_at', 'is', null)
      .not('last_user_reply_at', 'is', null)
      .lte('last_agent_reply_at', fiveMinsAgo);

    if (error) throw error;
    if (!leads || leads.length === 0) {
      console.log('[Cron] Nenhum lead inativo encontrado.');
      return new Response(JSON.stringify({ message: "Nenhum lead inativo." }), { headers: corsHeaders, status: 200 });
    }

    console.log(`[Cron] Encontrados ${leads.length} leads inativos. Processando...`);

    // Fetch instances
    const { data: instances } = await supabase.from('wa_instances').select('*');

    let processed5Min = 0;
    let processed10Min = 0;

    for (const lead of leads) {
      // Ignorar se o usuario falou DEPOIS do agente (o agente esta processando ou bugou, mas a inatividade e do agente, nao do usuario)
      if (new Date(lead.last_user_reply_at) >= new Date(lead.last_agent_reply_at)) continue;

      const agentData = lead.wa_ai_agents;
      let targetInstanceId = agentData?.instance_id;
      if (!targetInstanceId && agentData?.instance_ids?.length > 0) targetInstanceId = agentData.instance_ids[0];
      
      const instance = instances?.find(i => i.id === targetInstanceId);
      if (!instance) continue;

      const baseUrl = instance.api_url?.replace(/\/$/, '');
      const instKey = instance.api_key_encrypted || instance.api_key;
      const instanceName = instance.instance_name;
      const remoteJid = lead.remote_jid;
      const phoneNumber = remoteJid.split('@')[0];
      const agentId = lead.agent_id;

      const is10MinPassed = new Date(lead.last_agent_reply_at) <= new Date(tenMinsAgo);

      if (is10MinPassed) {
        // --- REGRA DE 10 MINUTOS (TRANSFERENCIA) ---
        // PASSO 1: Atualizar o status atomicamente para 'transferido' ANTES de qualquer mensagem.
        const { data: updatedRows, error: updateError } = await supabase
          .from('ai_crm_leads')
          .update({ status: 'transferido' })
          .in('status', ['novo', 'interessado'])
          .eq('id', lead.id)
          .select('id');

        // Se nenhuma linha foi atualizada, outro cron ja processou esse lead. Pular.
        if (updateError || !updatedRows || updatedRows.length === 0) {
          console.log(`[Cron] Lead ${phoneNumber} ja foi processado ou falhou no update. Pulando.`);
          continue;
        }

        console.log(`[Cron] Lead ${phoneNumber} inativo ha 10 min. Status atualizado. Iniciando transferencia...`);

        // PASSO 2: Achar vendedor pelo rodizio (menos leads recebidos)
        let selectedSellerId = null;
        const { data: teamMembers } = await supabase
          .from('ai_team_members')
          .select('*')
          .eq('agent_id', agentId)
          .eq('is_active', true)
          .order('last_lead_received_at', { ascending: true, nullsFirst: true })
          .limit(1);

        let sellerName = 'Especialista';
        
        if (teamMembers && teamMembers.length > 0) {
          const seller = teamMembers[0];
          selectedSellerId = seller.id;
          sellerName = seller.name;
          
          await supabase.from('ai_team_members').update({ 
            last_lead_received_at: new Date().toISOString(), 
            total_leads_received: (seller.total_leads_received || 0) + 1 
          }).eq('id', seller.id);

          // Avisar vendedor apenas se tiver numero de WhatsApp
          if (seller.whatsapp_number) {
            const cleanSellerNum = seller.whatsapp_number.replace(/\D/g, '');
            const notificationMsg = `ÔÜá´©Å *Novo Lead Transferido (Inatividade)*\n\nNome: ${lead.lead_name || 'Desconhecido'}\nNumero: ${phoneNumber}\nO bot transferiu automaticamente apos 10 minutos de inatividade do cliente.`;
            await sendUazapiTextMessage(baseUrl, instKey, instanceName, cleanSellerNum, `${cleanSellerNum}@s.whatsapp.net`, notificationMsg);
          }
        }

        // PASSO 3: Salvar o vendedor escolhido no CRM e historico
        await supabase.from('ai_crm_leads').update({
          assigned_to_id: selectedSellerId
        }).eq('id', lead.id);

        if (selectedSellerId) {
          await supabase.from('ai_lead_transfers').insert({
            user_id: lead.user_id,
            lead_id: lead.id,
            from_agent_id: agentId,
            to_member_id: selectedSellerId,
            transfer_reason: 'Inatividade (10 minutos)',
            notes: `Transferido automaticamente para o analista via cron`
          });
        }

        // PASSO 4: Mensagem de despedida para o cliente (depois de tudo garantido)
        const byeMsg = "Estarei te transferindo para um dos nossos especialistas em vendas!";
        await sendUazapiTextMessage(baseUrl, instKey, instanceName, phoneNumber, remoteJid, byeMsg);

        processed10Min++;

      } else if (!lead.followup_5min_sent) {
        // --- REGRA DE 5 MINUTOS (FOLLOW-UP) ---
        console.log(`[Cron] Lead ${phoneNumber} inativo ha 5 min. Enviando ping...`);
        const randomMsg = FIVE_MIN_MESSAGES[Math.floor(Math.random() * FIVE_MIN_MESSAGES.length)];
        
        const sent = await sendUazapiTextMessage(baseUrl, instKey, instanceName, phoneNumber, remoteJid, randomMsg);
        
        if (sent) {
          // Atualiza para nao enviar de novo e atualiza a last_agent_reply_at para reiniciar o cronometro dos proximos 5 minutos para dar os 10 totais
          // Porem se eu atualizar last_agent_reply_at, ele vai esperar mais 10 min a partir de AGORA para transferir.
          // O cliente quer 10 min no total. Entao nao mudo last_agent_reply_at. Apenas marco a flag.
          await supabase.from('ai_crm_leads').update({
            followup_5min_sent: true
          }).eq('id', lead.id);
          
          // Registrar no chat history
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
      processed_5_min: processed5Min, 
      processed_10_min: processed10Min 
    }), { headers: corsHeaders, status: 200 })

  } catch (err: any) {
    console.error("[Cron] Falha:", err);
    return new Response(JSON.stringify({ error: err.message }), { headers: corsHeaders, status: 500 })
  }
})
