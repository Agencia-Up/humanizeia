import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const sendOkResponse = (payload: any) => 
  new Response(JSON.stringify(payload), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

async function callAI(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  const openaiKey = Deno.env.get('OPENAI_API_KEY');

  let anthropicError = '';

  // 1. Tentar Anthropic (Claude 3.5 Sonnet) primeiro
  if (anthropicKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data?.content?.[0]?.text ?? '';
      }
      anthropicError = await res.text();
      console.error('Falha Anthropic:', anthropicError);
    } catch (e: any) {
      anthropicError = e.message;
      console.error('Erro Anthropic:', e);
    }
  }

  // 2. Fallback para OpenAI (GPT-4o) se a Anthropic falhar (ex: bloqueio de tier)
  if (openaiKey) {
    console.log('Iniciando fallback para OpenAI GPT-4o devido a falha na Anthropic.');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: "json_object" },
      }),
    });
    
    if (res.ok) {
        const data = await res.json();
        return data?.choices?.[0]?.message?.content ?? '';
    } else {
        const err = await res.text();
        throw new Error(`Ambas as APIs falharam. Anthropic: ${anthropicError}. OpenAI: ${err}`);
    }
  }

  throw new Error(`Falha na IA. Anthropic Error: ${anthropicError}. (E OpenAI não configurado). Verifique as chaves.`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return sendOkResponse({ error: 'Não autorizado' });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return sendOkResponse({ error: 'Token inválido' });

    const body = await req.json();
    const { action } = body;
    console.log(`Action: ${action} iniciada pelo usuário ${user.id}`);

    if (action === 'generate_strategy') return await generateStrategy(body);
    if (action === 'research_trends') return await researchTrends(body);
    if (action === 'generate_swot') return await generateSwot(body);

    return sendOkResponse({ error: `Ação desconhecida: ${action}` });
  } catch (err: any) {
    console.error("Erro Crítico na Edge Function:", err.message);
    return sendOkResponse({ error: err.message });
  }
});

async function generateStrategy(body: any) {
  const { business_name, business_type, strategy_type, current_situation, main_challenge, budget, timeframe_months = 6 } = body;

  const systemPrompt = `Você é DANIEL, um consultor estratégico de negócios de elite (Nível CEO/Board-Level), com especialização avançada em neuromarketing, engenharia de crescimento e tração escalável em mercados hiper-competitivos.
Sua análise é profunda, ácida, direta ao ponto e extremamente acionável. Nada de clichês motivacionais.
Traga táticas não óbvias, explore a psicologia profunda do consumidor e traga alavancas reais de conversão e estruturação para dominar o nicho ignorando a concorrência tradicional.
Retorne APENAS um objeto JSON válido, sem comentários ou formatação markdown adicional.`;

  const userPrompt = `Crie um plano estratégico definitivo para:
Empresa: ${business_name}
Tipo: ${business_type}
Estratégia: ${strategy_type}
Situação Atual: ${current_situation || 'Não informada'}
Desafio: ${main_challenge}
Orçamento: ${budget || 'Não informado'}
Prazo: ${timeframe_months} meses

Aprofunde significativamente em cada seção (use múltiplos bullets técnicos).
Formato JSON esperado:
{
  "title": "título impactante do plano estratégico",
  "executive_summary": "resumo executivo magistral e longo...",
  "sections": [{"icon": "emoji", "title": "título da seção", "content": "conteúdo extremamente técnico..."}],
  "key_metrics": ["kpi ultra-específico 1", "kpi de LTV/CAC 2", "kpi cirúrgico 3", "kpi 4", "kpi 5"],
  "timeline": "${timeframe_months} meses",
  "risk_factors": ["risco de modelo de negócios 1", "risco de retenção 2", "risco de desvantagem competitiva 3", "risco 4"]
}`;

  try {
    const rawText = await callAI(systemPrompt, userPrompt, 4000);
    const match = rawText.match(/\{[\s\S]*\}/);
    return sendOkResponse({ strategy: JSON.parse(match ? match[0] : rawText) });
  } catch (err: any) {
    return sendOkResponse({ error: `Erro processando a estratégia: ${err.message}` });
  }
}

async function researchTrends(body: any) {
  const { niche, platforms = ['instagram', 'tiktok', 'google'] } = body;
  if (!niche?.trim()) return sendOkResponse({ error: 'O Nicho do cliente é obrigatório para realizar a pesquisa.' });

  const platformsList = Array.isArray(platforms) ? platforms.join(', ') : 'instagram, tiktok, google';
  const now = new Date().toISOString();

  const systemPrompt = `Você é DANIEL, o Estrategista-Chefe (CMO/CEO nível Black) de uma das maiores agências de engajamento do mundo, um gênio em engenharia de viralidade, neuromarketing e hack de atenção.
O nicho do usuário é: "${niche.trim()}". Plataformas foco: ${platformsList}.
Retorne APENAS um objeto JSON válido, sem tags markdown ou texto fora do JSON.`;

  const userPrompt = `INSTRUÇÕES DE QUALIDADE EXTREMA E PROFUNDIDADE:
1. "recommendation": Escreva uma Tese Central longo e visceral (um parágrafo mestre de CEO). Ignore o clichê "faça parcerias". Revele uma alavanca oculta, use ganchos de persuasão e neuromarketing. Fale grosso sobre posicionamento magnético.
2. "trending_topics": Tópicos obscuros de alta conversão. O "why_trending" deve trazer a raiz psicossocial profunda (ex: enviesamento límbico).
3. "content_briefs": Pautas brilhantes de alto impacto. 
   - "hook" deve ser uma frase bizarra, de prender o scroll instantaneamente.
   - "slides_or_points" devem ser passos acionáveis.
   - "reason" deve detalhar exatamente porque isso funciona neuro-psicologicamente contra o algoritmo.
4. "viral_formats": "description" revela a estrutura invisível da retenção, e "example" destrincha o arcabouço da copy viral.

Formato JSON EXATO esperado:
{
  "niche": "${niche.trim()}",
  "research_date": "${now}",
  "data_source": "ai_analysis",
  "recommendation": "Sua tese central brutal de no mínimo 6 linhas...",
  "trending_topics": [{"topic": "micro-tendência", "why_trending": "motivo...", "engagement_potential": "alto", "best_format": "reel_script", "best_platform": "instagram"}],
  "content_briefs": [{"id": 1, "title": "Tese exótica", "hook": "Gancho matador", "format": "reel_script", "platform": "instagram", "slides_or_points": ["Insight 1", "Tática 2", "Opinião 3", "Ação 4", "CTA 5"], "cta": "Ultimato irresistível", "hashtags": ["t1", "t2"], "estimated_reach": "alto", "reason": "neurociência por trás"}],
  "viral_formats": [{"format": "Nome formato", "description": "Psicologia da Retenção...", "example": "Esqueleto prático"}]
}`;

  try {
    const rawText = await callAI(systemPrompt, userPrompt, 4000);
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("A IA não retornou um formato JSON válido");
    return sendOkResponse({ research: JSON.parse(match[0]), scraped: false });
  } catch (err: any) {
    return sendOkResponse({ error: `Falha na pesquisa: ${err.message}` });
  }
}

async function generateSwot(body: any) {
  const { business_name, business_type, context } = body;
  
  const systemPrompt = `Você é um Analista Estratégico Sênior focado em Board Executivo. Retorne APENAS um objeto JSON válido.`;
  const userPrompt = `Crie uma Análise SWOT (Matrix) absurdamente profunda, a nível de M&A e Board de Investimentos, para o negócio: ${business_name} (${business_type}). 
Contexto: ${context || 'empresa de médio porte'}.
Mostre maturidade executiva de alto nível. Cada ponto deve ser extenso, tático e considerar dinâmicas competitivas avançadas.
Retorne APENAS o JSON:
{"forcas":["f1 técnico pesado","f2","f3","f4","f5"], "fraquezas":["..."], "oportunidades":["..."], "ameacas":["..."]}`;

  try {
    const rawText = await callAI(systemPrompt, userPrompt, 2500);
    const match = rawText.match(/\{[\s\S]*\}/);
    return sendOkResponse({ swot: JSON.parse(match ? match[0] : rawText) });
  } catch (err: any) {
    return sendOkResponse({ error: `Falha SWOT: ${err.message}` });
  }
}
