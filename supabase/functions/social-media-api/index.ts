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

// ─── V2 Carousel Generator (Rich Page-Based Slides) ─────────────────────────
async function generateCarouselV2(body: any, cors: Record<string, string>) {
  const {
    topic,
    audience,
    tone = 'persuasivo',
    slide_count = 8,
    include_cta = true,
    brand_name = 'Minha Empresa',
    carousel_type = 'educacional',
    paul_copy = '',         // Copy importada do Paulo
    trend_context = '',     // Contexto de tendências
  } = body;

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    return new Response(JSON.stringify({
      carousel: buildMockCarouselV2(topic, audience, slide_count, brand_name, include_cta, carousel_type),
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const typeInstructions: Record<string, string> = {
    educacional: `Formato EDUCACIONAL: ensina algo valioso ao público. Cada slide = um conceito claro.
      Slide 1 (CAPA): Promessa poderosa que justifica o arraste. Ex: "O que nenhum [NICHO] te contou sobre X"
      Slides 2-${slide_count - 2}: Um insight profundo por slide, com dado ou exemplo concreto
      Slide ${slide_count - 1} (CONCLUSÃO): Recapitula o valor entregue
      Slide ${slide_count} (CTA): Ação clara e irresistível`,

    lista: `Formato LISTA: título provoca curiosidade, cada slide revela um item numerado.
      Slide 1 (CAPA): "X [coisas/erros/formas/razões] que [resultado impactante]"
      Slides 2-${slide_count - 1}: Cada item da lista — NUMERADO, com headline direta e explicação curta
      Slide ${slide_count} (CTA): Ação relacionada ao tema da lista`,

    storytelling: `Formato STORYTELLING: narrativa com começo, meio, fim e virada.
      Slide 1 (CAPA): Apresenta o protagonista e o conflito
      Slides 2-4: O problema e as tentativas fracassadas (tensão)
      Slides 5-6: A virada / descoberta / solução
      Slide 7: O resultado conquistado (prova)
      Slide ${slide_count} (CTA): "Quer o mesmo resultado? [ação]"`,

    mitos: `Formato MITOS vs VERDADES: derruba crenças populares.
      Slide 1 (CAPA): "X mitos sobre [tema] que estão sabotando você"
      Slides pares: MITO — em vermelho ou destaque negativo
      Slides ímpares: VERDADE — revelação que surpreende
      Slide ${slide_count} (CTA): Posiciona a marca como detentora da verdade`,

    passoapasso: `Formato PASSO A PASSO: guia prático com etapas sequenciais.
      Slide 1 (CAPA): Promete o resultado final do processo
      Slides 2-${slide_count - 1}: PASSO [N] — ação específica com orientação clara
      Slide ${slide_count} (CTA): "Salve este post e comece agora"`,

    polemica: `Formato POLÊMICO: gera debate e compartilhamento.
      Slide 1 (CAPA): Afirmação provocativa e contrária ao senso comum
      Slides 2-5: Argumentos que sustentam a posição, com dados
      Slide 6: Antecipa e derruba a principal objeção
      Slide 7: Convida ao debate nos comentários
      Slide ${slide_count} (CTA): "Concorda ou discorda? Comenta aqui"`,
  };

  const pauloContext = paul_copy
    ? `\n\nESTRATÉGIA DO COPYWRITER PAULO (use como base e expanda visualmente. RESPEITE TODAS AS ESPECIFICAÇÕES DO PAULO):\n${paul_copy.slice(0, 15000)}`
    : '';

  const trendContext = trend_context
    ? `\n\nCONTEXTO DE TENDÊNCIAS ATUAL:\n${trend_context.slice(0, 2000)}`
    : '';

  // ── STEP 1: Creative Director (Bíblia da Campanha em Markdown) ───────────────
  const bibleSystemPrompt = `Você é DAVI, o Diretor Criativo Executivo mais premiado do Brasil. Você pensa em campanhas, não em posts.
Você foi contratado para criar a BÍBLIA CRIATIVA de um carrossel de Instagram que vai parar o scroll e gerar compartilhamentos.
Se recebeu a estratégia do PAULO, você DEVE respeitar e expandir visualmente a visão dele.

REGRA ABSOLUTA: Você NÃO vai retornar JSON agora. Escreva a BÍBLIA DA CAMPANHA em Markdown puro, denso e prolixo.

ESTRUTURA DA BÍBLIA:
# Campanha: [Título Estratégico]
**Marca:** ${brand_name} | **Tipo:** ${carousel_type} | **Slides:** ${slide_count}

## DNA Visual da Campanha
- **Luz de Assinatura:** [Uma luz que define toda a campanha — Golden Hour, Neon Noturno, Luz Fria de Estúdio etc.]
- **Paleta Cromática:** [3-4 cores HEX e quando usar cada uma]
- **Sujeito Âncora:** [O protagonista humano específico que aparece em cada slide — nunca genérico]
- **Textura/Atmosfera:** [O "mood" visual — cinematic, editorial, raw, luxury etc.]

## Legenda do Post (Caption)
[Um manifesto de 5 parágrafos de puro valor. Mínimo 400 palavras. Tom: ${tone}.]

---
${Array.from({ length: slide_count }, (_, i) => `## Slide ${i + 1}: [Headline do Slide ${i + 1}]
**Sub-Headline:** [Complemento intrigante]
**Corpo/Narrativa:** [Explicação densa e fascinante — mínimo 3 parágrafos. Use dados, metáforas, neurociência. NUNCA seja genérico.]
**Bullets de Impacto:** [3 fatos/dados específicos e verificáveis]
**Prompt Midjourney v6 (INGLÊS):** [Sujeito específico em ação rica] + [Ambiente e clima] + [${brand_name} brand, Golden Hour / Assinatura de Luz] + [câmera: Sony A7IV, 85mm, f/1.8] + [cinematic, photorealistic, 8k, no text, no watermark]`).join('\n\n---\n')}`;

  const bibleUserPrompt = `Crie a Bíblia da Campanha para um carrossel sobre "${topic}" direcionado para "${audience}".
Tom: ${tone}. Slides: ${slide_count}. Marca: ${brand_name}. CTA: ${include_cta ? 'Sim — slide final com call-to-action poderoso' : 'Não'}.
Tipo de carrossel: ${carousel_type}.${pauloContext}${trendContext}

Instruções do tipo:
${typeInstructions[carousel_type] || typeInstructions.educacional}

Seja IMENSAMENTE detalhado. Cada slide deve ter conteúdo suficiente para transformar a vida de quem ler.`;

  const res1 = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: bibleSystemPrompt },
        { role: 'user', content: bibleUserPrompt },
      ],
      temperature: 0.9,
      max_tokens: 4000,
    }),
  });

  if (!res1.ok) {
    const err = await res1.text();
    throw new Error(`OpenAI API (Bíblia): ${res1.status} — ${err}`);
  }
  const data1 = await res1.json();
  const bible = data1.choices?.[0]?.message?.content || '';

  // ── STEP 2: Data Architect (Extração JSON determinística) ────────────────────
  const extractionSystemPrompt = `Você é o Arquiteto de Estruturas da HumanizeIA.
Sua ÚNICA missão: converter a "Bíblia da Campanha" em JSON EXATO e COMPLETO.
NÃO RESUMA. NÃO OMITA. Preserve TODA a densidade dos textos, prompts de imagem e bullets.
Retorne APENAS o objeto JSON, sem texto fora do JSON.

SCHEMA OBRIGATÓRIO:
{
  "carousel_type": "${carousel_type}",
  "cover_headline": "headline da capa (max 7 palavras, impactante)",
  "hook_promise": "o que o leitor vai aprender/ganhar",
  "caption": "legenda completa do post (extensa, persuasiva, mínimo 400 palavras)",
  "hashtags": ["hashtag1", "hashtag2"],
  "slides": [
    {
      "order": 1,
      "type": "cover",
      "headline": "HEADLINE DO SLIDE",
      "sub_headline": "sub-headline complementar",
      "body": "texto denso e completo do slide — NÃO RESUMIR",
      "bullets": ["bullet 1 detalhado", "bullet 2 detalhado", "bullet 3 detalhado"],
      "image_prompt": "full midjourney v6 style prompt in english — dense and specific",
      "visual_cue": "descrição curta do visual",
      "layout": "centered ou left",
      "accent_word": "palavra do headline a destacar"
    }
  ]
}

Tipos de slide: "cover", "content", "list", "quote", "cta"`;

  const res2 = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: extractionSystemPrompt },
        { role: 'user', content: `Converta esta Bíblia da Campanha no JSON do schema:\n\n${bible}` },
      ],
      temperature: 0,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res2.ok) {
    const err = await res2.text();
    throw new Error(`OpenAI API (Extração JSON): ${res2.status} — ${err}`);
  }

  const aiData = await res2.json();
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
