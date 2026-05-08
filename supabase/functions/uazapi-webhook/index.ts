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

      let userText = (msgObj.body || msgObj.text || msgObj.caption || '').trim();
      const pushName = msgObj.senderName || chat.name || msgObj.notifyName || msgObj.pushName || 'Lead';

      // ─── Extração de contexto de Anúncio (Facebook / Instagram) ───────────
      // Em mensagens Uazapi, os metadados do anúncio chegam dentro do msgObj
      // em diferentes campos dependendo da versão do WhatsApp / uazapi.
      const msgMeta = msgObj?.message || msgObj;
      const ctxInfo = msgMeta?.extendedTextMessage?.contextInfo
        || msgMeta?.imageMessage?.contextInfo
        || msgMeta?.videoMessage?.contextInfo
        || msgObj?.contextInfo
        || msgObj?.quoted?.contextInfo
        || {};

      const extAdReply = ctxInfo?.externalAdReply
        || ctxInfo?.quotedMessage?.extendedTextMessage?.contextInfo?.externalAdReply
        || {};

      let adTextContext = '';

      // 1) Click-to-WhatsApp (externalAdReply populado)
      if (extAdReply?.title || extAdReply?.body || extAdReply?.sourceUrl) {
        const t = extAdReply.title || '';
        const b = extAdReply.body || '';
        const u = extAdReply.sourceUrl || '';
        adTextContext = `[Lead veio de Anúncio Facebook/Instagram: "${t} ${b}" | URL: ${u}]`;
        console.log('[Webhook] externalAdReply detectado:', adTextContext);
      }

      // 2) Link compartilhado com preview (contextInfo com matchedText ou sourceUrl do Meta)
      if (!adTextContext && ctxInfo) {
        const matched = ctxInfo.matchedText || ctxInfo.description || ctxInfo.title || '';
        const srcUrl = (ctxInfo.sourceUrl || '').toLowerCase();
        if (matched || srcUrl.includes('fb.me') || srcUrl.includes('facebook') || srcUrl.includes('instagram')) {
          adTextContext = `[Lead enviou link de anúncio Facebook/Instagram: "${matched}" | URL: ${srcUrl}]`;
          console.log('[Webhook] contextInfo ad-link detectado:', adTextContext);
        }
      }

      // 3) Link preview pelo extendedTextMessage direto no msgObj
      if (!adTextContext) {
        const ext = msgMeta?.extendedTextMessage || {};
        const matchedUrl = (ext.matchedText || ext.canonicalUrl || '').toLowerCase();
        const linkTitle = ext.title || '';
        const linkDesc = ext.description || '';
        if (matchedUrl.includes('fb.me') || matchedUrl.includes('facebook') || matchedUrl.includes('instagram') || linkTitle) {
          adTextContext = `[Lead enviou link/anúncio: "${linkTitle} - ${linkDesc}" | URL: ${matchedUrl}]`;
          console.log('[Webhook] extendedTextMessage link detectado:', adTextContext);
        }
      }
      // ─── Enriquecimento via GPT-4o Vision na thumbnail do anúncio ────────────
      // A thumbnail do WhatsApp contém a imagem REAL do anúncio com o nome do carro,
      // versão, ano e preço escritos diretamente nela. O Vision lê isso com 100% de precisão.
      // Estratégia de extração: tentar todos os caminhos possíveis onde a thumbnail pode estar.
      const adThumbnailB64 =
        extAdReply?.jpegThumbnail ||
        extAdReply?.thumbnail ||
        ctxInfo?.jpegThumbnail ||
        msgMeta?.extendedTextMessage?.jpegThumbnail ||
        msgMeta?.imageMessage?.jpegThumbnail ||
        msgObj?.extendedTextMessage?.jpegThumbnail ||
        msgObj?.content?.JPEGThumbnail ||
        msgObj?.content?.jpegThumbnail ||
        msgObj?.jpegThumbnail ||
        '';

      // Também extrair URL do anúncio para fallback
      let adRawUrl = extAdReply?.sourceUrl || ctxInfo?.sourceUrl || '';
      if (!adRawUrl) {
        const ext2 = msgMeta?.extendedTextMessage || {};
        adRawUrl = ext2.matchedText || ext2.canonicalUrl || '';
      }
      if (!adRawUrl) {
        const urlMatch = userText.match(/https?:\/\/(fb\.me|www\.facebook\.com|m\.facebook\.com|instagram\.com)\S+/i);
        if (urlMatch) adRawUrl = urlMatch[0];
      }

      // ─── Identificação do carro por Vision: og:image do link ou thumbnail do WhatsApp ──
      const OPENAI_API_KEY_PRE = Deno.env.get('OPENAI_API_KEY') || '';

      // Função auxiliar: analisa uma imagem (base64 JPEG) com GPT-4o Vision e retorna o carro
      const analyzeImageWithVision = async (b64: string, mimeType = 'image/jpeg'): Promise<string> => {
        try {
          const vRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY_PRE}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'gpt-4o',
              max_tokens: 300,
              messages: [{ role: 'user', content: [
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}`, detail: 'high' } },
                { type: 'text', text: 'Esta e a imagem de um anuncio de carro de uma concessionaria. Leia TODOS os textos visiveis na imagem (etiquetas, sobreposicoes, faixas de preco). Identifique MARCA, MODELO, VERSAO, ANO e PRECO. IMPORTANTE: NUNCA adivinhe o modelo do carro apenas pelo design visual. Extraia APENAS o que esta escrito no texto da imagem ou anuncio. Se o modelo exato nao estiver escrito, diga apenas o que conseguiu ler. Responda APENAS com os dados encontrados em formato curto. Exemplo: "Fiat Strada CS Endurence 1.3 2024 - R$81.990"' }
              ]}]
            }),
          });
          if (!vRes.ok) return '';
          const vData = await vRes.json();
          return vData.choices?.[0]?.message?.content?.trim() || '';
        } catch { return ''; }
      };

      if (OPENAI_API_KEY_PRE) {
        // PRIORIDADE 1: Baixar a og:image do link do anúncio (mais confiável)
        // Esta é exatamente a imagem que aparece quando você abre o link no celular.
        if (adRawUrl) {
          const ogMeta = await fetchAdMetadata(adRawUrl);
          if (ogMeta.imageUrl) {
            console.log('[AdVision] Baixando og:image:', ogMeta.imageUrl.substring(0, 80));
            try {
              const imgCtrl = new AbortController();
              const imgTimeout = setTimeout(() => imgCtrl.abort(), 8000);
              const imgRes = await fetch(ogMeta.imageUrl, { signal: imgCtrl.signal });
              clearTimeout(imgTimeout);
              if (imgRes.ok) {
                const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
                const imgBuffer = await imgRes.arrayBuffer();
                // Converter para base64 de forma compatível com Deno
                const uint8 = new Uint8Array(imgBuffer);
                let binary = '';
                for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
                const imgBase64 = btoa(binary);
                const carInfo = await analyzeImageWithVision(imgBase64, mimeType);
                if (carInfo) {
                  adTextContext = `[ANÚNCI0 IDENTIFICADO (imagem do link): "${carInfo}" | URL: ${adRawUrl}]`;
                  console.log('[AdVision] Carro identificado via og:image:', carInfo);
                }
              }
            } catch (imgErr) {
              console.warn('[AdVision] Erro ao baixar og:image:', imgErr);
            }
          }

          // Se Vision falhou mas OG text tem dados úteis, usa como fallback
          if (!adTextContext) {
            const combined = `${ogMeta.title} ${ogMeta.description}`;
            const looksLikeCar = /\b(20\d{2}|R\$|km|flex|diesel|turbo|aut\.)/i.test(combined);
            if (looksLikeCar) {
              adTextContext = `[ANÚNCI0 (OG text): "${ogMeta.title}" | "${ogMeta.description}" | URL: ${adRawUrl}]`;
              console.log('[AdFetch] OG text útil como fallback:', adTextContext.substring(0, 150));
            }
          }
        }

        // PRIORIDADE 2: Thumbnail embutida no próprio payload WhatsApp
        if (!adTextContext && adThumbnailB64) {
          console.log('[AdVision] Tentando thumbnail do payload WhatsApp...');
          const carInfo = await analyzeImageWithVision(adThumbnailB64);
          if (carInfo) {
            adTextContext = `[ANÚNCI0 IDENTIFICADO (thumbnail WhatsApp): "${carInfo}" | URL: ${adRawUrl}]`;
            console.log('[AdVision] Carro identificado via thumbnail:', carInfo);
          }
        }
      }

      // Fallback final: ao menos sinaliza que é um anúncio e pede o carro ao lead
      if (!adTextContext && (adRawUrl || adThumbnailB64)) {
        adTextContext = `[Lead enviou link de anúncio. URL: ${adRawUrl}. Não foi possível identificar o carro automaticamente.]`;
        try {
          await supabase.storage.from('creatives').upload(`payload_diag_${Date.now()}.json`, JSON.stringify(msgObj));
        } catch (err) {
          console.error("Erro diag dump storage:", err);
        }
      }

      if (adTextContext) {
        // Enviar o adTextContext como um metadado separado para o processMessage
        // para não poluir o userText (que vai para o histórico e o Inbox)
        console.log(`[Webhook] Mensagem com contexto de anuncio -> Instance: ${instanceName}, From: ${remoteJid}`);
        return await processMessage(supabase, instanceName, remoteJid, userText, pushName, msgObj, adTextContext);
      }
      
      console.log(`[Webhook] Mensagem final a repassar -> Instance: ${instanceName}, From: ${remoteJid}, Text: ${userText.substring(0, 200)}`);
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
    
    let adTextContext = '';

    if (adReply) {
      const adTitle = adReply.title || '';
      const adBody = adReply.body || '';
      const sourceUrl = adReply.sourceUrl || '';
      if (adTitle || adBody || sourceUrl) {
        adTextContext = `[O lead veio de um Anúncio do Facebook/Instagram sobre: "${adTitle} ${adBody}" | Link: ${sourceUrl}]`;
      }
    } 
    
    if (!adTextContext && contextInfo) {
      const matchedText = contextInfo.matchedText || contextInfo.description || contextInfo.title || '';
      const sourceUrl = (contextInfo.sourceUrl || '').toLowerCase();
      if (matchedText || sourceUrl.includes('fb.me') || sourceUrl.includes('facebook') || sourceUrl.includes('instagram')) {
         adTextContext = `[O lead clicou em um Anúncio do Facebook/Instagram. Texto do anúncio: "${matchedText}". Link: ${sourceUrl}]`;
      }
    }

    if (!adTextContext && (message?.extendedTextMessage?.title || message?.extendedTextMessage?.description || message?.extendedTextMessage?.matchedText)) {
      const linkTitle = message.extendedTextMessage.title || '';
      const linkDesc = message.extendedTextMessage.description || message?.extendedTextMessage?.matchedText || '';
      adTextContext = `[O lead clicou ou enviou um anúncio/link sobre: "${linkTitle} - ${linkDesc}"]`;
    }

    if (adTextContext) {
      userText = `${adTextContext}\n(NOTA PARA IA: Analise a IMAGEM (se houver) e o TEXTO do anúncio acima para descobrir qual carro o lead se interessou. COMO ELE VEIO DE UM ANÚNCIO DE CARRO ESPECÍFICO, VOCÊ DEVE OBRIGATORIAMENTE ACIONAR A FERRAMENTA 'consultar_estoque_bndv' IMEDIATAMENTE PARA BUSCAR ESTE CARRO ANTES DE QUALQUER RESPOSTA DE TEXTO!)\n\nMensagem digitada pelo lead: ${userText}`;
    }
    
    return await processMessage(supabase, instance, key.remoteJid, userText.trim(), pushName || 'Lead', data)

  } catch (error: any) {
    console.error("[Webhook] Erro critico:", error)
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 })
  }
})

// ─── Busca de metadados reais do anúncio (Open Graph) ───────────────────────
async function fetchAdMetadata(rawUrl: string, maxRedirects = 5): Promise<{ title: string; description: string; imageUrl: string }> {
  try {
    let currentUrl = rawUrl;
    let res: Response | null = null;
    let redirects = 0;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    while (redirects <= maxRedirects) {
      res = await fetch(currentUrl, {
        headers: {
          'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9',
        },
        redirect: 'manual', // IMPEDE que Deno remova os headers no redirect
        signal: controller.signal,
      });

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get('location');
        if (loc) {
          currentUrl = loc.startsWith('http') ? loc : new URL(loc, currentUrl).href;
          redirects++;
          continue;
        }
      }
      break;
    }
    
    clearTimeout(timeout);
    if (!res || !res.ok) return { title: '', description: '', imageUrl: '' };
    
    const html = await res.text();

    const extract = (prop: string) => {
      const patterns = [
        new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'),
        new RegExp(`<meta[^>]+name=["']${prop.replace('og:','')}["'][^>]+content=["']([^"']+)["']`, 'i'),
      ];
      for (const p of patterns) {
        const m = html.match(p);
        if (m?.[1]) return m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();
      }
      return '';
    };

    const title = extract('og:title');
    const description = extract('og:description');
    const imageUrl = extract('og:image');
    console.log(`[AdFetch] URL: ${rawUrl} | Final: ${currentUrl} | og:title: ${title} | og:image: ${imageUrl.substring(0, 80)}`);
    return { title, description, imageUrl };
  } catch (e) {
    console.warn('[AdFetch] Falha ao buscar metadados do anuncio:', e);
    return { title: '', description: '', imageUrl: '' };
  }
}
// ─────────────────────────────────────────────────────────────────────────────

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
  let normalized = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/-/g, ' ')
    .replace(/[^\w\s.]/g, ' ')
    .trim();

  normalized = normalized
    .replace(/\beco\s*sport\b/g, 'ecosport')
    .replace(/\bfree\s*style\b/g, 'freestyle')
    .replace(/\bprem\.\b/g, 'premier')
    .replace(/\bpremi\b/g, 'premier')
    .replace(/\bcresta\b/g, 'creta')
    .replace(/\bauthen\.?\b/g, 'authentique')
    .replace(/\bauthent\.?\b/g, 'authentique')
    .replace(/\bauth\b/g, 'authentique')
    .replace(/\bh rv\b/g, 'hrv')
    .replace(/\bt-cross\b/g, 'tcross')
    .replace(/\bt\s+cross\b/g, 'tcross')
    .replace(/\bonix\s+plus\s+sedan\b/g, 'onix sedan plus')
    .replace(/\bonix\s+plus\b/g, 'onix sedan plus')
    .replace(/\s+/g, ' ');

  const expansions: string[] = [];
  if (/\bonix\b/.test(normalized)) expansions.push('chevrolet onix hatch sedan plus joy premier lt ltz activ');
  if (/\bonix\b/.test(normalized) && /\bsedan\b/.test(normalized)) expansions.push('onix plus');
  if (/\bcreta\b/.test(normalized)) expansions.push('hyundai creta action comfort limited platinum ultimate');
  if (/\becosport\b/.test(normalized)) expansions.push('ford ecosport freestyle titanium se');
  if (/\bduster\b/.test(normalized)) expansions.push('renault duster authentique dynamique expression intense iconic suv automatico manual');
  if (/\bargo\b/.test(normalized)) expansions.push('fiat argo drive trekking');
  if (/\btracker\b/.test(normalized)) expansions.push('chevrolet tracker premier ltz lt');
  if (expansions.length > 0) normalized = `${normalized} ${expansions.join(' ')}`;

  return normalized;
}

function bndvIncludes(haystack?: string | null, needle?: string | null) {
  if (!needle || !String(needle).trim()) return true;
  return normalizeBndvText(haystack).includes(normalizeBndvText(needle));
}

function bndvMatchesQuery(vehicle: any, query?: string | null) {
  if (!query || !String(query).trim()) return true;
  const scored = scoreBndvVehicle(vehicle, { query });
  return scored.score > 0;
}

const BNDV_WEAK_WORDS = new Set([
  'carro', 'veiculo', 'veiculos', 'revisado', 'revisados', 'pronto', 'prontos',
  'para', 'por', 'apenas', 'oferta', 'anuncio', 'facebook', 'instagram', 'fale',
  'agora', 'consultor', 'consultores', 'opcoes', 'disponiveis', 'disponivel',
  'informacoes', 'interesse', 'queria', 'mais', 'favor', 'preco', 'valor',
  'automatico', 'manual', 'flex', 'gasolina', 'diesel', 'alcool', 'aut',
  'mec', 'mecanico', 'motors', 'icom', 'loja', 'estoque', 'ltda', 'porfavor',
  'lead', 'clicou', 'link', 'meta', 'whatsapp', 'identificado', 'imagem', 'thumbnail',
  'url', 'texto', 'de', 'da', 'do', 'dos', 'das', 'um', 'uma', 'com', 'sem',
]);

function bndvTokens(value?: string | null) {
  return normalizeBndvText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !BNDV_WEAK_WORDS.has(token));
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= right.length; j++) previous[j] = current[j];
  }

  return previous[right.length];
}

function tokenSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length <= 3 || right.length <= 3) return 0;
  const longest = Math.max(left.length, right.length);
  return 1 - (levenshteinDistance(left, right) / longest);
}

function buildBndvIndexedText(vehicle: any) {
  let indexed = normalizeBndvText([
    vehicle?.markName,
    vehicle?.modelName,
    vehicle?.versionName,
    vehicle?.color,
    vehicle?.fuelName,
    vehicle?.transmissionName,
    vehicle?.year?.toString?.(),
  ].filter(Boolean).join(' '));

  const isPicape = /\b(hilux|s10|ranger|amarok|toro|frontier|triton|l200|strada|saveiro|montana|oroch|maverick|ram|1500|2500|3500|f150|silverado|titano|poer|gladiator|d20|f1000)\b/i.test(indexed);
  if (isPicape) indexed += ' picape caminhonete camionete pickup';

  const isSUV = /\b(compass|renegade|creta|kicks|hrv|corolla cross|tracker|tcross|nivus|fastback|pulse|tiggo|sw4|equinox|commander|taos|ecosport|duster|kardian|outlander|pajero|xc60|xc40)\b/i.test(indexed);
  if (isSUV) indexed += ' suv utilitario utilitario';

  const isSedan = /\b(corolla|civic|cruze|jetta|virtus|cronos|versa|hb20s|yaris sedan|logan|city|sentra|cerato|fusion)\b/i.test(indexed);
  if (isSedan) indexed += ' sedan';

  const isHatch = /\b(onix|hb20|polo|argo|208|yaris|mobi|kwid|c3|gol|fox|sandero|up|fiesta|march)\b/i.test(indexed);
  if (isHatch) indexed += ' hatch popular';

  return indexed;
}

function buildBndvSearchText(filters: any) {
  return normalizeBndvText([
    filters?.query,
    filters?.ad_context,
    filters?.contexto_anuncio,
    filters?.marca,
    filters?.modelo,
    filters?.versao,
    filters?.cor,
    filters?.combustivel,
    filters?.cambio,
    filters?.ano_min && filters?.ano_min === filters?.ano_max ? String(filters.ano_min) : '',
  ].filter(Boolean).join(' '));
}

function scoreBndvVehicle(vehicle: any, filters: any) {
  const searchText = buildBndvSearchText(filters);
  if (!searchText) return { score: 1, matchedTokens: [] as string[] };

  const indexed = buildBndvIndexedText(vehicle);
  const indexedTokens = bndvTokens(indexed);
  const queryTokens = [...new Set(bndvTokens(searchText))];
  const matchedTokens: string[] = [];
  let score = 0;

  for (const token of queryTokens) {
    if (indexed.includes(token)) {
      matchedTokens.push(token);
      score += token.length <= 3 ? 1 : 2;
      continue;
    }

    const similar = indexedTokens.some((candidate) => tokenSimilarity(candidate, token) >= 0.84);
    if (similar) {
      matchedTokens.push(token);
      score += 1.25;
    }
  }

  const exactModel = normalizeBndvText(vehicle?.modelName);
  const exactVersion = normalizeBndvText(vehicle?.versionName);
  const exactMark = normalizeBndvText(vehicle?.markName);
  const year = String(vehicle?.year || '');

  if (filters?.marca && exactMark.includes(normalizeBndvText(filters.marca))) score += 4;
  if (filters?.modelo && (exactModel.includes(normalizeBndvText(filters.modelo)) || indexed.includes(normalizeBndvText(filters.modelo)))) score += 7;
  if (filters?.versao && exactVersion.includes(normalizeBndvText(filters.versao))) score += 4;
  if (year && searchText.includes(year)) score += 3;

  if (searchText.includes('onix') && exactModel.includes('onix')) score += 10;
  if (searchText.includes('onix') && searchText.includes('sedan') && (exactModel.includes('sed') || exactVersion.includes('sed') || exactModel.includes('plus') || exactVersion.includes('plus'))) score += 8;
  if (searchText.includes('onix') && searchText.includes('plus') && (exactModel.includes('plus') || exactVersion.includes('plus') || exactModel.includes('sed'))) score += 6;
  if (searchText.includes('premier') && (exactVersion.includes('premier') || exactVersion.includes('prem'))) score += 4;
  if (searchText.includes('ecosport') && exactModel.includes('ecosport')) score += 10;
  if (searchText.includes('creta') && exactModel.includes('creta')) score += 10;
  if (searchText.includes('duster') && exactModel.includes('duster')) score += 10;
  if (searchText.includes('duster') && searchText.includes('renault') && exactMark.includes('renault')) score += 4;
  if (searchText.includes('authentique') && (exactVersion.includes('authentique') || exactVersion.includes('auth'))) score += 4;

  for (const modelToken of bndvTokens(exactModel)) {
    if (queryTokens.includes(modelToken)) score += 5;
  }

  if (searchText.includes('creta') && exactModel.includes('tiggo')) score -= 5;
  if (searchText.includes('onix') && !exactModel.includes('onix')) score -= 8;
  if (searchText.includes('ecosport') && !exactModel.includes('ecosport')) score -= 8;
  if (searchText.includes('creta') && !exactModel.includes('creta')) score -= 8;
  if (searchText.includes('duster') && !exactModel.includes('duster')) score -= 8;

  const requiredTokens = Math.min(2, queryTokens.length);
  if (queryTokens.length > 0 && matchedTokens.length < requiredTokens && score < 5) score = 0;

  return { score, matchedTokens };
}

function bndvPassesNumericFilters(vehicle: any, filters: any, relaxed = false) {
  if (relaxed) return true;
  const year = Number(vehicle?.year || 0);
  const price = Number(vehicle?.saleValue || 0);
  const mileage = Number(vehicle?.km || 0);

  return (
    (!filters?.ano_min || year >= Number(filters.ano_min)) &&
    (!filters?.ano_max || year <= Number(filters.ano_max)) &&
    (!filters?.preco_max || price <= Number(filters.preco_max)) &&
    (!filters?.km_max || mileage <= Number(filters.km_max))
  );
}

function rankBndvVehicles(items: any[], filters: any) {
  const hasSearch = !!buildBndvSearchText(filters);
  if (!hasSearch) {
    return [...items]
      .filter((vehicle) => bndvPassesNumericFilters(vehicle, filters))
      .map((vehicle) => ({ vehicle, score: 1, matchedTokens: [] as string[], relaxed: false }));
  }

  const hasAdSearch = !!String(filters?.ad_context || filters?.contexto_anuncio || '').trim();
  if (hasAdSearch) {
    return items
      .map((vehicle) => {
        const scored = scoreBndvVehicle(vehicle, filters);
        const relaxed = !bndvPassesNumericFilters(vehicle, filters);
        return {
          vehicle,
          ...scored,
          score: relaxed ? Math.max(0.1, scored.score - 1) : scored.score,
          relaxed,
        };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
  }

  const ranked = items
    .map((vehicle) => ({ vehicle, ...scoreBndvVehicle(vehicle, filters), relaxed: false }))
    .filter((item) => item.score > 0 && bndvPassesNumericFilters(item.vehicle, filters))
    .sort((left, right) => right.score - left.score);

  if (ranked.length > 0) return ranked;

  return items
    .map((vehicle) => ({ vehicle, ...scoreBndvVehicle(vehicle, filters), relaxed: true }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
}

async function rerankBndvVehiclesWithAi(openaiApiKey: string, filters: any, rankedItems: any[]) {
  const searchText = buildBndvSearchText(filters);
  if (!openaiApiKey || !searchText || rankedItems.length < 2) {
    return { ranked: rankedItems, strategy: 'fuzzy_rank', confidence: 'medium', note: '' };
  }

  const candidates = rankedItems.slice(0, 20).map((item: any, index: number) => ({
    index,
    score: item.score,
    matched_tokens: item.matchedTokens,
    relaxed: item.relaxed,
    marca: item.vehicle?.markName,
    modelo: item.vehicle?.modelName,
    versao: item.vehicle?.versionName,
    ano: item.vehicle?.year,
    preco: item.vehicle?.saleValue,
    cor: item.vehicle?.color,
  }));

  try {
    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'Voce e um classificador de estoque automotivo.',
              'Escolha quais candidatos do estoque correspondem ao veiculo procurado em um anuncio ou conversa.',
              'Leitura de anuncio pode errar ano, letras e versao. Modelo/familia visual tem prioridade sobre ano/versao exatos.',
              'Se houver mesmo modelo/familia e versao proxima, trate como disponivel/provavel, nao como ausente.',
              'Responda apenas JSON: {"best_indexes":[0,1],"confidence":"high|medium|low","reason":"curto"}.',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              busca_do_lead: searchText,
              filtros_recebidos: filters || {},
              candidatos: candidates,
            }),
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      console.warn(`[BNDV] AI rerank indisponivel: ${aiRes.status}`);
      return { ranked: rankedItems, strategy: 'fuzzy_rank', confidence: 'medium', note: '' };
    }

    const aiPayload = await aiRes.json().catch(() => null);
    const content = aiPayload?.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    const indexes = Array.isArray(parsed?.best_indexes)
      ? parsed.best_indexes.map((value: any) => Number(value)).filter((value: number) => Number.isInteger(value) && value >= 0 && value < candidates.length)
      : [];

    if (indexes.length === 0) {
      return { ranked: rankedItems, strategy: 'fuzzy_rank', confidence: 'medium', note: String(parsed?.reason || '') };
    }

    const selected = indexes.map((index: number) => rankedItems[index]).filter(Boolean);
    const selectedSet = new Set(indexes);
    const rest = rankedItems.filter((_: any, index: number) => !selectedSet.has(index));
    return {
      ranked: [...selected, ...rest],
      strategy: 'ai_rerank',
      confidence: parsed?.confidence || 'medium',
      note: String(parsed?.reason || ''),
    };
  } catch (err) {
    console.warn('[BNDV] Falha no AI rerank:', err);
    return { ranked: rankedItems, strategy: 'fuzzy_rank', confidence: 'medium', note: '' };
  }
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

function normalizeBndvPhotoView(view: string) {
  const normalized = String(view || '').toLowerCase().trim();
  if (['frente', 'front', 'dianteira'].includes(normalized)) return 'front';
  if (['traseira', 'rear', 'tras', 'trás'].includes(normalized)) return 'rear';
  if (['lateral', 'side', 'lado'].includes(normalized)) return 'side';
  if (['interior', 'inside', 'interna', 'interno', 'cabine', 'painel'].includes(normalized)) return 'interior';
  return 'other';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function selectBalancedBndvPictures(pictures: Array<{ url: string; principal?: boolean }>, requestedCount: number) {
  const uniqueIndexes: number[] = [];
  const shouldSkipDefaultWheelShot = (idx: number) => idx === 6 && pictures.length >= 9;
  const pushIndex = (idx?: number) => {
    if (typeof idx !== 'number') return;
    if (idx < 0 || idx >= pictures.length) return;
    if (shouldSkipDefaultWheelShot(idx)) return;
    if (!uniqueIndexes.includes(idx)) uniqueIndexes.push(idx);
  };

  // Mapeamento baseado no padrão real da API BNDV observado no estoque:
  // 0-2: frente / frente-lateral
  // 3-5: traseira / traseira-lateral
  // 6: roda/detalhe externo
  // 7+: interior
  [1, 4, 2, 7, 8, 9, 0, 3, 5].forEach(pushIndex);

  if (uniqueIndexes.length < requestedCount) {
    pictures.forEach((_, index) => {
      if (!shouldSkipDefaultWheelShot(index)) pushIndex(index);
    });
  }

  if (uniqueIndexes.length < requestedCount && pictures.length > 0) {
    // Se realmente faltar imagem, libera até a foto da roda como último recurso.
    pictures.forEach((_, index) => {
      if (!uniqueIndexes.includes(index)) uniqueIndexes.push(index);
    });
  }

  return uniqueIndexes.slice(0, requestedCount).map((idx) => pictures[idx]);
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

async function fetchBndvVehicles(supabase: any, userId: string, filters: any, options: any = {}) {
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

  const rankingFilters = {
    ...(filters || {}),
    ad_context: String(options?.adTextContext || filters?.ad_context || '').trim(),
  };
  const items = Array.isArray(payload?.data?.vehiclesBy) ? payload.data.vehiclesBy : [];
  const rankedVehicles = rankBndvVehicles(items, rankingFilters);
  const reranked = await rerankBndvVehiclesWithAi(String(options?.openaiApiKey || ''), rankingFilters, rankedVehicles);
  const orderedVehicles = reranked.strategy === 'ai_rerank'
    ? reranked.ranked
    : reranked.ranked.sort((left: any, right: any) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftPrice = Number(left.vehicle?.saleValue || 0);
      const rightPrice = Number(right.vehicle?.saleValue || 0);
      if (leftPrice !== rightPrice) return leftPrice - rightPrice;
      return Number(right.vehicle?.year || 0) - Number(left.vehicle?.year || 0);
    });

  const filtered = orderedVehicles
    .map((item: any) => ({
      ...item.vehicle,
      __bndv_score: item.score,
      __bndv_matched_tokens: item.matchedTokens,
      __bndv_relaxed_match: item.relaxed,
      __bndv_match_strategy: reranked.strategy,
      __bndv_match_confidence: reranked.confidence,
    }));

  console.log(`[BNDV] Busca inteligente | filtros: ${JSON.stringify(filters || {})} | ad: ${rankingFilters.ad_context ? 'sim' : 'nao'} | total estoque: ${items.length} | encontrados: ${filtered.length} | estrategia: ${reranked.strategy} | relaxada: ${filtered.some((item: any) => item.__bndv_relaxed_match) ? 'sim' : 'nao'}`);

  return {
    success: true,
    total: filtered.length,
    items: filtered,
    match_strategy: reranked.strategy,
    match_confidence: reranked.confidence,
    match_note: reranked.note,
    response_guidance: filtered.length > 0
      ? 'Ha candidatos compativeis no estoque. Nao diga que nao temos o veiculo. Se nao for uma correspondencia 100% exata, diga de forma humana que encontrou uma opcao muito proxima/correspondente e confirme detalhes como ano, versao e preco.'
      : 'Nenhum candidato compativel foi encontrado mesmo com busca ampla.',
  };
}

async function consultarEstoqueBndv(supabase: any, userId: string, filters: any, options: any = {}) {
  const result = await fetchBndvVehicles(supabase, userId, filters, options);
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
      match_score: vehicle?.__bndv_score || null,
      match_strategy: vehicle?.__bndv_match_strategy || result.match_strategy || null,
      match_confidence: vehicle?.__bndv_match_confidence || result.match_confidence || null,
      relaxed_match: !!vehicle?.__bndv_relaxed_match,
    };
  });

  return {
    success: true,
    total: result.total,
    items: capped,
    match_strategy: result.match_strategy,
    match_confidence: result.match_confidence,
    match_note: result.match_note,
    response_guidance: result.response_guidance,
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

async function enviarFotosBndv(supabase: any, userId: string, filters: any, delivery: any, options: any = {}) {
  const result = await fetchBndvVehicles(supabase, userId, filters, options);
  if (!result.success) return result;

  const allVehicles = result.items || [];
  const vehiclesWithPhotos = allVehicles.filter((item: any) => parseBndvPictures(item?.pictureJs).length > 0);
  
  // Selecionar o MELHOR veiculo que bate com os filtros passados, nao apenas o primeiro
  // Pontua por: versao bate (+3), ano bate (+2), preco bate (+1), marca+modelo bate (+2)
  const scoreVehicle = (v: any) => {
    let score = 0;
    const normV = (text: any) => String(text || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (filters.versao && normV(v.versionName).includes(normV(filters.versao))) score += 3;
    if (filters.ano_min && filters.ano_max && v.year >= filters.ano_min && v.year <= filters.ano_max) score += 2;
    else if (filters.ano_min && v.year >= filters.ano_min) score += 1;
    else if (filters.ano_max && v.year <= filters.ano_max) score += 1;
    if (filters.preco_max && v.saleValue <= filters.preco_max) score += 1;
    if (filters.marca && normV(v.markName).includes(normV(filters.marca))) score += 2;
    if (filters.modelo && normV(v.modelName).includes(normV(filters.modelo))) score += 2;
    if (filters.query) {
      const q = normV(filters.query);
      const label = normV([v.markName, v.modelName, v.versionName, String(v.year || '')].join(' '));
      const wordMatches = q.split(/\s+/).filter((w: string) => w.length > 2 && label.includes(w)).length;
      score += wordMatches;
    }
    return score;
  };

  const vehicleWithPhotos = vehiclesWithPhotos.sort((a: any, b: any) => scoreVehicle(b) - scoreVehicle(a))[0]
    || vehiclesWithPhotos[0];

  const vehicleExists = allVehicles.length > 0;
  
  if (!vehicleWithPhotos) {
    if (vehicleExists) {
      const existingVehicle = allVehicles[0];
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
  const requestedCount = Math.max(1, Math.min(Number(filters?.quantidade_fotos || 5), 5));
  const offset = Math.max(0, Number(filters?.offset_fotos || 0));

  let selectedPictures: Array<{ url: string; principal?: boolean }> = [];
  if (offset > 0) {
    selectedPictures = pictures.slice(offset, offset + requestedCount);
    console.log(`[BNDV] Envio com offset manual ${offset}. Mantendo ordem sequencial das fotos.`);
  } else {
    selectedPictures = selectBalancedBndvPictures(pictures, requestedCount);
    console.log(`[BNDV] Seleção mapeada de fotos | total disponíveis: ${pictures.length} | selecionadas: ${selectedPictures.length}`);
    console.log(`[BNDV] Índices escolhidos no padrão BNDV: ${selectedPictures.map((picture) => pictures.findIndex((candidate) => candidate.url === picture.url)).join(', ')}`);
  }

  if (selectedPictures.length === 0) {
    if (offset > 0) {
      return {
        success: false,
        error: `O veiculo possui apenas ${pictures.length} fotos cadastradas e voce tentou pular ${offset} fotos. Avise o cliente que nao ha mais fotos cadastradas no sistema.`,
      };
    }
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
    if (index < selectedPictures.length - 1) {
      await sleep(600);
    }
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
  // Check thumbnail from externalAdReply (Click-to-WhatsApp ads)
  const contextInfo = rawMsgObj?.message?.extendedTextMessage?.contextInfo || rawMsgObj?.message?.imageMessage?.contextInfo || rawMsgObj?.contextInfo;
  const adReply = contextInfo?.externalAdReply || contextInfo?.quotedMessage?.extendedTextMessage?.contextInfo?.externalAdReply;
  if (adReply?.thumbnail || adReply?.jpegThumbnail || contextInfo?.jpegThumbnail || adReply?.thumbnailUrl || adReply?.mediaUrl) {
    return 'image';
  }

  // Check thumbnail from link preview (extendedTextMessage.jpegThumbnail) - THIS is what Facebook story links send
  if (rawMsgObj?.message?.extendedTextMessage?.jpegThumbnail || rawMsgObj?.extendedTextMessage?.jpegThumbnail) {
    return 'image';
  }

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
  const contextInfo = rawMsgObj?.message?.extendedTextMessage?.contextInfo || rawMsgObj?.message?.imageMessage?.contextInfo || rawMsgObj?.contextInfo;
  const adReply = contextInfo?.externalAdReply || contextInfo?.quotedMessage?.extendedTextMessage?.contextInfo?.externalAdReply;
  const thumbBase64 = adReply?.thumbnail || adReply?.jpegThumbnail || contextInfo?.jpegThumbnail
    // Link preview thumbnail (Facebook story links, Instagram, etc.)
    || rawMsgObj?.message?.extendedTextMessage?.jpegThumbnail
    || rawMsgObj?.extendedTextMessage?.jpegThumbnail
    || '';

  const value = thumbBase64 || rawMsgObj?.base64 ||
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
  const contextInfo = rawMsgObj?.message?.extendedTextMessage?.contextInfo || rawMsgObj?.message?.imageMessage?.contextInfo || rawMsgObj?.contextInfo;
  const adReply = contextInfo?.externalAdReply || contextInfo?.quotedMessage?.extendedTextMessage?.contextInfo?.externalAdReply;
  const thumbUrl = adReply?.thumbnailUrl || adReply?.mediaUrl || (adReply?.sourceUrl?.match(/\.(jpeg|jpg|png|gif)/i) ? adReply.sourceUrl : '');

  return thumbUrl || rawMsgObj?.url ||
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
  // If this message has a JPEG thumbnail (link preview or ad), declare it as image/jpeg
  const contextInfo = rawMsgObj?.message?.extendedTextMessage?.contextInfo || rawMsgObj?.contextInfo;
  const adReply = contextInfo?.externalAdReply || {};
  const hasJpegThumb = !!(adReply?.jpegThumbnail || adReply?.thumbnail || contextInfo?.jpegThumbnail
    || rawMsgObj?.message?.extendedTextMessage?.jpegThumbnail
    || rawMsgObj?.extendedTextMessage?.jpegThumbnail);
  if (hasJpegThumb) return 'image/jpeg';

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

async function processMessage(supabase: any, instanceName: string, remoteJid: string, userText: string, pushName: string, rawMsgObj: any, adTextContext?: string) {
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
  // Importante: vendedor cadastrado nunca pode cair no fluxo de lead.
  // A equipe pertence ao usuario/loja; filtrar so por agent_id deixa passar vendedor
  // cadastrado em outro agente do mesmo usuario e cria lead indevido.
  const phoneNumber = remoteJid.replace(/@.*$/, '').replace(/\D/g, '');
  const { data: allTeamMembers } = await supabase.from('ai_team_members')
    .select('id, name, whatsapp_number, agent_id')
    .eq('user_id', agent.user_id)
    .eq('is_active', true);
  
  const normalizePhoneDigits = (p: string) => {
    const digits = String(p || '').replace(/\D/g, '');
    if (digits.startsWith('55') && digits.length >= 12) return digits.slice(2);
    return digits.replace(/^0+/, '');
  };

  const phoneVariants = (p: string) => {
    const base = normalizePhoneDigits(p);
    const variants = new Set<string>();
    if (!base) return variants;

    variants.add(base);
    if (base.length > 11) variants.add(base.slice(-11));
    if (base.length > 10) variants.add(base.slice(-10));
    if (base.length > 9) variants.add(base.slice(-9));
    // Brasil: alguns cadastros chegam com nono digito e outros sem.
    // Ex: 85999998888 <-> 8588888888.
    const local11 = base.slice(-11);
    if (local11.length === 11 && local11[2] === '9') {
      variants.add(`${local11.slice(0, 2)}${local11.slice(3)}`);
    }
    const local10 = base.slice(-10);
    if (local10.length === 10) {
      variants.add(`${local10.slice(0, 2)}9${local10.slice(2)}`);
    }

    return variants;
  };

  const senderVariants = phoneVariants(phoneNumber);
  console.log(`[Webhook] Sender phone variantes: "${Array.from(senderVariants).join('|')}" | Vendedores cadastrados: ${allTeamMembers?.map((m: any) => `${m.name}="${Array.from(phoneVariants(m.whatsapp_number)).join('|')}"`).join(', ')}`);
  const matchedSellers = (allTeamMembers || []).filter((m: any) => {
    const sellerVariants = phoneVariants(m.whatsapp_number);
    for (const variant of sellerVariants) {
      if (variant && senderVariants.has(variant)) return true;
    }
    return false;
  });
  const matchedSeller = matchedSellers[0];
  const matchedSellerIds = matchedSellers.map((m: any) => m.id);

  if (matchedSeller) {
    console.log(`[Webhook] Mensagem de VENDEDOR identificado: ${matchedSeller.name}. Verificando confirmacao de atendimento...`);
    const CONFIRMATION_KEYWORDS = ['ok', 'ta certo', 'tá certo', 'vou chamar', 'vou contatar', 'vou atender', 'certo', 'entendido', 'recebi', 'vou ligar', 'beleza', 'combinado', 'pode deixar', 'sim', 'perfeito', 'ok!', 'já ligo', 'ja ligo', 'vou ver', 'vou verificar', 'blz', 'joia', 'pronto', 'peguei', 'chamei', 'chamando', 'okay', 'atendendo', 'to indo', 'tô indo', 'estou indo', 'já peguei', 'ja peguei', 'pode mandar', 'manda', 'opa'];
    const normalizedText = normalizeBndvText(userText);
    const compactText = normalizedText.replace(/\s+/g, ' ').trim();
    const isShortAcknowledgement = compactText.length > 0 && compactText.length <= 12 && compactText.split(' ').length <= 3;
    const isConfirmation = CONFIRMATION_KEYWORDS.some(kw => normalizedText.includes(normalizeBndvText(kw))) || isShortAcknowledgement;
    
    if (isConfirmation) {
      console.log(`[Webhook] Vendedor ${matchedSeller.name} confirmou atendimento. Buscando lead para associar...`);
      
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      let assignedLeadId: string | null = null;
      let confirmedTransferId: string | null = null;

      // PASSO 1: Busca qualquer transferência NÃO confirmada das últimas 2h para este vendedor
      // Não filtra transfer_status porque registros antigos têm NULL neste campo
      const { data: recentTransfers } = await supabase
        .from('ai_lead_transfers')
        .select('id, lead_id, to_member_id, is_confirmed, transfer_status, created_at')
        .in('to_member_id', matchedSellerIds)
        .neq('is_confirmed', true) // não confirmada = pendente para aceite
        .gte('created_at', twoHoursAgo)
        .order('created_at', { ascending: false })
        .limit(10);

      console.log(`[Webhook] Transferências recentes para ${matchedSeller.name}: ${JSON.stringify(recentTransfers?.map(t => ({id: t.id, lead_id: t.lead_id, confirmed: t.is_confirmed, status: t.transfer_status})))}`);

      if (recentTransfers && recentTransfers.length > 0) {
        const transfer = recentTransfers.find((t: any) => !t.transfer_status || t.transfer_status === 'pending') || recentTransfers[0];
        assignedLeadId = transfer.lead_id;
        confirmedTransferId = transfer.id;
        if (transfer.to_member_id) {
          const transferSeller = matchedSellers.find((m: any) => m.id === transfer.to_member_id);
          if (transferSeller) {
            console.log(`[Webhook] Confirmacao associada ao cadastro correto do vendedor: ${transferSeller.name} (${transferSeller.id})`);
          }
        }
      }

      // PASSO 2 (FALLBACK): Se não achar pela tabela de transferências, busca direto no CRM
      // Procura qualquer lead atribuído a este vendedor que ainda não foi para 'transferido' ou 'encerrado'
      if (!assignedLeadId) {
        console.log(`[Webhook] Sem transferência recente. Buscando lead no CRM atribuído a ${matchedSeller.name}...`);
        const { data: crmLead } = await supabase
          .from('ai_crm_leads')
          .select('id, status')
          .in('assigned_to_id', matchedSellerIds)
          .in('status', ['qualificado', 'interessado', 'novo'])
          .order('last_interaction_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (crmLead) {
          assignedLeadId = crmLead.id;
          console.log(`[Webhook] Lead encontrado via CRM fallback: ${crmLead.id} (status: ${crmLead.status})`);
        }
      }

      if (assignedLeadId) {
        // Atualizar o CRM com o vendedor como responsável e status = transferido
        const confirmationTime = new Date().toISOString();
        const updateData = {
          status: 'transferido',
          assigned_to_id: (recentTransfers?.find((t: any) => t.id === confirmedTransferId)?.to_member_id || matchedSeller.id),
          last_interaction_at: confirmationTime
        };
        const { error: updateErr } = await supabase.from('ai_crm_leads').update(updateData).eq('id', assignedLeadId);
        if (updateErr) console.error(`[Webhook] Erro ao atualizar CRM:`, updateErr);

        if (supabaseNew) {
          try { await supabaseNew.from('ai_crm_leads').update(updateData).eq('id', assignedLeadId); } catch(e) { console.warn('[CRM Mirror] confirm falhou:', e); }
        }

        // Marcar a transferência como confirmada
        if (confirmedTransferId) {
          await supabase.from('ai_lead_transfers').update({
            is_confirmed: true,
            confirmed_at: confirmationTime,
            transfer_status: 'confirmed'
          }).eq('id', confirmedTransferId);
        } else {
          // Marcar todas as transferências pendentes deste lead para este vendedor como confirmadas
          await supabase.from('ai_lead_transfers').update({
            is_confirmed: true,
            confirmed_at: confirmationTime,
            transfer_status: 'confirmed'
          }).eq('lead_id', assignedLeadId).in('to_member_id', matchedSellerIds).neq('is_confirmed', true);
        }

        console.log(`[Webhook] ✅ Lead ${assignedLeadId} → TRANSFERIDO para ${matchedSeller.name}`);
        const baseUrl = (waInstance.api_url || Deno.env.get('EVOLUTION_API_URL') || '').replace(/\/$/, '');
        const instKey = waInstance.api_key_encrypted || Deno.env.get('EVOLUTION_API_KEY') || '';
        await sendUazapiTextMessage(baseUrl, instKey, instanceName, remoteJid.split('@')[0], remoteJid, `✅ *Atendimento Confirmado!*\n\nO lead foi atribuído a você no CRM. Pode seguir com a venda! 🚀`);
      } else {
        console.log(`[Webhook] ⚠️ Vendedor ${matchedSeller.name} confirmou, mas não encontrei nenhum lead para associar.`);
        const baseUrl = (waInstance.api_url || Deno.env.get('EVOLUTION_API_URL') || '').replace(/\/$/, '');
        const instKey = waInstance.api_key_encrypted || Deno.env.get('EVOLUTION_API_KEY') || '';
        await sendUazapiTextMessage(baseUrl, instKey, instanceName, remoteJid.split('@')[0], remoteJid, `⚠️ *Atenção!*\n\nNão encontrei um lead pendente para confirmar agora. Se ele já foi repassado, o atendimento segue com outro vendedor. Se quiser, eu posso conferir novamente.`);
      }
    }
    return new Response(JSON.stringify({ ok: true, seller_message: true }), { headers: corsHeaders });
  }
  console.log(`[Webhook] Remetente nao e vendedor. Processando como lead...`);


  // Verificar se o lead existe no CRM. Se nao existe (ou foi apagado), limpar o historico para comecar do zero
  const { data: leadExists } = await supabase.from('ai_crm_leads').select('id, status, assigned_to_id').eq('agent_id', agent.id).eq('remote_jid', remoteJid).maybeSingle();
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

  const updatePayload: any = { 
    last_interaction_at: nowStr,
    last_user_reply_at: nowStr, 
    followup_5min_sent: false 
  };
  await supabase.from('ai_crm_leads').update(updatePayload).eq('agent_id', agent.id).eq('remote_jid', remoteJid);
  if (supabaseNew) {
    try { await supabaseNew.from('ai_crm_leads').update(updatePayload).eq('agent_id', agent.id).eq('remote_jid', remoteJid); } catch(e) { console.warn('[CRM Mirror] update followup falhou:', e); }
  }

  // Tools — descrições naturais, sem comandos imperativos
  // A IA decide quando usar cada ferramenta baseada na personalidade e no contexto da conversa
  const tools = [
    {
      type: "function",
      function: {
        name: "consultar_estoque_bndv",
        description: "Acessa o estoque BNDV em tempo real com busca inteligente/tolerante a erro de leitura, variacao de versao, ano incorreto e OCR de anuncio. Retorna veiculos disponiveis com modelo, versao, ano, km, preco e combustivel. Use sempre que o lead vier de anuncio ou perguntar disponibilidade. Nunca declare que nao ha estoque se a ferramenta retornar candidatos: candidatos aproximados devem ser tratados como opcoes provaveis/compativeis e confirmados de forma humana.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Nome do modelo a buscar, ex: 'Chevrolet Onix' ou 'Jeep Renegade'. Use apenas marca e modelo." },
            marca: { type: "string", description: "Marca, ex: Chevrolet, Jeep, Fiat." },
            modelo: { type: "string", description: "Modelo, ex: Onix, Renegade, Strada." },
            versao: { type: "string", description: "Versão específica, ex: ACTIV, LTZ, LONGITUDE." },
            combustivel: { type: "string", description: "Combustível preferido, ex: Flex, Diesel." },
            cambio: { type: "string", description: "Câmbio preferido, ex: Automatico, Manual." },
            cor: { type: "string", description: "Cor preferida." },
            ano_min: { type: "number", description: "Ano mínimo." },
            ano_max: { type: "number", description: "Ano máximo." },
            preco_max: { type: "number", description: "Preço máximo em reais." },
            km_max: { type: "number", description: "Quilometragem máxima." },
            limite: { type: "number", description: "Número máximo de resultados." }
          },
          additionalProperties: false
        }
      }
    },
    {
        type: "function",
        function: {
          name: "enviar_fotos_bndv",
          description: "Envia fotos de um veículo específico do estoque diretamente no WhatsApp do cliente. Use quando o cliente pedir para ver o carro. No envio padrão, o sistema já manda uma combinação equilibrada com frente, traseira, lateral e interior. IMPORTANTE SOBRE FOTOS DE INTERIOR: no padrão atual do BNDV, a foto da roda costuma aparecer antes do interior. Se o cliente pedir 'fotos de dentro' ou 'interior', use offset_fotos=7 para priorizar as fotos internas. Se pedir 'mais fotos', use offset_fotos=7. Sempre passe os detalhes do veículo para garantir que enviará as fotos do carro certo.",
          parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Nome completo do veículo, ex: 'Chevrolet Onix ACTIV 1.4 2019'." },
            marca: { type: "string", description: "Marca do veículo." },
            modelo: { type: "string", description: "Modelo do veículo." },
            versao: { type: "string", description: "Versão exata, ex: ACTIV, LTZ, LONGITUDE." },
            ano_min: { type: "number", description: "Ano mínimo." },
            ano_max: { type: "number", description: "Ano máximo." },
            preco_max: { type: "number", description: "Preço máximo." },
            quantidade_fotos: { type: "number", description: "Quantidade de fotos. Use 5 para o cliente ver bem." },
            offset_fotos: { type: "number", description: "Quantas fotos pular do início. Use 6 para acessar fotos de interior, 0 para fotos externas." }
          },
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "atualizar_etapa_crm",
        description: "Registra a evolução do lead no CRM interno. Não é visível para o cliente. Use 'interessado' quando o cliente demonstrar interesse claro em algum carro, 'qualificado' quando demonstrar intenção de compra ou pedir para falar com um vendedor humano (o sistema notifica o vendedor automaticamente), e 'encerrado' quando o cliente desistir ou não tiver mais interesse.",
        parameters: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["interessado", "qualificado", "encerrado"], description: "Etapa atual do lead." },
            resumo: { type: "string", description: "Breve resumo da situação atual do lead para registro interno." }
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

  // --- DEDUPLICACAO DE MENSAGENS ---
  if (messageId) {
    const { data: existingMsg } = await supabase.from('wa_inbox')
      .select('id')
      .eq('remote_message_id', messageId)
      .maybeSingle();
    
    if (existingMsg) {
      console.log(`[Webhook] MENSAGEM DUPLICADA DETECTADA (ID: ${messageId}). Ignorando.`);
      const corsH = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
      return new Response('Duplicate message ignored', { headers: corsH, status: 200 });
    }
  }

  const baseUrl = (waInstance.api_url || Deno.env.get('EVOLUTION_API_URL') || '').replace(/\/$/, '')
  const instKey = waInstance.api_key_encrypted || Deno.env.get('EVOLUTION_API_KEY') || ''
  // phoneNumber ja declarado acima na verificacao de vendedores
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiApiKey) return new Response('Missing AI Key', { status: 500 })

  const normalizedAdTextContext = String(adTextContext || '').trim();
  const hasAdTextContext = normalizedAdTextContext.length > 0;

  const injectAdContextIntoUserContent = (content: any) => {
    if (!hasAdTextContext) return content;

    const adInstruction = `CONTEXTO PRIORITÁRIO DO ANÚNCIO: ${normalizedAdTextContext}

O lead veio diretamente desse anúncio e o veículo anunciado deve ser tratado como o ponto de partida da conversa.
Antes de responder de forma substantiva, identifique o carro do anúncio e consulte o estoque BNDV para esse veículo. A leitura da imagem pode errar letras ou versão; por isso, use uma busca ampla com marca/modelo/ano quando possível e considere a opção mais próxima retornada pela ferramenta antes de dizer que não há estoque.
Se o cliente pedir fotos, trabalhe em cima desse mesmo veículo identificado no anúncio ou no melhor candidato aproximado retornado pelo BNDV.
Responda de forma humana, comercial e natural, sem mencionar que você "não abre links" se já houver contexto suficiente do anúncio.
`;

    if (Array.isArray(content)) {
      const alreadyHasInstruction = content.some((part: any) =>
        part?.type === 'text' &&
        typeof part?.text === 'string' &&
        part.text.includes('CONTEXTO PRIORITÁRIO DO ANÚNCIO:')
      );
      if (alreadyHasInstruction) return content;
      return [
        { type: 'text', text: adInstruction },
        ...content,
      ];
    }

    if (typeof content === 'string') {
      if (content.includes('CONTEXTO PRIORITÁRIO DO ANÚNCIO:')) return content;
      return `${adInstruction}\nMensagem do lead: ${content}`;
    }

    return content;
  };

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
          formData.append('prompt', 'Jeep, Compass, Renegade, Commander, Fiat, Toro, Argo, Pulse, Fastback, Volkswagen, Nivus, T-Cross, Chevrolet, Onix, Tracker, automotivo, carro, seminovo, automático, financiamento, concessionária, valor, repasse, tabela fipe');
          
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

  userMessageContentForOpenAi = injectAdContextIntoUserContent(userMessageContentForOpenAi);

  if (hasAdTextContext) {
    console.log('[Webhook] Contexto de anúncio injetado no prompt da IA:', normalizedAdTextContext);
  }

  console.log(`[Webhook] Salvando historico e chamando OpenAI para: ${finalUserText}`);

  // Salvar historico
  const { data: insertedChat, error: chatError } = await supabase.from('wa_chat_history').insert({
    user_id: agent.user_id,
    agent_id: agent.id,
    instance_id: instanceName,
    remote_jid: remoteJid,
    role: 'user',
    content: typeof userMessageContentForOpenAi === 'string' ? finalUserText : '[Midia/Imagem]',
    lead_name: pushName
  }).select('id, created_at').single();

  if (chatError) {
    console.error('[Webhook] Erro ao salvar historico:', chatError.message);
  }

  const insertedId = insertedChat?.id;

  // --- BUFFER DE MENSAGENS (Human-like behavior) ---
  // Aguarda 4 segundos para ver se o lead manda mais mensagens em sequencia.
  // Apenas a ULTIMA mensagem da sequencia prosseguira para gerar a resposta da IA.
  console.log(`[Webhook] Aguardando buffer de 4s para ${remoteJid}...`);
  await new Promise(r => setTimeout(r, 4000));

  // Verifica se esta ainda e a ultima mensagem enviada pelo usuario
  const { data: lastUserMsg } = await supabase.from('wa_chat_history')
    .select('id')
    .eq('agent_id', agent.id)
    .eq('remote_jid', remoteJid)
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastUserMsg && insertedId && lastUserMsg.id !== insertedId) {
    console.log(`[Webhook] Outra mensagem chegou depois. Esta instancia (${insertedId}) sera encerrada para evitar respostas duplas.`);
    return new Response('Buffered', { headers: corsHeaders });
  }

  // --- AI LOCK MECHANISM ---
  // Prevent double processing if a message arrives right after the buffer finishes
  const { data: lockMsg } = await supabase.from('wa_chat_history')
    .select('created_at')
    .eq('agent_id', agent.id)
    .eq('remote_jid', remoteJid)
    .eq('role', 'system')
    .eq('content', '[AI_LOCK]')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lockMsg) {
    const lockAgeMs = Date.now() - new Date(lockMsg.created_at).getTime();
    if (lockAgeMs < 15000) { // Lock is less than 15 seconds old
      console.log(`[Webhook] IA ja esta gerando resposta (Lock ativo: ${lockAgeMs}ms). Abortando instancia ${insertedId}.`);
      return new Response('Locked', { headers: corsHeaders });
    }
  }

  // Set the lock
  await supabase.from('wa_chat_history').insert({
    agent_id: agent.id,
    remote_jid: remoteJid,
    role: 'system',
    content: '[AI_LOCK]'
  });

  // Se chegou aqui, somos a instancia encarregada de responder.
  // Vamos buscar todas as mensagens do usuario que chegaram desde a ultima resposta da IA.
  const { data: leadData } = await supabase.from('ai_crm_leads')
    .select('last_agent_reply_at')
    .eq('agent_id', agent.id)
    .eq('remote_jid', remoteJid)
    .maybeSingle();

  const lastReplyAt = leadData?.last_agent_reply_at || new Date(0).toISOString();
  
  // Atualiza last_agent_reply_at AGORA para evitar que outros webhooks peguem as mesmas mensagens
  await supabase.from('ai_crm_leads').update({ last_agent_reply_at: new Date().toISOString() })
    .eq('agent_id', agent.id).eq('remote_jid', remoteJid);

  const { data: recentUserMsgs } = await supabase.from('wa_chat_history')
    .select('content')
    .eq('agent_id', agent.id)
    .eq('remote_jid', remoteJid)
    .eq('role', 'user')
    .gt('created_at', lastReplyAt)
    .order('created_at', { ascending: true });

  let combinedUserText = finalUserText;
  if (recentUserMsgs && recentUserMsgs.length > 1) {
    combinedUserText = recentUserMsgs.map((m: any, idx: number) => `${idx + 1}. ${m.content}`).join('\n');
    userMessageContentForOpenAi = `[O lead enviou ${recentUserMsgs.length} mensagens em sequência]:\n${combinedUserText}`;
    console.log(`[Webhook] Mensagens combinadas para processamento: ${recentUserMsgs.length}`);
  }

  userMessageContentForOpenAi = injectAdContextIntoUserContent(userMessageContentForOpenAi);

  // Salvar mensagem RECEBIDA no wa_inbox (para aparecer no Inbox do Marcos)
  await supabase.from('wa_inbox').insert({
    user_id: waInstance.user_id,
    instance_id: waInstance.id,
    phone: phoneNumber,
    contact_name: pushName || null,
    direction: 'incoming',
    message_type: (msgType.includes('audio') || msgType === 'ptt') ? 'audio' : (msgType.includes('image') ? 'image' : 'text'),
    content: typeof userMessageContentForOpenAi === 'string' ? finalUserText : '[Mídia recebida]',
    is_read: false,
    remote_message_id: messageId || null,
  }).then(({ error }: any) => {
    if (error) console.error('[uazapi-webhook] wa_inbox incoming insert error:', error.message);
  });

  // Buscar histórico - CRÍTICO: filtrar por agent_id + remote_jid para não misturar conversas
  const { data: history } = await supabase.from('wa_chat_history')
    .select('role, content').eq('agent_id', agent.id).eq('remote_jid', remoteJid).order('created_at', { ascending: false }).limit(12)

  const chatHistory = (history || []).reverse().map((m: any) => ({ role: m.role, content: m.content }))

  // RAG - Busca Base de Conhecimento
  // Usa apenas o texto limpo do usuário (sem contexto de anúncio injetado) para embedding preciso
  const cleanUserTextForEmbedding = userText
    .replace(/\[ANÚNCI0[^\]]*\]/g, '')
    .replace(/\[Lead enviou link[^\]]*\]/g, '')
    .replace(/\(INSTRUÇÃO OBRIGATÓRIA:[^)]*\)/g, '')
    .replace(/\(NOTA PARA IA:[^)]*\)/g, '')
    .trim()
    .slice(0, 2000) || userText.slice(0, 2000);

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
          body: JSON.stringify({ model: 'text-embedding-3-small', input: cleanUserTextForEmbedding })
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

  // ─── SYSTEM PROMPT: apenas o prompt do agente + base de conhecimento ────────────────
  // O prompt configurado pelo usuário no cadastro do agente é a ÚNICA fonte de personalidade.
  // Não há regras internas, não há instruções de comportamento impostas pelo sistema.
  // As ferramentas são acessíveis e a IA decide quando e como usá-las, igual a um consultor humano.
  let systemPrompt = agent.system_prompt || 'Você é um consultor de vendas prestativo e atencioso.';
  if (agent.company_name) systemPrompt += `\n\nEmpresa/Loja: ${agent.company_name}`;

  // Terminologia e Gírias Automotivas (Global)
  systemPrompt += `\n\n(TERMINOLOGIA AUTOMOTIVA: Entenda "Caminhonete", "Camionete" ou "Picape" como a mesma categoria. Isso inclui picapes pequenas como Fiat Strada e VW Saveiro, médias como Toyota Hilux e Chevrolet S10, e grandes como a linha RAM. Se o cliente pedir caminhonete, busque e ofereça TODAS as picapes disponíveis no estoque, incluindo Strada e Toro, e JAMAIS diga que não tem se houver qualquer uma dessas disponíveis.)`;

  // Base de conhecimento: contexto de apoio, não como regra
  if (knowledgeContext) {
    systemPrompt += `\n\n${knowledgeContext}`;
  }

  if (hasAdTextContext) {
    systemPrompt += `\n\n(CONTEXTO DO ANUNCIO META/FACEBOOK/INSTAGRAM: ${normalizedAdTextContext}. Considere este anuncio como o veiculo de interesse principal do lead. A leitura visual pode trocar letras, como Cresta/Creta, ou misturar versao/modelo/ano. Consulte o estoque BNDV com busca ampla antes de sugerir outros carros. Se a ferramenta retornar QUALQUER candidato compativel ou provavel, nunca diga que nao temos ou que saiu de estoque; responda como consultor humano: "encontrei esse aqui no estoque" ou "achei uma opcao muito proxima", confirmando ano/versao/preco com naturalidade.)`;
  }

  // Contexto situacional: apenas quando o lead já foi transferido
  const lastTransferAt = leadExists?.last_interaction_at ? new Date(leadExists.last_interaction_at).getTime() : 0;
  const hoursSinceTransfer = (Date.now() - lastTransferAt) / (1000 * 60 * 60);
  if (leadExists && (leadExists.status === 'qualificado' || leadExists.status === 'transferido') && leadExists.assigned_to_id && hoursSinceTransfer < 24) {
    const { data: sellerData } = await supabase.from('ai_team_members').select('name').eq('id', leadExists.assigned_to_id).maybeSingle();
    if (sellerData) {
      systemPrompt += `\n\n(Contexto: ${sellerData.name} já foi notificado e assumirá este atendimento em breve.)`;
    }
  }

  let aiModel = agent.model || 'gpt-4o'; // gpt-4o para raciocínio completo e conversa natural
  if (aiModel.startsWith('openai/')) aiModel = aiModel.replace('openai/', '');
  else if (aiModel.includes('google/') || aiModel.includes('anthropic/')) {
    console.log(`[Webhook] Modelo externo detectado (${aiModel}), usando gpt-4o.`);
    aiModel = 'gpt-4o';
  }

  const mediaFallbackReply = getUazapiMediaFallbackReply(finalUserText);
  let aiMessage: any = null;
  let aiResponse = mediaFallbackReply || '';

  if (!mediaFallbackReply) {
    let iterations = 0;
    const maxIterations = 4; // aumentado para permitir mais tool calls em sequencia

    // Montar as mensagens de forma limpa
    const buildMessages = () => {
      const msgs: any[] = [{ role: 'system', content: systemPrompt }];

      if (hasAdTextContext) {
        msgs.push({
          role: 'system',
          content: `Origem do lead: ${normalizedAdTextContext}. Priorize o carro do anúncio e consulte o estoque antes de responder.`,
        });
      }

      msgs.push(...chatHistory);
      msgs.push({ role: 'user', content: userMessageContentForOpenAi });
      return msgs;
    };

    let currentMessages: any[] = buildMessages();

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
          tool_choice: hasAdTextContext && iterations === 1
            ? { type: "function", function: { name: "consultar_estoque_bndv" } }
            : "auto"
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
            lead_name: pushName,
            assigned_to_id: existingLead?.assigned_to_id || null
          };
          await supabase.from('ai_crm_leads').upsert(crmStatusPayload, { onConflict: 'agent_id, remote_jid' });
          if (supabaseNew) {
            try { await supabaseNew.from('ai_crm_leads').upsert(crmStatusPayload, { onConflict: 'agent_id, remote_jid' }); } catch(e) { console.warn('[CRM Mirror] tool upsert falhou:', e); }
          }

          console.log(`[CRM] Lead ${phoneNumber} analisado. Status: ${args.status}`);

          if (args.status === 'qualificado') {
            // Verificar se já existe uma transferência PENDENTE para esse lead.
            // Isso previne dupla-notificação quando a IA chama a ferramenta duas vezes.
            const { data: existingTransfer } = await supabase.from('ai_lead_transfers')
              .select('id, to_member_id')
              .eq('lead_id', (await supabase.from('ai_crm_leads').select('id').eq('agent_id', agent.id).eq('remote_jid', remoteJid).maybeSingle()).data?.id || '')
              .eq('is_confirmed', false)
              .eq('transfer_status', 'pending')
              .maybeSingle();

            if (existingTransfer) {
              console.log(`[CRM] Lead já tem transferência pendente (id: ${existingTransfer.id}). Pulando round-robin duplicado.`);
            } else {
            let selectedSeller = null;

            // Tentar manter o mesmo vendedor se o lead ja estiver designado e o vendedor estiver ativo
            if (existingLead && existingLead.assigned_to_id) {
              const { data: currentSeller } = await supabase.from('ai_team_members').select('*').eq('id', existingLead.assigned_to_id).eq('is_active', true).maybeSingle();
              if (currentSeller) {
                selectedSeller = currentSeller;
                console.log(`[CRM] Lead recorrente. Re-notificando vendedor designado: ${selectedSeller.name}`);
              }
            }

            // Se nao tiver vendedor ou o anterior estiver inativo, fazer round-robin
            if (!selectedSeller) {
              const { data: sellers } = await supabase.from('ai_team_members').select('*').eq('user_id', agent.user_id).eq('is_active', true).order('last_lead_received_at', { ascending: true, nullsFirst: true });
              if (sellers && sellers.length > 0) {
                const seenSellerPhones = new Set<string>();
                const uniqueSellers = sellers.filter((seller: any) => {
                  const variants = Array.from(phoneVariants(seller.whatsapp_number)).sort();
                  const phoneKey = variants[0] || String(seller.id);
                  if (seenSellerPhones.has(phoneKey)) return false;
                  seenSellerPhones.add(phoneKey);
                  return true;
                });
                selectedSeller = uniqueSellers[0];
              }
            }

            if (selectedSeller) {
              let sellerNum = String(selectedSeller.whatsapp_number || '').replace(/\D/g, '');
              if (sellerNum.length === 10 || sellerNum.length === 11) sellerNum = `55${sellerNum}`;
              if (sellerNum) {
                // Buscar TODAS as mensagens desta conversa específica para o resumo da IA
                const { data: fullChat } = await supabase.from('wa_chat_history')
                  .select('role, content, created_at')
                  .eq('agent_id', agent.id)
                  .eq('remote_jid', remoteJid)
                  .order('created_at', { ascending: true })
                  .limit(30);

                // Gerar resumo inteligente via IA (call dedicado)
                let aiGeneratedSummary = args.resumo || 'Lead qualificado pela IA.';
                try {
                  const chatTranscript = (fullChat || []).map((m: any) =>
                    `${m.role === 'user' ? `Cliente (${pushName})` : 'Agente IA'}: ${String(m.content || '').substring(0, 500)}`
                  ).join('\n');

                  const summaryRes = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
                    body: JSON.stringify({
                      model: 'gpt-4o-mini',
                      temperature: 0.3,
                      messages: [
                        {
                          role: 'system',
                          content: `Você é um analista de vendas especialista em mercado automotivo. Sua função é ler a conversa entre um cliente e um agente de IA de uma concessionária e gerar um briefing COMPLETO e OBJETIVO para o vendedor humano que vai assumir o atendimento agora.

O briefing deve ser em português, direto ao ponto, e conter EXATAMENTE estas seções:

🚗 *VEÍCULO DE INTERESSE:* (qual carro específico o cliente demonstrou interesse - marca, modelo, versão, ano se mencionado)
📢 *ORIGEM DO LEAD:* (se veio de anúncio do Meta/Facebook/Instagram, mencionar o produto anunciado. Se foi busca orgânica, dizer isso.)
👤 *PERFIL DO CLIENTE:* (nível de interesse: alto/médio/baixo, urgência percebida, se tem carro para troca, situação financeira mencionada, etc.)
💡 *DICA PARA O VENDEDOR:* (1-2 frases objetivas de como abordar este cliente para fechar a venda com base no que foi conversado)

Seja cirúrgico. Não invente informações. Se algo não foi mencionado na conversa, escreva "Não mencionado".`
                        },
                        {
                          role: 'user',
                          content: `Conversa completa:\n\n${chatTranscript}\n\nGere o briefing para o vendedor.`
                        }
                      ]
                    })
                  });
                  if (summaryRes.ok) {
                    const summaryData = await summaryRes.json();
                    const generatedText = summaryData.choices?.[0]?.message?.content;
                    if (generatedText) aiGeneratedSummary = generatedText;
                  }
                } catch(summaryErr) {
                  console.error('[CRM] Falha ao gerar resumo inteligente da IA:', summaryErr);
                }

                const { data: leadData } = await supabase
                  .from('ai_crm_leads')
                  .select('id')
                  .eq('agent_id', agent.id)
                  .eq('remote_jid', remoteJid)
                  .maybeSingle();

                if (!leadData?.id) {
                  console.error(`[CRM] Lead ${phoneNumber} não encontrado para atribuição antes do envio ao vendedor.`);
                } else {
                  const assignmentTime = new Date().toISOString();
                  const assignData = {
                    status: 'qualificado',
                    assigned_to_id: selectedSeller.id,
                    followup_5min_sent: true,
                    last_interaction_at: assignmentTime
                  };

                  await supabase.from('ai_crm_leads').update(assignData).eq('id', leadData.id);
                  if (supabaseNew) {
                    try {
                      await supabaseNew.from('ai_crm_leads').update(assignData).eq('id', leadData.id);
                    } catch(e) {
                      console.warn('[CRM Mirror] tool update assign falhou:', e);
                    }
                  }

                  await supabase.from('ai_lead_transfers').insert({
                    user_id: agent.user_id,
                    lead_id: leadData.id,
                    to_member_id: selectedSeller.id,
                    transfer_reason: args.resumo,
                    notes: `Transferido para ${selectedSeller.name} via round-robin`,
                    transfer_status: 'pending',
                    is_confirmed: false,
                    confirmation_timeout_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                  });

                  const sellerMsg = `🔥 *LEAD QUALIFICADO — ATENDIMENTO IMEDIATO*\n\n👤 *Cliente:* ${pushName}\n📱 *Contato:* +${phoneNumber}\n🤖 *Agente IA:* ${agent.name}\n\n━━━━━━━━━━━━━━━━━━━━\n📊 *ANÁLISE DO LEAD PELA IA:*\n${aiGeneratedSummary}\n\n━━━━━━━━━━━━━━━━━━━━\n\n👉 *Atender agora:* https://wa.me/${phoneNumber}\n\n*Responda "Ok" para assumir este atendimento!* ⏳`;
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
                      last_lead_received_at: assignmentTime,
                    }).eq('id', selectedSeller.id);

                    console.log(`[CRM] Lead ${phoneNumber} transferred to seller: ${selectedSeller.name}`);
                  }
                }
              } else {
                console.error(`[CRM] Vendedor ${selectedSeller.name} sem numero de WhatsApp configurado.`);
              }
            }
            } // fim do else (sem transferência pendente duplicada)
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
          if (hasAdTextContext) {
            args.query = args.query || normalizedAdTextContext;
            args.limite = args.limite || 8;
          }
          const stockResult = await consultarEstoqueBndv(supabase, agent.user_id, args, {
            openaiApiKey,
            adTextContext: normalizedAdTextContext,
          });
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
            { baseUrl, instKey, instanceName, phoneNumber, remoteJid },
            { openaiApiKey, adTextContext: normalizedAdTextContext }
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

  // Salvar resposta do AGENTE IA no wa_inbox (para aparecer no Inbox do Marcos)
  await supabase.from('wa_inbox').insert({
    user_id: waInstance.user_id,
    instance_id: waInstance.id,
    phone: phoneNumber,
    contact_name: pushName || null,
    direction: 'outgoing',
    message_type: 'text',
    content: aiResponse,
    is_read: true,
    ai_category: 'agent',
  }).then(({ error }: any) => {
    if (error) console.error('[uazapi-webhook] wa_inbox outgoing insert error:', error.message);
  });

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
