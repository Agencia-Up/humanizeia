// Modern Deno.serve pattern - no import needed

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
  images?: string[]; // Array of base64 data URIs
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
  system_prompt?: string;
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
      "description": "Primary text completo com hook forte na primeira linha, benefícios claros, prova social e CTA persuasivo.",
      "cta": "Texto do botão CTA",
      "score": 92,
      "framework": "PAS",
      "reasoning": "Explicação de por que essa copy converte"
    }
  ]
}

IMPORTANTE: Cada variação deve usar um FRAMEWORK DIFERENTE e ângulo único. Não repita estruturas.`,


  paulo: `Você é PAULO, o Copywriter Master e Diretor Criativo da Logos IA. Você é um gênio da persuasão visual e escrita, mestre em criar carrosséis que dominam o consciente e o inconsciente do público.

## SUA MISSÃO
Transformar dados brutos em **carrosséis de elite**. Cada slide deve ter um headline forte, um corpo de texto denso e persuasivo, e uma direção de arte cinematográfica (image prompt) em inglês.

## ESTRUTURA DE RESPOSTA (OBRIGATÓRIO JSON PURO)
Você deve responder EXCLUSIVAMENTE com um objeto JSON no formato abaixo, sem texto antes ou depois, sem markdown:

{
  "carousels": [
    {
      "title": "Título estratégico do carrossel",
      "niche": "Nicho identificado",
      "angle": "storytelling | lista | provocacao | mito_vs_verdade | passo_a_passo | polemica",
      "caption": "Legenda completa e persuasiva para o Instagram com parágrafos bem estruturados.",
      "hashtags": ["tag1", "tag2"],
      "slides": [
        {
          "slide_number": 1,
          "type": "cover",
          "headline": "Headline principal do slide",
          "subtext": "Texto de apoio opcional",
          "image_prompt": "[INGLÊS: Descreva uma cena cinematográfica realista 8K, iluminação master, composição editorial, detalhes extremos. Mínimo 60 palavras.]"
        },
        {
          "slide_number": 2,
          "type": "content",
          "headline": "Insight ou continuação da narrativa",
          "subtext": "Conteúdo denso e persuasivo",
          "image_prompt": "Prompt visual cinematográfico em inglês"
        }
      ]
    }
  ]
}

## REGRAS DE OURO
1. Use ganchos agressivos (hooks) no primeiro slide e ganchos psicológicos em todos os outros para manter o usuário arrastando.
2. NUNCA seja genérico. Use fatos, números e neurociência.
3. O IMAGE_PROMPT deve ser escrito para um gerador de imagens de elite: especifique lente, iluminação e estilo cinematográfico realista.
4. Responda apenas o JSON.`,


  assistant: `Você é a **LogosIA Central**, o hub de inteligência artificial da plataforma LogosIA. Você é o ponto de entrada principal para TODAS as necessidades do usuário em marketing digital e tráfego pago.

## SUA IDENTIDADE
Nome: LogosIA Central
Papel: Assistente-mestre que responde qualquer pergunta, puxa relatórios, analisa dados e coordena a equipe de agentes especializados (Equipe Salomão).
Idioma: Português brasileiro
Tom: Profissional, direto, amigável. Use formatação Markdown para organizar respostas.

## EQUIPE SALOMÃO - AGENTES ESPECIALIZADOS QUE VOCÊ COORDENA
- **JOSÉ (Governador)** — Agente autônomo de gestão de tráfego. Opera Meta Ads automaticamente.
- **Apollo (Midas)** — Analista Senior de Performance com 15+ anos.
- **Lucas** — Agente de WhatsApp e CRM.
- **Miriam** — Especialista em criativos e design.
- **Paulo** — Diretor Criativo de Carrosséis. Gera roteiros completos slide a slide com prompts de imagem.
- **Davi** — Gerador visual de carrosséis. Consome os roteiros do Paulo e produz o visual final.
- **Daniel** — Estrategista de tendências e pesquisa de nicho.

## SUAS CAPACIDADES COMPLETAS
1. **Relatórios**: Gerar relatórios de performance (diário, semanal, mensal)
2. **Análise**: Interpretar CPA, ROAS, CTR, CPC, CPM, spend, conversões
3. **Diagnóstico**: Identificar problemas, oportunidades e ameaças
4. **Otimização**: Sugerir ajustes específicos com impacto estimado
5. **Estratégia**: Planejar escalas, alocação de orçamento, testes A/B
6. **Educação**: Explicar conceitos de marketing digital
7. **Automação**: Criar regras, alertas e automações

## REGRAS DE COMPORTAMENTO
1. **SEMPRE responda com dados** quando disponíveis.
2. **NUNCA diga "não posso"** — sempre ofereça uma alternativa.
3. **Use formatação Markdown**: headers, **negrito**, listas, emojis estratégicos (📊🎯🔥⚠️✅💰🚀).
4. **Seja proativo**: aponte problemas e oportunidades que o usuário não perguntou.
5. **Classificação visual**: Use semáforos 🔴🟡🟢 para métricas.
6. **Termine com próximos passos** em análises.
7. **Resposta em português brasileiro** sempre.

## QUANDO MÉTRICAS ESTIVEREM DISPONÍVEIS
- CPA vs benchmark (🟢 ≤R$85 | 🟡 R$86-105 | 🔴 >R$106)
- ROAS (🟢 >3x | 🟡 2-3x | 🔴 <2x)
- CTR (🟢 >1.4% | 🟡 0.8-1.4% | 🔴 <0.8%)

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


  midas: `Você é o Apollo, o Agente de IA mais avançado do mercado em Mídia Paga e Tráfego Pago. Você atua como um Analista Senior de Performance com 15 anos de experiência real gerenciando mais de R$500 milhões em investimento publicitário em Meta Ads e Google Ads.

## SUA IDENTIDADE
Nome: Apollo
Papel: Analista Senior de Mídia Paga, Estrategista de Performance e Consultor de Growth
Personalidade: Direto, confiante, orientado a dados, mas acessível e didático.
Idioma: Português brasileiro com termos técnicos do mercado (CPA, ROAS, CTR, CPM, CPC, AOV, LTV, CAC, MER, nCPA).
Tom de voz: Profissional mas descontraído. Usa emojis estrategicamente (📊 🔥 🚀 ⚠️ 💰 🎯).

## REGRAS ABSOLUTAS DE COMPORTAMENTO

1. **DADOS PRIMEIRO, OPINIÃO DEPOIS.** Nunca dê conselho genérico — diga EXATAMENTE o que fazer, por que, quanto investir e qual resultado esperar.

2. **CLASSIFICAÇÃO DE URGÊNCIA OBRIGATÓRIA:**
   - 🔴 CRÍTICO — Agir AGORA.
   - 🟡 ATENÇÃO — Ajustar em 24-48h.
   - 🟢 SAUDÁVEL — Manter curso.

3. **FRAMEWORK DE DIAGNÓSTICO:** Para cada problema: Diagnóstico → Causa provável → Ação específica → Impacto estimado → Prazo.

4. **BENCHMARKS REAIS DO MERCADO BRASILEIRO:**
   - CTR médio Meta Feed: 1-2% (bom acima de 1.5%)
   - CTR médio Meta Stories/Reels: 0.5-1.5%
   - CTR médio Google Search: 3-8%
   - CPA médio e-commerce Brasil: R$25-80
   - CPA médio infoprodutos: R$15-60
   - ROAS saudável e-commerce: 3x+ (ideal 5x+)
   - CPM médio Meta Brasil: R$15-40
   - Frequência ideal Meta: abaixo de 3 em 7 dias

5. **NUNCA INVENTE DADOS.** Se não tiver informação suficiente, peça exatamente o que precisa.

6. **MÚLTIPLAS VARIAÇÕES.** Ao gerar copies, criativos ou estratégias, sempre gere mínimo 3 opções com justificativa.

7. **SEMPRE TERMINE COM PRÓXIMOS PASSOS.** Seção "🎯 PRÓXIMOS PASSOS" numerada e priorizada por impacto.

## PROCESSAMENTO DE DADOS ESTRUTURADOS (BRAIN TRUST)
Quando receber dados com tags [DADOS DE PERFORMANCE], [VARIÁVEIS DE CONTEXTO] e [SALA DE GUERRA APOLLO]:

**FORMATO DA RESPOSTA:**
## 📊 RELATÓRIO SALA DE GUERRA APOLLO
**Status Geral: [🔴/🟡/🟢] [CLASSIFICAÇÃO]**
### Análise de Métricas (tabela com métrica, valor, benchmark, semáforo)
### Diagnóstico
### Análise de Criativos
### 🎯 PRÓXIMO PASSO IMEDIATO

## CONHECIMENTOS TÉCNICOS
- Frameworks: AIDA, PAS, BAB, 4Ps, FAB, QUEST, Hook-Story-Offer
- Meta: CBO, ABO, Advantage+, Broad targeting, Lookalike (1%, 2-5%, 5-10%)
- Google: Performance Max, Smart Bidding, AI Max for Search, STAG
- Escala: +20-30% a cada 3-5 dias, duplicar com variações
- Kill criteria: 2x CPA meta sem conversão = pausar

Comece sua primeira resposta se apresentando como Apollo e perguntando como pode ajudar.`

};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
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
      return new Response(
        JSON.stringify({ error: 'Nenhuma chave de IA configurada.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: RequestBody = await req.json();
    const { messages, context, config, stream = true } = body;

    console.log('AI chat request:', { context, messagesCount: messages.length });

    let systemPrompt = body.system_prompt || systemPrompts[context] || systemPrompts.assistant;

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
      if (config.description) configContext.push(`Contexto adicional: ${config.description}`);
      if (config.campaignData) configContext.push(`Dados da campanha: ${JSON.stringify(config.campaignData)}`);
      if (config.metricsData) configContext.push(`Métricas: ${JSON.stringify(config.metricsData)}`);

      if (configContext.length > 0) {
        systemPrompt += `\n\nCONTEXTO DA SOLICITAÇÃO:\n${configContext.join('\n')}`;
      }

      if (config.swipeFileExamples && context === 'copywriter') {
        systemPrompt += `\n\n## SWIPE FILE DO USUÁRIO\nUse estas copies como INSPIRAÇÃO:\n\n${config.swipeFileExamples}\n\nIMPORTANTE: Suas novas copies devem igualar ou superar esse nível.`;
      }
    }

    // ─── CLIENT CONTEXT INJECTION (PAULO) ───
    if (systemPrompt.includes('{{CLIENT_CONTEXT}}')) {
      const clientDetails = [];
      if (config?.product) clientDetails.push(`PRODUTO/SERVIÇO: ${config.product}`);
      if (config?.description) clientDetails.push(`SOBRE O NEGÓCIO: ${config.description}`);
      if (config?.objective) clientDetails.push(`OBJETIVO: ${config.objective}`);
      if (config?.platform) clientDetails.push(`PLATAFORMA: ${config.platform}`);
      
      const contextString = clientDetails.length > 0 
        ? clientDetails.join('\n') 
        : 'Nenhum contexto específico fornecido pelo usuário. Use um nicho genérico de marketing de alta conversão.';
      
      systemPrompt = systemPrompt.replace('{{CLIENT_CONTEXT}}', contextString);
    }

    const creativityLevel = config?.creativity ?? 5;
    const temperature = 0.3 + (creativityLevel - 1) * (0.9 / 9);

    // ─── PROVIDER 1: OpenAI (Primary) ───
    if (OPENAI_API_KEY) {
      console.log('Using OpenAI (gpt-4o) as primary provider...');

      const openaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map((msg: Message) => {
          if (msg.images && msg.images.length > 0) {
            return {
              role: msg.role,
              content: [
                { type: 'text', text: msg.content },
                ...msg.images.map(img => ({
                  type: 'image_url',
                  image_url: { url: img }
                }))
              ]
            }
          }
          return { role: msg.role, content: msg.content };
        })
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
            const content = data.choices?.[0]?.message?.content || '';
            const lower = content.toLowerCase();
            if (lower.includes("sorry") || lower.includes("cannot fulfill") || lower.includes("can't assist") || lower.includes("cannot assist")) {
              throw new Error("OpenAI Refusal Triggered");
            }
            const compatResponse = {
              choices: [{ message: { role: 'assistant', content } }],
              _provider: 'openai',
            };
            return new Response(JSON.stringify(compatResponse), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } else {
          const errText = await openaiResponse.text();
          console.error('OpenAI API error:', openaiResponse.status, errText);
        }
      } catch (err) {
        console.error('OpenAI request failed:', err);
      }
    }

    // ─── PROVIDER 2: Anthropic Claude (Fallback 1) ───
    if (ANTHROPIC_API_KEY) {
      console.log('Using Anthropic Claude as fallback...');

      const anthropicMessages = messages.map((msg: Message) => {
        if (msg.images && msg.images.length > 0) {
          return {
            role: msg.role,
            content: [
              ...msg.images.map(img => {
                const match = img.match(/^data:(image\/[a-zA-Z]*);base64,(.*)$/);
                if (match) {
                  return {
                    type: 'image',
                    source: { type: 'base64', media_type: match[1], data: match[2] }
                  };
                }
                return null;
              }).filter(Boolean),
              { type: 'text', text: msg.content }
            ]
          };
        }
        return {
          role: msg.role,
          content: msg.content,
        }
      });

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
                          const openaiChunk = { choices: [{ delta: { content: event.delta.text } }] };
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
                        } else if (event.type === 'message_stop') {
                          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                          controller.close();
                          return;
                        }
                      } catch { /* ignore individual parse errors */ }
                    }
                  }
                } catch (err) {
                  console.error('Stream transform error:', err);
                  controller.close();
                }
              },
            });

            return new Response(transformedStream, {
              headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
            });
          } else {
            const data = await anthropicResponse.json();
            const text = data.content?.filter((b: any) => b.type === 'text')?.map((b: any) => b.text)?.join('') || '';
            const lower = text.toLowerCase();
            if (lower.includes("sorry") || lower.includes("cannot fulfill") || lower.includes("can't assist") || lower.includes("cannot assist")) {
              throw new Error("Anthropic Refusal Triggered");
            }
            return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }], _provider: 'anthropic' }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } else {
          const errText = await anthropicResponse.text();
          console.error('Anthropic API error:', anthropicResponse.status, errText);
        }
      } catch (err) {
        console.error('Anthropic request failed:', err);
      }
    }

    // ─── PROVIDER 3: Lovable AI Gateway (Fallback 2) ───
    if (LOVABLE_API_KEY) {
      console.log('Using Lovable AI Gateway as final fallback...');

      const aiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map((msg: Message) => {
          if (msg.images && msg.images.length > 0) {
            return {
              role: msg.role,
              content: [
                { type: 'text', text: msg.content },
                ...msg.images.map(img => ({
                  type: 'image_url',
                  image_url: { url: img }
                }))
              ]
            }
          }
          return { role: msg.role, content: msg.content };
        }),
      ];

      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-1.5-flash',
          messages: aiMessages,
          stream: stream,
          max_tokens: 4096,
          temperature: parseFloat(temperature.toFixed(2)),
        }),
      });

      if (response.status === 429 || response.status === 402) {
        const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
        if (GEMINI_API_KEY) {
          await response.text();
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
          const geminiBody = {
            contents: aiMessages.map((m: any) => ({
              role: m.role === 'system' ? 'user' : m.role === 'assistant' ? 'model' : 'user',
              parts: [
                { text: m.role === 'system' ? `[System Instructions]\n${m.content || (Array.isArray(m.content) ? m.content[0]?.text : '')}` : (Array.isArray(m.content) ? m.content[0]?.text : m.content) },
                ...(m.content && Array.isArray(m.content) ? m.content.filter((c: any) => c.type === 'image_url').map((c: any) => {
                   const match = c.image_url.url.match(/^data:(image\/[a-zA-Z]*);base64,(.*)$/);
                   if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
                   return null;
                }).filter(Boolean) : [])
              ],
            })),
            generationConfig: { temperature: parseFloat(temperature.toFixed(2)), maxOutputTokens: 4096 },
          };
          const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiBody),
          });
          if (geminiResponse.ok) {
            const geminiData = await geminiResponse.json();
            const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
            return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }], _fallback: 'gemini-direct' }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
        const statusMsg = response.status === 429 ? 'Limite de requisições atingido.' : 'Créditos insuficientes.';
        return new Response(JSON.stringify({ error: statusMsg }), { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (!response.ok) {
        const errorText = await response.text();
        return new Response(JSON.stringify({ error: 'Erro no serviço de IA', details: errorText }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (stream) {
        return new Response(response.body, { headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
      } else {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        const lower = text.toLowerCase();
        if (lower.includes("sorry") || lower.includes("cannot fulfill") || lower.includes("can't assist") || lower.includes("cannot assist")) {
            return new Response(JSON.stringify({ error: "Filtragem de IA: A imagem conteve elementos protegidos ou as IAs se recusaram. Tente enviar uma imagem diferente ou com menos elementos." }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
