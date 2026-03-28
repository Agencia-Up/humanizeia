import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Não autorizado');
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) throw new Error('Token inválido');

    const body = await req.json();
    const { action } = body;

    if (action === 'generate_strategy') {
      return await generateStrategy(body, corsHeaders);
    }

    if (action === 'research_trends') {
      return await researchTrends(body, user, supabase, corsHeaders);
    }

    if (action === 'generate_swot') {
      return await generateSwot(body, corsHeaders);
    }

    throw new Error(`Ação desconhecida: ${action}`);
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function generateStrategy(body: any, cors: Record<string, string>) {
  const {
    business_name, business_type, strategy_type, current_situation,
    main_challenge, budget, timeframe_months = 6,
  } = body;

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) throw new Error('OpenAI não configurado');

  const systemPrompt = `Você é DANIEL, consultor estratégico de negócios de alto nível.
Especialista em marketing digital, crescimento de empresas e planejamento estratégico.
Retorne APENAS JSON válido, em português brasileiro.`;

  const userPrompt = `Crie um plano estratégico completo para:
Empresa: ${business_name}
Tipo: ${business_type}
Tipo de estratégia: ${strategy_type}
Situação atual: ${current_situation || 'não informada'}
Principal desafio: ${main_challenge}
Orçamento: ${budget || 'não informado'}
Prazo: ${timeframe_months} meses

Retorne este JSON:
{
  "title": "título do plano estratégico",
  "executive_summary": "resumo executivo de 2-3 parágrafos",
  "sections": [
    {
      "icon": "emoji",
      "title": "título da seção",
      "content": "conteúdo detalhado com bullet points"
    }
  ],
  "key_metrics": ["lista de 5 KPIs com metas específicas"],
  "timeline": "${timeframe_months} meses",
  "risk_factors": ["lista de 4 riscos principais"]
}

Inclua 3 seções: diagnóstico, execução e escala. Seja específico, prático e orientado a resultados.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI: ${res.status}`);
  const data = await res.json();
  const strategy = JSON.parse(data.choices?.[0]?.message?.content || '{}');

  return new Response(JSON.stringify({ strategy }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function researchTrends(body: any, user: any, supabase: any, cors: Record<string, string>) {
  const { niche, platforms = ['instagram', 'tiktok', 'google'], language = 'pt-BR' } = body;
  if (!niche) throw new Error('Nicho é obrigatório');

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY não configurada');

  // Get Apify key from platform_integrations (optional)
  const { data: apifyIntegration } = await supabase
    .from('platform_integrations')
    .select('api_key_encrypted, is_active')
    .eq('user_id', user.id)
    .eq('platform', 'apify')
    .eq('is_active', true)
    .maybeSingle();

  const apifyToken = apifyIntegration?.api_key_encrypted;

  let scrapedData: Record<string, any[]> = {};

  // If Apify is configured, scrape real data
  if (apifyToken) {
    const apifyBase = 'https://api.apify.com/v2/acts';

    // Instagram hashtag scraping
    if (platforms.includes('instagram')) {
      try {
        const igRes = await fetch(
          `${apifyBase}/apify~instagram-hashtag-scraper/run-sync-get-dataset-items?token=${apifyToken}&timeout=25`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              hashtags: [niche.replace(/\s+/g, ''), `${niche.replace(/\s+/g, '')}brasil`],
              resultsLimit: 8,
            }),
          }
        );
        if (igRes.ok) {
          const igData = await igRes.json();
          scrapedData.instagram = (igData || []).slice(0, 8).map((p: any) => ({
            caption: p.caption?.slice(0, 200),
            likesCount: p.likesCount,
            commentsCount: p.commentsCount,
            type: p.type,
            hashtags: p.hashtags?.slice(0, 10),
          }));
        }
      } catch { /* ignore scraping errors */ }
    }

    // TikTok trend scraping
    if (platforms.includes('tiktok')) {
      try {
        const ttRes = await fetch(
          `${apifyBase}/clockworks~tiktok-scraper/run-sync-get-dataset-items?token=${apifyToken}&timeout=25`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              searchSection: `${niche}`,
              maxItems: 8,
              shouldDownloadCovers: false,
              shouldDownloadVideos: false,
            }),
          }
        );
        if (ttRes.ok) {
          const ttData = await ttRes.json();
          scrapedData.tiktok = (ttData || []).slice(0, 8).map((v: any) => ({
            text: v.text?.slice(0, 200),
            diggCount: v.diggCount,
            shareCount: v.shareCount,
            playCount: v.playCount,
            hashtags: v.hashtags?.slice(0, 8),
          }));
        }
      } catch { /* ignore */ }
    }

    // Google search scraping
    if (platforms.includes('google')) {
      try {
        const ggRes = await fetch(
          `${apifyBase}/apify~google-search-scraper/run-sync-get-dataset-items?token=${apifyToken}&timeout=25`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              queries: `${niche} tendencias 2025\n${niche} estrategias`,
              maxPagesPerQuery: 1,
              resultsPerPage: 5,
              languageCode: 'pt',
              countryCode: 'br',
            }),
          }
        );
        if (ggRes.ok) {
          const ggData = await ggRes.json();
          scrapedData.google = (ggData || []).slice(0, 10).map((r: any) => ({
            title: r.title,
            description: r.description?.slice(0, 200),
            url: r.url,
          }));
        }
      } catch { /* ignore */ }
    }
  }

  // Build context for Claude analysis
  const hasRealData = Object.values(scrapedData).some(d => d.length > 0);

  const dataContext = hasRealData
    ? `Dados reais coletados via scraping:\n${JSON.stringify(scrapedData, null, 2)}`
    : `(Sem dados de scraping disponíveis — use seu conhecimento sobre tendências digitais no Brasil em 2025)`;

  const systemPrompt = `Você é DANIEL, estrategista de conteúdo digital especialista em marketing brasileiro.
Analisa dados de redes sociais e cria pautas de conteúdo baseadas em tendências reais.
Retorne APENAS JSON válido, sem markdown.`;

  const userPrompt = `Analise tendências digitais para o nicho: "${niche}"
Idioma: ${language}
Plataformas alvo: ${platforms.join(', ')}

${dataContext}

Crie um relatório de tendências com 6 pautas de conteúdo. Retorne este JSON:
{
  "niche": "${niche}",
  "research_date": "${new Date().toISOString()}",
  "data_source": "${hasRealData ? 'apify_scraping' : 'ai_analysis'}",
  "trending_topics": [
    {
      "topic": "tema trending",
      "why_trending": "por que está em alta agora",
      "engagement_potential": "alto|médio|baixo",
      "best_format": "carrossel|reel|story|post",
      "best_platform": "instagram|tiktok|linkedin"
    }
  ],
  "content_briefs": [
    {
      "id": 1,
      "title": "título da pauta",
      "hook": "frase de abertura para fisgar atenção (max 15 palavras)",
      "format": "carrossel|reel|story|post",
      "platform": "instagram|tiktok|linkedin",
      "slides_or_points": ["ponto 1", "ponto 2", "ponto 3", "ponto 4", "ponto 5"],
      "cta": "chamada para ação final",
      "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
      "estimated_reach": "alto|médio|baixo",
      "reason": "por que esse conteúdo vai performar bem agora"
    }
  ],
  "viral_formats": [
    {
      "format": "nome do formato viral",
      "description": "como fazer",
      "example": "exemplo aplicado ao nicho"
    }
  ],
  "competitor_insights": "resumo de 2-3 linhas sobre o que concorrentes estão fazendo",
  "recommendation": "recomendação estratégica principal para o nicho agora"
}

Gere 6 content_briefs variados (mix de formatos), 5 trending_topics e 3 viral_formats.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4000,
      messages: [{ role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API: ${res.status}`);
  const aiData = await res.json();
  const rawContent = aiData.content?.[0]?.text || '{}';

  let research;
  try {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    research = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
  } catch {
    throw new Error('Resposta da IA inválida');
  }

  return new Response(JSON.stringify({ research, scraped: hasRealData }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function generateSwot(body: any, cors: Record<string, string>) {
  const { business_name, business_type, context } = body;
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) throw new Error('OpenAI não configurado');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Crie uma análise SWOT para ${business_name} (${business_type}). Contexto: ${context || 'empresa de médio porte'}. Retorne JSON: {"forcas": ["..."], "fraquezas": ["..."], "oportunidades": ["..."], "ameacas": ["..."]}. 5 itens em cada categoria.`,
      }],
      temperature: 0.7,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI: ${res.status}`);
  const data = await res.json();
  const swot = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  return new Response(JSON.stringify({ swot }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}
