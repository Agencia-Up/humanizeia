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
  // IMPORTANT: all responses use status 200 so Supabase SDK puts data in `data` not `error`
  // Errors are returned as { error: "message" } with status 200
  const ok = (payload: unknown) =>
    new Response(JSON.stringify(payload), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });

  const { niche, platforms = ['instagram', 'tiktok', 'google'] } = body;
  if (!niche?.trim()) return ok({ error: 'Nicho é obrigatório' });

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return ok({ error: 'ANTHROPIC_API_KEY não está configurada nas secrets do servidor' });

  const platformsList = Array.isArray(platforms) && platforms.length > 0
    ? platforms.join(', ')
    : 'instagram, tiktok, google';
  const now = new Date().toISOString();

  const prompt = `Você é DANIEL, estrategista de conteúdo digital especialista em marketing brasileiro.
Analise tendências para o nicho: "${niche.trim()}"
Plataformas foco: ${platformsList}

Retorne APENAS JSON válido sem markdown:
{"niche":"${niche.trim()}","research_date":"${now}","data_source":"ai_analysis","trending_topics":[{"topic":"tema 1","why_trending":"motivo","engagement_potential":"alto","best_format":"carrossel","best_platform":"instagram"},{"topic":"tema 2","why_trending":"motivo","engagement_potential":"médio","best_format":"reel","best_platform":"tiktok"},{"topic":"tema 3","why_trending":"motivo","engagement_potential":"alto","best_format":"post","best_platform":"instagram"},{"topic":"tema 4","why_trending":"motivo","engagement_potential":"médio","best_format":"story","best_platform":"instagram"},{"topic":"tema 5","why_trending":"motivo","engagement_potential":"alto","best_format":"carrossel","best_platform":"instagram"}],"content_briefs":[{"id":1,"title":"título","hook":"hook em até 15 palavras","format":"carrossel","platform":"instagram","slides_or_points":["slide 1","slide 2","slide 3","slide 4","slide 5"],"cta":"chamada para ação","hashtags":["tag1","tag2","tag3","tag4","tag5"],"estimated_reach":"alto","reason":"motivo"},{"id":2,"title":"título","hook":"hook","format":"reel","platform":"tiktok","slides_or_points":["ponto 1","ponto 2","ponto 3","ponto 4","ponto 5"],"cta":"cta","hashtags":["tag1","tag2","tag3","tag4","tag5"],"estimated_reach":"alto","reason":"motivo"},{"id":3,"title":"título","hook":"hook","format":"carrossel","platform":"instagram","slides_or_points":["s1","s2","s3","s4","s5"],"cta":"cta","hashtags":["t1","t2","t3","t4","t5"],"estimated_reach":"médio","reason":"motivo"},{"id":4,"title":"título","hook":"hook","format":"reel","platform":"instagram","slides_or_points":["p1","p2","p3","p4","p5"],"cta":"cta","hashtags":["t1","t2","t3","t4","t5"],"estimated_reach":"alto","reason":"motivo"},{"id":5,"title":"título","hook":"hook","format":"post","platform":"instagram","slides_or_points":["i1","i2","i3","i4","i5"],"cta":"cta","hashtags":["t1","t2","t3","t4","t5"],"estimated_reach":"médio","reason":"motivo"},{"id":6,"title":"título","hook":"hook","format":"carrossel","platform":"tiktok","slides_or_points":["a1","a2","a3","a4","a5"],"cta":"cta","hashtags":["t1","t2","t3","t4","t5"],"estimated_reach":"alto","reason":"motivo"}],"viral_formats":[{"format":"formato 1","description":"como fazer","example":"exemplo no nicho"},{"format":"formato 2","description":"como fazer","example":"exemplo no nicho"},{"format":"formato 3","description":"como fazer","example":"exemplo no nicho"}],"competitor_insights":"o que concorrentes estão fazendo no nicho","recommendation":"recomendação estratégica principal"}

Substitua todos os placeholders por conteúdo real e específico para o nicho "${niche.trim()}".`;

  let aiRes: Response;
  try {
    aiRes = await fetch('https://api.anthropic.com/v1/messages', {
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
  } catch (fetchErr: any) {
    return ok({ error: `Falha de rede ao chamar Claude: ${fetchErr.message}` });
  }

  if (!aiRes.ok) {
    const errText = await aiRes.text().catch(() => '');
    return ok({ error: `Claude API retornou ${aiRes.status}: ${errText.slice(0, 200)}` });
  }

  let aiData: any;
  try {
    aiData = await aiRes.json();
  } catch {
    return ok({ error: 'Falha ao parsear resposta da Claude API' });
  }

  const rawText: string = aiData?.content?.[0]?.text ?? '';
  if (!rawText) return ok({ error: 'Claude retornou resposta vazia' });

  let research: Record<string, unknown>;
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    research = JSON.parse(match ? match[0] : rawText);
  } catch {
    // Return the raw text so we can debug
    return ok({ error: `Claude não retornou JSON válido. Resposta: ${rawText.slice(0, 300)}` });
  }

  return ok({ research, scraped: false });
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
