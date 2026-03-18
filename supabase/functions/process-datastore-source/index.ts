import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const DEFAULT_CHUNK_SIZE = 1000
const DEFAULT_CHUNK_OVERLAP = 200

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  let source_id: string | null = null

  try {
    const body = await req.json()
    source_id = body.source_id

    if (!source_id) throw new Error('source_id is required')

    // 1. Buscar source
    const { data: source, error: sourceError } = await supabase
      .from('datastore_sources')
      .select('*')
      .eq('id', source_id)
      .single()

    if (sourceError || !source) throw new Error('Source not found')

    // Atualizar status
    await supabase
      .from('datastore_sources')
      .update({ status: 'processing' })
      .eq('id', source_id)

    // 2. Extrair conteúdo
    let content = ''

    switch (source.source_type) {
      case 'text':
        content = source.content || ''
        break
      case 'url':
        content = await fetchUrlContent(source.url)
        break
      case 'file':
        content = await extractFileContent(supabase, source.file_path)
        break
      default:
        throw new Error(`Unsupported source type: ${source.source_type}`)
    }

    if (!content.trim()) throw new Error('No content extracted')

    // 3. Dividir em chunks
    const chunks = splitIntoChunks(content, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP)
    console.log(`Created ${chunks.length} chunks`)

    // 4. Gerar embeddings via Gemini
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiApiKey) throw new Error('GEMINI_API_KEY not configured')

    const batchSize = 20
    const chunksToInsert: any[] = []

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize)

      const embeddings = await generateGeminiEmbeddings(
        geminiApiKey,
        batch.map(c => c.text)
      )

      for (let j = 0; j < batch.length; j++) {
        chunksToInsert.push({
          datastore_id: source.datastore_id,
          source_id: source_id,
          user_id: source.user_id,
          content: batch[j].text,
          embedding: JSON.stringify(embeddings[j]),
          chunk_index: i + j,
          tokens_count: estimateTokens(batch[j].text),
        })
      }
    }

    // 5. Deletar chunks antigos
    await supabase
      .from('datastore_chunks')
      .delete()
      .eq('source_id', source_id)

    // 6. Inserir novos chunks
    const { error: insertError } = await supabase
      .from('datastore_chunks')
      .insert(chunksToInsert)

    if (insertError) throw insertError

    // 7. Atualizar source
    const totalTokens = chunksToInsert.reduce((sum, c) => sum + (c.tokens_count || 0), 0)

    await supabase
      .from('datastore_sources')
      .update({
        status: 'completed',
        chunks_count: chunks.length,
        tokens_count: totalTokens,
        content: content,
      })
      .eq('id', source_id)

    // 8. Atualizar contadores do datastore
    const { data: allSources } = await supabase
      .from('datastore_sources')
      .select('chunks_count, tokens_count')
      .eq('datastore_id', source.datastore_id)

    const totalDocs = allSources?.length || 0
    const totalChunks = allSources?.reduce((s: number, src: any) => s + (src.chunks_count || 0), 0) || 0
    const totalTok = allSources?.reduce((s: number, src: any) => s + (src.tokens_count || 0), 0) || 0

    await supabase
      .from('datastores')
      .update({ total_documents: totalDocs, total_chunks: totalChunks, total_tokens: totalTok })
      .eq('id', source.datastore_id)

    return new Response(
      JSON.stringify({ success: true, chunks_created: chunks.length, tokens_used: totalTokens }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Process Error:', error)

    if (source_id) {
      await supabase
        .from('datastore_sources')
        .update({ status: 'error', error_message: (error as Error).message })
        .eq('id', source_id)
    }

    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ── Helpers ──

function splitIntoChunks(text: string, chunkSize: number, overlap: number) {
  const chunks: { text: string; start: number; end: number }[] = []
  let start = 0
  text = text.replace(/\s+/g, ' ').trim()

  while (start < text.length) {
    let end = start + chunkSize

    if (end < text.length) {
      const lastPeriod = text.lastIndexOf('.', end)
      const lastNewline = text.lastIndexOf('\n', end)
      const breakPoint = Math.max(lastPeriod, lastNewline)
      if (breakPoint > start + chunkSize * 0.5) end = breakPoint + 1
    }

    const chunkText = text.slice(start, end).trim()
    if (chunkText.length > 50) {
      chunks.push({ text: chunkText, start, end: Math.min(end, text.length) })
    }

    start = end - overlap
    if (start >= text.length) break
  }

  return chunks
}

async function generateGeminiEmbeddings(apiKey: string, texts: string[]): Promise<number[][]> {
  const results: number[][] = []

  for (const text of texts) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: { parts: [{ text }] },
          taskType: 'RETRIEVAL_DOCUMENT',
        }),
      }
    )

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Gemini Embedding API error: ${err}`)
    }

    const data = await response.json()
    results.push(data.embedding.values)
  }

  return results
}

async function fetchUrlContent(url: string): Promise<string> {
  // Try Firecrawl first if available
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')
  if (firecrawlKey) {
    try {
      const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formats: ['markdown'] }),
      })
      if (resp.ok) {
        const data = await resp.json()
        if (data.data?.markdown) return data.data.markdown
      }
    } catch (e) {
      console.warn('Firecrawl fallback:', e)
    }
  }

  // Simple HTML fetch fallback
  const response = await fetch(url)
  const html = await response.text()
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

async function extractFileContent(supabase: any, filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('datastore-files')
    .download(filePath)
  if (error) throw error
  return await data.text()
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4)
}
