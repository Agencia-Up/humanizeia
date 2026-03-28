import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const IG_API = 'https://graph.facebook.com/v18.0';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Não autorizado');
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Token inválido');

    const body = await req.json();
    const { action } = body;

    // ── GENERATE CAROUSEL ──────────────────────────────────────────────────
    if (action === 'generate_carousel') {
      return await generateCarousel(body, corsHeaders);
    }

    // ── PUBLISH POST ────────────────────────────────────────────────────────
    if (action === 'publish_post') {
      return await publishPost(supabase, user.id, body.post_id, corsHeaders);
    }

    // ── GET POST INSIGHTS ───────────────────────────────────────────────────
    if (action === 'get_post_insights') {
      return await getPostInsights(supabase, user.id, body.post_id, corsHeaders);
    }

    // ── GET INSTAGRAM ACCOUNT ────────────────────────────────────────────────
    if (action === 'get_ig_account') {
      return await getIgAccount(supabase, user.id, corsHeaders);
    }

    throw new Error(`Ação desconhecida: ${action}`);

  } catch (err: any) {
    console.error('social-media-api error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }
});

// ─── AI Carousel Generator ──────────────────────────────────────────────────
async function generateCarousel(body: any, cors: Record<string, string>) {
  const {
    topic,
    audience,
    tone = 'profissional',
    slide_count = 7,
    include_cta = true,
    brand_name = 'Minha Empresa',
  } = body;

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    // Fallback: Generate mock carousel for demo
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
  "hashtags": ["hashtag1", "hashtag2", ... (15 hashtags sem #)],
  "slides": [
    {
      "order": 1,
      "headline": "título do slide (max 6 palavras)",
      "body": "conteúdo principal (max 120 chars, objetivo e direto)",
      "cta": "texto de ação (apenas no último slide se include_cta=true)",
      "bg_color": "#hexcolor (azul escuro ou cor relevante ao tema)",
      "accent_color": "#hexcolor (dourado ou cor de contraste)"
    }
  ]
}

Regras:
- Slide 1: capa com headline impactante + subtítulo
- Slides 2-${slide_count - 1}: conteúdo educativo, um ponto por slide
- Último slide: conclusão${include_cta ? ' + CTA forte' : ''}
- Use dados, números, listas quando possível
- Tom brasileiro, não formal demais`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API: ${res.status} — ${err}`);
  }

  const aiData = await res.json();
  const rawContent = aiData.choices?.[0]?.message?.content || '{}';

  let carousel;
  try {
    carousel = JSON.parse(rawContent);
  } catch {
    throw new Error('Resposta da IA inválida — tente novamente');
  }

  return new Response(JSON.stringify({ carousel }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function buildMockCarousel(topic: string, audience: string, slideCount: number, brand: string, cta: boolean) {
  const slides = Array.from({ length: slideCount }, (_, i) => ({
    order: i + 1,
    headline: i === 0 ? `${topic}: O que você precisa saber` : `Ponto ${i}: Insight ${i}`,
    body: i === 0
      ? `Descubra como ${topic} pode transformar seus resultados`
      : `Estratégia ${i} para dominar ${topic} com resultados reais.`,
    cta: cta && i === slideCount - 1 ? `Fale com ${brand} hoje mesmo!` : undefined,
    bg_color: '#1A237E',
    accent_color: '#DAA520',
  }));

  return {
    topic,
    audience,
    cover_headline: `${topic}: Guia Completo`,
    caption: `Tudo que você precisa saber sobre ${topic}! 🚀\n\nSalve esse post para não perder! ⬇️\n\n#${topic.replace(/\s+/g, '')} #marketing #digitalmarketing`,
    hashtags: [topic.replace(/\s+/g, ''), 'marketing', 'digitalmarketing', 'empreendedorismo', 'negocios'],
    slides,
  };
}

// ─── Publish to Instagram ───────────────────────────────────────────────────
async function publishPost(supabase: any, userId: string, postId: string, cors: Record<string, string>) {
  // Get post from DB
  const { data: post, error: postError } = await supabase
    .from('social_posts')
    .select('*')
    .eq('id', postId)
    .eq('user_id', userId)
    .single();

  if (postError || !post) throw new Error('Post não encontrado');

  // Try instagram_publisher connection first (Davi's dedicated connection)
  let account: any = null;
  const { data: igAccount } = await supabase
    .from('connected_accounts' as any)
    .select('*')
    .eq('user_id', userId)
    .eq('platform', 'instagram_publisher')
    .maybeSingle();

  if (igAccount) {
    account = {
      access_token: igAccount.access_token,
      extra_data: { ig_account_id: igAccount.account_id },
    };
  } else {
    // Fallback to Meta Ads account (backwards compatibility)
    const { data: metaAccount } = await supabase
      .from('ad_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('platform', 'meta')
      .eq('is_active', true)
      .maybeSingle();
    if (metaAccount) {
      account = {
        access_token: metaAccount.access_token_encrypted || metaAccount.access_token,
        extra_data: metaAccount.extra_data,
      };
    }
  }

  if (!account) {
    return new Response(JSON.stringify({
      error: 'Conta Instagram não conectada. Conecte em Configurações > Integrações.',
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const igAccountId = account.extra_data?.ig_account_id;
  if (!igAccountId) {
    return new Response(JSON.stringify({
      error: 'Conta Instagram não encontrada. Verifique se sua conta está conectada como Instagram Business.',
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const accessToken = account.access_token;
  const caption = post.caption + (post.hashtags?.length ? '\n\n' + post.hashtags.map((h: string) => `#${h}`).join(' ') : '');

  try {
    if (post.post_type === 'carousel' && post.media_urls?.length > 1) {
      // Carousel publish flow
      const childIds = await Promise.all(
        post.media_urls.map(async (url: string) => {
          const r = await fetch(`${IG_API}/${igAccountId}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_url: url,
              is_carousel_item: true,
              access_token: accessToken,
            }),
          });
          const d = await r.json();
          return d.id;
        })
      );

      const containerRes = await fetch(`${IG_API}/${igAccountId}/media`, {
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

      // Publish
      await new Promise(r => setTimeout(r, 2000));
      const pubRes = await fetch(`${IG_API}/${igAccountId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: container.id, access_token: accessToken }),
      });
      const pub = await pubRes.json();

      await supabase.from('social_posts').update({
        status: 'published',
        published_at: new Date().toISOString(),
        ig_media_id: pub.id,
      }).eq('id', postId);

    } else {
      // Single image
      const url = post.media_urls?.[0];
      if (!url) throw new Error('Nenhuma mídia encontrada no post');

      const mediaRes = await fetch(`${IG_API}/${igAccountId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: url, caption, access_token: accessToken }),
      });
      const media = await mediaRes.json();
      if (!media.id) throw new Error(`Erro ao criar mídia: ${JSON.stringify(media)}`);

      await new Promise(r => setTimeout(r, 2000));
      const pubRes = await fetch(`${IG_API}/${igAccountId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: media.id, access_token: accessToken }),
      });
      const pub = await pubRes.json();

      await supabase.from('social_posts').update({
        status: 'published',
        published_at: new Date().toISOString(),
        ig_media_id: pub.id,
      }).eq('id', postId);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    await supabase.from('social_posts').update({ status: 'failed' }).eq('id', postId);
    throw err;
  }
}

// ─── Get Post Insights ──────────────────────────────────────────────────────
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

  const { data: account } = await supabase
    .from('ad_accounts')
    .select('access_token_encrypted, access_token')
    .eq('user_id', userId)
    .eq('platform', 'meta')
    .eq('is_active', true)
    .maybeSingle();

  if (!account) throw new Error('Conta Meta não conectada');

  const accessToken = account.access_token_encrypted || account.access_token;
  const metrics = 'impressions,reach,likes_count,comments_count,saved,shares';
  const res = await fetch(
    `${IG_API}/${post.ig_media_id}/insights?metric=${metrics}&access_token=${accessToken}`
  );
  const data = await res.json();

  if (!data.data) {
    return new Response(JSON.stringify({ insights: null }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const get = (name: string) => data.data.find((d: any) => d.name === name)?.values?.[0]?.value || 0;

  const impressions = get('impressions');
  const likes = get('likes_count');
  const comments = get('comments_count');
  const reach = get('reach');

  const insights = {
    impressions,
    reach,
    likes,
    comments,
    saves: get('saved'),
    shares: get('shares'),
    engagement_rate: reach > 0 ? ((likes + comments) / reach) * 100 : 0,
  };

  return new Response(JSON.stringify({ insights }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// ─── Get Instagram Account ─────────────────────────────────────────────────
async function getIgAccount(supabase: any, userId: string, cors: Record<string, string>) {
  // Check for dedicated Instagram Publisher connection
  const { data: igAccount } = await supabase
    .from('connected_accounts' as any)
    .select('account_id, extra_data')
    .eq('user_id', userId)
    .eq('platform', 'instagram_publisher')
    .maybeSingle();

  if (igAccount) {
    return new Response(JSON.stringify({
      connected: true,
      ig_account_id: igAccount.account_id,
      username: igAccount.extra_data?.username,
      source: 'instagram_publisher',
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  // Fallback: check Meta Ads account for ig_account_id
  const { data: metaAccount } = await supabase
    .from('ad_accounts')
    .select('extra_data')
    .eq('user_id', userId)
    .eq('platform', 'meta')
    .eq('is_active', true)
    .maybeSingle();

  if (metaAccount?.extra_data?.ig_account_id) {
    return new Response(JSON.stringify({
      connected: true,
      ig_account_id: metaAccount.extra_data.ig_account_id,
      source: 'meta_ads',
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ connected: false }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
