import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface CampaignContext {
  product: string;
  productDescription?: string;
  price?: number;
  landingPageUrl?: string;
  objective: 'vendas' | 'leads' | 'trafego' | 'awareness';
  targetAudience: string;
  ageRange?: { min: number; max: number };
  locations?: string[];
  interests?: string[];
  budget: number;
  budgetType: 'daily' | 'lifetime';
  duration?: number;
  platforms: ('meta' | 'google' | 'tiktok')[];
  niche?: string;
  tone?: 'formal' | 'casual' | 'urgente' | 'inspirador';
  draftCopies?: string[];
  historicalData?: {
    avgCTR: number;
    avgCPC: number;
    avgROAS: number;
  };
}

const model = 'claude-sonnet-4-20250514';

function getSystemPrompt(): string {
  return `Você é o SUPER GESTOR DE TRÁFEGO da HumanizeAI, um especialista sênior em mídia paga com 15+ anos de experiência em Meta Ads, Google Ads e TikTok Ads.

# SUAS RESPONSABILIDADES
1. ANÁLISE: Entender produto, nicho, público-alvo
2. ESTRATÉGIA: Criar planos completos de campanha
3. VALIDAÇÃO: Avaliar campanhas antes de publicar
4. OTIMIZAÇÃO: Analisar dados e sugerir melhorias
5. EXECUÇÃO: Gerar instruções JSON para automação
6. CRIATIVOS: Analisar e selecionar criativos da biblioteca do usuário

# CONHECIMENTO TÉCNICO

## Meta Ads
- Objetivos: OUTCOME_SALES, OUTCOME_LEADS, OUTCOME_TRAFFIC, OUTCOME_AWARENESS
- Estrutura: Campaign > Ad Set > Ad
- Valores em centavos (R$ 100 = 10000)

## Google Ads  
- Tipos: SEARCH, DISPLAY, PERFORMANCE_MAX
- Estrutura: Campaign > Ad Group > Ad
- Valores em micros (R$ 1 = 1.000.000)

## TikTok Ads
- Objetivos: TRAFFIC, CONVERSIONS, APP_INSTALL
- Estrutura: Campaign > Ad Group > Ad

## Análise de Criativos
- Avalie tipo (imagem, vídeo, carrossel), estilo visual e mensagem
- Selecione criativos alinhados com o objetivo da campanha
- Se não houver criativos adequados, forneça feedback estratégico detalhado
- Sugira tipos específicos de materiais que estão faltando

# REGRAS
- Foque em ROI e resultados mensuráveis
- Seja específico e acionável
- Use português brasileiro
- Moeda: Real (R$)
- SEMPRE forneça respostas em JSON quando solicitado, dentro de blocos de código
- Ao criar campanhas, SEMPRE selecione e referencie criativos da biblioteca quando disponíveis`;
}

function buildStrategyPrompt(context: CampaignContext): string {
  const budgetPerPlatform = Math.round(context.budget / context.platforms.length);
  
  return `
# Criar Estratégia Completa de Campanha

## Produto/Serviço
- Nome: ${context.product}
${context.productDescription ? `- Descrição: ${context.productDescription}` : ''}
${context.price ? `- Preço: R$ ${context.price}` : ''}
${context.landingPageUrl ? `- Landing Page: ${context.landingPageUrl}` : ''}
${context.niche ? `- Nicho: ${context.niche}` : ''}

## Objetivo da Campanha
${context.objective === 'vendas' ? 'Gerar vendas diretas (conversões de compra)' : ''}
${context.objective === 'leads' ? 'Capturar leads (formulários, cadastros)' : ''}
${context.objective === 'trafego' ? 'Gerar tráfego para o site' : ''}
${context.objective === 'awareness' ? 'Aumentar reconhecimento da marca' : ''}

## Público-Alvo
- Descrição: ${context.targetAudience}
${context.ageRange ? `- Faixa etária: ${context.ageRange.min} a ${context.ageRange.max} anos` : ''}
${context.locations?.length ? `- Localizações: ${context.locations.join(', ')}` : '- Localização: Brasil'}
${context.interests?.length ? `- Interesses: ${context.interests.join(', ')}` : ''}

## Orçamento
- Valor: R$ ${context.budget}
- Tipo: ${context.budgetType === 'daily' ? 'Diário' : 'Total'}
${context.duration ? `- Duração: ${context.duration} dias` : ''}

## Plataformas Selecionadas
${context.platforms.map(p => `- ${p.toUpperCase()}`).join('\n')}

${context.tone ? `## Tom de Comunicação: ${context.tone}` : ''}

${context.historicalData ? `
## Dados Históricos da Conta
- CTR médio: ${context.historicalData.avgCTR}%
- CPC médio: R$ ${context.historicalData.avgCPC}
- ROAS médio: ${context.historicalData.avgROAS}x
` : ''}

${context.draftCopies?.length ? `
## Copies Existentes (do Copywriter IA)
${context.draftCopies.map((c, i) => `${i + 1}. ${c}`).join('\n')}
` : ''}

---

TAREFA: Gere uma estratégia COMPLETA retornando APENAS um JSON válido no seguinte formato:

\`\`\`json
{
  "strategy": {
    "summary": "Resumo da estratégia em 2-3 frases",
    "approach": "Abordagem estratégica detalhada",
    "expectedResults": {
      "impressions": "XX.XXX - XX.XXX",
      "clicks": "X.XXX - X.XXX",
      "conversions": "XX - XX",
      "estimatedCPA": "R$ XX",
      "estimatedROAS": "X.Xx"
    }
  },
  "platforms": {
    ${context.platforms.includes('meta') ? `"meta": {
      "objective": "OUTCOME_SALES",
      "budget": ${budgetPerPlatform},
      "adSets": [
        {
          "name": "AdSet - Interesse Principal",
          "budget": ${Math.round(budgetPerPlatform * 0.6)},
          "targeting": {
            "age_min": ${context.ageRange?.min || 25},
            "age_max": ${context.ageRange?.max || 55},
            "genders": [0],
            "geo_locations": { "countries": ["BR"] },
            "interests": ["interesse1", "interesse2"]
          },
          "ads": [
            { "name": "Ad Variação 1", "headline": "Headline", "description": "Descrição", "cta": "LEARN_MORE" }
          ]
        }
      ]
    }` : ''}
    ${context.platforms.includes('google') ? `${context.platforms.includes('meta') ? ',' : ''}"google": {
      "type": "SEARCH",
      "budget": ${budgetPerPlatform},
      "adGroups": [
        {
          "name": "AdGroup - Keywords Principal",
          "keywords": ["keyword1", "keyword2"],
          "ads": [
            { "headlines": ["Headline 1", "Headline 2", "Headline 3"], "descriptions": ["Descrição 1", "Descrição 2"] }
          ]
        }
      ]
    }` : ''}
    ${context.platforms.includes('tiktok') ? `${context.platforms.includes('meta') || context.platforms.includes('google') ? ',' : ''}"tiktok": {
      "objective": "TRAFFIC",
      "budget": ${budgetPerPlatform},
      "adGroups": [
        { "name": "AdGroup - Principal", "targeting": {}, "ads": [] }
      ]
    }` : ''}
  },
  "copies": {
    "headlines": ["Headline 1 (max 40 chars)", "Headline 2", "Headline 3", "Headline 4", "Headline 5"],
    "descriptions": ["Descrição 1 (max 90 chars)", "Descrição 2", "Descrição 3"],
    "primaryTexts": ["Texto principal para feed 1", "Texto principal 2"],
    "ctas": ["Saiba Mais", "Compre Agora", "Cadastre-se"]
  },
  "targeting": {
    "primaryAudience": {
      "name": "Nome da Audiência",
      "description": "Descrição detalhada do público",
      "demographics": { "age": "${context.ageRange?.min || 25}-${context.ageRange?.max || 55}", "gender": "Todos" },
      "interests": ["Interesse 1", "Interesse 2", "Interesse 3"]
    },
    "secondaryAudiences": []
  },
  "optimization": {
    "bidStrategy": "Começar com menor custo, otimizar após 50 conversões",
    "budgetAllocation": {
      ${context.platforms.map(p => `"${p}": ${Math.round(100 / context.platforms.length)}`).join(',\n      ')}
    },
    "testingPlan": ["Teste A/B de headlines na semana 1", "Teste de públicos na semana 2"]
  },
  "agentInstructions": [
    {
      "id": "instr_001",
      "platform": "${context.platforms[0]}",
      "action": "create_campaign",
      "params": {
        "name": "${context.product} - ${context.objective} - ${new Date().toLocaleDateString('pt-BR')}",
        "objective": "${context.platforms[0] === 'meta' ? 'OUTCOME_SALES' : context.platforms[0] === 'google' ? 'SEARCH' : 'TRAFFIC'}",
        "status": "PAUSED"
      },
      "priority": 1,
      "reason": "Criar campanha principal"
    },
    {
      "id": "instr_002",
      "platform": "${context.platforms[0]}",
      "action": "create_adset",
      "params": {
        "campaign_id": "{{instr_001}}",
        "name": "AdSet - Principal",
        "daily_budget": ${budgetPerPlatform * 100},
        "status": "PAUSED"
      },
      "priority": 2,
      "dependsOn": ["instr_001"],
      "reason": "Criar conjunto de anúncios"
    }
  ]
}
\`\`\`

IMPORTANTE: 
- Retorne APENAS o JSON, sem texto adicional antes ou depois
- Adapte os valores para o contexto fornecido
- Seja específico e realista nas estimativas
- As instruções do agentInstructions devem ser executáveis via API`;
}

function buildValidationPrompt(campaign: any, context: CampaignContext): string {
  return `
# Validação de Campanha

## Campanha para Validar
\`\`\`json
${JSON.stringify(campaign, null, 2)}
\`\`\`

## Contexto
- Produto: ${context.product}
- Objetivo: ${context.objective}
- Orçamento: R$ ${context.budget}

Analise a campanha e retorne APENAS um JSON válido no formato:
\`\`\`json
{
  "isValid": true,
  "score": 85,
  "issues": [{ "severity": "medium", "message": "Descrição do problema", "fix": "Como corrigir" }],
  "suggestions": ["Sugestão 1", "Sugestão 2"],
  "estimatedPerformance": { "ctrRange": "1.5% - 3%", "cpaRange": "R$ 20 - R$ 40", "roasRange": "2x - 4x" }
}
\`\`\``;
}

function buildAnalyzePrompt(campaigns: any[], performanceData: any): string {
  return `
# Análise de Performance e Otimização

## Campanhas Ativas
\`\`\`json
${JSON.stringify(campaigns, null, 2)}
\`\`\`

## Métricas dos Últimos 7 Dias
\`\`\`json
${JSON.stringify(performanceData, null, 2)}
\`\`\`

Analise os dados e retorne APENAS um JSON válido:
\`\`\`json
{
  "analysis": "Análise geral da performance em 2-3 parágrafos",
  "insights": [
    { "type": "opportunity", "title": "Título", "description": "Descrição", "impact": "high" }
  ],
  "actions": [
    { "id": "opt_001", "platform": "meta", "action": "update_budget", "params": { "id": "xxx", "daily_budget": 15000 }, "priority": 1, "reason": "Motivo da ação" }
  ]
}
\`\`\``;
}

function buildChatPrompt(message: string, context?: CampaignContext): string {
  let fullMessage = '';

  // Detect campaign creation intent
  const creationKeywords = [
    'cri', 'criar', 'crie', 'monte', 'montar', 'gere', 'gerar',
    'lance', 'lançar', 'faça', 'fazer', 'campanha', 'estratégia completa',
    'publicar', 'configure', 'configurar'
  ];
  const msgLower = message.toLowerCase();
  const isCreationIntent = creationKeywords.some(k => msgLower.includes(k)) &&
    (msgLower.includes('campanha') || msgLower.includes('estratégia') || msgLower.includes('anúncio'));

  if (isCreationIntent) {
    fullMessage = `${message}

IMPORTANTE: O usuário quer que você CRIE uma campanha real, não apenas explique como fazer.
Se você tiver informações suficientes (produto, objetivo, orçamento, plataforma), retorne OBRIGATORIAMENTE um JSON executável no formato abaixo dentro de um bloco \`\`\`json.
Se faltar alguma informação essencial, PERGUNTE ao usuário de forma objetiva o que falta.

Informações essenciais mínimas:
- Produto/serviço
- Objetivo (vendas, leads, tráfego, awareness)
- Orçamento (diário ou total)
- Plataforma (meta, google, tiktok)

Se tiver o mínimo, use valores padrão inteligentes para o resto e retorne o JSON:

\`\`\`json
{
  "strategy": {
    "summary": "Resumo da estratégia",
    "approach": "Abordagem detalhada",
    "expectedResults": { "impressions": "X", "clicks": "X", "conversions": "X", "estimatedCPA": "R$ X", "estimatedROAS": "Xx" }
  },
  "copies": {
    "headlines": ["H1", "H2", "H3"],
    "descriptions": ["D1", "D2"],
    "primaryTexts": ["Texto 1"],
    "ctas": ["Saiba Mais"]
  },
  "targeting": {
    "primaryAudience": { "name": "Audiência", "description": "Desc", "demographics": {}, "interests": [] },
    "secondaryAudiences": []
  },
  "optimization": {
    "bidStrategy": "Menor custo",
    "budgetAllocation": { "meta": 100 },
    "testingPlan": []
  },
  "agentInstructions": [
    { "id": "instr_001", "platform": "meta", "action": "create_campaign", "params": { "name": "...", "objective": "OUTCOME_SALES", "status": "PAUSED", "special_ad_categories": [] }, "priority": 1, "reason": "Criar campanha" },
    { "id": "instr_002", "platform": "meta", "action": "create_adset", "params": { "campaign_id": "{{instr_001}}", "name": "...", "daily_budget": 5000, "status": "PAUSED", "targeting": { "geo_locations": { "countries": ["BR"] }, "age_min": 25, "age_max": 55 }, "optimization_goal": "OFFSITE_CONVERSIONS", "billing_event": "IMPRESSIONS", "bid_strategy": "LOWEST_COST_WITHOUT_CAP" }, "priority": 2, "dependsOn": ["instr_001"], "reason": "Criar conjunto" }
  ]
}
\`\`\``;
    if (context) {
      fullMessage = `Contexto: ${context.product}, objetivo ${context.objective}, orçamento R$ ${context.budget}, plataformas: ${context.platforms.join(', ')}\n\n${fullMessage}`;
    }
  } else if (context) {
    fullMessage = `Contexto atual: ${context.product}, objetivo ${context.objective}, orçamento R$ ${context.budget}, plataformas: ${context.platforms.join(', ')}\n\nPergunta: ${message}`;
  } else {
    fullMessage = message;
  }
  return fullMessage;
}

function parseJSON<T>(text: string): T | null {
  try {
    const match = text.match(/```json\n?([\s\S]*?)\n?```/);
    if (match) {
      return JSON.parse(match[1]);
    }
    return JSON.parse(text);
  } catch (error) {
    console.error('Erro ao parsear JSON:', error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.39.3');
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getUser(token);
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { action, context, campaign, campaigns, performanceData, message, history = [] } = await req.json();
    
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch user's creative library for strategy/chat actions
    let creativesContext = '';
    if (action === 'generateStrategy' || action === 'chat') {
      try {
        const { data: userCreatives } = await supabaseAuth
          .from('creative_uploads')
          .select('id, name, file_url, file_type, category, style, description, tags, ai_score, dimensions, created_at')
          .eq('user_id', claimsData.user.id)
          .order('created_at', { ascending: false })
          .limit(50);

        if (userCreatives && userCreatives.length > 0) {
          const summary = userCreatives.map((c: any) => 
            `- [${c.file_type.toUpperCase()}] "${c.name}" (Categoria: ${c.category}${c.style ? `, Estilo: ${c.style}` : ''}${c.dimensions ? `, ${c.dimensions}` : ''}${c.tags?.length ? `, Tags: ${c.tags.join(', ')}` : ''}${c.description ? `, Desc: ${c.description}` : ''}${c.ai_score ? `, Score: ${c.ai_score}/100` : ''}) URL: ${c.file_url}`
          ).join('\n');

          creativesContext = `\n\n## BIBLIOTECA DE CRIATIVOS DO USUÁRIO (${userCreatives.length} materiais disponíveis)
${summary}

INSTRUÇÕES SOBRE CRIATIVOS:
- Analise os criativos disponíveis e SELECIONE os mais adequados para a campanha
- Considere: tipo (imagem/vídeo), estilo visual, categoria e tags
- Se os criativos não forem adequados, INFORME o usuário com feedback estratégico
- Sugira quais tipos de criativos estão faltando para melhorar a performance
- Ao criar instruções de anúncios (create_ad), inclua o campo "image_url" com a URL do criativo selecionado
- Adicione um campo "selectedCreatives" no JSON da resposta com os IDs e motivos da seleção`;
        } else {
          creativesContext = `\n\n## BIBLIOTECA DE CRIATIVOS
O usuário NÃO possui criativos na biblioteca. Informe que para criar campanhas com anúncios visuais, ele precisa:
1. Acessar a Biblioteca de Criativos e enviar imagens/vídeos
2. Categorizar os materiais por tipo (produto, lifestyle, prova social, etc.)
3. Incluir variedade: vídeos curtos (até 30s), criativos com prova social, imagens com CTA claro`;
        }
      } catch (err) {
        console.error('Error fetching creatives:', err);
      }
    }

    let prompt: string;
    let maxTokens: number;

    switch (action) {
      case 'generateStrategy':
        prompt = buildStrategyPrompt(context) + creativesContext;
        maxTokens = 6000;
        break;
      case 'validateCampaign':
        prompt = buildValidationPrompt(campaign, context);
        maxTokens = 2000;
        break;
      case 'analyzeAndOptimize':
        prompt = buildAnalyzePrompt(campaigns, performanceData);
        maxTokens = 3000;
        break;
      case 'chat':
        prompt = buildChatPrompt(message, context) + creativesContext;
        maxTokens = 3000;
        break;
      default:
        return new Response(
          JSON.stringify({ error: 'Ação não suportada' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    const messages = action === 'chat' 
      ? [...history, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: getSystemPrompt(),
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: `Erro na API Anthropic: ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const text = data.content
      ?.filter((block: any) => block.type === 'text')
      ?.map((block: any) => block.text)
      ?.join('') || '';

    let result: any;
    
    if (action === 'chat') {
      result = { response: text, history: [...history, { role: 'user', content: prompt }, { role: 'assistant', content: text }] };
    } else {
      const parsed = parseJSON(text);
      if (!parsed) {
        return new Response(
          JSON.stringify({ error: 'Falha ao parsear resposta da IA', rawResponse: text }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      result = parsed;
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('claude-strategy error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
