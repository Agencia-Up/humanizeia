// Edge Function: knowledge-search
// Busca semântica nos chunks da base de conhecimento
// Retorna os chunks mais relevantes para uma query

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI Embeddings error (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: 'OPENAI_API_KEY não configurada' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { query, kb_ids, match_threshold = 0.65, match_count = 5 } = await req.json();

    if (!query || !kb_ids?.length) {
      return new Response(JSON.stringify({ error: 'query e kb_ids são obrigatórios' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[knowledge-search] Query: "${query.slice(0, 80)}" | KBs: ${kb_ids.length}`);

    // 1. Gerar embedding da query
    const queryEmbedding = await generateEmbedding(query, OPENAI_API_KEY);

    // 2. Busca semântica usando a função do banco
    const { data: results, error } = await supabase.rpc('search_knowledge', {
      query_embedding: queryEmbedding,
      kb_ids: kb_ids,
      match_threshold: match_threshold,
      match_count: match_count,
    });

    if (error) {
      console.error('[knowledge-search] Erro na busca:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[knowledge-search] ✅ ${results?.length || 0} chunks encontrados`);

    return new Response(
      JSON.stringify({
        success: true,
        results: results || [],
        count: results?.length || 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[knowledge-search] Erro crítico:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
