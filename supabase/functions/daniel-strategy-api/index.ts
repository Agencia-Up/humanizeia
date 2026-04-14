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

  if (openaiKey) {
    console.log('Iniciando fallback para OpenAI GPT-4o.');
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
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data?.choices?.[0]?.message?.content ?? '';
    }
    const err = await res.text();
    throw new Error(`Ambas as APIs falharam. Anthropic: ${anthropicError}. OpenAI: ${err}`);
  }

  throw new Error(`Falha na IA. Anthropic Error: ${anthropicError}. OpenAI não configurada.`);
}

// ─────────────────────────────────────────────────────────────────────────────

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
    console.log(`Action: ${action} — user ${user.id}`);

    // Inject client briefing context automatically from Supabase for research
    let clientContext = '';
    try {
      const { data: briefing } = await supabase
        .from('client_briefings')
        .select('client_name, business_name, product_service, target_audience, main_offer, differentiators, tone_of_voice')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (briefing) {
        const b = briefing as any;
        const parts: string[] = [];
        if (b.business_name || b.client_name) parts.push(`Empresa: ${b.business_name || b.client_name}`);
        if (b.product_service) parts.push(`Produto/Serviço: ${b.product_service}`);
        if (b.target_audience) parts.push(`Público-alvo: ${b.target_audience}`);
        if (b.main_offer) parts.push(`Oferta principal: ${b.main_offer}`);
        if (b.differentiators) parts.push(`Diferenciais: ${b.differentiators}`);
        if (b.tone_of_voice) parts.push(`Tom de voz: ${b.tone_of_voice}`);
        clientContext = parts.join('\n');
      }
    } catch (_) {
      // silently ignore — briefing is optional context
    }

    if (action === 'generate_strategy') return await generateStrategy(body);
    if (action === 'research_trends') return await researchTrends(body, clientContext);
    if (action === 'generate_swot') return await generateSwot(body);
    if (action === 'analyze_reference') return await analyzeReference(body);

    return sendOkResponse({ error: `Ação desconhecida: ${action}` });
  } catch (err: any) {
    console.error('Erro Crítico na Edge Function:', err.message);
    return sendOkResponse({ error: err.message });
  }
});

// ─── generate_strategy ────────────────────────────────────────────────────────

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

// ─── research_trends (MOTOR 2.0) ─────────────────────────────────────────────

async function researchTrends(body: any, clientContext: string) {
  const { niche, links, platforms = ['instagram', 'tiktok', 'google'] } = body;
  if (!niche?.trim()) return sendOkResponse({ error: 'O Nicho do cliente é obrigatório.' });

  const platformsList = Array.isArray(platforms) ? platforms.join(', ') : 'instagram, tiktok, google';
  const now = new Date().toISOString();
  const currentMonth = new Date().toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

  // Build client context block
  const clientBlock = clientContext
    ? `\n\n[CONTEXTO DO CLIENTE — USE PARA PERSONALIZAR CADA PAUTA]\n${clientContext}\n-> Toda pauta deve ser adaptada diretamente para este cliente específico, não genérica de nicho.`
    : '';

  // Build reference/competitor block
  const referenceBlock = links?.trim()
    ? `\n\n[REFERÊNCIAS/CONCORRENTES FORNECIDOS PELO CLIENTE]\n${links}\n-> Deconstrua essas referências: extraia o hook, o gatilho emocional dominante, a estrutura narrativa.`
    : '';

  const systemPrompt = `Você é DANIEL, o Estrategista-Chefe Executivo (CMO/CEO nível Black) de uma das maiores agências de inteligência de mercado do mundo. Seu cérebro funciona como um supercomputador de neuromarketing, psicologia do consumidor e hackeamento de algoritmos sociais.

NICHO: "${niche.trim()}"
PLATAFORMAS: ${platformsList}
DATA ATUAL: ${currentMonth}${clientBlock}${referenceBlock}`;

  const userPrompt = `Produza a Pesquisa de Inteligência de Mercado DEFINITIVA para o nicho "${niche.trim()}".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGRAS OBRIGATÓRIAS DE EXECUÇÃO:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1] RECOMMENDATION — Manifesto Estratégico de pelo menos 600 palavras. Deve conter:
  - Análise macro do mercado com dados comportamentais reais
  - Psicologia de compra e tomada de decisão deste público
  - As 3 alavancas ocultas de crescimento que a concorrência ignora

[2] PAIN_MAP — Mapeamento de 5 DORES PROFUNDAS.
[3] TRENDING_TOPICS — 5 TÓPICOS por ângulos variados.
[4] CONTENT_BRIEFS — 5 PAUTAS com roteiros de slides DENSOS.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATO DE SAÍDA OBRIGATÓRIO: O MANIFESTO DO ESTRATEGISTA (MARKDOWN)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Você NÃO deve retornar JSON. Escreva um MANIFESTO DE INTELIGÊNCIA em Markdown puro, visceral e denso.

Estrutura esperada:
# Pesquisa: [Nicho]
## Manifesto Estratégico
[Seu texto de 600+ palavras aqui]

## Mapeamento de Dores
## Tópicos Tendência (Trending Topics)
## Pautas de Conteúdo (Content Briefs)
## Calendário Editorial & Brechas de Mercado`;

  const extractionPrompt = `Você é o Arquiteto de Dados da HumanizeIA. Extraia TODAS as informações do manifesto estratégico e organize-as no formato JSON.

FORMATO JSON EXATO:
{
  "niche": "${niche.trim()}",
  "research_date": "${now}",
  "data_source": "ai_analysis_v2",
  "recommendation": "texto do manifesto",
  "pain_map": [{"category": "...", "title": "...", "description": "..."}],
  "trending_topics": [{"angle": "...", "topic": "...", "why_trending": "...", "engagement_potential": "...", "best_format": "...", "best_platform": "..."}],
  "content_briefs": [{"id": 1, "angle": "...", "title": "...", "hook": "...", "format": "...", "platform": "...", "slides_or_points": ["slide 1 denso", "..."], "cta": "...", "hashtags": ["tag1"], "reason": "..."}],
  "content_calendar": [{"day": "...", "format": "...", "theme": "...", "platform": "...", "best_time": "..."}],
  "competitive_gaps": [{"title": "...", "why_empty": "...", "content_type": "..."}],
  "viral_formats": [{"format": "...", "description": "...", "example": "..."}]
}`;

  try {
    // PASS 1: Generate Deep Markdown Manifesto
    const manifesto = await callAI(systemPrompt, userPrompt, 8000);

    // PASS 2: Extract JSON from Manifesto
    const rawJson = await callAI("Você é um arquiteto de dados. Extraia o JSON do texto fornecido seguinto o schema solicitado.",
      `${extractionPrompt}\n\nMANIFESTO:\n${manifesto}`, 8000);

    // Try to extract JSON from the response
    const match = rawJson.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('A IA não retornou um JSON válido de extração. Tente novamente.');

    let parsed: any;
    try {
      parsed = JSON.parse(match[0]);
    } catch (_) {
      // Second attempt: try to fix common JSON issues
      const cleaned = match[0]
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
      parsed = JSON.parse(cleaned);
    }

    return sendOkResponse({ research: parsed, scraped: false });
  } catch (err: any) {
    return sendOkResponse({ error: `Falha na pesquisa estratégica: ${err.message}` });
  }
}

// ─── analyze_reference (chamado pelo Davi) ────────────────────────────────────

async function analyzeReference(body: any) {
  const { reference_url, context } = body;

  const systemPrompt = `Você é DANIEL, especialista em análise de conteúdo e estratégia de marketing digital. Analise referências de conteúdo e extraia insights estratégicos profundos.`;

  const userPrompt = `Analise esta referência de conteúdo: ${reference_url}
Contexto adicional: ${context || 'Nenhum'}
Extraia: formato, tom de voz, tamanho do texto, uso de emojis, tipo de hook, estrutura narrativa, gatilhos emocionais e o que torna este conteúdo eficaz.
Retorne como texto descritivo e acionável.`;

  try {
    const analysis = await callAI(systemPrompt, userPrompt, 1500);
    return sendOkResponse({ analysis });
  } catch (err: any) {
    return sendOkResponse({ error: `Falha na análise: ${err.message}` });
  }
}

// ─── generate_swot ────────────────────────────────────────────────────────────

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
