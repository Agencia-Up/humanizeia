// Edge Function: knowledge-embed
// Processa uma knowledge_source e gera embeddings no pgvector
// Chamada pelo frontend ao adicionar uma fonte de dados

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Divide texto em chunks de ~500 tokens (~2000 chars)
function splitIntoChunks(text: string, maxChars = 2000): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n{2,}/); // divide por parágrafo duplo
  let current = '';

  for (const para of paragraphs) {
    if ((current + para).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // Se algum chunk ainda for muito grande, divide por linha simples
  const result: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxChars) {
      result.push(chunk);
    } else {
      const lines = chunk.split('\n');
      let sub = '';
      for (const line of lines) {
        if ((sub + line).length > maxChars && sub.length > 0) {
          result.push(sub.trim());
          sub = line;
        } else {
          sub += (sub ? '\n' : '') + line;
        }
      }
      if (sub.trim()) result.push(sub.trim());
    }
  }

  return result.filter(c => c.length > 10);
}

// Gera embedding para um texto via OpenAI
async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000), // limite seguro
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

    const { source_id } = await req.json();
    if (!source_id) {
      return new Response(JSON.stringify({ error: 'source_id é obrigatório' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Buscar a fonte de dados
    const { data: source, error: sourceErr } = await supabase
      .from('knowledge_sources')
      .select('*')
      .eq('id', source_id)
      .single();

    if (sourceErr || !source) {
      return new Response(JSON.stringify({ error: 'Fonte não encontrada' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[knowledge-embed] Processando fonte: "${source.name}" (${source.type})`);

    // 2. Marcar como processing
    await supabase
      .from('knowledge_sources')
      .update({ status: 'processing' })
      .eq('id', source_id);

    // 3. Preparar o conteúdo baseado no tipo
    let textContent = source.content || '';

    if (source.type === 'url' && source.metadata?.url) {
      // Para URL: tenta fazer scraping simples
      try {
        console.log(`[knowledge-embed] Fazendo scraping de: ${source.metadata.url}`);
        const urlRes = await fetch(source.metadata.url as string, {
          headers: { 'User-Agent': 'Mozilla/5.0 HumanizeIA/1.0' },
        });
        if (urlRes.ok) {
          const html = await urlRes.text();
          // Remove tags HTML de forma simples
          textContent = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim()
            .slice(0, 50000); // Limite de 50k chars
          console.log(`[knowledge-embed] Scraping OK: ${textContent.length} chars`);
        }
      } catch (scrapeErr) {
        console.warn('[knowledge-embed] Scraping falhou:', scrapeErr);
        // Usa o conteúdo salvo se scraping falhar
      }
    }

    if (!textContent || textContent.length < 10) {
      await supabase
        .from('knowledge_sources')
        .update({
          status: 'error',
          error_message: 'Conteúdo vazio ou muito pequeno para processar',
        })
        .eq('id', source_id);

      return new Response(JSON.stringify({ error: 'Conteúdo insuficiente' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Dividir em chunks
    const chunks = splitIntoChunks(textContent);
    console.log(`[knowledge-embed] ${chunks.length} chunks gerados`);

    // 5. Deletar chunks existentes desta fonte (re-sync)
    await supabase
      .from('knowledge_chunks')
      .delete()
      .eq('source_id', source_id);

    // 6. Gerar embeddings e inserir em lote
    let processedChunks = 0;
    const totalTokens = Math.ceil(textContent.length / 4);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const embedding = await generateEmbedding(chunk, OPENAI_API_KEY);
        
        await supabase.from('knowledge_chunks').insert({
          source_id: source_id,
          kb_id: source.kb_id,
          user_id: source.user_id,
          content: chunk,
          embedding: JSON.stringify(embedding), // pgvector aceita array como JSON
          chunk_index: i,
          metadata: {
            source_name: source.name,
            source_type: source.type,
            char_count: chunk.length,
          },
        });

        processedChunks++;
        console.log(`[knowledge-embed] Chunk ${i + 1}/${chunks.length} processado`);

        // Pequena pausa para evitar rate limit da OpenAI
        if (i < chunks.length - 1) {
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (chunkErr: any) {
        console.error(`[knowledge-embed] Erro no chunk ${i}:`, chunkErr.message);
      }
    }

    // 7. Atualizar status da fonte
    await supabase
      .from('knowledge_sources')
      .update({
        status: processedChunks > 0 ? 'synced' : 'error',
        token_count: totalTokens,
        chunk_count: processedChunks,
        content: textContent.slice(0, 100000), // salva conteúdo atualizado (max 100k)
        last_synced_at: new Date().toISOString(),
        error_message: processedChunks === 0 ? 'Nenhum chunk processado com sucesso' : null,
      })
      .eq('id', source_id);

    console.log(`[knowledge-embed] ✅ Concluído: ${processedChunks}/${chunks.length} chunks | ${totalTokens} tokens`);

    return new Response(
      JSON.stringify({
        success: true,
        chunks_processed: processedChunks,
        total_chunks: chunks.length,
        token_count: totalTokens,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[knowledge-embed] Erro crítico:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
