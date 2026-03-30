import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Utils para garantir que o cliente Supabase Frontend leia o JSON do erro
// O Supabase SDK oculta o corpo se retornarmos 400/500, dando o erro genérico "non-2xx status code".
const sendOkResponse = (payload: any) => 
  new Response(JSON.stringify(payload), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

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

    if (action === 'generate_strategy') {
      return await generateStrategy(body);
    }

    if (action === 'research_trends') {
      return await researchTrends(body);
    }

    if (action === 'generate_swot') {
      return await generateSwot(body);
    }

    return sendOkResponse({ error: `Ação desconhecida: ${action}` });
  } catch (err: any) {
    console.error("Erro Crítico na Edge Function:", err.message);
    return sendOkResponse({ error: err.message });
  }
});

async function generateStrategy(body: any) {
  const {
    business_name, business_type, strategy_type, current_situation,
    main_challenge, budget, timeframe_months = 6,
  } = body;

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return sendOkResponse({ error: 'ANTHROPIC_API_KEY não configurada no Supabase. Configure-a no painel.' });

  const prompt = `Você é DANIEL, um consultor estratégico de negócios de elite (Nível CEO/Board-Level), com especialização avançada em neuromarketing, engenharia de crescimento e tração escalável em mercados hiper-competitivos.
Sua análise é profunda, ácida, direta ao ponto e extremamente acionável. Nada de clichês motivacionais.
Traga táticas não óbvias, explore a psicologia profunda do consumidor e traga alavancas reais de conversão e estruturação para dominar o nicho ignorando a concorrência tradicional.

Crie um plano estratégico definitivo para:
Empresa: ${business_name}
Tipo: ${business_type}
Estratégia: ${strategy_type}
Situação Atual: ${current_situation || 'Não informada'}
Desafio: ${main_challenge}
Orçamento: ${budget || 'Não informado'}
Prazo: ${timeframe_months} meses

Aprofunde significativamente em cada seção (use múltiplos bullets técnicos).
Retorne APENAS o JSON puro, sem markdown:
{
  "title": "título impactante do plano estratégico",
  "executive_summary": "resumo executivo magistral e longo, com sua visão não-óbvia sobre a empresa de acordo com as falhas do mercado atual",
  "sections": [{"icon": "emoji", "title": "título da seção", "content": "conteúdo extremamente técnico, longo, detalhado com balas táticas passo-a-passo (seja agressivo e prático)"}],
  "key_metrics": ["kpi ultra-específico 1", "kpi de LTV/CAC 2", "kpi cirúrgico 3", "kpi 4", "kpi 5"],
  "timeline": "${timeframe_months} meses",
  "risk_factors": ["risco de modelo de negócios 1", "risco de retenção 2", "risco de desvantagem competitiva 3", "risco 4"]
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
        model: 'claude-3-opus-20240229',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return sendOkResponse({ error: `Falha na API Claude: ${errText.slice(0, 150)}` });
    }

    const aiData = await aiRes.json();
    const rawText = aiData?.content?.[0]?.text ?? '';
    const match = rawText.match(/\{[\s\S]*\}/);
    const strategy = JSON.parse(match ? match[0] : rawText);

    return sendOkResponse({ strategy });
  } catch (err: any) {
    return sendOkResponse({ error: `Erro processando a estratégia: ${err.message}` });
  }
}

async function researchTrends(body: any) {
  const { niche, platforms = ['instagram', 'tiktok', 'google'] } = body;
  
  if (!niche?.trim()) return sendOkResponse({ error: 'O Nicho do cliente é obrigatório para realizar a pesquisa.' });

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return sendOkResponse({ error: 'ANTHROPIC_API_KEY não configurada no Supabase Secrets.' });

  const platformsList = Array.isArray(platforms) ? platforms.join(', ') : 'instagram, tiktok, google';
  const now = new Date().toISOString();

  const prompt = `Você é DANIEL, o Estrategista-Chefe (CMO/CEO nível Black) de uma das maiores agências de engajamento do mundo, um gênio em engenharia de viralidade, neuromarketing e hack de atenção.
Você está preparando a pesquisa de campo definitiva sobre este nicho brutal.

Nicho do usuário: "${niche.trim()}". 
Plataformas foco: ${platformsList}.

INSTRUÇÕES DE QUALIDADE EXTREMA E PROFUNDIDADE:
1. "recommendation": Escreva uma Tese Central longo e visceral (um parágrafo mestre de CEO). Ignore o clichê "faça parcerias". Revele uma alavanca oculta, use ganchos de persuasão e neuromarketing. Fale grosso sobre posicionamento magnético.
2. "trending_topics": Tópicos obscuros de alta conversão. Em vez de "dicas simples", fale "Como a assimetria da informação impacta X às sextas-feiras". O "why_trending" deve trazer a raiz psicossocial profunda (ex: enviesamento límbico).
3. "content_briefs": Pautas brilhantes de alto impacto. 
   - "hook" deve ser uma frase bizarra, de prender o scroll instantaneamente (exótico, paradoxal ou autoritário).
   - "slides_or_points" devem ser passos acionáveis, ouro puro em forma de insights que ninguém fala. Pelo menos 5.
   - "reason" deve detalhar exatamente porque isso funciona neuro-psicologicamente contra o algoritmo.
4. "viral_formats": "description" revela a estrutura invisível da retenção, e "example" destrincha o arcabouço da copy viral.

Retorne EXATAMENTE este JSON puro, sem marcadores ou markdown:
{
  "niche": "${niche.trim()}",
  "research_date": "${now}",
  "data_source": "ai_analysis",
  "recommendation": "Sua tese central brutal de no mínimo 6 linhas detalhadas de um CEO",
  "trending_topics": [
    {
      "topic": "Micro-tendência hiper-específica",
      "why_trending": "Desconstrução comportamental e psicológica do motivo exato pela qual engaja",
      "engagement_potential": "alto",
      "best_format": "carrossel ou reel_script",
      "best_platform": "instagram"
    },
    { "topic": "...", "why_trending": "...", "engagement_potential": "alto", "best_format": "...", "best_platform": "..." },
    { "topic": "...", "why_trending": "...", "engagement_potential": "médio", "best_format": "...", "best_platform": "..." }
  ],
  "content_briefs": [
    {
      "id": 1,
      "title": "Tese exótica ou Polêmica",
      "hook": "Uma frase de gancho completamente fora da curva, provocadora",
      "format": "carrossel / reel_script",
      "platform": "instagram",
      "slides_or_points": ["Insight brutal 1 - Detalhado", "Tática escondida 2", "Inversão de crença 3", "Solução irrefutável 4", "Chamada hipnótica 5"],
      "cta": "Ultimato irresistível",
      "hashtags": ["microtag1", "tagforte2", "gatilho3", "nicho4"],
      "estimated_reach": "alto",
      "reason": "Análise neurocientífica: por que isso domina o cérebro límbico e prende a atenção."
    },
    { "id": 2, "title": "...", "hook": "...", "format": "...", "platform": "...", "slides_or_points": ["...","...","...","...","..."], "cta": "...", "hashtags": ["..."], "estimated_reach": "alto", "reason": "..." },
    { "id": 3, "title": "...", "hook": "...", "format": "...", "platform": "...", "slides_or_points": ["...","...","...","...","..."], "cta": "...", "hashtags": ["..."], "estimated_reach": "médio", "reason": "..." }
  ],
  "viral_formats": [
    {
      "format": "Nome da estrutura (ex: O Contraste Brutal / Inversão de Status)",
      "description": "Psicologia da Retenção: O que faz as pessoas não conseguirem parar de ver.",
      "example": "Esqueleto prático: (1) O problema ignorado... (2) A falsa solução... (3) O segredo... (4) O resultado."
    },
    { "format": "...", "description": "...", "example": "..." }
  ]
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
        model: 'claude-3-opus-20240229',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return sendOkResponse({ error: `Falha na comunicação com o provedor de IA (Claude): ${errText.slice(0, 150)}` });
    }

    const aiData = await aiRes.json();
    const rawText = aiData?.content?.[0]?.text ?? '';
    const match = rawText.match(/\{[\s\S]*\}/);
    
    if (!match) {
      return sendOkResponse({ error: `A IA não retornou um formato válido. Resposta: ${rawText.slice(0, 100)}` });
    }

    const research = JSON.parse(match[0]);
    return sendOkResponse({ research, scraped: false });
  } catch (err: any) {
    return sendOkResponse({ error: `Falha ao construir pesquisa: ${err.message}` });
  }
}

async function generateSwot(body: any) {
  const { business_name, business_type, context } = body;
  
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return sendOkResponse({ error: 'ANTHROPIC_API_KEY falhou (Verifique as Secrets no Painel)' });

  const prompt = `Crie uma Análise SWOT (Matrix) absurdamente profunda, a nível de M&A e Board de Investimentos, para o negócio: ${business_name} (${business_type}). 
Contexto: ${context || 'empresa de médio porte'}.

Mostre maturidade executiva de alto nível. Cada ponto deve ser extenso, tático e considerar dinâmicas competitivas avançadas.
Retorne APENAS o JSON puro, sem markdown:
{"forcas":["f1 técnico pesado","f2","f3","f4","f5"], "fraquezas":["..."], "oportunidades":["..."], "ameacas":["..."]}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 2500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return sendOkResponse({ error: `Falha no modelo Claude: ${errText.slice(0, 150)}` });
    }

    const aiData = await aiRes.json();
    const rawText = aiData?.content?.[0]?.text ?? '';
    const match = rawText.match(/\{[\s\S]*\}/);
    const swot = JSON.parse(match ? match[0] : rawText);

    return sendOkResponse({ swot });
  } catch (err: any) {
    return sendOkResponse({ error: `Falha ao processar análise SWOT: ${err.message}` });
  }
}
