import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `Você é LUCAS, especialista em construção de funis de vendas e copywriting de alta conversão para landing pages. Você domina as metodologias AIDA, PAS e storytelling de vendas.

Sua tarefa é gerar o copy completo de uma landing page de alta conversão com base no briefing do negócio.

O copy deve ser:
- Extremamente persuasivo e orientado à conversão
- Escrito em português brasileiro natural e direto
- Baseado em dores reais do público-alvo
- Com chamadas à ação irresistíveis
- Profissional mas próximo do leitor

FORMATO DE SAÍDA (JSON obrigatório):
{
  "headline": "Headline principal impactante (max 12 palavras)",
  "subheadline": "Subheadline que expande a proposta de valor (max 20 palavras)",
  "hero_text": "Parágrafo de abertura que conecta com a dor do cliente (2-3 frases)",
  "benefits": ["Benefício 1 com emoji", "Benefício 2 com emoji", "Benefício 3 com emoji", "Benefício 4 com emoji", "Benefício 5 com emoji"],
  "social_proof": "Texto de prova social e resultados (2-3 frases)",
  "offer_headline": "Título da seção da oferta",
  "offer_description": "Descrição da oferta com urgência e escassez (3-4 frases)",
  "guarantee": "Texto da garantia (1-2 frases)",
  "faq": [{"q": "Pergunta frequente 1", "a": "Resposta direta"}, {"q": "Pergunta 2", "a": "Resposta"}],
  "cta_primary": "Texto do botão CTA principal (max 5 palavras)",
  "cta_secondary": "CTA secundário para quem ainda hesita",
  "urgency_text": "Texto de urgência/escassez"
}`;

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

    if (action === 'generate_lp_copy') {
      const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');

      if (!anthropicKey) {
        // Demo fallback
        return new Response(JSON.stringify({ copy: buildDemoCopy(briefing), demo: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const userMessage = `Gere o copy completo da landing page para este negócio:

Produto/Serviço: ${briefing.produto}
Público-alvo: ${briefing.publico}
Principal dor/problema: ${briefing.dor}
Benefícios principais: ${briefing.beneficios}
Prova social/resultados: ${briefing.provas}
Oferta/Preço: ${briefing.oferta}
Garantia: ${briefing.garantia}
CTA desejado: ${briefing.cta}

Responda APENAS com o JSON válido conforme o formato especificado.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Anthropic API error: ${response.status} — ${errText}`);
      }

      const data = await response.json();
      const rawText = data.content?.[0]?.text ?? '{}';

      // Extract JSON from response
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const copy = jsonMatch ? JSON.parse(jsonMatch[0]) : buildDemoCopy(briefing);

      return new Response(JSON.stringify({ copy, demo: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    throw new Error(`Ação desconhecida: ${action}`);

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function buildDemoCopy(briefing: any) {
  return {
    headline: `Descubra Como ${briefing?.produto || 'Nossa Solução'} Vai Transformar Seus Resultados`,
    subheadline: "A solução definitiva para quem quer resultados reais sem perder tempo com o que não funciona",
    hero_text: "Você já tentou de tudo e os resultados ainda não vieram? Entendemos sua frustração. É por isso que criamos uma abordagem completamente diferente, focada no que realmente funciona para o seu mercado.",
    benefits: [
      "✅ Resultados comprovados em 30 dias ou seu dinheiro de volta",
      "🚀 Implementação rápida sem precisar de equipe técnica",
      "💰 ROI garantido desde a primeira semana de uso",
      "🎯 Estratégia personalizada para o seu nicho específico",
      "📊 Relatórios detalhados para você acompanhar cada resultado"
    ],
    social_proof: "Já ajudamos mais de 500 empresas a alcançar resultados extraordinários. Nossos clientes reportam em média 3x mais conversões no primeiro mês de uso.",
    offer_headline: "Oferta Especial por Tempo Limitado",
    offer_description: "Aproveite nossa condição especial de lançamento com acesso completo por um valor especial. Esta oferta é válida apenas para os próximos 48 horas ou até esgotar as vagas. Não deixe para depois o que pode mudar seus resultados hoje.",
    guarantee: "🛡️ Garantia total de 30 dias: Se você não ficar satisfeito por qualquer motivo, devolvemos 100% do seu investimento. Sem perguntas, sem burocracia.",
    faq: [
      { q: "Preciso ter experiência técnica?", a: "Não! Nossa plataforma foi criada para ser simples e intuitiva. Qualquer pessoa consegue usar." },
      { q: "Em quanto tempo vejo resultados?", a: "A maioria dos nossos clientes começa a ver resultados na primeira semana de uso." }
    ],
    cta_primary: "Quero Começar Agora",
    cta_secondary: "Falar com um especialista antes de decidir",
    urgency_text: "⚡ Oferta disponível para as próximas 47:23 horas — garanta sua vaga agora"
  };
}
