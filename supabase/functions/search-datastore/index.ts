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
    } = await req.json()

    if (!datastore_id || !query) {
      throw new Error('datastore_id and query are required')
    }

    const startTime = Date.now()

    // Busca via full-text search (PostgreSQL) — sem API key externa
    const { data: results, error: searchError } = await supabase.rpc(
      'search_datastore_fulltext',
      {
        p_datastore_id: datastore_id,
        p_query: query,
        p_match_count: match_count,
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
