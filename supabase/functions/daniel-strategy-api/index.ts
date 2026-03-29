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
    console.log(`Action: ${action} iniciada pelo usuário ${user.id}`);

    if (action === 'generate_strategy') {
      return await generateStrategy(body, corsHeaders);
    }

    if (action === 'research_trends') {
      return await researchTrends(body, corsHeaders);
    }

    if (action === 'generate_swot') {
      return await generateSwot(body, corsHeaders);
    }

    return new Response(JSON.stringify({ error: `Ação desconhecida: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error("Erro Crítico na Edge Function:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function generateStrategy(body: any, cors: Record<string, string>) {
  const errorRes = (msg: string, status = 400) => 
    new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  const {
    business_name, business_type, strategy_type, current_situation,
    main_challenge, budget, timeframe_months = 6,
  } = body;

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return errorRes('ANTHROPIC_API_KEY não configurada no Supabase', 500);

  const prompt = `Você é DANIEL, consultor estratégico de negócios de alto nível. Especialista em marketing digital e crescimento.

Crie um plano estratégico para:
Empresa: ${business_name}
Tipo: ${business_type}
Estratégia: ${strategy_type}
Situação Atual: ${current_situation || 'Não informada'}
Desafio: ${main_challenge}
Orçamento: ${budget || 'Não informado'}
Prazo: ${timeframe_months} meses

Retorne APENAS o JSON puro, sem markdown, contendo:
{
  "title": "título do plano estratégico",
  "executive_summary": "resumo executivo",
  "sections": [{"icon": "emoji", "title": "título da seção", "content": "conteúdo detalhado com marcadores/bullet points"}],
  "key_metrics": ["kpi 1", "kpi 2", "kpi 3", "kpi 4", "kpi 5"],
  "timeline": "${timeframe_months} meses",
  "risk_factors": ["risco 1", "risco 2", "risco 3", "risco 4"]
}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return errorRes(`Claude API Error ${aiRes.status}: ${errText.slice(0, 150)}`, 502);
    }

    const aiData = await aiRes.json();
    const rawText = aiData?.content?.[0]?.text ?? '';
    const match = rawText.match(/\{[\s\S]*\}/);
    const strategy = JSON.parse(match ? match[0] : rawText);

    return new Response(JSON.stringify({ strategy }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return errorRes(`Erro processando estratégia: ${err.message}`, 500);
  }
}

async function researchTrends(body: any, cors: Record<string, string>) {
  const { niche, platforms = ['instagram', 'tiktok', 'google'] } = body;
  
  const errorRes = (msg: string, status = 400) => 
    new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (!niche?.trim()) return errorRes('Nicho é obrigatório');

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return errorRes('ANTHROPIC_API_KEY não configurada no Supabase', 500);

  const platformsList = Array.isArray(platforms) ? platforms.join(', ') : 'instagram, tiktok, google';
  const now = new Date().toISOString();

  const prompt = `Você é DANIEL, estrategista de tendências. Analise o nicho: "${niche.trim()}". Foco em: ${platformsList}. 
  Retorne APENAS o JSON puro, sem markdown:
  {"niche":"${niche.trim()}","research_date":"${now}","data_source":"ai_analysis","trending_topics":[{"topic":"tema","why_trending":"motivo","engagement_potential":"alto","best_format":"carrossel","best_platform":"instagram"}],"content_briefs":[{"id":1,"title":"titulo","hook":"gancho","format":"carrossel","platform":"instagram","slides_or_points":["p1","p2","p3","p4","p5"],"cta":"chamada","hashtags":["t1","t2"],"estimated_reach":"alto","reason":"pq"}],"viral_formats":[{"format":"f1","description":"como","example":"ex"}],"competitor_insights":"insights","recommendation":"recomendação"}`;

  try {
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
      const errText = await aiRes.text();
      return errorRes(`Claude API Error ${aiRes.status}: ${errText.slice(0, 150)}`, 502);
    }

    const aiData = await aiRes.json();
    const rawText = aiData?.content?.[0]?.text ?? '';
    const match = rawText.match(/\{[\s\S]*\}/);
    const research = JSON.parse(match ? match[0] : rawText);

    return new Response(JSON.stringify({ research, scraped: false }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return errorRes(`Erro processando pesquisa: ${err.message}`, 500);
  }
}

async function generateSwot(body: any, cors: Record<string, string>) {
  const errorRes = (msg: string, status = 400) => 
    new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  const { business_name, business_type, context } = body;
  
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return errorRes('ANTHROPIC_API_KEY não configurada no Supabase', 500);

  const prompt = `Crie uma análise SWOT para o negócio: ${business_name} (${business_type}). 
Contexto: ${context || 'empresa de médio porte'}.

Retorne APENAS o JSON puro, sem markdown:
{"forcas":["f1","f2","f3","f4","f5"], "fraquezas":["..."], "oportunidades":["..."], "ameacas":["..."]}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return errorRes(`Claude API Error ${aiRes.status}: ${errText.slice(0, 150)}`, 502);
    }

    const aiData = await aiRes.json();
    const rawText = aiData?.content?.[0]?.text ?? '';
    const match = rawText.match(/\{[\s\S]*\}/);
    const swot = JSON.parse(match ? match[0] : rawText);

    return new Response(JSON.stringify({ swot }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return errorRes(`Erro processando SWOT: ${err.message}`, 500);
  }
}
