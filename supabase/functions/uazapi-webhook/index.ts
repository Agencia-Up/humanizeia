import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const payload = await req.json()
    console.log("[Webhook] Payload COMPLETO:", JSON.stringify(payload))

    const isUazapi = !!(payload.BaseUrl || payload.EventType || payload.instanceId)
    const isEvolution = !!(payload.event || payload.data)
    
    // --- FORMATO UAZAPI ---
    if (isUazapi) {
      const eventType = String(payload.EventType || payload.eventType || '').toLowerCase()

      if (eventType === 'connection' || eventType === 'status' || eventType.includes('connect')) {
        const instanceName = payload.instance || payload.instanceName || payload.InstanceId || payload.instanceId || ''
        if (instanceName) {
          const state = String(payload.state || payload.status || '').toLowerCase()
          if (state === 'open' || state === 'connected') {
            await supabase.from('wa_instances')
              .update({ is_active: true, status: 'connected', updated_at: new Date().toISOString() })
              .eq('instance_name', instanceName)
          }
        }
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
      }
      
      if (eventType !== 'messages' && eventType !== 'message' && !eventType.includes('message')) {
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
      }

      const instanceName = payload.instance || payload.instanceName || payload.InstanceId || payload.instanceId || ''
      const chat = payload.chat || {}
      
      let msgObj = null
      if (Array.isArray(payload.messages) && payload.messages.length > 0) {
        msgObj = payload.messages[0]
      } else if (payload.message) {
        msgObj = payload.message
      }
      
      if (!msgObj) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
      if (msgObj.fromMe === true) return new Response('Ignored fromMe', { headers: corsHeaders })
      
      const remoteJid = msgObj.chatId || msgObj.chatid || msgObj.from || chat.id || chat.chatId || '';
      if (!remoteJid) { console.log('[Webhook] No remoteJid'); return new Response('No remoteJid', { headers: corsHeaders }); }
      if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast')) return new Response('Ignored group/broadcast', { headers: corsHeaders });

      const userText = (msgObj.body || msgObj.text || msgObj.caption || '').trim();
      const pushName = msgObj.senderName || chat.name || msgObj.notifyName || msgObj.pushName || 'Lead';
      
      console.log(`[Webhook] Mensagem recebida [UAZAPI]. Instance: ${instanceName}, From: ${remoteJid}, Text: ${userText}`);
      return await processMessage(supabase, instanceName, remoteJid, userText, pushName, msgObj);
    }

    // --- FORMATO EVOLUTION API ---
    const eventRaw = payload.event || ''
    const event = String(eventRaw).toLowerCase()

    if (event.includes('connection.update') || event.includes('connection_update')) {
      const data = payload.data || payload
      const instance = payload.instance || data.instance || ''
      const state = String(data.state || data.status || '').toLowerCase()
      if ((state === 'open' || state === 'connected') && instance) {
        await supabase.from('wa_instances')
          .update({ is_active: true, status: 'connected', updated_at: new Date().toISOString() })
          .eq('instance_name', instance)
      }
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
    }

    if (event !== 'messages.upsert' && event !== 'messages_upsert') {
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
    }

    let data = payload.data || payload
    if (Array.isArray(data)) data = data[0]

    const instance = payload.instance || data.instance || ''
    const { key, message, pushName, messageType } = data

    if (!instance || !key || !message) return new Response('Incomplete payload', { headers: corsHeaders })
    if (key.fromMe) return new Response('Ignored fromMe', { headers: corsHeaders })
    if (key.remoteJid?.includes('@broadcast') || key.remoteJid?.includes('@g.us')) return new Response('Ignored group/broadcast', { headers: corsHeaders })

    let userText = message.conversation || message.extendedTextMessage?.text || message.text || data.text || ''
    
    return await processMessage(supabase, instance, key.remoteJid, userText.trim(), pushName || 'Lead', data)

  } catch (error: any) {
    console.error("[Webhook] Erro Crítico:", error)
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 })
  }
})

function buildUazapiMediaFallbackContent(msgType: string, currentText: string) {
  const text = (currentText || '').trim();
  const normalizedType = String(msgType || '').toLowerCase();

  if (text) return text;
  if (normalizedType.includes('audio') || normalizedType === 'ptt') {
    return '[Mensagem de audio recebida sem transcricao]';
  }
  if (normalizedType.includes('image')) {
    return '[Imagem recebida sem legenda]';
  }
  if (normalizedType.includes('document')) {
    return '[Arquivo recebido sem leitura]';
  }
  return text;
}

function getUazapiMediaFallbackReply(content: string) {
  const normalized = (content || '').trim().toLowerCase();

  if (normalized.startsWith('[mensagem de audio recebida sem transcricao]')) {
    return 'Recebi seu audio aqui, mas ele chegou sem transcricao pra mim. Se puder, me manda de novo ou escreve rapidinho o ponto principal que eu continuo com voce.';
  }

  if (normalized.startsWith('[imagem recebida sem legenda]')) {
    return 'Recebi sua imagem aqui. Me diz rapidinho o que voce quer que eu avalie nela que eu sigo com voce.';
  }

  if (normalized.startsWith('[arquivo recebido sem leitura]') || normalized.startsWith('[arquivo recebido:')) {
    return 'Recebi seu arquivo aqui, mas por enquanto eu nao consigo abrir documentos direto. Se quiser, me resume o ponto principal em texto ou audio que eu te ajudo daqui.';
  }

  return null;
}

function inferUazapiMessageType(rawMsgObj: any) {
  const explicitType = String(
    rawMsgObj?.messageType ||
    rawMsgObj?.type ||
    rawMsgObj?.message_type ||
    rawMsgObj?.mediaType ||
    rawMsgObj?.mimeType ||
    rawMsgObj?.mimetype ||
    ''
  ).toLowerCase();

  const mimeType = String(rawMsgObj?.mimetype || rawMsgObj?.mimeType || '').toLowerCase();

  if (mimeType.startsWith('image/')) {
    return 'image';
  }

  if (mimeType.startsWith('application/')) {
    return 'document';
  }

  if (mimeType.startsWith('video/')) {
    return 'video';
  }

  if (mimeType.startsWith('audio/')) {
    return 'audio';
  }

  if (
    explicitType.includes('image') ||
    rawMsgObj?.image ||
    rawMsgObj?.imageMessage
  ) {
    return 'image';
  }

  if (
    explicitType.includes('document') ||
    explicitType.includes('file') ||
    rawMsgObj?.document ||
    rawMsgObj?.documentMessage ||
    rawMsgObj?.fileName ||
    rawMsgObj?.filename
  ) {
    return 'document';
  }

  if (
    explicitType.includes('video') ||
    rawMsgObj?.video ||
    rawMsgObj?.videoMessage
  ) {
    return 'video';
  }

  if (
    explicitType.includes('audio') ||
    explicitType.includes('ptt') ||
    explicitType.includes('voice') ||
    rawMsgObj?.audio ||
    rawMsgObj?.audioMessage ||
    rawMsgObj?.ptt
  ) {
    return 'audio';
  }

  return explicitType;
}

function extractUazapiMessageId(rawMsgObj: any) {
  return rawMsgObj?.messageid ||
    rawMsgObj?.messageId ||
    rawMsgObj?.id?.id ||
    rawMsgObj?.id ||
    rawMsgObj?.key?.id ||
    rawMsgObj?.msgId ||
    '';
}

function extractUazapiBase64(rawMsgObj: any) {
  const value = rawMsgObj?.base64 ||
    rawMsgObj?.base64Data ||
    rawMsgObj?.message?.base64 ||
    rawMsgObj?.message?.base64Data ||
    rawMsgObj?.media?.base64 ||
    rawMsgObj?.media?.base64Data ||
    rawMsgObj?.mediaBase64 ||
    rawMsgObj?.file ||
    rawMsgObj?.data?.base64 ||
    rawMsgObj?.data?.base64Data ||
    '';

  if (typeof value === 'string' && value.startsWith('data:')) {
    const parts = value.split(',');
    return parts.length > 1 ? parts[1] : '';
  }

  return value;
}

function extractUazapiMediaUrl(rawMsgObj: any) {
  return rawMsgObj?.url ||
    rawMsgObj?.mediaUrl ||
    rawMsgObj?.mediaURL ||
    rawMsgObj?.downloadUrl ||
    rawMsgObj?.downloadURL ||
    rawMsgObj?.fileUrl ||
    rawMsgObj?.fileURL ||
    rawMsgObj?.message?.url ||
    rawMsgObj?.message?.mediaUrl ||
    rawMsgObj?.message?.mediaURL ||
    rawMsgObj?.message?.downloadUrl ||
    rawMsgObj?.message?.downloadURL ||
    rawMsgObj?.data?.url ||
    rawMsgObj?.data?.mediaUrl ||
    rawMsgObj?.data?.mediaURL ||
    rawMsgObj?.data?.downloadUrl ||
    rawMsgObj?.data?.downloadURL ||
    rawMsgObj?.data?.fileURL ||
    '';
}

function extractUazapiMimeType(rawMsgObj: any) {
  return rawMsgObj?.mimetype ||
    rawMsgObj?.mimeType ||
    rawMsgObj?.media?.mimetype ||
    rawMsgObj?.media?.mimeType ||
    rawMsgObj?.message?.mimetype ||
    rawMsgObj?.message?.mimeType ||
    rawMsgObj?.data?.mimetype ||
    rawMsgObj?.data?.mimeType ||
    'application/octet-stream';
}

async function fetchMediaAsBase64(mediaUrl: string, instKey: string) {
  if (!mediaUrl) return '';

  try {
    const res = await fetch(mediaUrl, {
      headers: {
        'token': instKey,
        'apikey': instKey,
      },
    });
    if (!res.ok) {
      console.log(`[Webhook] Fetch media URL falhou: ${res.status}`);
      return '';
    }

    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch (err) {
    console.error('[Webhook] Falha ao buscar mídia por URL:', err);
    return '';
  }
}

async function sendUazapiTextMessage(baseUrl: string, instKey: string, instanceName: string, phoneNumber: string, remoteJid: string, text: string) {
  const attempts = [
    {
      label: 'send-text-number',
      url: `${baseUrl}/send/text`,
      headers: { 'Content-Type': 'application/json', 'token': instKey },
      body: { number: phoneNumber, text }
    },
    {
      label: 'send-text-number-instance',
      url: `${baseUrl}/send/text?instance=${instanceName}`,
      headers: { 'Content-Type': 'application/json', 'token': instKey, 'apikey': instKey },
      body: { number: phoneNumber, text }
    },
    {
      label: 'send-text-remotejid',
      url: `${baseUrl}/send/text`,
      headers: { 'Content-Type': 'application/json', 'token': instKey },
      body: { remoteJid, text }
    },
    {
      label: 'send-message-body',
      url: `${baseUrl}/send/text`,
      headers: { 'Content-Type': 'application/json', 'token': instKey },
      body: { number: phoneNumber, body: text }
    }
  ];

  for (const attempt of attempts) {
    try {
      console.log(`[Webhook] Tentando envio UAZAPI via ${attempt.label} para ${phoneNumber}`);
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: attempt.headers as any,
        body: JSON.stringify(attempt.body),
      });
      const responseText = await res.text().catch(() => '');
      console.log(`[Webhook] UAZAPI ${attempt.label} -> ${res.status} | ${responseText.substring(0, 300)}`);
      if (res.ok) {
        return { ok: true, label: attempt.label, status: res.status, body: responseText };
      }
    } catch (err) {
      console.error(`[Webhook] Falha no envio UAZAPI (${attempt.label}):`, err);
    }
  }

  return { ok: false };
}

async function processMessage(supabase: any, instanceName: string, remoteJid: string, userText: string, pushName: string, rawMsgObj: any) {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

  const { data: waInstance } = await supabase.from('wa_instances').select('*').eq('instance_name', instanceName).maybeSingle()
  if (!waInstance) {
    console.log(`[Webhook] Instance not found: ${instanceName}`);
    return new Response('Instance not found', { headers: corsHeaders })
  }

  const { data: agent } = await supabase.from('wa_ai_agents')
    .select('*').eq('user_id', waInstance.user_id).eq('is_active', true).contains('instance_ids', [waInstance.id]).maybeSingle()

  if (!agent) {
    console.log(`[Webhook] No matching active agent for instanceId: ${waInstance.id}`);
    return new Response('No matching active agent', { headers: corsHeaders })
  }
  
  console.log(`[Webhook] Agente encontrado: ${agent.name} (ID: ${agent.id})`);

  // Registrar Lead no CRM
  await supabase.from('ai_crm_leads').upsert({
    user_id: agent.user_id,
    agent_id: agent.id,
    remote_jid: remoteJid,
    lead_name: pushName,
    last_interaction_at: new Date().toISOString()
  }, { onConflict: 'agent_id, remote_jid', ignoreDuplicates: true });

  // Tools
  const tools = [
    {
      type: "function",
      function: {
        name: "atualizar_etapa_crm",
        description: "Atualiza o Kanban/CRM conforme a evolução da conversa. Chame esta função secretamente para categorizar o lead. Valores válidos de status: 'interessado' (quando tem interesse inicial), 'qualificado' (quando pediu para comprar ou quer falar com humano) e 'encerrado' (quando não quer comprar). OBS IMPORTANTE: Ao chamar esta função para status 'interessado' ou 'encerrado', VOCÊ DEVE TAMBÉM gerar uma mensagem normal para o cliente. Só encerre a conversa se for status 'qualificado'.",
        parameters: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["interessado", "qualificado", "encerrado"], description: "A etapa atual do cliente." },
            resumo: { type: "string", description: "O que o cliente deseja e as informações que você coletou dele até o momento. Seja breve." }
          },
          required: ["status", "resumo"]
        }
      }
    }
  ];

  // Helper function to decode base64
  const b64toBlob = (b64Data: string, contentType = '', sliceSize = 512) => {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, {type: contentType});
  }

  const msgType = inferUazapiMessageType(rawMsgObj);
  const messageId = extractUazapiMessageId(rawMsgObj);

  const baseUrl = (waInstance.api_url || Deno.env.get('EVOLUTION_API_URL') || '').replace(/\/$/, '')
  const instKey = waInstance.api_key_encrypted || Deno.env.get('EVOLUTION_API_KEY') || ''
  const phoneNumber = remoteJid.replace(/@.*$/, '').replace(/\D/g, '')
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiApiKey) return new Response('Missing AI Key', { status: 500 })

  let finalUserText = userText;
  let userMessageContentForOpenAi: any = finalUserText;
  let mediaMimeType = extractUazapiMimeType(rawMsgObj);

  console.log(`[Webhook] Tipo inferido: ${msgType || 'desconhecido'} | mimeType: ${mediaMimeType || 'n/a'} | messageId: ${messageId || 'n/a'}`);

  // Process Media se houver
  if (msgType === 'audio' || msgType === 'ptt' || msgType === 'image' || msgType === 'document' || msgType === 'video') {
    let base64 = extractUazapiBase64(rawMsgObj);
    let mediaUrl = extractUazapiMediaUrl(rawMsgObj);
    
    // Se não veio base64, tentar download pela uazapi
    if (!base64 && messageId) {
      console.log(`[Webhook] Baixando mídia ID: ${messageId}`);
      try {
        const dRes = await fetch(`${baseUrl}/message/download?instance=${instanceName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': instKey, 'token': instKey },
          body: JSON.stringify({ id: messageId, return_base64: true })
        });
        if (dRes.ok) {
          const dData = await dRes.json();
          console.log(`[Webhook] Download de midia payload keys: ${Object.keys(dData || {}).join(', ')}`);
          base64 = extractUazapiBase64(dData);
          mediaUrl = mediaUrl || extractUazapiMediaUrl(dData);
          mediaMimeType = extractUazapiMimeType(dData) || mediaMimeType;
          console.log(`[Webhook] Download de midia OK | base64: ${base64 ? 'sim' : 'nao'} | mediaUrl: ${mediaUrl ? 'sim' : 'nao'}`);
        } else {
          console.log(`[Webhook] Download de midia falhou: ${dRes.status}`);
        }
      } catch (err) {
        console.error('[Webhook] Falha no download de mídia:', err);
      }
    }

    if (!base64 && mediaUrl) {
      console.log('[Webhook] Tentando buscar mídia pela URL retornada');
      base64 = await fetchMediaAsBase64(mediaUrl, instKey);
      console.log(`[Webhook] Base64 via URL: ${base64 ? 'sim' : 'nao'}`);
    }

    if (msgType === 'document') {
       // Apenas informar o nome do arquivo para o GPT
       const fileName = rawMsgObj?.fileName || rawMsgObj?.filename || rawMsgObj?.documentMessage?.fileName || 'Arquivo';
       finalUserText = `[Arquivo recebido: ${fileName}] ` + (finalUserText || '');
       userMessageContentForOpenAi = finalUserText;
    } else if (base64) {
      if (msgType === 'audio' || msgType === 'ptt') {
        try {
          const blob = b64toBlob(base64, mediaMimeType || 'audio/ogg');
          const formData = new FormData();
          formData.append('file', blob, `audio.${(mediaMimeType || 'audio/ogg').split('/')[1] || 'ogg'}`);
          formData.append('model', 'whisper-1');
          
          console.log('[Webhook] Enviando para Whisper...');
          const wRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${openaiApiKey}` },
            body: formData
          });
          const wData = await wRes.json();
          if (wData.text) {
             finalUserText = wData.text;
             userMessageContentForOpenAi = finalUserText;
             console.log('[Webhook] Transcrição (Whisper):', finalUserText);
          } else {
             finalUserText = buildUazapiMediaFallbackContent(msgType, finalUserText);
             userMessageContentForOpenAi = finalUserText;
          }
        } catch(err) {
          console.error('[Webhook] Erro no Whisper:', err);
          finalUserText = buildUazapiMediaFallbackContent(msgType, finalUserText);
          userMessageContentForOpenAi = finalUserText;
        }
      } else if (msgType === 'image') {
        finalUserText = finalUserText || '[Imagem recebida]';
        console.log(`[Webhook] Encaminhando imagem para OpenAI Vision | mimeType: ${mediaMimeType}`);
        userMessageContentForOpenAi = [
          { type: "text", text: finalUserText },
          { type: "image_url", image_url: { url: `data:${mediaMimeType || 'image/jpeg'};base64,${base64}` } }
        ];
      } else {
        finalUserText = buildUazapiMediaFallbackContent(msgType, finalUserText);
        userMessageContentForOpenAi = finalUserText;
      }
    } else {
      finalUserText = buildUazapiMediaFallbackContent(msgType, finalUserText);
      userMessageContentForOpenAi = finalUserText;
    }
  }

  if (!finalUserText && typeof userMessageContentForOpenAi === 'string') {
    finalUserText = '[Mensagem recebida sem conteudo legivel]';
    userMessageContentForOpenAi = finalUserText;
    console.log('[Webhook] Empty text after media processing, applying generic fallback');
  }

  console.log(`[Webhook] Salvando histórico e chamando OpenAI para: ${finalUserText}`);

  // Salvar histórico
  await supabase.from('wa_chat_history').insert({
    user_id: agent.user_id,
    agent_id: agent.id,
    instance_id: instanceName,
    remote_jid: remoteJid,
    role: 'user',
    content: typeof userMessageContentForOpenAi === 'string' ? finalUserText : '[Mídia/Imagem]',
    lead_name: pushName
  })

  // Buscar histórico
  const { data: history } = await supabase.from('wa_chat_history')
    .select('role, content').eq('instance_id', instanceName).eq('remote_jid', remoteJid).order('created_at', { ascending: false }).limit(10)

  const chatHistory = (history || []).reverse().map((m: any) => ({ role: m.role, content: m.content }))

  // RAG - Busca Base de Conhecimento
  let knowledgeContext = ''
  try {
    const { data: agentKbs } = await supabase.from('agent_knowledge_bases').select('kb_id').eq('agent_id', agent.id)
    const kbIds = (agentKbs || []).map((k: any) => k.kb_id)

    if (kbIds.length > 0) {
      const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
      if (OPENAI_API_KEY) {
        const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'text-embedding-3-small', input: userText.slice(0, 8000) })
        })
        if (embedRes.ok) {
          const embedData = await embedRes.json()
          const { data: chunks } = await supabase.rpc('search_knowledge', {
            query_embedding: embedData.data[0].embedding, kb_ids: kbIds, match_threshold: 0.60, match_count: 5
          })
          if (chunks && chunks.length > 0) knowledgeContext = chunks.map((c: any) => c.content).join('\n\n---\n\n')
        }
      }
    }
  } catch (err: any) {}

  let systemPrompt = agent.system_prompt || 'Você é um assistente prestativo.'
  if (agent.company_name) systemPrompt += `\n\nEmpresa: ${agent.company_name}`
  if (knowledgeContext) systemPrompt += `\n\n## BASE DE CONHECIMENTO:\n${knowledgeContext}`
  
  // Regra Anti-Alucinação para Arquivos/Mídia
  systemPrompt += `\n\n[REGRAS DE CONDUTA ANTE MÍDIAS E ARQUIVOS]
- Se o usuário enviar uma Imagem (será indicado com "[Imagem recebida]"), análise com precisão fotográfica se conseguir visualizar o anexo no seu array.
- Se o usuário enviar Áudio, a transcrição é entregue como texto direto para você interpretar, lide naturalmente como se tivesse ouvido.
- Se o usuário anexar Documentos/PDFs (indicado com "[Arquivo recebido: <nome>]"), VOCÊ NÃO PODE ABRIR ARQUIVOS e NÃO DEVE INVENTAR DADOS. Responda educadamente sem fugir do personagem: informe que a plataforma limitou sua visão ou que não consegue abrir documentos, sugerindo que o cliente resuma o que há no arquivo ou envie as dúvidas em áudio/texto. Nunca dê respostas genéricas e nunca ofereça "mais informações" se não sabe o conteúdo.`

  let aiModel = agent.model || 'gpt-4o';
  // Fallbacks para evitar crashes na OpenAI caso o frontend envie modelos do Google/Anthropic
  if (aiModel.startsWith('openai/')) {
    aiModel = aiModel.replace('openai/', '');
  } else if (aiModel.includes('google/') || aiModel.includes('anthropic/')) {
    console.log(`[Webhook] Aviso: Modelo externo (${aiModel}) detectado no endpoint OpenAI nativo. Fazendo fallback para gpt-4o-mini para evitar falha.`);
    aiModel = 'gpt-4o-mini';
  }

  const mediaFallbackReply = getUazapiMediaFallbackReply(finalUserText);
  let aiMessage: any = null;
  let aiResponse = mediaFallbackReply || '';

  if (!mediaFallbackReply) {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
      body: JSON.stringify({
        model: aiModel,
        messages: [{ role: 'system', content: systemPrompt }, ...chatHistory, { role: 'user', content: userMessageContentForOpenAi }],
        temperature: agent.temperature || 0.7,
        tools: tools,
        tool_choice: "auto"
      })
    })

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error(`[Webhook] OpenAI Erro: ${openaiRes.status} - ${errText}`);
      return new Response('OpenAI erro', { status: 500 });
    }
    const openaiData = await openaiRes.json()
    aiMessage = openaiData.choices?.[0]?.message
    aiResponse = aiMessage?.content || ''
  }
  
  console.log(`[Webhook] Resposta da IA recebida. ToolCalls: ${aiMessage?.tool_calls?.length || 0}`);

  // Verificar se o modelo decidiu chamar a função de CRM (atualizar_etapa_crm)
  if (!mediaFallbackReply && aiMessage?.tool_calls && aiMessage.tool_calls.length > 0) {
    const toolCall = aiMessage.tool_calls.find((t: any) => t.function.name === 'atualizar_etapa_crm');
    if (toolCall) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        
        // Anti-Duplicate Broadcast Lock (Concorrência webhook)
        const { data: existingLead } = await supabase.from('ai_crm_leads')
          .select('status, assigned_to_member_id')
          .eq('agent_id', agent.id)
          .eq('remote_jid', remoteJid)
          .maybeSingle();

        const alreadyTransferred = existingLead && (existingLead.status === 'transferido' || existingLead.status === 'qualificado' || existingLead.assigned_to_member_id);

        // 1. Atualizar banco de dados CRM (arrastar cartão para a coluna correta)
        await supabase.from('ai_crm_leads').upsert({
          user_id: agent.user_id,
          agent_id: agent.id,
          remote_jid: remoteJid,
          status: args.status,
          summary: args.resumo,
          last_interaction_at: new Date().toISOString(),
          lead_name: pushName
        }, { onConflict: 'agent_id, remote_jid' });

        console.log(`[CRM] Lead ${phoneNumber} analisado. Status: ${args.status}`);

        // 2. Alertar vendedor via Round-Robin SE status for 'qualificado'
        if (args.status === 'qualificado' && !alreadyTransferred) {
          const { data: sellers } = await supabase.from('ai_team_members').select('*').eq('agent_id', agent.id).eq('is_active', true).order('last_lead_received_at', { ascending: true, nullsFirst: true });
          if (sellers && sellers.length > 0) {
            // Round-robin: pick seller with oldest last_lead_received_at
            const selectedSeller = sellers[0];
            let sellerNum = selectedSeller.whatsapp_number.replace(/\D/g, '');
            if (sellerNum.length === 10 || sellerNum.length === 11) sellerNum = `55${sellerNum}`;
            
            const sellerMsg = `🚨 *LEAD QUALIFICADO - ATENDIMENTO IMEDIATO*\n\n👤 *Nome do Cliente:* ${pushName}\n📱 *Contato:* ${phoneNumber}\n🤖 *Agente IA:* ${agent.name}\n\n━━━━━━━━━━━━━━━━━━━━\n\n📝 *Resumo do Atendimento pela IA:*\n${args.resumo}\n\n━━━━━━━━━━━━━━━━━━━━\n\n👉 *Atender agora:* https://wa.me/${phoneNumber}\n\n⚡ O cliente está esperando!`;
            const sellerRes = await fetch(`${baseUrl}/send/text`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': instKey },
              body: JSON.stringify({ number: sellerNum, text: sellerMsg })
            });
            if (!sellerRes.ok) {
               console.error(`[CRM] Fail send to seller: ${sellerRes.status} - ${await sellerRes.text()}`);
            }

            // Update seller stats
            await supabase.from('ai_team_members').update({
              last_lead_received_at: new Date().toISOString(),
              total_leads_received: (selectedSeller.total_leads_received || 0) + 1,
            }).eq('id', selectedSeller.id);

            // Record transfer
            const { data: leadData } = await supabase.from('ai_crm_leads').select('id').eq('agent_id', agent.id).eq('remote_jid', remoteJid).maybeSingle();
            if (leadData) {
              await supabase.from('ai_lead_transfers').insert({
                user_id: agent.user_id, lead_id: leadData.id, from_agent_id: agent.id,
                to_member_id: selectedSeller.id, transfer_reason: args.resumo,
                notes: `Transferido para ${selectedSeller.name} via round-robin`,
              });
              await supabase.from('ai_crm_leads').update({
                status: 'transferido', assigned_to_member_id: selectedSeller.id,
                transferred_at: new Date().toISOString(), transfer_reason: `Encaminhado para ${selectedSeller.name}`,
              }).eq('id', leadData.id);
            }

            console.log(`[CRM] Lead ${phoneNumber} transferred to seller: ${selectedSeller.name}`);
          }
        }
        
        if (!aiResponse) {
          // Se o GPT não retornou texto (só o tool_call), devemos devolver o resultado da tool e pedir o texto!
          console.log(`[Webhook] IA apenas executou a tool sem texto. Solicitando resposta final...`);
          const secondRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
            body: JSON.stringify({
              model: aiModel,
              messages: [
                { role: 'system', content: systemPrompt }, 
                ...chatHistory, 
                { role: 'user', content: userMessageContentForOpenAi },
                aiMessage,
                { role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: `{"success": true}` }
              ],
              temperature: agent.temperature || 0.7
            })
          });
          if (secondRes.ok) {
            const secondData = await secondRes.json();
            aiResponse = secondData.choices?.[0]?.message?.content || '';
            console.log(`[Webhook] Resposta final capturada: ${aiResponse}`);
          }
        }
      } catch (err) {
        console.error("[Webhook] Erro no Handoff/CRM", err)
      }
    }
  }

  if (!aiResponse) return new Response('No AI Response', { headers: corsHeaders })

  console.log(`[Webhook] Resposta final ao cliente: ${aiResponse.substring(0, 200)}`);

  // Salvar no histórico
  await supabase.from('wa_chat_history').insert({
    user_id: agent.user_id, agent_id: agent.id, instance_id: instanceName,
    remote_jid: remoteJid, role: 'assistant', content: aiResponse
  })

  // Enviar para o cliente final
  try {
    const sendResult = await sendUazapiTextMessage(baseUrl, instKey, instanceName, phoneNumber, remoteJid, aiResponse)
    if (!sendResult.ok) {
      console.error('[Webhook] Nenhuma tentativa de envio UAZAPI funcionou');
    }
  } catch (e) {
    console.error('[Webhook] Erro ao enviar mensagem:', e)
  }

  return new Response(JSON.stringify({ success: true }), { headers: corsHeaders, status: 200 })
}
