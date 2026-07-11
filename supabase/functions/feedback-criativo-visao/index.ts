// feedback-criativo-visao
// Lê a IMAGEM (thumbnail) dos criativos do José cujo NOME é genérico ("05","01"...)
// e identifica o carro por visão (GPT-4o), cacheando em jose_criativo_carro para o
// painel "Por produto" casar com o produto da conversa. Chamado pelo gestor a partir
// do painel; processa só a lista que o frontend manda (os que ele marcou como genéricos).
// SÓ LEITURA de tráfego — não altera campanha/anúncio nenhum.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function identificarCarro(thumbUrl: string): Promise<{ carro: string; confianca: string }> {
  // baixa a imagem do fbcdn (pública) e manda pro GPT-4o de visão
  const img = await fetch(thumbUrl);
  if (!img.ok) return { carro: 'indefinido', confianca: 'baixa' };
  const ct = img.headers.get('content-type') || 'image/jpeg';
  const buf = new Uint8Array(await img.arrayBuffer());
  if (buf.length === 0 || buf.length > 6_000_000) return { carro: 'indefinido', confianca: 'baixa' };
  const dataUri = `data:${ct};base64,${toBase64(buf)}`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0,
      max_tokens: 30,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Esta é a imagem de um anúncio de uma concessionária de carros. Identifique o carro (marca e modelo). '
              + 'Responda SOMENTE o modelo curto e canônico, ex.: "Fiat Toro", "Chevrolet Onix", "Jeep Compass", "Hyundai Creta". '
              + 'Sem preço, ano ou versão. Se não for possível identificar um carro na imagem, responda exatamente "indefinido".',
          },
          { type: 'image_url', image_url: { url: dataUri, detail: 'low' } },
        ],
      }],
    }),
  });
  if (!resp.ok) return { carro: 'indefinido', confianca: 'baixa' };
  const j = await resp.json();
  let carro = String(j?.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '').slice(0, 60);
  if (!carro || /^indefinido/i.test(carro)) return { carro: 'indefinido', confianca: 'baixa' };
  return { carro, confianca: 'ia' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Não autorizado');
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada');

    // client escopado no chamador — o RPC de gravação usa auth.uid() pra achar o tenant
    const supabase = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Token inválido');

    const body = await req.json().catch(() => ({}));
    const entrada: Array<{ asset_key?: string; nome?: string; thumbnail_url?: string }> = Array.isArray(body?.criativos) ? body.criativos : [];

    // dedupe por asset_key, só com thumbnail, teto de 12 por chamada (custo/tempo)
    const vistos = new Set<string>();
    const fila = entrada.filter((c) => {
      const k = (c.asset_key || '').trim();
      if (!k || !c.thumbnail_url || vistos.has(k)) return false;
      vistos.add(k); return true;
    }).slice(0, 12);

    const resultados: Array<{ asset_key: string; carro: string; confianca: string }> = [];
    for (const c of fila) {
      try {
        const { carro, confianca } = await identificarCarro(c.thumbnail_url!);
        await supabase.rpc('jose_criativo_carro_set', {
          p_asset_key: c.asset_key, p_nome: c.nome || null, p_carro: carro, p_confianca: confianca, p_thumb: c.thumbnail_url,
        });
        resultados.push({ asset_key: c.asset_key!, carro, confianca });
      } catch (_e) {
        resultados.push({ asset_key: c.asset_key!, carro: 'indefinido', confianca: 'erro' });
      }
    }

    return new Response(JSON.stringify({ ok: true, processados: resultados.length, resultados }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
