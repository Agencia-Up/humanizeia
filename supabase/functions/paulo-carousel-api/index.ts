import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return new Response(JSON.stringify({ error: 'Token inválido' }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const { action, prompt, system_prompt, angle } = body;

    if (action !== 'generate_carousels') {
      return new Response(JSON.stringify({ error: `Ação desconhecida: ${action}` }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');

    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY não configurada no Supabase.');
    }

    // Helper to call AI (prefers Anthropic if available and not forced to JSON, otherwise OpenAI)
    async function callAI(sys: string, userPrompt: string, maxTokens: number, forceJson = false): Promise<string> {
      // For JSON extraction, OpenAI is usually more reliable and faster
      if (!forceJson && anthropicKey) {
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
              system: sys,
              messages: [{ role: 'user', content: userPrompt }],
            }),
          });
          if (res.ok) {
            const data = await res.json();
            return data?.content?.[0]?.text ?? '';
          }
          console.warn('Anthropic falhou, tentando fallback OpenAI...', await res.text());
        } catch (e: any) {
          console.warn('Erro Anthropic:', e.message);
        }
      }

      // OpenAI Fallback / JSON Extractor
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: userPrompt },
          ],
          temperature: forceJson ? 0 : 0.88,
          max_tokens: maxTokens,
          ...(forceJson ? { response_format: { type: 'json_object' } } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`OpenAI API Error: ${res.status} — ${err}`);
      }

      const data = await res.json();
      return data?.choices?.[0]?.message?.content ?? '';
    }

    // ── STEP 1: Creative Director (Markdown Manifesto) ───────────────────────
    console.log('Paulo: Gerando Manifesto Criativo...');
    const manifesto = await callAI(system_prompt, prompt, 8000, false);

    if (!manifesto) {
      throw new Error('Falha ao gerar o manifesto criativo.');
    }

    // ── STEP 2: JSON Extraction ──────────────────────────────────────────────
    console.log('Paulo: Extraindo para JSON...');
    const EXTRACTION_PROMPT = `Você é o Arquiteto de Estruturas JSON. 
Sua missão é extrair os dados do Manifesto Criativo (que segue um template específico com chaves como text_headline, image_prompt, etc.) para o objeto JSON rigoroso abaixo. Mantenha os textos IGUAIS ao original.

SCHEMA OBRIGATÓRIO:
{
  "carousels": [
    {
      "title": "Título",
      "niche": "Nicho",
      "angle": "ângulo",
      "caption": "Legenda gerada completa (manter todo o texto)",
      "hashtags": ["tag1"],
      "slides": [
        {
          "slide_number": 1,
          "type": "cover",
          "headline": "text_headline original",
          "subtext": "text_sub_headline original (se houver)",
          "body": "text_body original",
          "bullets": ["bullet 1"],
          "image_prompt": "image_prompt original completo (em inglês)",
          "visual_cue": "visual_cue original"
        }
      ]
    }
  ]
}

- Não extraia chaves que não existam.
- Se algum campo for opcional (ex: subtext, visual_cue, bullets) e não estiver no markdown, envie vazio.
- O campo 'body' no json equivale a 'text_body' no markdown.`;

    const rawJson = await callAI(
      EXTRACTION_PROMPT,
      `Converta o seguinte roteiro em JSON rigorosamente dentro do schema especificado:\n\n${manifesto}`,
      8000,
      true
    );

    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      // Tentar match se gpt-4o enviar texto markdown em volta
      const match = rawJson.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('A IA não retornou um JSON válido na extração.');
      }
    }

    // Retorna o JSON como string (o frontend parseia)
    return new Response(JSON.stringify({ content: JSON.stringify(parsed) }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('paulo-carousel-api error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
