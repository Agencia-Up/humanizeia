import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GRAPH = 'https://graph.facebook.com/v21.0';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Não autorizado');
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Token inválido');

    const body = await req.json();
    const { action } = body;

    if (action === 'generate_carousel') return await generateCarousel(body, corsHeaders);
    if (action === 'publish_post')      return await publishPost(supabase, user.id, body.post_id, corsHeaders);
    if (action === 'publish_reel')      return await publishReel(supabase, user.id, body, corsHeaders);
    if (action === 'publish_story')     return await publishStory(supabase, user.id, body, corsHeaders);
    if (action === 'get_post_insights') return await getPostInsights(supabase, user.id, body.post_id, corsHeaders);
    if (action === 'get_ig_account')    return await getIgAccount(supabase, user.id, corsHeaders);
    if (action === 'check_container')   return await checkContainerStatus(body.container_id, body.access_token, corsHeaders);

    throw new Error(`Ação desconhecida: ${action}`);

  } catch (err: any) {
    console.error('social-media-api error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Busca credenciais Instagram da conta conectada */
async function getIgCredentials(supabase: any, userId: string) {
  const { data: igAcct } = await supabase
    .from('connected_accounts' as any)
    .select('*')
    .eq('user_id', userId)
    .eq('platform', 'instagram_publisher')
    .maybeSingle();

  if (!igAcct) throw new Error('Conta Instagram não conectada. Conecte em Configurações → Integrações.');

  // page_token é preferível para publicação (não expira)
  const accessToken = igAcct.extra_data?.page_token || igAcct.access_token_encrypted;
  const igUserId    = igAcct.extra_data?.ig_user_id  || igAcct.account_id;

  if (!igUserId)    throw new Error('Instagram Business Account ID não encontrado. Reconecte sua conta.');
  if (!accessToken) throw new Error('Token de acesso inválido. Reconecte sua conta Instagram.');

  return { accessToken, igUserId };
}

/**
 * Aguarda o container ficar pronto (status FINISHED).
 * Faz polling por até 60 segundos.
 */
async function waitForContainer(containerId: string, accessToken: string): Promise<void> {
  const maxAttempts = 12;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000)); // 5s entre tentativas
    const res  = await fetch(`${GRAPH}/${containerId}?fields=status_code&access_token=${accessToken}`);
    const data = await res.json();
    console.log(`[IG] Container ${containerId} status: ${data.status_code} (tentativa ${i + 1})`);
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR')    throw new Error(`Erro no container de mídia: ${JSON.stringify(data)}`);
  }
  throw new Error('Timeout: container de mídia não ficou pronto em 60s.');
}

/** Verifica status de um container (ação exposta ao frontend) */
async function checkContainerStatus(containerId: string, accessToken: string, cors: Record<string, string>) {
  const res  = await fetch(`${GRAPH}/${containerId}?fields=status_code,status&access_token=${accessToken}`);
  const data = await res.json();
  return new Response(JSON.stringify(data), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

// ─── Publicação: Post (Imagem / Carrossel) ──────────────────────────────────

async function publishPost(supabase: any, userId: string, postId: string, cors: Record<string, string>) {
  const { data: post, error: postError } = await supabase
    .from('social_posts')
    .select('*')
    .eq('id', postId)
    .eq('user_id', userId)
    .single();

  if (postError || !post) throw new Error('Post não encontrado');

  const { accessToken, igUserId } = await getIgCredentials(supabase, userId);
  const caption = buildCaption(post.caption, post.hashtags);

  try {
    let mediaId: string;

    if (post.post_type === 'carousel' && post.media_urls?.length > 1) {
      // ── Carrossel ──────────────────────────────────────────────────────────
      const childIds: string[] = [];
      for (const url of post.media_urls) {
        const r = await fetch(`${GRAPH}/${igUserId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: url, is_carousel_item: true, access_token: accessToken }),
        });
        const d = await r.json();
        if (!d.id) throw new Error(`Erro ao criar item do carrossel: ${JSON.stringify(d)}`);
        childIds.push(d.id);
      }

      const containerRes = await fetch(`${GRAPH}/${igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'CAROUSEL',
          caption,
          children: childIds.join(','),
          access_token: accessToken,
        }),
      });
      const container = await containerRes.json();
      if (!container.id) throw new Error(`Erro ao criar container: ${JSON.stringify(container)}`);
      mediaId = container.id;

    } else {
      // ── Imagem única ────────────────────────────────────────────────────────
      const imageUrl = post.media_urls?.[0];
      if (!imageUrl) throw new Error('Nenhuma imagem encontrada no post');

      const mediaRes = await fetch(`${GRAPH}/${igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl, caption, access_token: accessToken }),
      });
      const media = await mediaRes.json();
      if (!media.id) throw new Error(`Erro ao criar mídia: ${JSON.stringify(media)}`);
      mediaId = media.id;
    }

    // Aguarda container ficar pronto
    await waitForContainer(mediaId, accessToken);

    // Publica
    const pubRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: mediaId, access_token: accessToken }),
    });
    const pub = await pubRes.json();
    if (!pub.id) throw new Error(`Erro ao publicar: ${JSON.stringify(pub)}`);

    await supabase.from('social_posts').update({
      status:       'published',
      published_at: new Date().toISOString(),
      ig_media_id:  pub.id,
    }).eq('id', postId);

    return new Response(JSON.stringify({ success: true, ig_media_id: pub.id }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    await supabase.from('social_posts').update({ status: 'failed' }).eq('id', postId);
    throw err;
  }
}

// ─── Publicação: Reel ───────────────────────────────────────────────────────

async function publishReel(supabase: any, userId: string, body: any, cors: Record<string, string>) {
  /**
   * Parâmetros esperados em body:
   * - video_url: string (URL pública do vídeo MP4/MOV)
   * - caption: string
   * - cover_url?: string (thumbnail opcional)
   * - share_to_feed?: boolean (padrão: true)
   */
  const { video_url, caption, cover_url, share_to_feed = true } = body;
  if (!video_url) throw new Error('video_url é obrigatório para publicar Reel');

  const { accessToken, igUserId } = await getIgCredentials(supabase, userId);

  // 1. Cria container de Reel
  const payload: Record<string, unknown> = {
    media_type:    'REELS',
    video_url,
    caption,
    share_to_feed,
    access_token:  accessToken,
  };
  if (cover_url) payload.cover_url = cover_url;

  const containerRes = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const container = await containerRes.json();
  if (!container.id) throw new Error(`Erro ao criar container do Reel: ${JSON.stringify(container)}`);

  console.log('[IG] Container Reel criado:', container.id);

  // 2. Aguarda processamento (vídeos demoram mais)
  await waitForContainer(container.id, accessToken);

  // 3. Publica
  const pubRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: container.id, access_token: accessToken }),
  });
  const pub = await pubRes.json();
  if (!pub.id) throw new Error(`Erro ao publicar Reel: ${JSON.stringify(pub)}`);

  console.log('[IG] Reel publicado! ID:', pub.id);

  return new Response(JSON.stringify({ success: true, ig_media_id: pub.id, type: 'reel' }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// ─── Publicação: Story ──────────────────────────────────────────────────────

async function publishStory(supabase: any, userId: string, body: any, cors: Record<string, string>) {
  /**
   * Parâmetros esperados em body:
   * - media_url: string (URL pública — imagem JPEG ou vídeo MP4)
   * - media_type: 'IMAGE' | 'VIDEO' (padrão: IMAGE)
   */
  const { media_url, media_type = 'IMAGE' } = body;
  if (!media_url) throw new Error('media_url é obrigatório para publicar Story');

  const { accessToken, igUserId } = await getIgCredentials(supabase, userId);

  // 1. Cria container de Story
  const payload: Record<string, unknown> = {
    media_type: 'STORIES',
    access_token: accessToken,
  };

  if (media_type === 'VIDEO') {
    payload.video_url = media_url;
  } else {
    payload.image_url = media_url;
  }

  const containerRes = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const container = await containerRes.json();
  if (!container.id) throw new Error(`Erro ao criar container do Story: ${JSON.stringify(container)}`);

  console.log('[IG] Container Story criado:', container.id);

  // 2. Aguarda processamento
  await waitForContainer(container.id, accessToken);

  // 3. Publica
  const pubRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: container.id, access_token: accessToken }),
  });
  const pub = await pubRes.json();
  if (!pub.id) throw new Error(`Erro ao publicar Story: ${JSON.stringify(pub)}`);

  console.log('[IG] Story publicado! ID:', pub.id);

  return new Response(JSON.stringify({ success: true, ig_media_id: pub.id, type: 'story' }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// ─── Insights ───────────────────────────────────────────────────────────────

async function getPostInsights(supabase: any, userId: string, postId: string, cors: Record<string, string>) {
  const { data: post } = await supabase
    .from('social_posts')
    .select('ig_media_id')
    .eq('id', postId)
    .eq('user_id', userId)
    .single();

  if (!post?.ig_media_id) {
    return new Response(JSON.stringify({ insights: null }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const { accessToken } = await getIgCredentials(supabase, userId);
  const metrics = 'impressions,reach,likes_count,comments_count,saved,shares';
  const res = await fetch(
    `${GRAPH}/${post.ig_media_id}/insights?metric=${metrics}&access_token=${accessToken}`
  );
  const data = await res.json();

  if (!data.data) {
    return new Response(JSON.stringify({ insights: null }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const get = (name: string) => data.data.find((d: any) => d.name === name)?.values?.[0]?.value ?? 0;
  const likes    = get('likes_count');
  const comments = get('comments_count');
  const reach    = get('reach');

  return new Response(JSON.stringify({
    insights: {
      impressions:      get('impressions'),
      reach,
      likes,
      comments,
      saves:            get('saved'),
      shares:           get('shares'),
      engagement_rate:  reach > 0 ? +((likes + comments) / reach * 100).toFixed(2) : 0,
    },
  }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

// ─── Conta Instagram ─────────────────────────────────────────────────────────

async function getIgAccount(supabase: any, userId: string, cors: Record<string, string>) {
  const { data: igAcct } = await supabase
    .from('connected_accounts' as any)
    .select('account_id, account_name, extra_data, connected_at')
    .eq('user_id', userId)
    .eq('platform', 'instagram_publisher')
    .maybeSingle();

  if (igAcct) {
    return new Response(JSON.stringify({
      connected:    true,
      ig_user_id:   igAcct.extra_data?.ig_user_id || igAcct.account_id,
      username:     igAcct.extra_data?.username   || igAcct.account_name,
      picture:      igAcct.extra_data?.profile_picture_url ?? null,
      page_name:    igAcct.extra_data?.page_name  ?? null,
      connected_at: igAcct.connected_at,
      source:       'instagram_publisher',
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ connected: false }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// ─── AI Carousel Generator ──────────────────────────────────────────────────

async function generateCarousel(body: any, cors: Record<string, string>) {
  const {
    topic,
    audience,
    tone        = 'profissional',
    slide_count = 7,
    include_cta = true,
    brand_name  = 'Minha Empresa',
  } = body;

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    return new Response(JSON.stringify({
      carousel: buildMockCarousel(topic, audience, slide_count, brand_name, include_cta),
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const systemPrompt = `Você é DAVI, especialista em social media marketing para Instagram.
Sua missão é criar carrosséis virais em português brasileiro, educativos e persuasivos.
Retorne APENAS um JSON válido, sem markdown, sem explicações extras.`;

  const userPrompt = `Crie um carrossel Instagram sobre "${topic}" para o público: "${audience}".
Tom: ${tone}. Slides: ${slide_count}. Marca: ${brand_name}. CTA: ${include_cta ? 'sim' : 'não'}.

Retorne este JSON exato:
{
  "cover_headline": "frase de impacto para capa (max 8 palavras)",
  "topic": "${topic}",
  "audience": "${audience}",
  "caption": "legenda completa do post (max 2200 chars, com emojis)",
  "hashtags": ["hashtag1", "hashtag2" (15 hashtags sem #)],
  "slides": [
    {
      "order": 1,
      "headline": "título do slide (max 6 palavras)",
      "body": "conteúdo principal (max 120 chars)",
      "cta": "texto de ação (apenas no último slide se include_cta=true)",
      "bg_color": "#hexcolor",
      "accent_color": "#hexcolor"
    }
  ]
}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:           'gpt-4o-mini',
      messages:        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature:     0.8,
      max_tokens:      2000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI API: ${res.status}`);

  const aiData = await res.json();
  let carousel;
  try {
    carousel = JSON.parse(aiData.choices?.[0]?.message?.content || '{}');
  } catch {
    throw new Error('Resposta da IA inválida — tente novamente');
  }

  return new Response(JSON.stringify({ carousel }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

function buildMockCarousel(topic: string, audience: string, slideCount: number, brand: string, cta: boolean) {
  return {
    topic, audience,
    cover_headline: `${topic}: Guia Completo`,
    caption: `Tudo sobre ${topic}! 🚀\nSalve esse post! ⬇️\n\n#${topic.replace(/\s+/g, '')} #marketing`,
    hashtags: [topic.replace(/\s+/g, ''), 'marketing', 'digitalmarketing', 'empreendedorismo'],
    slides: Array.from({ length: slideCount }, (_, i) => ({
      order:        i + 1,
      headline:     i === 0 ? `${topic}: O Guia Definitivo` : `Dica ${i}`,
      body:         `Estratégia ${i + 1} para dominar ${topic}.`,
      cta:          cta && i === slideCount - 1 ? `Fale com ${brand}!` : undefined,
      bg_color:     '#1A237E',
      accent_color: '#DAA520',
    })),
  };
}

// ─── Utils ───────────────────────────────────────────────────────────────────

function buildCaption(caption: string, hashtags?: string[]): string {
  if (!hashtags?.length) return caption ?? '';
  return `${caption ?? ''}\n\n${hashtags.map((h: string) => `#${h}`).join(' ')}`;
}
