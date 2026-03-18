import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const {
      datastore_id,
      query,
      match_count = 5,
      similarity_threshold = 0.5,
    } = await req.json()

    if (!datastore_id || !query) {
      throw new Error('datastore_id and query are required')
    }

    // 1. Gerar embedding da query via Gemini
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiApiKey) throw new Error('GEMINI_API_KEY not configured')

    const startTime = Date.now()

    const embResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: { parts: [{ text: query }] },
          taskType: 'RETRIEVAL_QUERY',
        }),
      }
    )

    if (!embResponse.ok) {
      const err = await embResponse.text()
      throw new Error(`Gemini Embedding error: ${err}`)
    }

    const embData = await embResponse.json()
    const queryEmbedding = embData.embedding.values

    // 2. Buscar via função SQL existente
    const { data: results, error: searchError } = await supabase.rpc(
      'search_datastore_chunks',
      {
        p_datastore_id: datastore_id,
        p_query_embedding: JSON.stringify(queryEmbedding),
        p_match_count: match_count,
        p_match_threshold: similarity_threshold,
      }
    )

    if (searchError) throw searchError

    const executionTime = Date.now() - startTime

    const formattedResults = (results || []).map((r: any) => ({
      id: r.id,
      content: r.content,
      source: r.source_name,
      similarity: parseFloat(Number(r.similarity).toFixed(4)),
    }))

    return new Response(
      JSON.stringify({
        success: true,
        query,
        results: formattedResults,
        total_results: formattedResults.length,
        execution_time_ms: executionTime,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Search Error:', error)
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
