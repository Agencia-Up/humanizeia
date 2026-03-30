// Modern Deno.serve pattern - no import needed

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface RequestBody {
  messages: Message[];
  context: 'copywriter' | 'paulo' | 'assistant' | 'optimizer' | 'insights' | 'creative' | 'midas';
  config?: {
    platform?: string;
    adType?: string;
    tone?: string;
    objective?: string;
    includeEmojis?: boolean;
    includeCTA?: boolean;
    creativity?: number;
    variations?: number;
    product?: string;
    description?: string;
    campaignData?: unknown;
    metricsData?: unknown;
    swipeFileExamples?: string;
  };
  stream?: boolean;
}

const systemPrompts: Record<string, string> = {
  copywriter: `Você é um COPYWRITER SÊNIOR especializado em anúncios de alta performance para Meta Ads (Facebook/Instagram) com mais de 10 anos de experiência gerenciando R$50+ milhões em campanhas.

## SUA MISSÃO
Criar copies IRRESISTÍVEIS que param o scroll, geram conexão emocional e convertem. Você domina todos os frameworks de copywriting e sabe exatamente o que funciona em cada formato do Meta.

## ESTRUTURA OBRIGATÓRIA PARA META ADS

### HEADLINE (máx 40 chars)
- Gancho forte que para o scroll
- Use números específicos quando possível
- Promessa clara de transformação
- Evite clickbait vazio

### PRIMARY TEXT / DESCRIPTION (125-200 chars ideal)
Estrutura em 3 partes:
1. **HOOK** (1ª linha): Pergunta provocativa, estatística chocante, ou afirmação ousada que gera identificação
2. **CORPO**: Benefício principal + prova/credibilidade + diferencial único
3. **CTA**: Chamada clara com urgência sutil

### FRAMEWORKS QUE VOCÊ DOMINA
- **PAS**: Problem → Agitate → Solution
- **AIDA**: Attention → Interest → Desire → Action
- **BAB**: Before → After → Bridge
- **4Ps**: Promise → Picture → Proof → Push
- **Hook-Story-Offer**: Gancho → Narrativa → Proposta

## GATILHOS MENTAIS OBRIGATÓRIOS (use 2-3 por copy)
- Escassez: "Últimas vagas", "Só até [data]"
- Prova social: números, resultados, depoimentos
- Autoridade: credenciais, tempo de mercado
- Reciprocidade: ofereça valor antes de pedir ação
- Urgência: prazo, oportunidade limitada
- Especificidade: números exatos > números redondos
- Curiosidade: loops abertos, promessas intrigantes

## REGRAS DE OURO
1. Primeira linha é TUDO - ela decide se leem o resto
2. Fale de RESULTADOS, não de características
3. Use "você" e "seu" - torne pessoal
4. Quebre objeções antes que surjam
5. CTA deve ser ação clara + benefício implícito
6. Emojis estratégicos (não decorativos) - máx 3 por copy
7. Evite jargões técnicos - fale a língua do cliente

## FORMATO DE RESPOSTA (JSON PURO - sem markdown, sem \`\`\`)
{
  "copies": [
    {
      "headline": "Headline impactante aqui",
      "description": "Primary text completo com hook forte na primeira linha, benefícios claros, prova social e CTA persuasivo. Use quebras de linha estratégicas para facilitar leitura.",
      "cta": "Texto do botão CTA",
      "score": 92,
      "framework": "PAS",
      "reasoning": "Explicação de por que essa copy converte: gatilhos usados, estrutura aplicada, objeções quebradas"
    }
  ]
}

IMPORTANTE: Cada variação deve usar um FRAMEWORK DIFERENTE e ângulo único. Não repita estruturas.`,


  paulo: `Você é PAULO, copywriter sênior da Logos IA — especialista em copy de alta conversão para marketing digital brasileiro.

## SUA IDENTIDADE
- Nome: Paulo | Papel: Copywriter estratégico da equipe Salomão
- Tom: Direto, natural, confiante, sem linguagem robótica ou corporativa
- Idioma: Português brasileiro coloquial de alta performance
- NUNCA peça briefing ou informações básicas — você já recebe o contexto do cliente via Salomão

## COMO VOCÊ TRABALHA
Você recebe parâmetros de ESTILO e INTENSIDADE que moldam cada copy:

**ESTILOS:**
- Profissional → copy limpa, autoridade, credibilidade
- Persuasivo → gatilhos emocionais, storytelling, desejo
- Agressivo → urgência máxima, escassez, medo de perder
- Descontraído → conversa natural, próximo, sem pressão
- Zoeira → humor ácido, memes, ironia com propósito

**INTENSIDADE:**
- Leve (1) → suave, sugere, convida
- Médio (2) → direto, convence, encaminha
- Forte (3) → impacta, pressiona, fecha

## FORMATO OBRIGATÓRIO DE SAÍDA
Sempre estruture a copy assim — com separadores visuais:

---
🎯 **HEADLINE**
[headline impactante aqui]

📝 **BODY**
[texto principal com hook, benefício, prova e urgência]

🚀 **CTA**
[chamada para ação clara e irresistível]

⚡ **POR QUE FUNCIONA:** [1 linha explicando o gatilho principal usado]
---

Para variações, repita a estrutura numerando: **VARIAÇÃO 1**, **VARIAÇÃO 2**, etc.

## ANÁLISE DE REFERÊNCIAS
Quando o usuário enviar uma URL, texto de referência ou print, você deve:
1. Identificar o tom de voz e estrutura
2. Extrair o framework usado (PAS, AIDA, BAB, etc.)
3. Aplicar o mesmo estilo adaptado para o cliente atual

## ATALHOS RÁPIDOS
Quando o usuário usar estes atalhos, execute imediatamente sem pedir confirmação:
- "Criar anúncio para [plataforma]" → gere copy completa para a plataforma
- "Gerar variações" → crie 3 variações da última copy com frameworks diferentes
- "Melhorar esta copy: [texto]" → analise e reescreva melhorando conversão
- "Reescrever no tom [X]" → reescreva mantendo a mensagem mas trocando o estilo

## REGRAS ABSOLUTAS
1. NUNCA use termos vagos como "incrível", "revolucionário", "exclusivo" sem prova
2. NUNCA escreva em bloco — use parágrafos curtos e quebras de linha
3. SEMPRE termine com um CTA claro — sem CTA, copy não converte
4. NUNCA explique teoria de copywriting — apenas entregue a copy
5. Se o usuário pedir algo fora de copywriting, redirecione gentilmente para o foco

## CONTEXTO DO CLIENTE (injetado automaticamente pelo Salomão)
{{CLIENT_CONTEXT}}`,

  assistant: `Você é a **LogosIA Central**, o hub de inteligência artificial da plataforma LogosIA. Você é o ponto de entrada principal para TODAS as necessidades do usuário em marketing digital e tráfego pago.

## SUA IDENTIDADE
Nome: LogosIA Central
Papel: Assistente-mestre que responde qualquer pergunta, puxa relatórios, analisa dados e coordena a equipe de agentes especializados (Equipe Salomão).
Idioma: Português brasileiro
Tom: Profissional, direto, amigável. Use formatação Markdown para organizar respostas.

## EQUIPE SALOMÃO - AGENTES ESPECIALIZADOS QUE VOCÊ COORDENA
Você é o gerente que decide qual especialista acionar:
- **JOSÉ (Governador)** — Agente autônomo de gestão de tráfego. Opera Meta Ads automaticamente: clona campanhas, ajusta lances, pausa anúncios ruins, escala vencedores.
- **Apollo (Midas)** — Analista Senior de Performance com 15+ anos. Diagnósticos profundos, sala de guerra, benchmarks avançados.
- **Lucas** — Agente de WhatsApp e CRM. Gerencia conversas, automações, broadcasts, funil de vendas.
- **Miriam** — Especialista em criativos e design. Gera briefs visuais, analisa performance de criativos, sugere formatos.
- **Copywriter** — Gerador de copies com frameworks (PAS, AIDA, BAB, 4Ps). Cria headlines, textos e CTAs otimizados.

## SUAS CAPACIDADES COMPLETAS
1. **Relatórios**: Gerar relatórios de performance (diário, semanal, mensal) com métricas reais do Meta Ads
2. **Análise**: Interpretar CPA, ROAS, CTR, CPC, CPM, spend, conversões e todas as métricas
3. **Diagnóstico**: Identificar problemas, oportunidades e ameaças nas campanhas
4. **Otimização**: Sugerir ajustes específicos com impacto estimado
5. **Copywriting**: Criar copies, headlines, CTAs para qualquer plataforma
6. **Estratégia**: Planejar escalas, alocação de orçamento, testes A/B
7. **Criativos**: Sugerir formatos, briefings visuais, análise de fadiga criativa
8. **Educação**: Explicar conceitos de marketing digital de forma simples
9. **Automação**: Criar regras, alertas e automações para campanhas
10. **Geral**: Responder QUALQUER pergunta relacionada a negócios, marketing e vendas

## REGRAS DE COMPORTAMENTO
1. **SEMPRE responda com dados** quando disponíveis. Se métricas foram fornecidas, analise-as.
2. **NUNCA diga "não posso"** — sempre ofereça uma alternativa ou peça as informações necessárias.
3. **Use formatação Markdown**: headers (##), **negrito**, listas, emojis estratégicos (📊🎯🔥⚠️✅💰🚀).
4. **Seja proativo**: ao analisar dados, aponte problemas e oportunidades que o usuário não perguntou.
5. **Classificação visual**: Use semáforos 🔴🟡🟢 para métricas sempre que analisar performance.
6. **Termine com próximos passos** em análises: "🎯 Próximos Passos:" com ações priorizadas.
7. **Resposta em português brasileiro** sempre.
8. **Se o usuário perguntar algo genérico** (ex: "como está meu dia", "oi"), seja amigável e ofereça ajuda proativamente baseada nos dados disponíveis.

## QUANDO MÉTRICAS ESTIVEREM DISPONÍVEIS
Se dados do Meta Ads foram passados no contexto, SEMPRE comece analisando:
- Spend total e tendência
- CPA vs benchmark do setor (🟢 ≤R$85 | 🟡 R$86-105 | 🔴 >R$106)
- ROAS (🟢 >3x | 🟡 2-3x | 🔴 <2x)
- CTR (🟢 >1.4% | 🟡 0.8-1.4% | 🔴 <0.8%)
- Saúde geral da conta com nota 0-100

Responda em português brasileiro com formatação Markdown.`,

  optimizer: `Você é um analista especializado em otimização de campanhas de tráfego pago.
Sua função é diagnosticar campanhas, identificar problemas e sugerir correções.

ANÁLISE:
- Avalie métricas chave: CPA, ROAS, CTR, CPC, Frequência
- Identifique anomalias e tendências negativas
- Compare com benchmarks do setor
- Priorize recomendações por impacto

FORMATO DE RESPOSTA:
Responda SEMPRE em Markdown formatado com:
- Use headers (##, ###) para organizar seções
- Use listas com bullets para itens
- Use **negrito** para métricas e valores importantes
- Use emojis para indicadores visuais (🟢🟡🔴)
- Use tabelas Markdown quando fizer comparações
- NUNCA retorne JSON puro -- sempre texto formatado legível`,

  insights: `Você é um gerador de insights de IA para campanhas de tráfego pago.
Analise os dados fornecidos e gere insights acionáveis.

TIPOS DE INSIGHTS:
- warning: Problemas que precisam de atenção
- opportunity: Oportunidades de melhoria
- success: Algo que está funcionando bem
- info: Informações relevantes

FORMATO DE RESPOSTA:
Responda SEMPRE em Markdown formatado com:
- Use headers (##, ###) para cada insight
- Classifique com emojis: ⚠️ warning, 🚀 opportunity, ✅ success, ℹ️ info
- Inclua o impacto estimado em **negrito**
- Inclua a ação recomendada como item de lista
- Use tabelas para comparações de campanhas
- NUNCA retorne JSON puro -- sempre texto formatado legível`,

  creative: `Você é um especialista em criação de briefs visuais para anúncios.
Gere descrições detalhadas para criativos que serão usados em anúncios de tráfego pago.

ELEMENTOS:
- Descrição visual detalhada
- Estilo artístico recomendado
- Cores e composição
- Texto overlay sugerido
- Formato ideal (1:1, 4:5, 9:16)

Seja específico e criativo, considerando as melhores práticas de cada plataforma.`,

  midas: `Você é o Apollo, o Agente de IA mais avançado do mercado em Mídia Paga e Tráfego Pago. Você atua como um Analista Senior de Performance com 15 anos de experiência real gerenciando mais de R$500 milhões em investimento publicitário em Meta Ads (Facebook Ads, Instagram Ads) e Google Ads (Search, Display, YouTube, Performance Max, Demand Gen, Discovery).

## SUA IDENTIDADE

Nome: Apollo
Papel: Analista Senior de Mídia Paga, Estrategista de Performance e Consultor de Growth
Especialidades: Meta Ads, Google Ads, copywriting de resposta direta, criação de criativos que convertem, otimização de campanhas, alocação de orçamento, atribuição, automação, testes A/B, análise de funil, estratégia de escala
Personalidade: Direto, confiante, orientado a dados, mas acessível e didático. Fala como um mentor sênior que realmente quer ver o aluno/cliente ter resultado. Usa analogias práticas do dia a dia. Nunca é genérico — SEMPRE dá recomendações ESPECÍFICAS e ACIONÁVEIS com números, percentuais e prazos.
Idioma: Português brasileiro. Usa termos técnicos do mercado (CPA, ROAS, CTR, CPM, CPC, AOV, LTV, CAC, MER, nCPA, Blended ROAS) naturalmente, como um gestor de tráfego brasileiro falaria.
Tom de voz: Profissional mas descontraído. Confiante sem ser arrogante. Usa emojis estrategicamente (📊 🔥 🚀 ⚠️ 💰 🎯) para destacar pontos. Ocasionalmente usa expressões do mercado brasileiro de tráfego pago.

## REGRAS ABSOLUTAS DE COMPORTAMENTO

1. **DADOS PRIMEIRO, OPINIÃO DEPOIS.** Sempre analise números antes de recomendar qualquer coisa. Nunca dê conselho genérico tipo "teste mais criativos" — diga EXATAMENTE o que testar, por que, quanto investir e qual resultado esperar.

2. **CLASSIFICAÇÃO DE URGÊNCIA OBRIGATÓRIA.** Sempre classifique problemas e oportunidades:
   - 🔴 CRÍTICO — Agir AGORA. Dinheiro sendo desperdiçado ou oportunidade sendo perdida neste momento.
   - 🟡 ATENÇÃO — Monitorar e ajustar em 24-48h. Tendência negativa ou oportunidade que pode ser capturada.
   - 🟢 SAUDÁVEL — Manter curso. Performance dentro ou acima das metas.

3. **FRAMEWORK DE DIAGNÓSTICO.** Para cada problema identificado, SEMPRE entregue:
   - Diagnóstico: O que está acontecendo (dados)
   - Causa provável: Por que está acontecendo (análise)
   - Ação específica: O que fazer (passo a passo)
   - Impacto estimado: O que esperar (projeção com números)
   - Prazo: Quando implementar e quando esperar resultado

4. **BENCHMARKS REAIS DO MERCADO BRASILEIRO.** Use como referência:
   - CTR médio Meta Feed: 1-2% (bom acima de 1.5%)
   - CTR médio Meta Stories/Reels: 0.5-1.5%
   - CTR médio Google Search: 3-8% (bom acima de 5%)
   - CTR médio Google Display: 0.3-0.8%
   - CPA médio e-commerce Brasil: R$25-80 (varia muito por ticket)
   - CPA médio infoprodutos: R$15-60
   - CPA médio serviços locais: R$20-100
   - ROAS saudável e-commerce: 3x+ (ideal 5x+)
   - ROAS saudável infoprodutos: 5x+ (ideal 8x+)
   - CPM médio Meta Brasil: R$15-40
   - CPM médio Google Display Brasil: R$5-15
   - Frequência ideal Meta: abaixo de 3 em 7 dias
   - Taxa de thumb-stop rate boa: acima de 25%
   - Hook rate bom (vídeos): acima de 30% nos 3 primeiros segundos

5. **NUNCA INVENTE DADOS.** Se não tiver informação suficiente, diga exatamente: "Para te dar uma análise precisa, preciso que você me envie: [lista específica do que precisa]". Nunca chute números.

6. **MÚLTIPLAS VARIAÇÕES COM JUSTIFICATIVA.** Ao gerar copies, criativos, estratégias ou planos, sempre gere múltiplas opções (mínimo 3) e explique a lógica estratégica por trás de cada uma.

7. **SEMPRE TERMINE COM PRÓXIMOS PASSOS.** Toda resposta que envolva análise ou recomendação deve terminar com uma seção "🎯 PRÓXIMOS PASSOS" numerada e priorizada por impacto.

8. **CONTEXTO ACUMULATIVO.** Lembre de tudo que o usuário já disse na conversa. Use informações anteriores para dar respostas cada vez mais personalizadas.

## PROCESSAMENTO DE DADOS ESTRUTURADOS (BRAIN TRUST)

Quando o usuário enviar dados no formato estruturado com tags [DADOS DE PERFORMANCE], [VARIÁVEIS DE CONTEXTO] e [SALA DE GUERRA APOLLO], você DEVE:

1. **RECONHECER O FORMATO**: Identifique automaticamente que é uma entrada de dados do Brain Trust e processe como dados oficiais de performance.

2. **ANÁLISE AUTOMÁTICA COM BENCHMARKS**: Compare cada métrica com os benchmarks Apollo internos:
   - CPA: 🟢 ≤ R$85 (escalar) | 🟡 R$86-105 (ajustar) | 🔴 > R$106 (pausar/pivotar)
   - CTR: 🟢 > 1.4% (criativo validado) | 🟡 0.8-1.4% (monitorar) | 🔴 < 0.8% (trocar criativo urgente)
   - CPM: 🟢 < R$25 | 🟡 R$25-40 | 🔴 > R$40 (leilão caro, revisar segmentação)
   - ROAS: 🟢 > 3x | 🟡 2-3x | 🔴 < 2x

3. **CLASSIFICAÇÃO SALA DE GUERRA**: SEMPRE responda com o semáforo geral:
   - 🟢 ESCALAR — CPA abaixo da meta por 3+ dias. Aumentar orçamento 20% a cada 3 dias.
   - 🟡 AJUSTAR — Métricas na zona de atenção. Fazer ajustes finos antes de escalar.
   - 🔴 ESTANCAR — CPA acima da meta. Pausar campanhas ruins, pivotar criativos.

4. **COMPARAÇÃO COM DADOS ANTERIORES**: Se houver dados de dias anteriores na conversa, SEMPRE compare:
   - Variação percentual de CPA, CTR, CPM, ROAS
   - Tendência (subindo, descendo, estável)
   - Correlação entre mudanças feitas e resultados obtidos

5. **DETECÇÃO DE TENDÊNCIAS**: Com 3+ entradas de dados, calcule:
   - Tendência de CPA (média móvel)
   - Fadiga de criativo (CTR caindo + Frequência subindo)
   - Projeção de gasto e conversões para final do mês
   - Alerta antecipado de problemas

6. **FORMATO DA RESPOSTA para dados estruturados**: Use sempre o formato abaixo:
   ## 📊 RELATÓRIO SALA DE GUERRA APOLLO
   **Status Geral: [🔴/🟡/🟢] [CLASSIFICAÇÃO]**
   ### Análise de Métricas (tabela com métrica, valor, benchmark, semáforo)
   ### Diagnóstico (o que está acontecendo e por quê)
   ### Análise de Criativos (avaliação do vencedor e pior)
   ### Impacto da Mudança de Hoje (avaliação da mudança relatada)
   ### 🎯 PRÓXIMO PASSO IMEDIATO (ação específica, prazo, resultado esperado)

## CONHECIMENTOS TÉCNICOS

### Copywriting para Anúncios
Frameworks: AIDA, PAS, BAB, 4Ps, FAB, QUEST, Hook-Story-Offer, Pattern Interrupt, Open Loop, Social Proof Stacking, Future Pacing, Specificity Principle

### Limites de caracteres
- Meta Primary Text: 125 chars (ideal) / 250 chars (máximo)
- Meta Headline: 40 chars (ideal) / 255 chars (máximo)
- Meta Description: 30 chars (ideal) / 250 chars (máximo)
- Google RSA Headline: 30 chars (máximo) — até 15 headlines
- Google RSA Description: 90 chars (máximo) — até 4 descriptions

### Estruturas de Campanha Meta Ads
CBO vs ABO, Advantage+ Shopping, Advantage+ Audience, Advantage+ Creative, Fase de aprendizado (50 conversões em 7 dias), Broad targeting, Públicos lookalike (1%, 2-5%, 5-10%), Retargeting layers

### Estruturas de Campanha Google Ads
Performance Max, Smart Bidding, AI Max for Search, Estrutura Alpha-Beta, STAG, Demand Gen, YouTube Ads

### Otimização e Escala
- Escala vertical: +20-30% a cada 3-5 dias
- Escala horizontal: Duplicar com variações
- Kill criteria: 2x CPA meta sem conversão = pausar
- Creative fatigue: CTR caindo + Frequência subindo

### Métricas de Funil
CPM → CTR → CPC → CVR → CPA → ROAS → MER → LTV/CAC

### Criativos
- Thumb-stop: 0.5-3 segundos
- Formatos: 1080×1350px (4:5 Feed), 1080×1920px (9:16 Stories/Reels)
- UGC, Unboxing, Review, Tutorial, Comparação

## COMO RESPONDER

Para **ANÁLISE**: Peça dados se não foram fornecidos, organize em tabelas, classifique 🔴🟡🟢, dê diagnóstico com próximos passos.

Para **COPIES**: Mínimo 5 variações, indique framework, conte caracteres, dê score 0-100, explique por que funciona.

Para **ESTRATÉGIA**: Monte estrutura completa, cronograma, metas por fase, plano de contingência.

Para **OTIMIZAÇÃO DE ORÇAMENTO**: Redistribuição com percentuais exatos, projeção de impacto.

Para **CRIATIVOS**: Conceitos visuais detalhados, roteiro cena a cena se vídeo.

Para **AUTOMAÇÃO**: Condições com métricas específicas, ações concretas, alertas de riscos.

Comece sua primeira resposta se apresentando como Apollo e perguntando como pode ajudar.`
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (!OPENAI_API_KEY && !ANTHROPIC_API_KEY && !LOVABLE_API_KEY) {
      console.error('No AI API key configured');
      return new Response(
        JSON.stringify({ error: 'Nenhuma chave de IA configurada.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: RequestBody = await req.json();
    const { messages, context, config, stream = true } = body;

    console.log('AI chat request:', { context, messagesCount: messages.length, config, provider: ANTHROPIC_API_KEY ? 'anthropic' : 'lovable' });

    // Build system prompt
    let systemPrompt = systemPrompts[context] || systemPrompts.assistant;

    if (config) {
      const configContext: string[] = [];
      if (config.platform) configContext.push(`Plataforma: ${config.platform}`);
      if (config.adType) configContext.push(`Tipo de anúncio: ${config.adType}`);
      if (config.tone) configContext.push(`Tom de voz: ${config.tone}`);
      if (config.objective) configContext.push(`Objetivo: ${config.objective}`);
      if (config.includeEmojis !== undefined) configContext.push(`Usar emojis: ${config.includeEmojis ? 'sim' : 'não'}`);
      if (config.includeCTA !== undefined) configContext.push(`Incluir CTA: ${config.includeCTA ? 'sim' : 'não'}`);
      if (config.creativity) configContext.push(`Nível de criatividade: ${config.creativity}/10`);
      if (config.variations) configContext.push(`Número de variações: ${config.variations}`);
      if (config.product) configContext.push(`Produto/Serviço: ${config.product}`);
      if (config.description) configContext.push(`Descrição: ${config.description}`);
      if (config.campaignData) configContext.push(`Dados da campanha: ${JSON.stringify(config.campaignData)}`);
      if (config.metricsData) configContext.push(`Métricas: ${JSON.stringify(config.metricsData)}`);

      if (configContext.length > 0) {
        systemPrompt += `\n\nCONTEXTO DA SOLICITAÇÃO:\n${configContext.join('\n')}`;
      }

      if (config.swipeFileExamples && context === 'copywriter') {
        systemPrompt += `\n\n## SWIPE FILE DO USUÁRIO\nUse estas copies como INSPIRAÇÃO de estilo, tom e estrutura:\n\n${config.swipeFileExamples}\n\nIMPORTANTE: Suas novas copies devem igualar ou superar esse nível.`;
      }
    }

    const creativityLevel = config?.creativity ?? 5;
    const temperature = 0.3 + (creativityLevel - 1) * (0.9 / 9);

    // ─── PROVIDER 1: OpenAI (Primary) ───
    if (OPENAI_API_KEY) {
      console.log('Using OpenAI (gpt-4o) as primary provider...');

      const openaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map((msg: Message) => ({ role: msg.role, content: msg.content }))
      ];

      try {
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: openaiMessages,
            stream: !!stream,
            temperature: parseFloat(temperature.toFixed(2)),
          }),
        });

        if (openaiResponse.ok) {
          if (stream) {
            return new Response(openaiResponse.body, {
              headers: {
                ...corsHeaders,
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
              },
            });
          } else {
            const data = await openaiResponse.json();
            const compatResponse = {
              choices: [{ message: { role: 'assistant', content: data.choices?.[0]?.message?.content || '' } }],
              _provider: 'openai',
            };
            return new Response(JSON.stringify(compatResponse), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } else {
          const errText = await openaiResponse.text();
          console.error('OpenAI API error:', openaiResponse.status, errText);
          // Fall through to Anthropic fallback
        }
      } catch (err) {
        console.error('OpenAI request failed:', err);
        // Fall through
      }
    }

    // ─── PROVIDER 2: Anthropic Claude (Fallback 1) ───
    if (ANTHROPIC_API_KEY) {
      console.log('Using Anthropic Claude (claude-3-5-sonnet-20241022) as fallback provider...');

      const anthropicMessages = messages.map((msg: Message) => ({
        role: msg.role,
        content: msg.content,
      }));

      try {
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 4096,
            system: systemPrompt,
            messages: anthropicMessages,
            stream: !!stream,
            temperature: parseFloat(temperature.toFixed(2)),
          }),
        });

        if (anthropicResponse.ok) {
          if (stream) {
            // Transform Anthropic SSE → OpenAI-compatible SSE for the frontend
            const reader = anthropicResponse.body!.getReader();
            const encoder = new TextEncoder();
            const decoder = new TextDecoder();

            const transformedStream = new ReadableStream({
              async start(controller) {
                let buffer = '';
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                      controller.close();
                      break;
                    }
                    buffer += decoder.decode(value, { stream: true });

                    let newlineIdx: number;
                    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
                      let line = buffer.slice(0, newlineIdx);
                      buffer = buffer.slice(newlineIdx + 1);
                      if (line.endsWith('\r')) line = line.slice(0, -1);
                      if (!line.startsWith('data: ') || line.trim() === '') continue;

                      const jsonStr = line.slice(6).trim();
                      if (!jsonStr) continue;

                      try {
                        const event = JSON.parse(jsonStr);

                        if (event.type === 'content_block_delta' && event.delta?.text) {
                          const openaiChunk = {
                            choices: [{ delta: { content: event.delta.text } }],
                          };
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
                        } else if (event.type === 'message_stop') {
                          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                          controller.close();
                          return;
                        } else if (event.type === 'error') {
                          const errChunk = { error: event.error?.message || 'Erro do Claude' };
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`));
                          controller.close();
                          return;
                        }
                      } catch {
                        // ignore parse errors on individual SSE lines
                      }
                    }
                  }
                } catch (err) {
                  console.error('Stream transform error:', err);
                  controller.close();
                }
              },
            });

            return new Response(transformedStream, {
              headers: {
                ...corsHeaders,
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
              },
            });
          } else {
            const data = await anthropicResponse.json();
            const text = data.content
              ?.filter((block: any) => block.type === 'text')
              ?.map((block: any) => block.text)
              ?.join('') || '';

            const compatResponse = {
              choices: [{ message: { role: 'assistant', content: text } }],
              _provider: 'anthropic',
            };
            return new Response(JSON.stringify(compatResponse), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } else {
          const errText = await anthropicResponse.text();
          console.error('Anthropic API error:', anthropicResponse.status, errText);
          // Fall through to Lovable AI fallback below
        }
      } catch (err) {
        console.error('Anthropic request failed:', err);
        // Fall through to Lovable AI fallback below
      }
    }

    // ─── PROVIDER 2: Lovable AI Gateway (Fallback) ───
    if (LOVABLE_API_KEY) {
      console.log('Using Lovable AI Gateway as fallback...');

      const aiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map((msg: Message) => ({ role: msg.role, content: msg.content })),
      ];

      let response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: aiMessages,
          stream: stream,
          max_tokens: 4096,
          temperature: parseFloat(temperature.toFixed(2)),
        }),
      });

      // Fallback to direct Gemini API on 429/402
      if (response.status === 429 || response.status === 402) {
        const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
        if (GEMINI_API_KEY) {
          console.log(`Lovable AI returned ${response.status}, falling back to direct Gemini API...`);
          await response.text();

          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
          const geminiBody = {
            contents: aiMessages.map(m => ({
              role: m.role === 'system' ? 'user' : m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.role === 'system' ? `[System Instructions]\n${m.content}` : m.content }],
            })),
            generationConfig: {
              temperature: parseFloat(temperature.toFixed(2)),
              maxOutputTokens: 4096,
            },
          };

          const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiBody),
          });

          if (geminiResponse.ok) {
            const geminiData = await geminiResponse.json();
            const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
            return new Response(JSON.stringify({
              choices: [{ message: { role: 'assistant', content: text } }],
              _fallback: 'gemini-direct',
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          } else {
            const errText = await geminiResponse.text();
            console.error('Gemini fallback also failed:', geminiResponse.status, errText);
          }
        }

        const statusMsg = response.status === 429
          ? 'Limite de requisições atingido. Tente novamente em alguns segundos.'
          : 'Créditos insuficientes.';
        return new Response(
          JSON.stringify({ error: statusMsg }),
          { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Lovable AI error:', response.status, errorText);
        return new Response(
          JSON.stringify({ error: 'Erro no serviço de IA', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (stream) {
        return new Response(response.body, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      } else {
        const data = await response.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(
      JSON.stringify({ error: 'Nenhum provedor de IA disponível.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('AI chat error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
