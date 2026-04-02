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
    console.log("[Webhook] Payload Recebido:", JSON.stringify(payload, null, 2));

    const eventRaw = payload.event || '';
    const event = eventRaw.toLowerCase();
    
    if (event !== 'messages.upsert') {
      console.log(`[Webhook] Evento ignorado: ${eventRaw}`);
      return new Response(JSON.stringify({ message: "Ignored event" }), { headers: corsHeaders })
    }

    // Normalização: Uazapi costuma mandar data como um ARRAY [ { ... } ]
    let data = payload.data || payload; 
    if (Array.isArray(data)) {
        console.log(`[Webhook] Detectado payload em ARRAY. Extraindo primeiro item.`);
        data = data[0];
    }
    
    const instance = payload.instance || data.instance || '';
    const { key, message, pushName, messageType } = data;

    if (!instance || !key || !message) {
        console.error("[Webhook] Erro: Dados incompletos no payload (Normalizado).", JSON.stringify({ instance: !!instance, key: !!key, message: !!message }));
        return new Response('Incomplete payload', { headers: corsHeaders });
    }

    if (key.fromMe) return new Response('Ignored fromMe', { headers: corsHeaders });
    if (key.remoteJid.includes('@broadcast') || key.remoteJid.includes('@g.us')) {
        return new Response('Ignored group/broadcast', { headers: corsHeaders });
    }

    // Extração robusta de texto
    let userText = '';
    if (messageType === 'conversation') userText = message.conversation || '';
    else if (messageType === 'extendedTextMessage') userText = message.extendedTextMessage?.text || '';
    else {
        // Fallbacks para formatos variados
        userText = message.conversation || 
                   message.extendedTextMessage?.text || 
                   message.text || 
                   data.text || 
                   '';
    }
    
    if (!userText.trim()) {
        console.log("[Webhook] Texto não encontrado no objeto message.");
        return new Response('Empty text', { headers: corsHeaders });
    }

    console.log(`[Webhook] Mensagem de ${pushName} (${key.remoteJid}): "${userText}"`);

    // 1. Localizar Instância
    const { data: waInstance, error: instErr } = await supabaseClient
      .from('wa_instances')
      .select('*')
      .eq('instance_name', instance)
      .maybeSingle();

    if (instErr || !waInstance) {
      console.log(`[Webhook] Instância "${instance}" não configurada no HumanizeIA.`);
      return new Response('Instance not found', { headers: corsHeaders });
    }

    // 2. Achar Agente Ativo
    console.log(`[Webhook] Buscando agente para Instância ID: ${waInstance.id}`);
    const { data: agent, error: agentErr } = await supabaseClient
      .from('wa_ai_agents')
      .select('*')
      .eq('user_id', waInstance.user_id)
      .eq('is_active', true)
      .contains('instance_ids', [waInstance.id])
      .maybeSingle();

    if (agentErr || !agent) {
      console.log(`[Webhook] Nenhum agente ATIVO e VINCULADO encontrado para a instância ${instance}.`);
      return new Response('No matching active agent', { headers: corsHeaders });
    }

    console.log(`[Webhook] Agente encontrado: "${agent.name}" (ID: ${agent.id})`);

    // 3. Salvar Histórico
    try {
        const { error: histErr } = await supabaseClient.from('wa_chat_history').insert({
          user_id: agent.user_id,
          agent_id: agent.id,
          instance_id: instance,
          remote_jid: key.remoteJid,
          role: 'user',
          content: userText,
          lead_name: pushName || 'Lead'
        });
        if (histErr) console.warn("[Webhook] Erro ao salvar histórico:", histErr);
    } catch (e) {
        console.error("[Webhook] Exceção ao salvar histórico:", e);
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
    const baseUrl = (waInstance.api_url || Deno.env.get('EVOLUTION_API_URL') || '').replace(/\/$/, '');
    const globalKey = Deno.env.get('EVOLUTION_API_KEY') || '';
    const instKey = waInstance.api_key_encrypted || globalKey;

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
