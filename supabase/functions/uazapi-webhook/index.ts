import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Configuration, OpenAIApi } from 'https://esm.sh/openai@3.3.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const payload = await req.json()
    console.log("WebHook Uazapi Payload:", JSON.stringify(payload, null, 2));

    // Normalização de Eventos: Uazapi costuma usar MAIÚSCULAS (MESSAGES_UPSERT)
    // Evolution API v1 usa minúsculas (messages.upsert)
    const eventRaw = payload.event || '';
    const event = eventRaw.toLowerCase();
    
    if (event !== 'messages.upsert') {
      console.log(`[Webhook] Ignorando evento não suportado: ${eventRaw}`);
      return new Response(JSON.stringify({ message: "Ignored event", event: eventRaw }), { headers: corsHeaders })
    }

    // Normalização de Dados: O payload pode vir com 'instance' e 'data' no root
    // ou dentro de estruturas diferentes dependendo da versão
    const instance = payload.instance || payload.data?.instance || '';
    const data = payload.data || payload; 
    const { key, message, pushName, messageType } = data;

    if (!instance || !key || !message) {
        console.error("[Webhook] Payload incompleto:", JSON.stringify({ instance: !!instance, key: !!key, message: !!message }));
        return new Response('Incomplete payload', { headers: corsHeaders });
    }

    // Filtrar mensagens
    if (key.fromMe) return new Response('Ignored fromMe', { headers: corsHeaders });
    if (key.remoteJid.includes('@broadcast')) return new Response('Ignored broadcast', { headers: corsHeaders });
    if (key.remoteJid.includes('@g.us')) return new Response('Ignored group', { headers: corsHeaders });

    // Extrai o texto da mensagem (Suporta múltiplos formatos)
    let userText = '';
    if (messageType === 'conversation') userText = message.conversation || '';
    else if (messageType === 'extendedTextMessage') userText = message.extendedTextMessage?.text || '';
    else if (message.conversation) userText = message.conversation;
    else if (message.extendedTextMessage?.text) userText = message.extendedTextMessage.text;
    
    if (!userText.trim()) {
        console.log("[Webhook] Texto vazio ignorado");
        return new Response('Empty text', { headers: corsHeaders });
    }

    // 1. Localizar a instância no banco
    const { data: waInstance, error: fetchInstErr } = await supabaseClient
      .from('wa_instances')
      .select('*')
      .eq('instance_name', instance)
      .single();

    if (fetchInstErr || !waInstance) {
      console.log(`[Webhook] Instância ${instance} não encontrada no banco.`);
      return new Response('Instance not found', { headers: corsHeaders });
    }

    const instanceData = {
      ...waInstance,
      api_key: waInstance.api_key_encrypted,
      server_url: waInstance.api_url
    };

    // Achar o Agente Ativo vinculado a essa instância
    const { data: agent, error: agentErr } = await supabaseClient
      .from('wa_ai_agents')
      .select('*')
      .eq('user_id', instanceData.user_id)
      .eq('is_active', true)
      .contains('instance_ids', [instanceData.id])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (agentErr || !agent) {
      console.log(`[Webhook] Nenhum agente ativo atribuído à instância ${instance}.`);
      return new Response('No matching agent', { headers: corsHeaders });
    }

    // 2. Salvar Mensagem do Cliente na Tabela de Histórico
    try {
        await supabaseClient.from('wa_chat_history').insert({
          user_id: agent.user_id,
          agent_id: agent.id,
          instance_id: instance,
          remote_jid: key.remoteJid,
          role: 'user',
          content: userText,
          lead_name: pushName || 'Lead'
        });
    } catch (dbErr) {
        console.warn("[Webhook] Falha ao salvar histórico:", dbErr);
    }

    // 3. Montar o Contexto do LLM (Semelhante ao anterior)
    const { data: knowledge } = await supabaseClient
      .from('agent_knowledge')
      .select('knowledge_text')
      .eq('user_id', agent.user_id)
      .maybeSingle();

    const { data: history } = await supabaseClient
      .from('wa_chat_history')
      .select('role, content')
      .eq('instance_id', instance)
      .eq('remote_jid', key.remoteJid)
      .order('created_at', { ascending: false })
      .limit(10);
    
    const chatGptMessages = (history || []).reverse().map(m => ({
      role: m.role,
      content: m.content
    }));

    let finalSystemPrompt = agent.system_prompt || 'Você é um assistente prestativo.';
    if (agent.company_name) finalSystemPrompt += `\n\nEmpresa: ${agent.company_name}`;
    if (agent.services) finalSystemPrompt += `\nProdutos/Serviços: ${agent.services}`;
    if (knowledge?.knowledge_text) {
      finalSystemPrompt += `\n\nBASE DE CONHECIMENTO:\n${knowledge.knowledge_text}`;
    }

    // 4. Chamar IA
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
        console.error("[Webhook] OPENAI_API_KEY desapareceu!");
        return new Response('Missing AI Key', { status: 500 });
    }
    
    const configuration = new Configuration({ apiKey: openaiApiKey });
    const openaiApi = new OpenAIApi(configuration);

    const completion = await openaiApi.createChatCompletion({
      model: agent.model || "gpt-4o-mini",
      messages: [
        { role: 'system', content: finalSystemPrompt },
        ...chatGptMessages
      ],
      temperature: agent.temperature || 0.7,
    });

    const aiResponse = completion.data.choices[0].message?.content || '';
    if (!aiResponse) return new Response('No AI Response', { headers: corsHeaders });

    // 5. Salvar resposta IA
    await supabaseClient.from('wa_chat_history').insert({
      user_id: agent.user_id,
      agent_id: agent.id,
      instance_id: instance,
      remote_jid: key.remoteJid,
      role: 'assistant',
      content: aiResponse
    });

    // 6. Enviar de volta para WhatsApp (Universal Format)
    const baseUrl = (instanceData.server_url || Deno.env.get('EVOLUTION_API_URL') || '').replace(/\/$/, '');
    const globalKey = Deno.env.get('EVOLUTION_API_KEY') || '';
    const instKey = instanceData.api_key || globalKey;

    console.log(`[Webhook] Enviando resposta para ${key.remoteJid} via ${instance}`);
    
    // Suporta Evolution v1 e v2/Uazapi enviando o máximo de tokens nos headers
    const sendResp = await fetch(`${baseUrl}/message/sendText/${instance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': globalKey,
        'token': instKey,
        'admintoken': globalKey
      },
      body: JSON.stringify({
        number: key.remoteJid.split('@')[0],
        text: aiResponse, // Formato v2/Uazapi
        textMessage: { text: aiResponse }, // Formato v1 fallback
        options: { delay: agent.reply_delay_ms || 1000, presence: "composing" }
      })
    });

    if (!sendResp.ok) {
        const errText = await sendResp.text();
        console.error(`[Webhook] Erro no envio (${sendResp.status}):`, errText);
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders, status: 200 })

  } catch (error: any) {
    console.error("[Webhook] Erro Crítico:", error);
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 })
  }
});
