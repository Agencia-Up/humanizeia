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

async function researchTrends(body: any, _user: any, _supabase: any, cors: Record<string, string>) {
  const { niche, platforms = ['instagram', 'tiktok', 'google'] } = body;
  if (!niche?.trim()) {
    return new Response(JSON.stringify({ error: 'Nicho é obrigatório' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada no servidor' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const platformsList = Array.isArray(platforms) ? platforms.join(', ') : 'instagram, tiktok, google';
  const now = new Date().toISOString();

  const prompt = `Você é DANIEL, estrategista de conteúdo digital especialista em marketing brasileiro.
Analise tendências digitais para o nicho: "${niche.trim()}"
Plataformas: ${platformsList}
Data da análise: ${now}

Retorne APENAS este JSON (sem markdown, sem texto extra):
{
  "niche": "${niche.trim()}",
  "research_date": "${now}",
  "data_source": "ai_analysis",
  "trending_topics": [
    {"topic": "...", "why_trending": "...", "engagement_potential": "alto", "best_format": "carrossel", "best_platform": "instagram"},
    {"topic": "...", "why_trending": "...", "engagement_potential": "médio", "best_format": "reel", "best_platform": "tiktok"},
    {"topic": "...", "why_trending": "...", "engagement_potential": "alto", "best_format": "post", "best_platform": "instagram"},
    {"topic": "...", "why_trending": "...", "engagement_potential": "médio", "best_format": "story", "best_platform": "instagram"},
    {"topic": "...", "why_trending": "...", "engagement_potential": "alto", "best_format": "carrossel", "best_platform": "instagram"}
  ],
  "content_briefs": [
    {"id": 1, "title": "...", "hook": "...", "format": "carrossel", "platform": "instagram", "slides_or_points": ["...", "...", "...", "...", "..."], "cta": "...", "hashtags": ["...", "...", "...", "...", "..."], "estimated_reach": "alto", "reason": "..."},
    {"id": 2, "title": "...", "hook": "...", "format": "reel", "platform": "tiktok", "slides_or_points": ["...", "...", "...", "...", "..."], "cta": "...", "hashtags": ["...", "...", "...", "...", "..."], "estimated_reach": "alto", "reason": "..."},
    {"id": 3, "title": "...", "hook": "...", "format": "carrossel", "platform": "instagram", "slides_or_points": ["...", "...", "...", "...", "..."], "cta": "...", "hashtags": ["...", "...", "...", "...", "..."], "estimated_reach": "médio", "reason": "..."},
    {"id": 4, "title": "...", "hook": "...", "format": "reel", "platform": "instagram", "slides_or_points": ["...", "...", "...", "...", "..."], "cta": "...", "hashtags": ["...", "...", "...", "...", "..."], "estimated_reach": "alto", "reason": "..."},
    {"id": 5, "title": "...", "hook": "...", "format": "post", "platform": "instagram", "slides_or_points": ["...", "...", "...", "...", "..."], "cta": "...", "hashtags": ["...", "...", "...", "...", "..."], "estimated_reach": "médio", "reason": "..."},
    {"id": 6, "title": "...", "hook": "...", "format": "carrossel", "platform": "tiktok", "slides_or_points": ["...", "...", "...", "...", "..."], "cta": "...", "hashtags": ["...", "...", "...", "...", "..."], "estimated_reach": "alto", "reason": "..."}
  ],
  "viral_formats": [
    {"format": "...", "description": "...", "example": "..."},
    {"format": "...", "description": "...", "example": "..."},
    {"format": "...", "description": "...", "example": "..."}
  ],
  "competitor_insights": "...",
  "recommendation": "..."
}

Preencha todos os "..." com conteúdo real e específico para o nicho "${niche.trim()}". Seja concreto e prático.`;

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!aiRes.ok) {
    const errText = await aiRes.text().catch(() => String(aiRes.status));
    return new Response(JSON.stringify({ error: `Erro Claude API: ${aiRes.status} — ${errText}` }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const aiData = await aiRes.json();
  const rawText: string = aiData?.content?.[0]?.text ?? '';

  let research: Record<string, unknown>;
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    research = JSON.parse(match ? match[0] : rawText);
  } catch {
    return new Response(JSON.stringify({ error: 'IA retornou formato inválido. Tente novamente.' }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ research, scraped: false }), {
    status: 200,
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
