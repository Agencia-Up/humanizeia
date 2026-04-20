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
    console.error("[Webhook] Erro CrÃ­tico:", error)
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

function parseStoredIntegrationCredentials(raw: string | null) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return { api_token: raw };
  }
}

function normalizeBndvText(value?: string | null) {
  return String(value || '').toLowerCase().trim();
}

function bndvIncludes(haystack?: string | null, needle?: string | null) {
  if (!needle || !String(needle).trim()) return true;
  return normalizeBndvText(haystack).includes(normalizeBndvText(needle));
}

function bndvMatchesQuery(vehicle: any, query?: string | null) {
  if (!query || !String(query).trim()) return true;
  const indexed = [
    vehicle?.markName,
    vehicle?.modelName,
    vehicle?.versionName,
    vehicle?.color,
    vehicle?.fuelName,
    vehicle?.transmissionName,
    vehicle?.year?.toString?.(),
  ].filter(Boolean).join(' ').toLowerCase();
  return indexed.includes(normalizeBndvText(query));
}

async function consultarEstoqueBndv(supabase: any, userId: string, filters: any) {
  const BNDV_API_URL = 'https://api-estoque.azurewebsites.net/graphql';

  const { data: integration, error: integrationError } = await supabase
    .from('platform_integrations')
    .select('api_key_encrypted, is_active')
    .eq('user_id', userId)
    .eq('platform', 'bndv')
    .maybeSingle();

  if (integrationError) {
    throw integrationError;
  }

  if (!integration?.is_active) {
    return { success: false, error: 'A integraÃ§Ã£o BNDV nÃ£o estÃ¡ conectada para este cliente.' };
  }

  const credentials = parseStoredIntegrationCredentials(integration.api_key_encrypted);
  const token = String(credentials?.api_token || '').trim();

  if (!token) {
    return { success: false, error: 'O token do BNDV nÃ£o foi encontrado na integraÃ§Ã£o salva.' };
  }

  const response = await fetch(BNDV_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: `
        query BndvVehicles {
          vehiclesBy {
            modelName
            markName
            year
            km
            saleValue
            color
            fuelName
            transmissionName
            versionName
          }
        }
      `,
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      success: false,
      error: payload?.errors?.[0]?.message || payload?.message || `BNDV retornou status ${response.status}.`,
    };
  }

  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    return { success: false, error: payload.errors[0]?.message || 'A API do BNDV retornou um erro.' };
  }

  const {
    query,
    marca,
    modelo,
    versao,
    combustivel,
    cambio,
    cor,
    ano_min,
    ano_max,
    preco_max,
    km_max,
    limite,
  } = filters || {};

  const items = Array.isArray(payload?.data?.vehiclesBy) ? payload.data.vehiclesBy : [];
  const filtered = items
    .filter((vehicle: any) => {
      const year = Number(vehicle?.year || 0);
      const price = Number(vehicle?.saleValue || 0);
      const mileage = Number(vehicle?.km || 0);

      return (
        bndvMatchesQuery(vehicle, query) &&
        bndvIncludes(vehicle?.markName, marca) &&
        bndvIncludes(vehicle?.modelName, modelo) &&
        bndvIncludes(vehicle?.versionName, versao) &&
        bndvIncludes(vehicle?.fuelName, combustivel) &&
        bndvIncludes(vehicle?.transmissionName, cambio) &&
        bndvIncludes(vehicle?.color, cor) &&
        (!ano_min || year >= Number(ano_min)) &&
        (!ano_max || year <= Number(ano_max)) &&
        (!preco_max || price <= Number(preco_max)) &&
        (!km_max || mileage <= Number(km_max))
      );
    })
    .sort((left: any, right: any) => {
      const leftPrice = Number(left?.saleValue || 0);
      const rightPrice = Number(right?.saleValue || 0);
      if (leftPrice !== rightPrice) return leftPrice - rightPrice;
      return Number(right?.year || 0) - Number(left?.year || 0);
    });

  const capped = filtered.slice(0, Number(limite || 8)).map((vehicle: any) => ({
    marca: vehicle?.markName || null,
    modelo: vehicle?.modelName || null,
    versao: vehicle?.versionName || null,
    ano: vehicle?.year || null,
    km: vehicle?.km || null,
    preco: vehicle?.saleValue || null,
    cor: vehicle?.color || null,
    combustivel: vehicle?.fuelName || null,
    cambio: vehicle?.transmissionName || null,
    label: [vehicle?.markName, vehicle?.modelName, vehicle?.versionName].filter(Boolean).join(' '),
  }));

  return {
    success: true,
    total: filtered.length,
    items: capped,
  };
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
    console.error('[Webhook] Falha ao buscar mÃ­dia por URL:', err);
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
        description: "Atualiza o Kanban/CRM conforme a evoluÃ§Ã£o da conversa. Chame esta funÃ§Ã£o secretamente para categorizar o lead. Valores vÃ¡lidos de status: 'interessado' (quando tem interesse inicial), 'qualificado' (quando pediu para comprar ou quer falar com humano) e 'encerrado' (quando nÃ£o quer comprar). OBS IMPORTANTE: Ao chamar esta funÃ§Ã£o para status 'interessado' ou 'encerrado', VOCÃŠ DEVE TAMBÃ‰M gerar uma mensagem normal para o cliente. SÃ³ encerre a conversa se for status 'qualificado'.",
        parameters: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["interessado", "qualificado", "encerrado"], description: "A etapa atual do cliente." },
            resumo: { type: "string", description: "O que o cliente deseja e as informaÃ§Ãµes que vocÃª coletou dele atÃ© o momento. Seja breve." }
          },
          required: ["status", "resumo"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "consultar_estoque_bndv",
        description: "Consulta o estoque real de veÃ­culos do cliente integrado ao BNDV. Use quando o cliente perguntar por carro disponÃ­vel, preÃ§o, ano, versÃ£o, cÃ¢mbio, combustÃ­vel, cor ou faixa de valor. Nunca invente estoque sem usar esta ferramenta.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Busca livre do cliente, como 'nivus automÃ¡tico atÃ© 110 mil'." },
            marca: { type: "string", description: "Marca do veÃ­culo, ex: Chevrolet, Jeep, Hyundai." },
            modelo: { type: "string", description: "Modelo do veÃ­culo, ex: Onix, Renegade, Creta." },
            versao: { type: "string", description: "VersÃ£o ou detalhe do veÃ­culo, ex: LTZ, EX, Touring." },
            combustivel: { type: "string", description: "CombustÃ­vel desejado, ex: Flex, Diesel." },
            cambio: { type: "string", description: "Tipo de cÃ¢mbio, ex: AutomÃ¡tico, Manual." },
            cor: { type: "string", description: "Cor desejada, se o cliente pedir." },
            ano_min: { type: "number", description: "Ano mÃ­nimo desejado." },
            ano_max: { type: "number", description: "Ano mÃ¡ximo desejado." },
            preco_max: { type: "number", description: "PreÃ§o mÃ¡ximo desejado pelo cliente." },
            km_max: { type: "number", description: "Quilometragem mÃ¡xima desejada pelo cliente." },
            limite: { type: "number", description: "Quantidade mÃ¡xima de veÃ­culos para retornar." }
          },
          additionalProperties: false
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
    
    // Se nÃ£o veio base64, tentar download pela uazapi
    if (!base64 && messageId) {
      console.log(`[Webhook] Baixando mÃ­dia ID: ${messageId}`);
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
        console.error('[Webhook] Falha no download de mÃ­dia:', err);
      }
    }

    if (!base64 && mediaUrl) {
      console.log('[Webhook] Tentando buscar mÃ­dia pela URL retornada');
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
             console.log('[Webhook] TranscriÃ§Ã£o (Whisper):', finalUserText);
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

  console.log(`[Webhook] Salvando histÃ³rico e chamando OpenAI para: ${finalUserText}`);

  // Salvar histÃ³rico
  await supabase.from('wa_chat_history').insert({
    user_id: agent.user_id,
    agent_id: agent.id,
    instance_id: instanceName,
    remote_jid: remoteJid,
    role: 'user',
    content: typeof userMessageContentForOpenAi === 'string' ? finalUserText : '[MÃ­dia/Imagem]',
    lead_name: pushName
  })

  // Buscar histÃ³rico
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

  let systemPrompt = agent.system_prompt || 'VocÃª Ã© um assistente prestativo.'
  if (agent.company_name) systemPrompt += `\n\nEmpresa: ${agent.company_name}`
  if (knowledgeContext) systemPrompt += `\n\n## BASE DE CONHECIMENTO:\n${knowledgeContext}`
  
  // Regra Anti-AlucinaÃ§Ã£o para Arquivos/MÃ­dia
  systemPrompt += `\n\n[REGRAS DE CONDUTA ANTE MÃDIAS E ARQUIVOS]
- Se o usuÃ¡rio enviar uma Imagem (serÃ¡ indicado com "[Imagem recebida]"), anÃ¡lise com precisÃ£o fotogrÃ¡fica se conseguir visualizar o anexo no seu array.
- Se o usuÃ¡rio enviar Ãudio, a transcriÃ§Ã£o Ã© entregue como texto direto para vocÃª interpretar, lide naturalmente como se tivesse ouvido.
- Se o usuÃ¡rio anexar Documentos/PDFs (indicado com "[Arquivo recebido: <nome>]"), VOCÃŠ NÃƒO PODE ABRIR ARQUIVOS e NÃƒO DEVE INVENTAR DADOS. Responda educadamente sem fugir do personagem: informe que a plataforma limitou sua visÃ£o ou que nÃ£o consegue abrir documentos, sugerindo que o cliente resuma o que hÃ¡ no arquivo ou envie as dÃºvidas em Ã¡udio/texto. Nunca dÃª respostas genÃ©ricas e nunca ofereÃ§a "mais informaÃ§Ãµes" se nÃ£o sabe o conteÃºdo.`
  systemPrompt += `\n\n[CONSULTA DE ESTOQUE BNDV]
- Quando o cliente pedir preÃ§o, disponibilidade, ano, versÃ£o, cÃ¢mbio, combustÃ­vel, quilometragem ou quiser saber se existe algum veÃ­culo no estoque, use a ferramenta "consultar_estoque_bndv".
- Nunca invente veÃ­culos, preÃ§os ou disponibilidade sem consultar a ferramenta.
- Depois de consultar, responda como vendedor consultivo: direto, claro e comercial.
- Se a ferramenta nÃ£o retornar resultados, diga isso de forma transparente e ofereÃ§a alternativas prÃ³ximas.`

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
  if (!mediaFallbackReply && aiMessage?.tool_calls && aiMessage.tool_calls.length > 0) {
    const toolMessages: any[] = [];

    for (const toolCall of aiMessage.tool_calls) {
      try {
        if (toolCall.function.name === 'atualizar_etapa_crm') {
          const args = JSON.parse(toolCall.function.arguments);

          const { data: existingLead } = await supabase.from('ai_crm_leads')
            .select('status, assigned_to_member_id')
            .eq('agent_id', agent.id)
            .eq('remote_jid', remoteJid)
            .maybeSingle();

          const alreadyTransferred = existingLead && (existingLead.status === 'transferido' || existingLead.status === 'qualificado' || existingLead.assigned_to_member_id);

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

          if (args.status === 'qualificado' && !alreadyTransferred) {
            const { data: sellers } = await supabase.from('ai_team_members').select('*').eq('agent_id', agent.id).eq('is_active', true).order('last_lead_received_at', { ascending: true, nullsFirst: true });
            if (sellers && sellers.length > 0) {
              const selectedSeller = sellers[0];
              let sellerNum = selectedSeller.whatsapp_number.replace(/\D/g, '');
              if (sellerNum.length === 10 || sellerNum.length === 11) sellerNum = `55${sellerNum}`;

              const sellerMsg = `ðŸš¨ *LEAD QUALIFICADO - ATENDIMENTO IMEDIATO*\n\nðŸ‘¤ *Nome do Cliente:* ${pushName}\nðŸ“± *Contato:* ${phoneNumber}\nðŸ¤– *Agente IA:* ${agent.name}\n\nâ”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n\nðŸ“ *Resumo do Atendimento pela IA:*\n${args.resumo}\n\nâ”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n\nðŸ‘‰ *Atender agora:* https://wa.me/${phoneNumber}\n\nâš¡ O cliente estÃ¡ esperando!`;
              const sellerRes = await fetch(`${baseUrl}/send/text`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'token': instKey },
                body: JSON.stringify({ number: sellerNum, text: sellerMsg })
              });
              if (!sellerRes.ok) {
                 console.error(`[CRM] Fail send to seller: ${sellerRes.status} - ${await sellerRes.text()}`);
              }

              await supabase.from('ai_team_members').update({
                last_lead_received_at: new Date().toISOString(),
                total_leads_received: (selectedSeller.total_leads_received || 0) + 1,
              }).eq('id', selectedSeller.id);

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

          toolMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: JSON.stringify({ success: true, status: args.status })
          });
        }

        if (toolCall.function.name === 'consultar_estoque_bndv') {
          const args = JSON.parse(toolCall.function.arguments || '{}');
          const stockResult = await consultarEstoqueBndv(supabase, agent.user_id, args);
          console.log(`[BNDV] Consulta executada | success: ${stockResult.success} | total: ${stockResult.total || 0}`);
          toolMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: JSON.stringify(stockResult)
          });
        }
      } catch (err) {
        console.error(`[Webhook] Erro ao processar tool ${toolCall.function?.name}:`, err);
        toolMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function?.name || 'tool_error',
          content: JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Erro inesperado na ferramenta.' })
        });
      }
    }

    if (toolMessages.length > 0) {
      console.log(`[Webhook] Tool(s) executadas (${toolMessages.length}). Solicitando resposta final...`);
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
            ...toolMessages
          ],
          temperature: agent.temperature || 0.7
        })
      });
      if (secondRes.ok) {
        const secondData = await secondRes.json();
        aiResponse = secondData.choices?.[0]?.message?.content || aiResponse || '';
        console.log(`[Webhook] Resposta final capturada: ${aiResponse}`);
      } else {
        console.error(`[Webhook] Falha no follow-up das tools: ${secondRes.status} - ${await secondRes.text()}`);
      }
    }
  }

  if (!aiResponse) return new Response('No AI Response', { headers: corsHeaders })

  console.log(`[Webhook] Resposta final ao cliente: ${aiResponse.substring(0, 200)}`);

  // Salvar no histÃ³rico
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
