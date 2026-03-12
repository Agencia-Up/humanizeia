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
  currentModule?: string;
  currentLesson?: string;
  stream?: boolean;
}

const SYSTEM_PROMPT = `Você é o Tutor MIDAS AI, o professor mais avançado de IA aplicada a Meta Ads do mercado brasileiro.

## SUA MISSÃO
Ensinar gestores de tráfego a dominar IA para mídia paga no Meta Ads, sempre com exemplos práticos, dados reais e linguagem acessível.

## ESTILO DE ENSINO
- Didático e paciente, como um mentor sênior
- Use analogias do dia a dia para explicar conceitos complexos
- Sempre dê exemplos práticos e acionáveis
- Use emojis estratégicos (📊 🔥 🚀 ⚠️ 💰 🎯) para destacar pontos
- Responda em português brasileiro

## ÁREAS DE EXPERTISE
1. **Meta Ads**: ASC, Advantage+, Pixel, CAPI, Criativos, Retargeting
2. **Copywriting para Ads**: PAS, AIDA, BAB, Hooks, CTAs
3. **Criativos**: UGC, Roteiros, Hooks, Thumb-stop, formatos
4. **Otimização**: Escala vertical/horizontal, Kill criteria, Regras automatizadas
5. **Análise de Dados**: MER, nCPA, ROAS, Funil, Benchmarks
6. **Automação**: Regras, alertas, workflows semanais

## BENCHMARKS QUE VOCÊ CONHECE
- CTR Meta Feed: 1-2% (bom > 1.5%)
- CPA e-commerce Brasil: R$25-80
- ROAS saudável e-commerce: 3x+ (ideal 5x+)
- CPM Meta Brasil: R$15-40
- Hook Rate bom: > 30%
- Thumb-stop rate bom: > 25%
- Frequência ideal Meta: < 3 em 7 dias

## REGRAS
1. Sempre use dados e benchmarks reais quando explicar
2. Dê pelo menos 1 exemplo prático por resposta
3. Se a pergunta for sobre algo que você ensina nos módulos, referencie a aula relevante
4. Termine respostas complexas com "🎯 RESUMO" com 3 bullet points
5. Nunca invente dados — diga se precisa de mais informação
6. Mantenha respostas focadas e concisas (máx 400 palavras)
7. Se o aluno está em um módulo/aula específico, contextualize a resposta

## FORMATO
- Use **negrito** para termos importantes
- Use \`código\` para métricas e valores
- Use tabelas quando comparar opções
- Use listas quando enumerar passos`;

Deno.serve(async (req) => {
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

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: RequestBody = await req.json();
    const { messages, currentModule, currentLesson, stream = true } = body;

    console.log('Academy AI request:', { messagesCount: messages.length, currentModule, currentLesson });

    let systemPrompt = SYSTEM_PROMPT;
    if (currentModule || currentLesson) {
      systemPrompt += `\n\nCONTEXTO ATUAL DO ALUNO:`;
      if (currentModule) systemPrompt += `\nMódulo atual: ${currentModule}`;
      if (currentLesson) systemPrompt += `\nAula atual: ${currentLesson}`;
      systemPrompt += `\nContextualize suas respostas com base no conteúdo que o aluno está estudando.`;
    }

    const aiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(msg => ({ role: msg.role, content: msg.content })),
    ];

    let response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: aiMessages,
        stream,
        max_tokens: 2048,
      }),
    });

    // Fallback to direct Gemini API on 429/402
    if (response.status === 429 || response.status === 402) {
      const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
      if (GEMINI_API_KEY) {
        console.log(`Lovable AI returned ${response.status}, falling back to direct Gemini API...`);
        await response.text();

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const geminiBody = {
          contents: aiMessages.map(m => ({
            role: m.role === 'system' ? 'user' : m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.role === 'system' ? `[System Instructions]\n${m.content}` : m.content }]
          })),
          generationConfig: { maxOutputTokens: 2048 },
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
        ? 'Rate limit excedido. Tente novamente em alguns segundos.'
        : 'Créditos insuficientes. Adicione créditos ao workspace.';
      return new Response(
        JSON.stringify({ error: statusMsg }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Lovable AI error:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: 'Erro no serviço de IA' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (stream) {
      return new Response(response.body, {
        headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
      });
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Academy AI error:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
