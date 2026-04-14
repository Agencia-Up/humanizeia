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

    let content = '';

    // ── Attempt 1: Anthropic Claude (highest quality) ───────────────────────
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
            max_tokens: 8000,
            system: system_prompt,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (res.ok) {
          const data = await res.json();
          content = data?.content?.[0]?.text ?? '';
          console.log('Paulo gerou via Anthropic Claude.');
        } else {
          console.warn('Anthropic falhou:', await res.text());
        }
      } catch (e: any) {
        console.warn('Erro Anthropic:', e.message);
      }
    }

    // ── Attempt 2: OpenAI GPT-4o (fallback) ────────────────────────────────
    if (!content && openaiKey) {
      console.log('Tentando OpenAI GPT-4o...');
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: system_prompt },
            { role: 'user', content: prompt },
          ],
          temperature: 0.88,
          max_tokens: 6000,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        content = data?.choices?.[0]?.message?.content ?? '';
        console.log('Paulo gerou via OpenAI GPT-4o.');
      } else {
        const err = await res.text();
        throw new Error(`OpenAI falhou: ${res.status} — ${err}`);
      }
    }

    if (!content) {
      throw new Error('Nenhum provedor de IA disponível. Verifique as chaves de API no Supabase.');
    }

    return new Response(JSON.stringify({ content }), {
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
