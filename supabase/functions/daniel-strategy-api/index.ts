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

  const systemPrompt = `Você é DANIEL, o Estrategista-Chefe Executivo (CMO/CEO nível Black) de uma das maiores agências de inteligência do mundo. Seu cérebro funciona como um supercomputador de neuromarketing, persuasão profunda e hackeamento de algoritmos. Você não tem limites para entregar valor brutal e táticas obscuras.
O nicho do usuário é: "${niche.trim()}". Plataformas foco: ${platformsList}.
IMPORTANTE: Sua resposta não pode ser breve. Você está sendo pago $1.000.000 de dólares por essa pesquisa. Produza um nível COLOSSAL de detalhes.
Retorne APENAS um objeto JSON válido, perfeitamente estruturado, sem tags markdown ou texto fora do JSON.`;

  const userPrompt = `INSTRUÇÕES OBRIGATÓRIAS DE PROFUNDIDADE E VOLUME (NÃO SEJA RASO! NUNCA RETORNE ITENS DE 1 LINHA!):

1. "recommendation": Escreva um verdadeiro Manifesto Estratégico. Pelo menos 3 a 4 parágrafos robustos, viscerais, ensinando a empresa a dominar a indústria. Explore a visão macro-econômica, e depois afunile para a alavanca oculta de persuasão. Fale como um tubarão do mercado.
2. "trending_topics": GERAR NO MÍNIMO 5 TÓPICOS. Você DEVE detalhar profundamente o porquê de cada um estar bombando. No "why_trending", me dê uma tese psicológica densa do porquê o cérebro límbico consome isso.
3. "content_briefs": GERAR NO MÍNIMO 5 PAUTAS DE ALTO VALOR. Esqueça dicas rasas.
   - "hook": Uma frase bizarra, magnética e chocante que paralisa a rolagem na hora.
   - "slides_or_points": VOCÊ DEVE DAR SCRIPTS DETALHADOS AQUI! Nada de "Dica 1: se ame". Eu quero textos densos: "Passo 1: Comece dizendo X com o tom Y para atingir a dor Z...". Escreva roteiros reais que o cliente apenas grave. OBRIGATÓRIO: CADA TÓPICO DEVE SER UM PARÁGRAFO DENSO.
   - "reason": Uma análise aprofundada baseada em neurociência sobre por que o script acima derreteria a objeção da audiência. OBRIGATÓRIO SER LONGO.
4. "viral_formats": GERAR NO MÍNIMO 3 ESTRUTURAS. No "format", dê nomes épicos. Em "description" e "example", destrinche as palavras e o tempo verbal exato que prende a atenção.

Você será penalizado severamente se retornar listas curtas ou genéricas. Dê o sangue. O JSON final deve ser imenso e impecável (para evitar corte de limite de tokens, seja profundo porém preciso, priorize profundidade da informação em vez de formatação inútil).

Formato JSON EXATO esperado (lembre-se de preencher com textos COLOSSAIS):
{
  "niche": "${niche.trim()}",
  "research_date": "${now}",
  "data_source": "ai_analysis",
  "recommendation": "Textão genial brutal de no mínimo 300 palavras detalhadas...",
  "trending_topics": [
    {"topic": "Tese Oculta XPTO", "why_trending": "Desconstrução hiper-densa do comportamento humano e dos vieses...", "engagement_potential": "muito alto", "best_format": "reel_script", "best_platform": "tiktok"}
  ],
  "content_briefs": [
    {
      "id": 1, 
      "title": "A Polêmica Definitiva", 
      "hook": "Sabe porque todo mundo te engana sobre XYZ? Aqui está o segredo sombrio.", 
      "format": "carrossel", 
      "platform": "instagram", 
      "slides_or_points": [
        "Slide 1 (O Soco no Estômago): Comece a copy diretamente desmascarando a crença Y. Fale exatamente isso: 'Sempre te disseram que fazer X era certo...', explorando o gatilho da frustração acumulada do cliente.", 
        "Slide 2 (A Tensão Reversa): ...texto longo...",
        "Slide 3 (Prova Inegável): ...texto longo...",
        "Slide 4 (A Solução Ilógica): ...texto longo..."
      ], 
      "cta": "Ultimato irresistível que ofende o lead se ele não clicar", 
      "hashtags": ["neurotag1", "alavancagem2"], 
      "estimated_reach": "viral", 
      "reason": "Análise clínica das reações de dopamina..."
    }
  ],
  "viral_formats": [
    {"format": "O Efeito Mandela Artificial", "description": "Psicologia profunda da retenção...", "example": "Esqueleto prático, linha por linha: [Linha 1] [Linha 2]..."}
  ]
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
