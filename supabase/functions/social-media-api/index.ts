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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Não autorizado');
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Token inválido');

    const body = await req.json();
    const { action } = body;

    // ── GENERATE CAROUSEL V2 (RICH PAGE-BASED SLIDES) ──────────────────────
    if (action === 'generate_carousel_v2') {
      return await generateCarouselV2(body, corsHeaders);
    }

    // ── GENERATE CAROUSEL (legacy) ──────────────────────────────────────────
    if (action === 'generate_carousel') {
      return await generateCarousel(body, corsHeaders);
    }

    // ── FETCH TRENDS BRIEF ──────────────────────────────────────────────────
    if (action === 'fetch_trends_brief') {
      return await fetchTrendsBrief(body, corsHeaders);
    }

    // ── GENERATE SLIDE IMAGE (fal.ai Flux.1) ───────────────────────────────
    if (action === 'generate_slide_image') {
      return await generateSlideImage(body, corsHeaders);
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

// ─── Design Codes Knowledge Base (Inspired by Freepik) ────────────────────────
// ─── Design Kits Knowledge Base (Freepik Inspired) ────────────────────────
const DESIGN_KITS = {
  modern_bold: {
    name: 'Modern Bold',
    bg: '#000000', accent: '#FFEE00', text: '#FFFFFF', sub: '#CCCCCC',
    style: 'Impactante, tipografia pesada, alto contraste, vibe automotiva de luxo ou tecnologia.'
  },
  minimal_luxury: {
    name: 'Minimal Luxury',
    bg: '#FFFFFF', accent: '#D4AF37', text: '#111111', sub: '#555555',
    style: 'Elegante, clean, espaços em branco generosos, fontes serifadas ou minimalistas premium.'
  },
  cyber_neon: {
    name: 'Cyber Neon',
    bg: '#050510', accent: '#00F0FF', text: '#FFFFFF', sub: '#7BCFFF',
    style: 'Futurista, elementos holográficos, gradientes neon, alta tecnologia e inovação.'
  },
  soft_brand: {
    name: 'Soft Brand',
    bg: '#FDFCFB', accent: '#FF6B6B', text: '#2D3436', sub: '#636E72',
    style: 'Acolhedor, tons pastéis, arredondado, focado em marca pessoal ou lifestyle.'
  },
  executive_grid: {
    name: 'Executive Grid',
    bg: '#0D1B2A', accent: '#415A77', text: '#E0E1DD', sub: '#778DA9',
    style: 'Sóbrio, estruturado em grids, azul marinho e prata, confiança e autoridade real.'
  }
};

// ─── V2 Carousel Generator (Rich Page-Based Slides) ─────────────────────────
// ─── V2 Carousel Generator (Multi-Agent Architecture) ──────────────────────
async function generateCarouselV2(body: any, cors: Record<string, string>) {
  const {
    topic,
    audience,
    tone = 'persuasivo',
    slide_count = 8,
    include_cta = true,
    brand_name = 'Minha Empresa',
    carousel_type = 'educacional',
    paul_copy = '',
    trend_context = '',
    niche = 'Negócios',
    objective = 'Engajamento e Vendas'
  } = body;

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    return new Response(JSON.stringify({ 
      error: "API Key não configurada no Supabase." 
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  console.log(`[DAVI] Iniciando geração multi-agente para: ${topic}`);

  try {
    // ── PHASE 1: DAVI STRATEGIST (CMO) ───────────────────────────────────────
    const strategistRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Você é o DAVI ESTRATEGISTA, um CMO nível Senior. Sua função é analisar o tema e criar um "Ângulo de Ataque" viral e uma promessa de valor (Hook Promise) irrefutável.' },
          { role: 'user', content: `Tema: ${topic}\nPúblico: ${audience}\nNiche: ${niche}\nObjetivo: ${objective}\n\nRetorne JSON: {"angle": "estratégia central", "hook_promise": "promessa do slide 1"}` }
        ],
        response_format: { type: 'json_object' }
      })
    });
    const strategyData = await strategistRes.json();
    const strategy = strategyData.choices?.[0]?.message?.content ? JSON.parse(strategyData.choices[0].message.content) : {};

    // ── PHASE 2: DAVI DESIGNER (Freepik Specialist) ─────────────────────────
    const designerRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `Você é o DAVI DESIGNER, especialista em UI/UX e curador do Freepik. Sua função é escolher o melhor Kit Visual e definir os prompts de imagem cinematográficos.
          KITS DISPONÍVEIS: ${JSON.stringify(DESIGN_KITS)}` },
          { role: 'user', content: `Estratégia: ${strategy.angle}\nTema: ${topic}\nSlides: ${slide_count}\n\nRetorne JSON: {"selected_kit": "key_do_kit", "visual_style_guide": "descrição do clima visual", "slides_visuals": [{"order": 1, "visual_cue": "prompt de imagem 8k sem texto"}]}` }
        ],
        response_format: { type: 'json_object' }
      })
    });
    const designerData = await designerRes.json();
    const design = designerData.choices?.[0]?.message?.content ? JSON.parse(designerData.choices[0].message.content) : {};
    const kitKey = (design.selected_kit || 'modern_bold') as keyof typeof DESIGN_KITS;
    const selectedKit = DESIGN_KITS[kitKey] || DESIGN_KITS.modern_bold;

    // ── PHASE 3: DAVI COPYWRITER (Final Assembly) ───────────────────────────
    const copywriterSystem = `Você é o DAVI COPYWRITER, fundindo a expertise do Paulo Copywriter com o design do Freepik.
    Sua missão é escrever as headlines e o corpo dos slides com base na estratégia e no design definidos.
    
    ESTRATÉGIA: ${strategy.angle}
    GUIA VISUAL: ${design.visual_style_guide}
    ESTILO: ${selectedKit.style}
    
    REGRAS:
    1. headlines curtas (máx 6 palavras), agressivas e viscerais.
    2. body denso (máx 180 caracteres), focado em dor/desejo.
    3. bullets impactantes (2 a 3 por slide quando couber).
    4. Use EXATAMENTE ${slide_count} slides.`;

    const finalRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: copywriterSystem },
          { role: 'user', content: `Crie o carrossel completo para o tema "${topic}". Público: ${audience}. Slides: ${slide_count}. Marca: ${brand_name}.
          
          Siga este formato JSON:
          {
            "carousel_type": "${carousel_type}",
            "cover_headline": "HEADLINE PRINCIPAL",
            "hook_promise": "${strategy.hook_promise}",
            "caption": "Legenda com hashtags",
            "hashtags": ["h1", "h2", "h3"],
            "slides": [
              { "order": 1, "headline": "...", "sub_headline": "...", "body": "...", "bullets": [], "accent_word": "...", "layout": "centered" }
            ]
          }` }
        ],
        response_format: { type: 'json_object' }
      })
    });

    const finalData = await finalRes.json();
    const carousel = JSON.parse(finalData.choices?.[0]?.message?.content || '{}');

    // Mesclar os dados de design nos slides
    carousel.slides = carousel.slides.map((s: any, i: number) => ({
      ...s,
      visual_cue: design.slides_visuals?.[i]?.visual_cue || `${topic} professional concept`,
      visual_config: {
        bg: selectedKit.bg,
        accent: selectedKit.accent,
        text: selectedKit.text,
        sub: selectedKit.sub,
        theme: kitKey
      }
    }));

    console.log(`[DAVI] Geração concluída com sucesso.`);

    return new Response(JSON.stringify({ carousel }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error("[DAVI ERROR]:", err);
    return new Response(JSON.stringify({ error: `Erro na geração multi-agente: ${err.message}` }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
}

// ─── Fetch Trends Brief ──────────────────────────────────────────────────────
async function fetchTrendsBrief(body: any, cors: Record<string, string>) {
  const { niche = 'marketing digital', limit = 8 } = body;
  const newsdataKey = Deno.env.get('NEWSDATA_API_KEY');

  const nicheToQuery: Record<string, string> = {
    automotivo: 'carros mercado automóveis',
    saude_bem_estar: 'saúde bem-estar medicina fitness',
    varejo_ecommerce: 'e-commerce varejo vendas online consumo',
    educacao_conhecimento: 'educação cursos online aprendizado',
    alimentacao_bebidas: 'gastronomia alimentação restaurante',
    imobiliario: 'imóveis mercado imobiliário',
    servicos_b2b: 'negócios B2B empreendedorismo startups',
    pet: 'pets animais domésticos veterinário',
    financas_investimentos: 'finanças investimentos economia mercado',
    tecnologia_saas: 'tecnologia inteligência artificial software',
    'marketing digital': 'marketing digital redes sociais',
    outro: 'negócios empreendedorismo tendências',
  };

  const query = nicheToQuery[niche] || niche;
  const topics: { title: string; summary: string; source: string }[] = [];

  // Source 1: Google Trends RSS Brazil
  try {
    const trendsUrl = `https://trends.google.com/trends/trendingsearches/daily/rss?geo=BR`;
    const trendsRes = await fetch(trendsUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (trendsRes.ok) {
      const xml = await trendsRes.text();
      const itemMatches = xml.matchAll(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/g);
      let count = 0;
      for (const match of itemMatches) {
        if (count >= 5 && topics.length > 0) break;
        const title = match[1].trim();
        if (title && title.length > 3) {
          topics.push({ title, summary: 'Tendência em alta no Google Brasil', source: 'Google Trends' });
          count++;
        }
      }
    }
  } catch { /* silent fail */ }

  // Source 2: NewsData.io
  if (newsdataKey) {
    try {
      const newsUrl = `https://newsdata.io/api/1/news?apikey=${newsdataKey}&q=${encodeURIComponent(query)}&language=pt&country=br&size=${limit}`;
      const newsRes = await fetch(newsUrl);
      if (newsRes.ok) {
        const newsData = await newsRes.json();
        if (newsData.results) {
          for (const article of newsData.results.slice(0, 6)) {
            topics.push({
              title: article.title || '',
              summary: article.description || article.content?.slice(0, 200) || '',
              source: article.source_id || 'NewsData',
            });
          }
        }
      }
    } catch { /* silent fail */ }
  }

  // Source 3: Wikipedia summary for niche context
  try {
    const wikiQuery = query.split(' ')[0];
    const wikiUrl = `https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiQuery)}`;
    const wikiRes = await fetch(wikiUrl);
    if (wikiRes.ok) {
      const wikiData = await wikiRes.json();
      if (wikiData.extract) {
        topics.push({
          title: wikiData.title,
          summary: wikiData.extract.slice(0, 300),
          source: 'Wikipedia',
        });
      }
    }
  } catch { /* silent fail */ }

  // Compile a brief for the copywriter (Paulo)
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  let carouselIdeas: any[] = [];

  if (openaiKey && topics.length > 0) {
    try {
      const topicsText = topics.map((t, i) => `${i + 1}. ${t.title}: ${t.summary}`).join('\n');
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: `Com base nas tendências abaixo do nicho "${niche}", crie ${limit} ideias de carrossel para Instagram.
Para cada ideia, retorne JSON no formato:
{"ideas": [{"title": "título do carrossel", "hook": "primeira frase para capturar atenção", "type": "educacional|lista|storytelling|mitos|passoapasso|polemica", "viral_score": 1-10, "why": "por que isso vai engajar o público"}]}

TENDÊNCIAS:
${topicsText}

Retorne apenas JSON.`,
          }],
          temperature: 0.9,
          max_tokens: 1500,
          response_format: { type: 'json_object' },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
        carouselIdeas = parsed.ideas || [];
      }
    } catch { /* use raw topics as fallback */ }
  }

  if (!carouselIdeas.length) {
    carouselIdeas = topics.slice(0, limit).map((t, i) => ({
      title: t.title,
      hook: t.summary.slice(0, 100),
      type: ['educacional', 'lista', 'mitos'][i % 3],
      viral_score: 7,
      why: `Trending: ${t.source}`,
    }));
  }

  return new Response(JSON.stringify({
    niche,
    raw_topics: topics,
    carousel_ideas: carouselIdeas,
    generated_at: new Date().toISOString(),
  }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

// ─── Generate Slide Image via fal.ai ────────────────────────────────────────
async function generateSlideImage(body: any, cors: Record<string, string>) {
  const { visual_cue, template_style = 'dark', slide_type = 'content' } = body;
  const falKey = Deno.env.get('FAL_API_KEY');

  if (!falKey) {
    return new Response(JSON.stringify({ image_url: null, error: 'FAL_API_KEY não configurada' }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const styleMap: Record<string, string> = {
    dark: 'cinematic dark background, dramatic lighting, moody atmosphere, professional photography',
    editorial: 'elegant editorial style, navy blue tones, minimalist composition, high-end magazine',
    neon: 'neon cyberpunk aesthetic, dark background, glowing lights, futuristic',
    clean_light: 'clean white studio background, natural lighting, modern minimal, lifestyle photography',
  };

  const prompt = `${visual_cue}. ${styleMap[template_style] || styleMap.dark}. Instagram carousel slide visual, 4:5 aspect ratio, no text, professional quality, high detail`;

  try {
    const falRes = await fetch('https://fal.run/fal-ai/flux/schnell', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_size: 'portrait_4_3',
        num_inference_steps: 4,
        num_images: 1,
      }),
    });

    if (!falRes.ok) throw new Error(`fal.ai error: ${falRes.status}`);

    const falData = await falRes.json();
    const imageUrl = falData.images?.[0]?.url || null;

    return new Response(JSON.stringify({ image_url: imageUrl }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ image_url: null, error: err.message }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
}

// ─── Mock V2 Carousel (no API key) ──────────────────────────────────────────
function buildMockCarouselV2(
  topic: string, audience: string, slideCount: number,
  brand: string, cta: boolean, carouselType: string
) {
  const typeSlides: Record<string, any[]> = {
    educacional: [
      { type: 'cover', headline: `Tudo sobre ${topic}`, sub_headline: 'O guia definitivo para quem quer resultados', layout: 'centered', accent_word: topic },
      { type: 'content', headline: 'Por que isso importa?', sub_headline: 'Insight 1 de 5', body: `Entender ${topic} pode mudar completamente seus resultados.`, layout: 'left' },
      { type: 'list', headline: '3 Pilares Fundamentais', sub_headline: 'Insight 2 de 5', bullets: ['Consistência acima de tudo', 'Estratégia antes de tática', 'Métricas que importam'], layout: 'left' },
      { type: 'content', headline: 'O Erro Mais Comum', sub_headline: 'Insight 3 de 5', body: 'A maioria pula etapas cruciais e depois não entende por que não funciona.', layout: 'centered' },
      { type: 'quote', headline: '"Quem domina o básico, domina o jogo."', sub_headline: 'Insight 4 de 5', body: `Aplicado a ${topic}`, layout: 'centered' },
      { type: 'content', headline: 'O Que Fazer Agora', sub_headline: 'Insight 5 de 5', body: 'Aplicar um conceito por vez é mais poderoso do que saber tudo e não agir.', layout: 'left' },
    ],
    lista: [
      { type: 'cover', headline: `7 segredos de ${topic}`, sub_headline: 'Que os especialistas não revelam', layout: 'centered', accent_word: '7' },
      ...(Array.from({ length: slideCount - 2 }, (_, i) => ({
        type: 'list', headline: `#${i + 1} ${['Comece pelo básico', 'Conheça seu público', 'Crie sistemas', 'Meça tudo', 'Itere rápido'][i] || `Ponto ${i + 1}`}`,
        sub_headline: `Dica ${i + 1} de ${slideCount - 2}`, body: `Implementar isso muda completamente sua relação com ${topic}.`, layout: 'left',
      }))),
    ],
  };

  const slides = (typeSlides[carouselType] || typeSlides.educacional).slice(0, slideCount - 1);

  if (cta) {
    slides.push({
      type: 'cta',
      headline: 'Pronto para começar?',
      sub_headline: `Fale com ${brand} hoje`,
      body: 'Salve esse post e envie para alguém que precisa ver isso.',
      layout: 'centered',
      accent_word: 'começar',
    });
  }

  return {
    carousel_type: carouselType,
    cover_headline: slides[0]?.headline || topic,
    hook_promise: `Aprenda tudo sobre ${topic} em ${slideCount} slides`,
    caption: `🚀 ${topic} — O guia completo!\n\nSalve esse post para não perder! ⬇️\n\n#${topic.replace(/\s+/g, '')} #marketing #digital`,
    hashtags: [topic.replace(/\s+/g, ''), 'marketing', 'digitalmarketing', 'empreendedorismo'],
    slides: slides.map((s, i) => ({ order: i + 1, visual_cue: `professional ${topic} concept`, ...s })),
  };
}

// ─── AI Carousel Generator (Legacy) ─────────────────────────────────────────
async function generateCarousel(body: any, cors: Record<string, string>) {
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  const { topic, audience, tone = 'profissional', slide_count = 7, include_cta = true, brand_name = 'Minha Empresa' } = body;

  if (!openaiKey) {
    return new Response(JSON.stringify({
      carousel: buildMockCarousel(topic, audience, slide_count, brand_name, include_cta),
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: 'Você é DAVI, especialista em social media marketing. Retorne APENAS JSON válido.',
      }, {
        role: 'user',
        content: `Crie um carrossel Instagram sobre "${topic}" para "${audience}". Tom: ${tone}. Slides: ${slide_count}. Marca: ${brand_name}. CTA: ${include_cta}.
Retorne: {"cover_headline":"...","topic":"...","audience":"...","caption":"...","hashtags":[...],"slides":[{"order":1,"headline":"...","body":"...","cta":"...","bg_color":"#hex","accent_color":"#hex"}]}`,
      }],
      temperature: 0.8,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI API: ${res.status}`);
  const aiData = await res.json();
  const carousel = JSON.parse(aiData.choices?.[0]?.message?.content || '{}');

  return new Response(JSON.stringify({ carousel }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

function buildMockCarousel(topic: string, audience: string, slideCount: number, brand: string, cta: boolean) {
  const slides = Array.from({ length: slideCount }, (_, i) => ({
    order: i + 1,
    headline: i === 0 ? `${topic}: O que você precisa saber` : `Ponto ${i}: Insight ${i}`,
    body: i === 0 ? `Descubra como ${topic} pode transformar seus resultados` : `Estratégia ${i} para dominar ${topic}.`,
    cta: cta && i === slideCount - 1 ? `Fale com ${brand} hoje mesmo!` : undefined,
    bg_color: '#1A237E',
    accent_color: '#DAA520',
  }));
  return { topic, audience, cover_headline: `${topic}: Guia Completo`, caption: `Tudo sobre ${topic}! 🚀`, hashtags: [topic.replace(/\s+/g, ''), 'marketing'], slides };
}

// ─── Publish to Instagram ───────────────────────────────────────────────────
async function publishPost(supabase: any, userId: string, postId: string, cors: Record<string, string>) {
  const { data: post, error: postError } = await supabase.from('social_posts').select('*').eq('id', postId).eq('user_id', userId).single();
  if (postError || !post) throw new Error('Post não encontrado');

  let account: any = null;
  const { data: igAccount } = await supabase.from('connected_accounts' as any).select('*').eq('user_id', userId).eq('platform', 'instagram_publisher').maybeSingle();
  if (igAccount) {
    account = { access_token: igAccount.access_token, extra_data: { ig_account_id: igAccount.account_id } };
  } else {
    const { data: metaAccount } = await supabase.from('ad_accounts').select('*').eq('user_id', userId).eq('platform', 'meta').eq('is_active', true).maybeSingle();
    if (metaAccount) account = { access_token: metaAccount.access_token_encrypted || metaAccount.access_token, extra_data: metaAccount.extra_data };
  }

  if (!account) return new Response(JSON.stringify({ error: 'Conta Instagram não conectada.' }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  const igAccountId = account.extra_data?.ig_account_id;
  if (!igAccountId) return new Response(JSON.stringify({ error: 'Conta Instagram Business não encontrada.' }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  const accessToken = account.access_token;
  const caption = post.caption + (post.hashtags?.length ? '\n\n' + post.hashtags.map((h: string) => `#${h}`).join(' ') : '');

  try {
    const isVideo = (url: string) => /\.(mp4|mov)$/i.test(url) || post.post_type === 'reel';
    let containerId: string | null = null;
    let containerPayload: any = { access_token: accessToken };
    const mediaUrls = post.media_urls || [];
    if (!mediaUrls.length) throw new Error('Nenhuma mídia encontrada no post');

    if (post.post_type === 'carousel' || mediaUrls.length > 1) {
      const childIds = await Promise.all(mediaUrls.map(async (url: string) => {
        const type = isVideo(url) ? 'video_url' : 'image_url';
        const r = await fetch(`${IG_API}/${igAccountId}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [type]: url, is_carousel_item: true, media_type: isVideo(url) ? 'VIDEO' : 'IMAGE', access_token: accessToken }) });
        const d = await r.json();
        if (d.error) throw new Error(`Erro filho: ${d.error.message}`);
        return d.id;
      }));
      containerPayload = { ...containerPayload, media_type: 'CAROUSEL', caption, children: childIds.join(',') };
    } else if (post.post_type === 'reel') {
      containerPayload = { ...containerPayload, media_type: 'REELS', video_url: mediaUrls[0], caption, share_to_feed: true };
    } else {
      const url = mediaUrls[0];
      containerPayload = isVideo(url) ? { ...containerPayload, media_type: 'VIDEO', video_url: url, caption } : { ...containerPayload, image_url: url, caption };
    }

    const containerRes = await fetch(`${IG_API}/${igAccountId}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(containerPayload) });
    const container = await containerRes.json();
    if (container.error || !container.id) throw new Error(`Erro container: ${container.error?.message}`);
    containerId = container.id;

    let isFinished = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const statusRes = await fetch(`${IG_API}/${containerId}?fields=status_code&access_token=${accessToken}`);
      const statusData = await statusRes.json();
      const code = statusData.status_code;
      if (code === 'FINISHED' || code === 'PUBLISHED') { isFinished = true; break; }
      if (code === 'ERROR' || code === 'EXPIRED') throw new Error(`Instagram rejeitou: ${code}`);
    }
    if (!isFinished) throw new Error('Timeout no processamento da mídia');

    const pubRes = await fetch(`${IG_API}/${igAccountId}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creation_id: containerId, access_token: accessToken }) });
    const pub = await pubRes.json();
    if (pub.error || !pub.id) throw new Error(`Erro na publicação: ${pub.error?.message}`);

    await supabase.from('social_posts').update({ status: 'published', published_at: new Date().toISOString(), ig_media_id: pub.id }).eq('id', postId);
    return new Response(JSON.stringify({ success: true, ig_media_id: pub.id }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    await supabase.from('social_posts').update({ status: 'failed' }).eq('id', postId);
    throw err;
  }
}

// ─── Get Post Insights ──────────────────────────────────────────────────────
async function getPostInsights(supabase: any, userId: string, postId: string, cors: Record<string, string>) {
  const { data: post } = await supabase.from('social_posts').select('ig_media_id').eq('id', postId).eq('user_id', userId).single();
  if (!post?.ig_media_id) return new Response(JSON.stringify({ insights: null }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  const { data: account } = await supabase.from('ad_accounts').select('access_token_encrypted, access_token').eq('user_id', userId).eq('platform', 'meta').eq('is_active', true).maybeSingle();
  if (!account) throw new Error('Conta Meta não conectada');

  const accessToken = account.access_token_encrypted || account.access_token;
  const metrics = 'impressions,reach,likes_count,comments_count,saved,shares';
  const res = await fetch(`${IG_API}/${post.ig_media_id}/insights?metric=${metrics}&access_token=${accessToken}`);
  const data = await res.json();
  if (!data.data) return new Response(JSON.stringify({ insights: null }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  const get = (name: string) => data.data.find((d: any) => d.name === name)?.values?.[0]?.value || 0;
  const impressions = get('impressions'), likes = get('likes_count'), comments = get('comments_count'), reach = get('reach');
  const insights = { impressions, reach, likes, comments, saves: get('saved'), shares: get('shares'), engagement_rate: reach > 0 ? ((likes + comments) / reach) * 100 : 0 };

  return new Response(JSON.stringify({ insights }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

// ─── Get Instagram Account ─────────────────────────────────────────────────
async function getIgAccount(supabase: any, userId: string, cors: Record<string, string>) {
  const { data: igAccount } = await supabase.from('connected_accounts' as any).select('account_id, extra_data').eq('user_id', userId).eq('platform', 'instagram_publisher').maybeSingle();
  if (igAccount) return new Response(JSON.stringify({ connected: true, ig_account_id: igAccount.account_id, username: igAccount.extra_data?.username, source: 'instagram_publisher' }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  const { data: metaAccount } = await supabase.from('ad_accounts').select('extra_data').eq('user_id', userId).eq('platform', 'meta').eq('is_active', true).maybeSingle();
  if (metaAccount?.extra_data?.ig_account_id) return new Response(JSON.stringify({ connected: true, ig_account_id: metaAccount.extra_data.ig_account_id, source: 'meta_ads' }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  return new Response(JSON.stringify({ connected: false }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}
