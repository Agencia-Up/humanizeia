/**
 * ai-key-test — valida uma chave de IA do cliente contra o provedor.
 *
 * NAO salva nada. So responde se a chave funciona (pro botao "testar" na tela
 * de Configuracoes > IA, antes do cliente salvar). Exige usuario autenticado.
 *
 * Body: { provider: 'openai'|'anthropic'|'deepseek', key: string }
 * Resp: { ok: boolean, detail: string }
 */

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function testKey(provider: string, key: string): Promise<{ ok: boolean; detail: string }> {
  try {
    if (provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (r.ok) return { ok: true, detail: 'Chave OpenAI válida.' };
      if (r.status === 401) return { ok: false, detail: 'Chave OpenAI inválida (não autorizada).' };
      return { ok: false, detail: `OpenAI respondeu HTTP ${r.status}.` };
    }
    if (provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      });
      if (r.ok) return { ok: true, detail: 'Chave Anthropic (Claude) válida.' };
      if (r.status === 401) return { ok: false, detail: 'Chave Anthropic inválida (não autorizada).' };
      return { ok: false, detail: `Anthropic respondeu HTTP ${r.status}.` };
    }
    if (provider === 'deepseek') {
      const r = await fetch('https://api.deepseek.com/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (r.ok) return { ok: true, detail: 'Chave DeepSeek válida.' };
      if (r.status === 401) return { ok: false, detail: 'Chave DeepSeek inválida (não autorizada).' };
      return { ok: false, detail: `DeepSeek respondeu HTTP ${r.status}.` };
    }
    return { ok: false, detail: 'Provedor não suportado.' };
  } catch (e: any) {
    return { ok: false, detail: `Falha ao contatar o provedor: ${e?.message || e}` };
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, detail: 'Method not allowed' }, 405);

  try {
    // Exige usuario autenticado (evita uso anonimo do endpoint).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ ok: false, detail: 'Não autorizado' }, 401);
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !user) return json({ ok: false, detail: 'Token inválido' }, 401);

    const { provider, key } = await req.json();
    if (!provider || !['openai', 'anthropic', 'deepseek'].includes(provider)) {
      return json({ ok: false, detail: 'Provedor inválido' }, 400);
    }
    if (!key || String(key).trim().length < 12) {
      return json({ ok: false, detail: 'Chave muito curta.' }, 400);
    }

    const result = await testKey(provider, String(key).trim());
    return json(result, 200);
  } catch (err: any) {
    return json({ ok: false, detail: err?.message || 'Erro' }, 500);
  }
});
