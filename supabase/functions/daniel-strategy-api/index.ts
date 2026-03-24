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
