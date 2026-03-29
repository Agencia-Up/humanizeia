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
    console.log("WebHook Uazapi Payload:", JSON.stringify(payload));

    // O WebHook da Uazapi (padrão Evolution/ZAPI) vem neste formato
    const event = payload.event;
    if (event !== 'messages.upsert') {
      return new Response(JSON.stringify({ message: "Ignored event" }), { headers: corsHeaders })
    }

    const { instance, data } = payload;
    const { key, message, pushName, messageType } = data;

    if (key.fromMe) return new Response('Ignored fromMe', { headers: corsHeaders });
    if (key.remoteJid.includes('@broadcast')) return new Response('Ignored broadcast', { headers: corsHeaders });
    if (key.remoteJid.includes('@g.us')) return new Response('Ignored group', { headers: corsHeaders });

    // Extrai o texto da mensagem
    let userText = '';
    if (messageType === 'conversation') userText = message.conversation;
    else if (messageType === 'extendedTextMessage') userText = message.extendedTextMessage.text;
    else return new Response('Unsupported message type', { headers: corsHeaders });

    if (!userText.trim()) return new Response('Empty text', { headers: corsHeaders });

    // 1. Achar o agente atrelado a essa instância ativa
    // Procuramos na tabela wa_instances para pegar o ID local
    const { data: waInstance } = await supabaseClient
      .from('wa_instances')
      .select('id, user_id, api_key, server_url')
      .eq('instance_name', instance)
      .single();

    if (!waInstance) {
      console.log(`Instância ${instance} não encontrada no banco.`);
      return new Response('Instance not found', { headers: corsHeaders });
    }

    // Achar o Agente (Pedro) que está ativo e atrelado a essa instância
    // Pode ser que o agent tenha a instance no array instance_ids
    const { data: agents } = await supabaseClient
      .from('wa_ai_agents')
      .select('*')
      .eq('user_id', waInstance.user_id)
      .eq('is_active', true)
      .contains('instance_ids', [waInstance.id]);

    // Se o array estiver vazio, tenta achar o agente genérico (array vazio atende todos)
    let agent = agents && agents.length > 0 ? agents[0] : null;

    if (!agent) {
      const { data: globalAgents } = await supabaseClient
        .from('wa_ai_agents')
        .select('*')
        .eq('user_id', waInstance.user_id)
        .eq('is_active', true)
        .filter('instance_ids', 'eq', '[]'); // Array vazio significa Todas as Instâncias
      
      if (globalAgents && globalAgents.length > 0) agent = globalAgents[0];
    }

    if (!agent) {
      console.log(`Nenhum agente ativo atribuído à instância ${instance}.`);
      return new Response('No matching agent', { headers: corsHeaders });
    }

    // 2. Salvar Mensagem do Cliente na Tabela de Histórico
    await supabaseClient.from('wa_chat_history').insert({
      user_id: agent.user_id,
      agent_id: agent.id,
      instance_id: instance,
      remote_jid: key.remoteJid,
      role: 'user',
      content: userText,
      lead_name: pushName
    });

    // 3. Montar o Contexto do LLM
    //  3.1 - Buscar Base de Conhecimento do Salomão
    const { data: knowledge } = await supabaseClient
      .from('agent_knowledge')
      .select('knowledge_text')
      .eq('user_id', agent.user_id)
      .eq('agent_id', 'salomao')
      .single();

    // 3.2 - Histórico da Conversa
    const { data: history } = await supabaseClient
      .from('wa_chat_history')
      .select('role, content')
      .eq('instance_id', instance)
      .eq('remote_jid', key.remoteJid)
      .order('created_at', { ascending: false })
      .limit(15);
    
    const messagesReverse = (history || []).reverse();
    const chatGptMessages = messagesReverse.map(m => ({
      role: m.role,
      content: m.content
    }));

    // 3.3 - Prompt final
    let finalSystemPrompt = agent.system_prompt;
    
    if (agent.company_name) finalSystemPrompt += `\n\nNome da Empresa: ${agent.company_name}`;
    if (agent.services) finalSystemPrompt += `\n\nProdutos/Serviços que vendemos: ${agent.services}`;
    
    if (knowledge?.knowledge_text) {
      finalSystemPrompt += `\n\nBASE DE CONHECIMENTO DA EMPRESA (Use isso para basear suas respostas):\n${knowledge.knowledge_text}`;
    }

    if (agent.sdr_goal) {
      finalSystemPrompt += `\n\nSEU OBJETIVO DE QUALIFICAÇÃO NESTA CONVERSA: ${agent.sdr_goal}`;
    }

    if (agent.qualification_questions && agent.qualification_questions.length > 0) {
      finalSystemPrompt += `\n\nPERGUNTAS OBRIGATÓRIAS QUE VOCÊ DEVE FAZER DURANTE A CONVERSA:\n`;
      agent.qualification_questions.forEach((q: string, i: number) => {
        finalSystemPrompt += `${i + 1}. ${q}\n`;
      });
      finalSystemPrompt += `\nInstrução Importante: Tente fazer as perguntas naturalmente na conversa, um passo de cada vez, ao invés de enviar um questionário robótico. Avalie se a pessoa já forneceu a resposta antes de perguntar novamente.`;
    }

    // 4. Chamar a IA para gerar a resposta
    const openai = new Configuration({
      apiKey: Deno.env.get('OPENAI_API_KEY')
    });
    const openaiApi = new OpenAIApi(openai);

    const completion = await openaiApi.createChatCompletion({
      model: "gpt-4o-mini", // fallback model, o ideal é o usuário definir a chave e o gpt-4o
      messages: [
        { role: 'system', content: finalSystemPrompt },
        ...chatGptMessages
      ],
      temperature: agent.temperature || 0.7,
      max_tokens: agent.max_tokens || 500,
    });

    const aiResponse = completion.data.choices[0].message?.content || '';

    if (!aiResponse) return new Response('No AI Response', { headers: corsHeaders });

    // 5. Salvar a resposta da IA no banco
    await supabaseClient.from('wa_chat_history').insert({
      user_id: agent.user_id,
      agent_id: agent.id,
      instance_id: instance,
      remote_jid: key.remoteJid,
      role: 'assistant',
      content: aiResponse
    });

    // Subir o total de replies do Agente
    await supabaseClient.rpc('increment_agent_replies', { agent_id: agent.id });

    // 6. Enviar a Mensagem de Volta para o WhatsApp (via Uazapi)
    // Se o cliente definiu o Uazapi API KEY pelo server_url, usamos.
    // Senão, assumimos o painel global (isso varia conforme o deploy do app)
    const uazapiUrl = waInstance.server_url || `https://${instance}.uazapi.com`;
    const uazapiToken = waInstance.api_key || Deno.env.get('UAZAPI_GLOBAL_TOKEN');

    const sendResp = await fetch(`${uazapiUrl}/message/sendText/${instance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': uazapiToken as string
      },
      body: JSON.stringify({
        number: key.remoteJid.replace('@s.whatsapp.net', ''),
        options: { delay: agent.reply_delay_ms || 2000, presence: "composing" },
        textMessage: { text: aiResponse }
      })
    });

    if (!sendResp.ok) {
        console.error("Erro ao enviar msg:", await sendResp.text());
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders, status: 200 })

  } catch (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 })
  }
})
