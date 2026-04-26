import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Banco LEGADO (onde os agentes/instancias estao configurados)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Banco NOVO (onde o CRM frontend le os leads) - Agora instanciado dentro de processMessage

    const payload = await req.json()
    console.log("[Webhook] Payload COMPLETO:", JSON.stringify(payload))

    const isUazapi = !!(payload.BaseUrl || payload.EventType || payload.instanceId)
    const isEvolution = !!(payload.event || payload.data)
    console.log('[Webhook] isUazapi:', isUazapi, 'isEvolution:', isEvolution);
    
    // --- FORMATO UAZAPI ---
    if (isUazapi) {
      const eventType = String(payload.EventType || payload.eventType || '').toLowerCase()
      console.log('[Webhook] eventType (Uazapi):', eventType);

      if (eventType === 'connection' || eventType === 'status' || eventType.includes('connect')) {
        console.log('[Webhook] Ignorando evento de conexao (retornando silenciosamente)');
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
        console.log('[Webhook] Ignorando evento Uazapi que nao e messages:', eventType);
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
      }

      const instanceName = payload.instance || payload.instanceName || payload.InstanceId || payload.instanceId || ''
      const chat = payload.chat || {}
      
      let msgObj = null
      if (Array.isArray(payload.messages) && payload.messages.length > 0) {
        msgObj = payload.messages[0]
      } else if (payload.message) {
        msgObj = payload.message
      } else if (payload.data && payload.data.message) {
        msgObj = payload.data.message
      } else if (payload.chat && payload.chat.messages) {
        msgObj = Array.isArray(payload.chat.messages) ? payload.chat.messages[0] : payload.chat.messages
      } else if (payload.data && Array.isArray(payload.data) && payload.data.length > 0) {
        msgObj = payload.data[0]
      }
      
      console.log('[Webhook] Extraiu msgObj?', !!msgObj);
      if (!msgObj) {
        console.log('[Webhook] Estrutura completa para inspecao:', JSON.stringify(payload).substring(0, 500));
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }
      
      if (msgObj.fromMe === true) {
         console.log('[Webhook] Ignored fromMe');
         return new Response('Ignored fromMe', { headers: corsHeaders });
      }
      
      const remoteJid = msgObj.chatId || msgObj.chatid || msgObj.from || chat.id || chat.chatId || '';
      console.log('[Webhook] remoteJid extraido:', remoteJid);
      
      if (!remoteJid) {
         console.log('[Webhook] No remoteJid, ignorando.');
         return new Response('No remoteJid', { headers: corsHeaders });
      }
      
      if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast')) {
         console.log('[Webhook] Ignored group/broadcast', remoteJid);
         return new Response('Ignored group/broadcast', { headers: corsHeaders });
      }

      const userText = (msgObj.body || msgObj.text || msgObj.caption || '').trim();
      const pushName = msgObj.senderName || chat.name || msgObj.notifyName || msgObj.pushName || 'Lead';
      
      console.log(`[Webhook] Mensagem final a repassar -> Instance: ${instanceName}, From: ${remoteJid}, Text: ${userText}`);
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

    let userText = message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || message.videoMessage?.caption || message.text || data.text || ''
    
    const contextInfo = message?.extendedTextMessage?.contextInfo || message?.imageMessage?.contextInfo || message?.videoMessage?.contextInfo || data?.contextInfo;
    const adReply = contextInfo?.externalAdReply || contextInfo?.quotedMessage?.extendedTextMessage?.contextInfo?.externalAdReply;
    
    if (adReply) {
      const adTitle = adReply.title || '';
      const adBody = adReply.body || '';
      if (adTitle || adBody) {
        userText = `[O lead veio de um Anúncio do Facebook/Instagram sobre: "${adTitle} ${adBody}"]\n\n${userText}`;
      }
    } else if (message?.extendedTextMessage?.title || message?.extendedTextMessage?.description) {
      const linkTitle = message.extendedTextMessage.title || '';
      const linkDesc = message.extendedTextMessage.description || '';
      userText = `[O lead enviou um link sobre: "${linkTitle} - ${linkDesc}"] (NOTA PARA IA: As informacoes do link ja foram extraidas, atenda o cliente com base nisso e nao diga que nao consegue abrir o link)\n\n${userText}`;
    }
    
    return await processMessage(supabase, instance, key.remoteJid, userText.trim(), pushName || 'Lead', data)

  } catch (error: any) {
    console.error("[Webhook] Erro critico:", error)
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
  // Remove acentos para que "automatico" == "Automático", "manual" == "Manual", etc.
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function bndvIncludes(haystack?: string | null, needle?: string | null) {
  if (!needle || !String(needle).trim()) return true;
  return normalizeBndvText(haystack).includes(normalizeBndvText(needle));
}

function bndvMatchesQuery(vehicle: any, query?: string | null) {
  if (!query || !String(query).trim()) return true;
  
  const rawIndexed = [
    vehicle?.markName,
    vehicle?.modelName,
    vehicle?.versionName,
    vehicle?.color,
    vehicle?.fuelName,
    vehicle?.transmissionName,
    vehicle?.year?.toString?.(),
  ].filter(Boolean).join(' ');

  const indexed = normalizeBndvText(rawIndexed).replace(/-/g, ' ');
  const normalizedQuery = normalizeBndvText(query).replace(/-/g, ' ');
  
  const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 0);
  
  return queryWords.every(word => indexed.includes(word));
}

function parseBndvPictures(rawPictureJs: any) {
  if (!rawPictureJs) return [];

  let parsed: any = rawPictureJs;
  if (typeof rawPictureJs === 'string') {
    try {
      parsed = JSON.parse(rawPictureJs);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item: any) => ({
      url: String(item?.Link || item?.link || '').trim(),
      principal: String(item?.Principal || item?.principal || '').toLowerCase() === 'true',
    }))
    .filter((item: any) => !!item.url)
    .sort((left: any, right: any) => Number(right.principal) - Number(left.principal));
}

function buildBndvVehicleLabel(vehicle: any) {
  return [vehicle?.markName, vehicle?.modelName, vehicle?.versionName].filter(Boolean).join(' ');
}

function inferImageMimeType(imageUrl: string) {
  const normalized = String(imageUrl || '').toLowerCase();
  if (normalized.includes('.png')) return 'image/png';
  if (normalized.includes('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function buildImageFileName(imageUrl: string, vehicleLabel?: string) {
  const mimeType = inferImageMimeType(imageUrl);
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const baseName = String(vehicleLabel || 'veiculo')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'veiculo';
  return `${baseName}.${extension}`;
}

async function fetchBndvVehicles(supabase: any, userId: string, filters: any) {
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
    return { success: false, error: 'A integracao BNDV nao esta conectada para este cliente.' };
  }

  const credentials = parseStoredIntegrationCredentials(integration.api_key_encrypted);
  const token = String(credentials?.api_token || '').trim();

  if (!token) {
    return { success: false, error: 'O token do BNDV nao foi encontrado na integracao salva.' };
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
            pictureJs
          }
        }
      `,
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return { success: false, error: payload?.errors?.[0]?.message || payload?.message || `BNDV retornou status ${response.status}.` };
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

  return {
    success: true,
    total: filtered.length,
    items: filtered,
  };
}

async function consultarEstoqueBndv(supabase: any, userId: string, filters: any) {
  const result = await fetchBndvVehicles(supabase, userId, filters);
  if (!result.success) return result;

  const limite = filters?.limite;
  const capped = (result.items || []).slice(0, Number(limite || 8)).map((vehicle: any) => {
    const pictures = parseBndvPictures(vehicle?.pictureJs);
    const principalImage = pictures.find((item: any) => item.principal)?.url || pictures[0]?.url || null;

    return {
    marca: vehicle?.markName || null,
    modelo: vehicle?.modelName || null,
    versao: vehicle?.versionName || null,
    ano: vehicle?.year || null,
    km: vehicle?.km || null,
    preco: vehicle?.saleValue || null,
    cor: vehicle?.color || null,
    combustivel: vehicle?.fuelName || null,
    cambio: vehicle?.transmissionName || null,
      label: buildBndvVehicleLabel(vehicle),
      images_count: pictures.length,
    };
  });

  return {
    success: true,
    total: result.total,
    items: capped,
  };
}

async function sendUazapiImageMessage(baseUrl: string, instKey: string, instanceName: string, phoneNumber: string, remoteJid: string, imageUrl: string, caption?: string, vehicleLabel?: string) {
  const attempts = [
    { label: 'send-media-number', url: `${baseUrl}/send/media`, body: { number: phoneNumber, file: imageUrl, type: 'image', text: caption || '' } },
    { label: 'message-sendMedia', url: `${baseUrl}/message/sendMedia`, body: { number: phoneNumber, mediaMessage: { mediatype: 'image', media: imageUrl, caption: caption || '' }, options: { delay: 200 } } },
    { label: 'message-sendMedia-instance', url: `${baseUrl}/message/sendMedia/${instanceName}`, body: { number: phoneNumber, mediaMessage: { mediatype: 'image', media: imageUrl, caption: caption || '' }, options: { delay: 200 } } }
  ];

  for (const attempt of attempts) {
    try {
      console.log(`[Webhook] Tentando envio de imagem via ${attempt.label}`);
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': instKey, 'apikey': instKey },
        body: JSON.stringify(attempt.body)
      });
      const txt = await res.text().catch(() => '');
      console.log(`[Webhook] UAZAPI ${attempt.label} -> ${res.status} | ${txt.substring(0, 150)}`);
      if (res.ok) return { ok: true, label: attempt.label, status: res.status };
    } catch (err) {
      console.error(`[Webhook] Erro envio de imagem ${attempt.label}:`, err);
    }
  }

  return { ok: false };
}

async function sendUazapiCarouselMessage(baseUrl: string, instKey: string, phoneNumber: string, vehicleLabel: string, pictures: Array<{ url: string }>) {
  const carouselItems = pictures.slice(0, 5).map((picture, index) => ({
    text: `${vehicleLabel}\nFoto ${index + 1}`,
    image: picture.url,
    buttons: [
      {
        id: `mais_detalhes_${index + 1}`,
        text: 'Quero saber mais',
        type: 'REPLY'
      }
    ]
  }));

  try {
    console.log('[Webhook] Tentando envio de fotos UAZAPI via send-carousel');
    const res = await fetch(`${baseUrl}/send/carousel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'token': instKey, 'apikey': instKey },
      body: JSON.stringify({
        number: phoneNumber,
        text: `Separei as fotos do ${vehicleLabel} para voce.`,
        carousel: carouselItems,
        readchat: true,
        delay: 0
      }),
    });
    const responseText = await res.text().catch(() => '');
    console.log(`[Webhook] UAZAPI send-carousel -> ${res.status} | ${responseText.substring(0, 300)}`);
    if (res.ok) {
      return { ok: true, status: res.status, body: responseText };
    }
  } catch (err) {
    console.error('[Webhook] Falha no envio de carrossel UAZAPI:', err);
  }

  return { ok: false };
}

function buildBndvPhotoLinksMessage(vehicleLabel: string, vehicle: any, pictures: Array<{ url: string }>) {
  const intro = `Separei aqui as fotos do ${vehicleLabel}.`;
  const details = [
    vehicle?.year ? `Ano: ${vehicle.year}` : '',
    vehicle?.saleValue ? `Preco: R$ ${Number(vehicle.saleValue).toLocaleString('pt-BR')}` : '',
  ].filter(Boolean).join(' | ');
  const urls = pictures.slice(0, 5).map((picture, index) => `Foto ${index + 1}: ${picture.url}`).join('\n');

  return [intro, details, urls].filter(Boolean).join('\n\n');
}

async function enviarFotosBndv(supabase: any, userId: string, filters: any, delivery: any) {
  const result = await fetchBndvVehicles(supabase, userId, filters);
  if (!result.success) return result;

  const vehicleWithPhotos = (result.items || []).find((item: any) => parseBndvPictures(item?.pictureJs).length > 0);
  const vehicleExists = (result.items || []).length > 0;
  
  if (!vehicleWithPhotos) {
    if (vehicleExists) {
      // Carro existe no estoque mas nao tem fotos cadastradas no portal BNDV
      const existingVehicle = result.items[0];
      const label = buildBndvVehicleLabel(existingVehicle);
      return {
        success: false,
        error: `O veiculo ${label} (${existingVehicle?.year}) esta disponivel no nosso estoque, mas ainda nao possui fotos cadastradas no sistema. Informe ao cliente que voce pode agendar uma visita presencial para ele conhecer o veiculo, ou que pode enviar fotos por outro canal. Nao diga que nao temos o veiculo - temos, mas sem fotos no sistema.`,
        vehicle_exists: true,
        vehicle_label: label,
        vehicle_year: existingVehicle?.year
      };
    }
    return {
      success: false,
      error: 'Nao encontrei esse veiculo no estoque atual.',
      vehicle_exists: false
    };
  }
  
  const vehicle = vehicleWithPhotos;

  const pictures = parseBndvPictures(vehicle.pictureJs);
  const requestedCount = Math.max(1, Math.min(Number(filters?.quantidade_fotos || 3), 5));
  const selectedPictures = pictures.slice(0, requestedCount);

  if (selectedPictures.length === 0) {
    return {
      success: false,
      error: 'Esse veiculo nao possui fotos disponiveis para envio agora.',
    };
  }

  let sentCount = 0;
  const vehicleLabel = buildBndvVehicleLabel(vehicle);
  for (let index = 0; index < selectedPictures.length; index++) {
    const picture = selectedPictures[index];
    const caption = index === 0
      ? `${vehicleLabel}${vehicle?.year ? ` | ${vehicle.year}` : ''}${vehicle?.saleValue ? ` | R$ ${Number(vehicle.saleValue).toLocaleString('pt-BR')}` : ''}`
      : '';
    const sendResult = await sendUazapiImageMessage(
      delivery.baseUrl,
      delivery.instKey,
      delivery.instanceName,
      delivery.phoneNumber,
      delivery.remoteJid,
      picture.url,
      caption,
      vehicleLabel
    );

    if (!sendResult.ok) {
      const carouselResult = await sendUazapiCarouselMessage(
        delivery.baseUrl,
        delivery.instKey,
        delivery.phoneNumber,
        vehicleLabel,
        selectedPictures
      );

      if (carouselResult.ok) {
        return {
          success: true,
          sent: selectedPictures.length,
          vehicle: vehicleLabel,
          year: vehicle?.year || null,
          price: vehicle?.saleValue || null,
          mode: 'carousel'
        };
      }



      return {
        success: false,
        error: 'Encontrei as fotos, mas nao consegui envia-las no WhatsApp pela Uazapi.',
        vehicle: vehicleLabel,
        attempted: selectedPictures.length,
        sent: sentCount,
      };
    }

    sentCount += 1;
  }

  return {
    success: true,
    sent: sentCount,
    vehicle: vehicleLabel,
    year: vehicle?.year || null,
    price: vehicle?.saleValue || null,
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
    const isExternal = !mediaUrl.includes('uazapi') && !mediaUrl.includes('evolution');
    const headers = isExternal ? {} : { 'token': instKey, 'apikey': instKey };
    const res = await fetch(mediaUrl, { headers });
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
    console.error('[Webhook] Falha ao buscar midia por URL:', err);
    return '';
  }
}

async function fetchMediaBlob(mediaUrl: string, instKey: string, mimeType?: string) {
  if (!mediaUrl) return null;

  try {
    const isExternal = !mediaUrl.includes('uazapi') && !mediaUrl.includes('evolution');
    const headers = isExternal ? {} : { 'token': instKey, 'apikey': instKey };
    const res = await fetch(mediaUrl, { headers });
    if (!res.ok) {
      console.log(`[Webhook] Fetch media blob falhou: ${res.status}`);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    return new Blob([arrayBuffer], { type: mimeType || res.headers.get('content-type') || 'application/octet-stream' });
  } catch (err) {
    console.error('[Webhook] Falha ao buscar blob da midia:', err);
    return null;
  }
}

async function sendUazapiTextMessage(baseUrl: string, instKey: string, instanceName: string, phoneNumber: string, remoteJid: string, text: string) {
  const attempts = [
    { label: 'send-text-number', url: `${baseUrl}/send/text`, body: { number: phoneNumber, text } },
    { label: 'send-text-remotejid', url: `${baseUrl}/send/text`, body: { remoteJid, text } },
    { label: 'message-sendText', url: `${baseUrl}/message/sendText/${instanceName}`, body: { number: phoneNumber, text } }
  ];

  for (const attempt of attempts) {
    try {
      console.log(`[Webhook] Tentando envio UAZAPI via ${attempt.label} para ${phoneNumber}`);
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': instKey, 'apikey': instKey },
        body: JSON.stringify(attempt.body),
      });
      const responseText = await res.text().catch(() => '');
      console.log(`[Webhook] UAZAPI ${attempt.label} -> ${res.status} | ${responseText.substring(0, 300)}`);
      if (res.ok) return { ok: true, label: attempt.label, status: res.status, body: responseText };
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

  // Banco NOVO (onde o CRM frontend le os leads)
  const newSupabaseUrl = Deno.env.get('NEW_SUPABASE_URL');
  const newSupabaseKey = Deno.env.get('NEW_SUPABASE_SERVICE_KEY');
  const supabaseNew = newSupabaseUrl && newSupabaseKey
    ? createClient(newSupabaseUrl, newSupabaseKey)
    : null;

  const { data: agents } = await supabase.from('wa_ai_agents')
    .select('*').eq('user_id', waInstance.user_id).eq('is_active', true)

  const agent = agents?.find((a: any) => {
    const ids = a.instance_ids || [];
    return Array.isArray(ids) && ids.length > 0 && ids.includes(waInstance.id);
  }) || agents?.find((a: any) => a.instance_id === waInstance.id)
     || agents?.find((a: any) => {
    const ids = a.instance_ids || [];
    return (!ids || ids.length === 0) && !a.instance_id;
  });

  if (!agent) {
    console.log(`[Webhook] No matching active agent for instanceId: ${waInstance.id}`);
    return new Response('No matching active agent', { headers: corsHeaders })
  }
  
  console.log(`[Webhook] Agente encontrado: ${agent.name} (ID: ${agent.id})`);

  // --- VERIFICACAO SE REMETENTE E UM VENDEDOR CADASTRADO ---
  const phoneNumber = remoteJid.replace(/@.*$/, '').replace(/\D/g, '');
  const { data: allTeamMembers } = await supabase.from('ai_team_members').select('id, name, whatsapp_number').eq('agent_id', agent.id).eq('is_active', true);
  
  // Normaliza para os ultimos 11 digitos (DDD + numero 9 digitos) para comparacao robusta
  const normalizePhone = (p: string) => {
    const digits = String(p || '').replace(/\D/g, '');
    // Remove prefixo internacional 55 se tiver 13 digitos (5511999999999)
    if (digits.startsWith('55') && digits.length >= 12) return digits.slice(2);
    return digits;
  };
  const senderNormalized = normalizePhone(phoneNumber);
  console.log(`[Webhook] Sender phone normalizado: "${senderNormalized}" | Vendedores cadastrados: ${allTeamMembers?.map((m: any) => `${m.name}="${normalizePhone(m.whatsapp_number)}"`).join(', ')}`);
  const matchedSeller = allTeamMembers?.find((m: any) => {
    const sellerNorm = normalizePhone(m.whatsapp_number);
    // Match se os ultimos digitos coincidirem (pelo menos 8 digitos finais para ignorar o 9 extra)
    return sellerNorm && senderNormalized && (sellerNorm === senderNormalized || sellerNorm.endsWith(senderNormalized.slice(-8)) || senderNormalized.endsWith(sellerNorm.slice(-8)));
  });

  if (matchedSeller) {
    console.log(`[Webhook] Mensagem de VENDEDOR identificado: ${matchedSeller.name}. Verificando confirmacao de atendimento...`);
    const CONFIRMATION_KEYWORDS = ['ok', 'ta certo', 'tá certo', 'vou chamar', 'vou contatar', 'vou atender', 'certo', 'entendido', 'recebi', 'vou ligar', 'beleza', 'combinado', 'pode deixar', 'sim', 'perfeito', 'ok!', 'já ligo', 'ja ligo', 'vou ver', 'vou verificar', 'blz', 'joia', 'pronto', 'peguei', 'chamei', 'chamando', 'okay', 'atendendo', 'to indo', 'tô indo', 'estou indo', 'já peguei', 'ja peguei', 'pode mandar', 'manda', 'opa'];
    const normalizedText = normalizeBndvText(userText);
    const isConfirmation = CONFIRMATION_KEYWORDS.some(kw => normalizedText.includes(normalizeBndvText(kw))) || userText.length <= 15;
    if (isConfirmation) {
      console.log(`[Webhook] Vendedor ${matchedSeller.name} confirmou atendimento. Atualizando CRM...`);
      const { data: assignedLead } = await supabase.from('ai_crm_leads').select('id, assigned_to_id').eq('agent_id', agent.id).eq('status', 'qualificado').order('last_interaction_at', { ascending: false }).limit(1).maybeSingle();
      if (assignedLead && assignedLead.assigned_to_id === matchedSeller.id) {
        await supabase.from('ai_crm_leads').update({ status: 'transferido', last_interaction_at: new Date().toISOString() }).eq('id', assignedLead.id);
        console.log(`[Webhook] Lead ${assignedLead.id} atualizado para 'transferido' (Em Atendimento) pelo vendedor ${matchedSeller.name}.`);
      } else {
        console.log(`[Webhook] Vendedor ${matchedSeller.name} confirmou, mas o lead nao esta mais designado para ele (ja foi repassado ou assumido).`);
        const baseUrl = (waInstance.api_url || Deno.env.get('EVOLUTION_API_URL') || '').replace(/\/$/, '');
        const instKey = waInstance.api_key_encrypted || Deno.env.get('EVOLUTION_API_KEY') || '';
        await sendUazapiTextMessage(baseUrl, instKey, instanceName, remoteJid.split('@')[0], remoteJid, "⚠️ *Tempo esgotado!* \n\nEste lead já foi repassado para o próximo especialista da fila pois passaram-se 5 minutos. Fique atento aos próximos!");
      }
    }
    return new Response(JSON.stringify({ ok: true, seller_message: true }), { headers: corsHeaders });
  }
  console.log(`[Webhook] Remetente nao e vendedor. Processando como lead...`);


  // Verificar se o lead existe no CRM. Se nao existe (ou foi apagado), limpar o historico para comecar do zero
  const { data: leadExists } = await supabase.from('ai_crm_leads').select('id').eq('agent_id', agent.id).eq('remote_jid', remoteJid).maybeSingle();
  if (!leadExists) {
    console.log(`[Webhook] Lead apagado manualmente ou novo. Limpando historico de chat de ${remoteJid}...`);
    await supabase.from('wa_chat_history').delete().eq('agent_id', agent.id).eq('remote_jid', remoteJid);
  }

  // Registrar Lead no CRM (legado + novo)
  const nowStr = new Date().toISOString();
  const crmPayload = {
    user_id: agent.user_id,
    agent_id: agent.id,
    remote_jid: remoteJid,
    lead_name: pushName,
    last_interaction_at: nowStr,
    last_user_reply_at: nowStr
  };
  await supabase.from('ai_crm_leads').upsert(crmPayload, { onConflict: 'agent_id, remote_jid', ignoreDuplicates: true });
  if (supabaseNew) {
    try { await supabaseNew.from('ai_crm_leads').upsert(crmPayload, { onConflict: 'agent_id, remote_jid', ignoreDuplicates: true }); } catch(e) { console.warn('[CRM Mirror] upsert falhou:', e); }
  }

  const updatePayload: any = { last_user_reply_at: nowStr, followup_5min_sent: false };
  await supabase.from('ai_crm_leads').update(updatePayload).eq('agent_id', agent.id).eq('remote_jid', remoteJid);
  if (supabaseNew) {
    try { await supabaseNew.from('ai_crm_leads').update(updatePayload).eq('agent_id', agent.id).eq('remote_jid', remoteJid); } catch(e) { console.warn('[CRM Mirror] update followup falhou:', e); }
  }

  // Tools
  const tools = [
    {
      type: "function",
      function: {
        name: "atualizar_etapa_crm",
        description: "Atualiza o Kanban/CRM conforme a evolucao da conversa. Chame esta funcao secretamente para categorizar o lead. Valores validos de status: 'interessado' (quando tem interesse inicial), 'qualificado' (quando pediu para comprar ou quer falar com humano) e 'encerrado' (quando nao quer comprar). OBS IMPORTANTE: Ao chamar esta funcao para status 'interessado' ou 'encerrado', VOCE DEVE TAMBEM gerar uma mensagem normal para o cliente. So encerre a conversa se for status 'qualificado'.",
        parameters: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["interessado", "qualificado", "encerrado"], description: "A etapa atual do cliente." },
            resumo: { type: "string", description: "Resumo DETALHADO e COMPLETO do atendimento para o vendedor humano que vai continuar. Inclua OBRIGATORIAMENTE: (1) o que o cliente quer comprar (modelo, versao, ano, cor, km, preco maximo se mencionado), (2) quais veiculos ja foram apresentados pela IA, (3) o motivo pelo qual o cliente quer falar com um humano ou fechar negocio, e (4) o tom e urgencia demonstrados pelo cliente. NUNCA seja vago ou generico." }
          },
          required: ["status", "resumo"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "consultar_estoque_bndv",
        description: "Consulta o estoque real de veiculos do cliente integrado ao BNDV. Use quando o cliente perguntar por carro disponivel, preco, ano, versao, cambio, combustivel, cor ou faixa de valor. Nunca invente estoque sem usar esta ferramenta.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Busca livre do cliente, como 'nivus automatico ate 110 mil'." },
            marca: { type: "string", description: "Marca do veiculo, ex: Chevrolet, Jeep, Hyundai." },
            modelo: { type: "string", description: "Modelo do veiculo, ex: Onix, Renegade, Creta." },
            versao: { type: "string", description: "Versao ou detalhe do veiculo, ex: LTZ, EX, Touring." },
            combustivel: { type: "string", description: "Combustivel desejado, ex: Flex, Diesel." },
            cambio: { type: "string", description: "Tipo de cambio, ex: Automatico, Manual." },
            cor: { type: "string", description: "Cor desejada, se o cliente pedir." },
            ano_min: { type: "number", description: "Ano minimo desejado." },
            ano_max: { type: "number", description: "Ano maximo desejado." },
            preco_max: { type: "number", description: "Preco maximo desejado pelo cliente." },
            km_max: { type: "number", description: "Quilometragem maxima desejada pelo cliente." },
            limite: { type: "number", description: "Quantidade maxima de veiculos para retornar." }
          },
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "enviar_fotos_bndv",
        description: "Envia fotos reais de um veiculo do estoque BNDV pelo WhatsApp. Use quando o cliente pedir fotos, imagens, quiser ver o carro ou disser para mandar fotos.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Busca livre do cliente, como 'onix activ 2019'." },
            marca: { type: "string", description: "Marca do veiculo." },
            modelo: { type: "string", description: "Modelo do veiculo." },
            versao: { type: "string", description: "Versao do veiculo." },
            ano_min: { type: "number", description: "Ano minimo desejado." },
            ano_max: { type: "number", description: "Ano maximo desejado." },
            preco_max: { type: "number", description: "Preco maximo desejado." },
            quantidade_fotos: { type: "number", description: "Quantidade maxima de fotos para enviar, entre 1 e 5." }
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
  // phoneNumber ja declarado acima na verificacao de vendedores
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
    
    // Se nao veio base64, tentar download pela uazapi
    if (!base64 && messageId) {
      console.log(`[Webhook] Baixando midia ID: ${messageId}`);
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
        console.error('[Webhook] Falha no download de midia:', err);
      }
    }

    if (!base64 && mediaUrl) {
      console.log('[Webhook] Tentando buscar midia pela URL retornada');
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
             console.log('[Webhook] Transcricao (Whisper):', finalUserText);
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

  console.log(`[Webhook] Salvando historico e chamando OpenAI para: ${finalUserText}`);

  // Salvar historico
  await supabase.from('wa_chat_history').insert({
    user_id: agent.user_id,
    agent_id: agent.id,
    instance_id: instanceName,
    remote_jid: remoteJid,
    role: 'user',
    content: typeof userMessageContentForOpenAi === 'string' ? finalUserText : '[Midia/Imagem]',
    lead_name: pushName
  })

  // Buscar historico
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

  let systemPrompt = agent.system_prompt || 'Voce e um assistente prestativo.'
  if (agent.company_name) systemPrompt += `\n\nEmpresa: ${agent.company_name}`
  if (knowledgeContext) systemPrompt += `\n\n## BASE DE CONHECIMENTO:\n${knowledgeContext}`
  
  // Regra anti-alucinacao para arquivos/midia
  systemPrompt += `\n\n[REGRAS DE CONDUTA ANTE MIDIAS E ARQUIVOS]
- Se o usuario enviar uma imagem (sera indicado com "[Imagem recebida]"), analise com precisao fotografica se conseguir visualizar o anexo no seu array.
- Se o usuario enviar audio, a transcricao e entregue como texto direto para voce interpretar, lide naturalmente como se tivesse ouvido.
- Se o usuario anexar documentos/PDFs (indicado com "[Arquivo recebido: <nome>]"), VOCE NAO PODE ABRIR ARQUIVOS e NAO DEVE INVENTAR DADOS. Responda educadamente sem fugir do personagem: informe que a plataforma limitou sua visao ou que nao consegue abrir documentos, sugerindo que o cliente resuma o que ha no arquivo ou envie as duvidas em audio/texto. Nunca de respostas genericas e nunca ofereca "mais informacoes" se nao sabe o conteudo.`
  systemPrompt += `\n\n[CONSULTA DE ESTOQUE BNDV]
- Quando o cliente perguntar sobre veiculos (ex: "Tem Renegade?", "Qual o preco do Onix?"), voce DEVE usar a ferramenta "consultar_estoque_bndv" ANTES de responder.
- NUNCA invente veiculos, precos ou disponibilidade. Baseie-se APENAS no retorno da ferramenta. Se a ferramenta voltar vazio, diga que nao tem no momento.
- Ao apresentar os resultados, liste as opcoes encontradas de forma comercial (versao, ano, km, preco) e pergunte se ele quer ver as fotos.

[ENVIO DE FOTOS BNDV]
- Se o cliente pedir fotos (ex: "Me manda fotos", "Quero ver esse", "Quero fotos do 2"), use a ferramenta "enviar_fotos_bndv".
- IMPORTANTE: No campo "query" da ferramenta, passe o NOME EXATO e ANO do carro que o cliente escolheu (ex: "Jeep Compass 2023"). NUNCA use palavras como "segundo", "primeiro" ou "esse". Use o nome do carro da lista original para garantir a busca correta.`

  systemPrompt += `\n\n[REGRA DE QUALIFICACAO E TRANSFERENCIA]
- Se o cliente quiser falar com vendedor, humano, consultor, fechar compra, ver proposta, financiamento, visita, teste drive, negociar ou demonstrar clara intencao de compra, use imediatamente a ferramenta "atualizar_etapa_crm" com status "qualificado".
- Quando o lead estiver qualificado, o sistema encaminha o contato para o vendedor salvo na lista. Nao deixe de acionar a ferramenta nesses casos.`

  systemPrompt += `\n- O WhatsApp NAO suporta Markdown para imagens. NUNCA escreva links ou URLs de fotos no chat. SEMPRE use a ferramenta "enviar_fotos_bndv" para envio de midia.`
  systemPrompt += `\n- REGRA ABSOLUTA AO ENVIAR FOTOS: PROIBIDO dizer "foram enviadas", "aqui estao as fotos" ou confirmar o envio tecnicamente. O cliente JA ESTA VENDO AS FOTOS. Faca apenas um comentario comercial natural sobre o veiculo.`

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
    let iterations = 0;
    const maxIterations = 3;
    let currentMessages: any[] = [
      { role: 'system', content: systemPrompt },
      ...chatHistory,
      { role: 'user', content: userMessageContentForOpenAi }
    ];

    while (iterations < maxIterations) {
      iterations++;
      
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
        body: JSON.stringify({
          model: aiModel,
          messages: currentMessages,
          temperature: agent.temperature || 0.7,
          tools: tools,
          tool_choice: "auto"
        })
      });

      if (!openaiRes.ok) {
        const errText = await openaiRes.text();
        console.error(`[Webhook] OpenAI Erro: ${openaiRes.status} - ${errText}`);
        if (iterations === 1) return new Response('OpenAI erro', { status: 500 });
        break;
      }
      
      const openaiData = await openaiRes.json();
      aiMessage = openaiData.choices?.[0]?.message;
      
      if (aiMessage?.content) {
        aiResponse = aiResponse ? `${aiResponse}\n${aiMessage.content}` : aiMessage.content;
      }
      
      currentMessages.push(aiMessage);
      
      console.log(`[Webhook] Iteracao ${iterations}: ToolCalls: ${aiMessage?.tool_calls?.length || 0}`);
      
      if (!aiMessage?.tool_calls || aiMessage.tool_calls.length === 0) {
        break;
      }

      const toolMessages: any[] = [];
      let suppressAssistantReply = false;

      for (const toolCall of aiMessage.tool_calls) {
      try {
        if (toolCall.function.name === 'atualizar_etapa_crm') {
          const args = JSON.parse(toolCall.function.arguments);

          const { data: existingLead } = await supabase.from('ai_crm_leads')
            .select('status, assigned_to_id')
            .eq('agent_id', agent.id)
            .eq('remote_jid', remoteJid)
            .maybeSingle();

          const alreadyTransferred = existingLead && (existingLead.status === 'transferido' || existingLead.status === 'qualificado');

          const crmStatusPayload = {
            user_id: agent.user_id,
            agent_id: agent.id,
            remote_jid: remoteJid,
            status: args.status,
            summary: args.resumo,
            last_interaction_at: new Date().toISOString(),
            lead_name: pushName
          };
          await supabase.from('ai_crm_leads').upsert(crmStatusPayload, { onConflict: 'agent_id, remote_jid' });
          if (supabaseNew) {
            try { await supabaseNew.from('ai_crm_leads').upsert(crmStatusPayload, { onConflict: 'agent_id, remote_jid' }); } catch(e) { console.warn('[CRM Mirror] tool upsert falhou:', e); }
          }

          console.log(`[CRM] Lead ${phoneNumber} analisado. Status: ${args.status}`);

          if (args.status === 'qualificado') {
            const { data: sellers } = await supabase.from('ai_team_members').select('*').eq('agent_id', agent.id).eq('is_active', true).order('last_lead_received_at', { ascending: true, nullsFirst: true });
            if (sellers && sellers.length > 0) {
              const selectedSeller = sellers[0];
              let sellerNum = String(selectedSeller.whatsapp_number || '').replace(/\D/g, '');
              if (sellerNum.length === 10 || sellerNum.length === 11) sellerNum = `55${sellerNum}`;
              if (sellerNum) {
                // Buscar ultimas mensagens do chat para contexto
                const { data: recentChat } = await supabase.from('wa_chat_history').select('role, content, created_at').eq('agent_id', agent.id).eq('instance_id', instanceName).eq('user_id', agent.user_id).order('created_at', { ascending: false }).limit(8);
                let chatSnippet = '';
                if (recentChat && recentChat.length > 0) {
                  chatSnippet = '\n\n--------------------\n\nUltimas mensagens da conversa:\n' + recentChat.reverse().map((m: any) => `${m.role === 'user' ? `👤 ${pushName}` : '🤖 Agente'}: ${String(m.content || '').substring(0, 300)}`).join('\n');
                }
                const sellerMsg = `🚨 *LEAD QUALIFICADO - ATENDIMENTO IMEDIATO*\n\n*Nome do Cliente:* ${pushName}\n*Contato:* +${phoneNumber}\n*Agente IA:* ${agent.name}\n\n--------------------\n\n*📋 Resumo do Atendimento pela IA:*\n${args.resumo}${chatSnippet}\n\n--------------------\n\n👉 *Atender agora:* https://wa.me/${phoneNumber}\n\nO cliente está esperando! ⏳`;
                const sellerSendResult = await sendUazapiTextMessage(
                  baseUrl,
                  instKey,
                  instanceName,
                  sellerNum,
                  `${sellerNum}@s.whatsapp.net`,
                  sellerMsg
                );

                if (!sellerSendResult.ok) {
                  console.error(`[CRM] Falha ao enviar lead para vendedor ${selectedSeller.name} (${sellerNum}).`);
                } else {
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
                      assigned_to_id: selectedSeller.id
                    }).eq('id', leadData.id);
                  }

                  console.log(`[CRM] Lead ${phoneNumber} transferred to seller: ${selectedSeller.name}`);
                }
              } else {
                console.error(`[CRM] Vendedor ${selectedSeller.name} sem numero de WhatsApp configurado.`);
              }
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

        if (toolCall.function.name === 'enviar_fotos_bndv') {
          const args = JSON.parse(toolCall.function.arguments || '{}');
          const photoResult: any = await enviarFotosBndv(
            supabase,
            agent.user_id,
            args,
            { baseUrl, instKey, instanceName, phoneNumber, remoteJid }
          );
          console.log(`[BNDV] Envio de fotos executado | success: ${photoResult.success} | sent: ${photoResult.sent || 0}`);
          if (photoResult?.suppress_follow_up) {
            suppressAssistantReply = true;
          }
          toolMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: JSON.stringify(photoResult)
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

      currentMessages.push(...toolMessages);

      if (suppressAssistantReply) {
        aiResponse = '';
        console.log('[Webhook] Tool de fotos ja respondeu direto ao cliente. Encerrando loop.');
        break;
      }
    }
  }

  if (!aiResponse) {
    // A ferramenta respondeu direto, atualizamos a data de resposta do agente
    const agentReplyTs = new Date().toISOString();
    await supabase.from('ai_crm_leads').update({ last_agent_reply_at: agentReplyTs }).eq('agent_id', agent.id).eq('remote_jid', remoteJid);
    if (supabaseNew) {
      try { await supabaseNew.from('ai_crm_leads').update({ last_agent_reply_at: agentReplyTs }).eq('agent_id', agent.id).eq('remote_jid', remoteJid); } catch(e) { console.warn('[CRM Mirror] update agent_reply falhou:', e); }
    }
    return new Response(JSON.stringify({ success: true, delivered_via_tool: true }), { headers: corsHeaders, status: 200 });
  }

  console.log(`[Webhook] Resposta final ao cliente: ${aiResponse.substring(0, 200)}`);

  // Salvar no historico
  await supabase.from('wa_chat_history').insert({
    user_id: agent.user_id, agent_id: agent.id, instance_id: instanceName,
    remote_jid: remoteJid, role: 'assistant', content: aiResponse
  })

  // Enviar para o cliente final
  try {
    const sendResult = await sendUazapiTextMessage(baseUrl, instKey, instanceName, phoneNumber, remoteJid, aiResponse)
    if (!sendResult.ok) {
      console.error('[Webhook] Nenhuma tentativa de envio UAZAPI funcionou');
    } else {
      const agentReplyTs = new Date().toISOString();
      await supabase.from('ai_crm_leads').update({ last_agent_reply_at: agentReplyTs }).eq('agent_id', agent.id).eq('remote_jid', remoteJid);
      if (supabaseNew) {
        try { await supabaseNew.from('ai_crm_leads').update({ last_agent_reply_at: agentReplyTs }).eq('agent_id', agent.id).eq('remote_jid', remoteJid); } catch(e) { console.warn('[CRM Mirror] update agent_reply final falhou:', e); }
      }
    }
  } catch (e) {
    console.error('[Webhook] Erro ao enviar mensagem:', e)
  }

  return new Response(JSON.stringify({ success: true }), { headers: corsHeaders, status: 200 })
}

