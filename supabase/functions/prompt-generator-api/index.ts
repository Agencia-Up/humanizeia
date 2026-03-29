import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `Você é um especialista sênior em copywriting de conversão, vendas consultivas e criação de agentes de IA para negócios digitais. Seu trabalho é transformar um briefing de negócio em um SYSTEM PROMPT completo, poderoso e pronto para implementação em um agente de vendas (ChatGPT, Claude, ManyChat, Evolution API, etc.).

O prompt gerado deve:
1. Definir claramente a identidade e papel do agente
2. Estabelecer o tom de voz e estilo de comunicação exato
3. Mapear o fluxo de conversa (discovery → apresentação → objeções → CTA)
4. Incluir técnicas de copywriting (AIDA, PAS, storytelling)
5. Ter scripts completos para as principais objeções
6. Definir regras rígidas de comportamento (o que fazer e o que NUNCA fazer)
7. Sempre terminar com CTA claro e irresistível

Formate o prompt com seções bem definidas usando emojis e separadores visuais (─────). Seja extremamente específico, direto e poderoso. Use linguagem de comando para o agente. Escreva em português brasileiro. O prompt deve ter pelo menos 800 palavras.`;

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
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Token inválido');

    const body = await req.json();
    const { action, briefing } = body;

    if (action === 'generate_prompt') {
      const provider = body.ai_provider || 'openai'; // default to openai
      let promptText = '';
      let tokensUsed = 0;

      // Buscando a Base de Conhecimento dos Agentes para este usuário
      const { data: knowledgeData } = await supabase
        .from('agent_knowledge')
        .select('agent_id, knowledge_text')
        .eq('user_id', user.id);

      let finalSystemPrompt = SYSTEM_PROMPT;
      if (knowledgeData && knowledgeData.length > 0) {
        let knowledgeSection = '\n\n─────────────────────────────────────────────────\n\n## 🧠 BASE DE CONHECIMENTO ESPECÍFICA DESTA AGÊNCIA\n\nVocê deve incorporar as seguintes regras e personalidades individuais na delegação das tarefas para a equipe:\n\n';
        for (const k of knowledgeData) {
          knowledgeSection += `- **Agente ${k.agent_id.toUpperCase()}**: ${k.knowledge_text}\n\n`;
        }
        finalSystemPrompt += knowledgeSection;
      }

      if (provider === 'openai') {
        const openAiKey = Deno.env.get('OPENAI_API_KEY');
        if (!openAiKey) {
          return new Response(JSON.stringify({ prompt: buildDemoPrompt(briefing, 'OpenAI'), tokens_used: 0, demo: true }), 
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openAiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: finalSystemPrompt },
              { role: 'user', content: `Com base neste briefing, crie um SYSTEM PROMPT completo e profissional para um agente de vendas:\n\n${briefing}` }
            ],
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`OpenAI API error: ${response.status} — ${errText}`);
        }
        const data = await response.json();
        promptText = data.choices?.[0]?.message?.content ?? '';
        tokensUsed = data.usage?.total_tokens ?? 0;

      } else if (provider.startsWith('anthropic')) {
        const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
        if (!anthropicKey) {
          return new Response(JSON.stringify({ prompt: buildDemoPrompt(briefing, 'Anthropic'), tokens_used: 0, demo: true }), 
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const modelId = provider === 'anthropic_sonnet' ? 'claude-3-5-sonnet-20241022' : 'claude-3-haiku-20240307';
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: modelId,
            max_tokens: 4096,
            system: finalSystemPrompt,
            messages: [{
              role: 'user',
              content: `Com base neste briefing, crie um SYSTEM PROMPT completo e profissional para um agente de vendas:\n\n${briefing}`,
            }],
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Anthropic API error: ${response.status} — ${errText}`);
        }
        const data = await response.json();
        promptText = data.content?.[0]?.text ?? '';
        tokensUsed = data.usage?.input_tokens + data.usage?.output_tokens ?? 0;
      }

      // Save to DB
      await supabase.from('generated_prompts' as any).insert({
        user_id: user.id,
        briefing_data: briefing,
        generated_prompt: promptText,
        tokens_used: tokensUsed,
      });

      return new Response(JSON.stringify({
        prompt: promptText,
        tokens_used: tokensUsed,
        demo: false,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    throw new Error(`Ação desconhecida: ${action}`);

  } catch (err: any) {
    console.error('API Error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function buildDemoPrompt(briefing: string): string {
  return `# 🤖 SYSTEM PROMPT — AGENTE DE VENDAS

> ⚠️ MODO DEMO — Configure ANTHROPIC_API_KEY nas secrets do Supabase para gerar prompts reais com IA.

─────────────────────────────────────────────────

## 🎯 IDENTIDADE E MISSÃO

Você é um especialista em vendas consultivas altamente treinado. Sua missão é qualificar leads, apresentar a oferta com clareza e conduzir o cliente até a decisão de compra de forma natural e sem pressão excessiva.

─────────────────────────────────────────────────

## 🗣️ TOM DE VOZ E COMUNICAÇÃO

- Seja direto, objetivo e confiante
- Use linguagem acessível e próxima do cliente
- Demonstre empatia genuína com as dores do cliente
- Nunca seja robótico ou repetitivo

─────────────────────────────────────────────────

## 📋 FLUXO DE CONVERSA

### FASE 1 — DISCOVERY (2-3 mensagens)
Faça perguntas para entender:
1. Qual o maior desafio atual do cliente?
2. Já tentou resolver antes? O que aconteceu?
3. O que mudaria se esse problema fosse resolvido?

### FASE 2 — APRESENTAÇÃO
Após entender a dor, apresente a solução conectando aos problemas relatados. Use a estrutura:
- O problema que eles têm
- Por que soluções comuns falham
- Como nossa abordagem é diferente
- Prova social (resultados reais)

### FASE 3 — CONTORNO DE OBJEÇÕES
Para cada objeção, use: Validar → Reformular → Resolver

### FASE 4 — CTA
Conduza naturalmente para a ação. Crie urgência real, não artificial.

─────────────────────────────────────────────────

## 🚫 REGRAS ABSOLUTAS

- NUNCA prometa resultados garantidos
- NUNCA ofereça desconto sem autorização
- NUNCA fale mal de concorrentes
- NUNCA pressione de forma agressiva

─────────────────────────────────────────────────

*Prompt gerado com dados do briefing. Configure a API key para gerar prompts personalizados com IA.*`;
}
