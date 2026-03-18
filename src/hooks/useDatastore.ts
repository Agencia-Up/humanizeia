import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { useState } from 'react';

// ── useDatastore ──────────────────────────────────────────────
export function useDatastore() {
  const { user } = useAuth();

  const { data: datastores, isLoading } = useQuery({
    queryKey: ['datastores', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('datastores')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const queryClient = useQueryClient();

  const createDatastore = useMutation({
    mutationFn: async (input: { name: string; description: string }) => {
      const { data, error } = await supabase
        .from('datastores')
        .insert({ ...input, user_id: user!.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['datastores'] });
      toast.success('Datastore criado com sucesso!');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteDatastore = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('datastores').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['datastores'] });
      toast.success('Datastore excluído');
    },
    onError: (err: any) => toast.error(err.message),
  });

  return { datastores, isLoading, createDatastore, deleteDatastore };
}

// ── useDatastoreSources ───────────────────────────────────────
export function useDatastoreSources(datastoreId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: sources, isLoading } = useQuery({
    queryKey: ['datastore-sources', datastoreId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('datastore_sources')
        .select('*')
        .eq('datastore_id', datastoreId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!datastoreId && !!user,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['datastore-sources', datastoreId] });
    queryClient.invalidateQueries({ queryKey: ['datastores'] });
  };

  const addTextSource = useMutation({
    mutationFn: async (input: { name: string; content: string }) => {
      const { data, error } = await supabase
        .from('datastore_sources')
        .insert({
          datastore_id: datastoreId!,
          user_id: user!.id,
          name: input.name,
          source_type: 'text',
          content: input.content,
          status: 'pending',
        })
        .select()
        .single();
      if (error) throw error;

      // Process chunks inline (simple chunking)
      await processTextChunks(datastoreId!, data.id, user!.id, input.content);

      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Fonte adicionada com sucesso!');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const addUrlSource = useMutation({
    mutationFn: async (input: { name: string; url: string }) => {
      const { data, error } = await supabase
        .from('datastore_sources')
        .insert({
          datastore_id: datastoreId!,
          user_id: user!.id,
          name: input.name,
          source_type: 'url',
          url: input.url,
          status: 'pending',
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('URL adicionada! Processamento será feito em breve.');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const uploadFile = useMutation({
    mutationFn: async ({ file }: { file: File }) => {
      const filePath = `${user!.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('datastore-files')
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      const content = await file.text();

      const { data, error } = await supabase
        .from('datastore_sources')
        .insert({
          datastore_id: datastoreId!,
          user_id: user!.id,
          name: file.name,
          source_type: 'file',
          file_path: filePath,
          content,
          status: 'pending',
        })
        .select()
        .single();
      if (error) throw error;

      await processTextChunks(datastoreId!, data.id, user!.id, content);

      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Arquivo enviado e processado!');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteSource = useMutation({
    mutationFn: async (sourceId: string) => {
      const { error } = await supabase.from('datastore_sources').delete().eq('id', sourceId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Fonte excluída');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const reprocessSource = useMutation({
    mutationFn: async (sourceId: string) => {
      const source = sources?.find(s => s.id === sourceId);
      if (!source || !source.content) throw new Error('Sem conteúdo para reprocessar');

      // Delete existing chunks
      await supabase.from('datastore_chunks').delete().eq('source_id', sourceId);

      // Re-chunk
      await processTextChunks(datastoreId!, sourceId, user!.id, source.content);
    },
    onSuccess: () => {
      invalidate();
      toast.success('Reprocessado com sucesso!');
    },
    onError: (err: any) => toast.error(err.message),
  });

  return { sources, isLoading, addTextSource, addUrlSource, uploadFile, deleteSource, reprocessSource };
}

// ── Simple text chunking ──────────────────────────────────────
async function processTextChunks(datastoreId: string, sourceId: string, userId: string, text: string) {
  const CHUNK_SIZE = 500;
  const OVERLAP = 50;
  const chunks: string[] = [];

  for (let i = 0; i < text.length; i += CHUNK_SIZE - OVERLAP) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  const chunkRows = chunks.map((content, index) => ({
    source_id: sourceId,
    datastore_id: datastoreId,
    user_id: userId,
    content,
    chunk_index: index,
    tokens_count: Math.ceil(content.length / 4),
  }));

  if (chunkRows.length > 0) {
    const { error } = await supabase.from('datastore_chunks').insert(chunkRows);
    if (error) throw error;
  }

  const totalTokens = chunkRows.reduce((s, c) => s + c.tokens_count, 0);

  // Update source status
  await supabase
    .from('datastore_sources')
    .update({ status: 'completed', chunks_count: chunks.length, tokens_count: totalTokens })
    .eq('id', sourceId);

  // Update datastore counters
  const { data: allSources } = await supabase
    .from('datastore_sources')
    .select('chunks_count, tokens_count')
    .eq('datastore_id', datastoreId);

  const totalDocs = allSources?.length || 0;
  const totalChunks = allSources?.reduce((s, src) => s + (src.chunks_count || 0), 0) || 0;
  const totalTok = allSources?.reduce((s, src) => s + (src.tokens_count || 0), 0) || 0;

  await supabase
    .from('datastores')
    .update({ total_documents: totalDocs, total_chunks: totalChunks, total_tokens: totalTok })
    .eq('id', datastoreId);
}

// ── useDatastoreSearch ────────────────────────────────────────
export function useDatastoreSearch(datastoreId: string | null) {
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);

  const search = async (query: string) => {
    if (!datastoreId || !query.trim()) return;
    setIsSearching(true);

    try {
      // Simple text search fallback (embeddings require edge function)
      const { data, error } = await supabase
        .from('datastore_chunks')
        .select('id, content, source_id')
        .eq('datastore_id', datastoreId)
        .ilike('content', `%${query}%`)
        .limit(10);

      if (error) throw error;

      // Get source names
      const sourceIds = [...new Set(data?.map(d => d.source_id) || [])];
      const { data: sourcesData } = await supabase
        .from('datastore_sources')
        .select('id, name')
        .in('id', sourceIds);

      const sourceMap = new Map(sourcesData?.map(s => [s.id, s.name]) || []);

      setResults(
        (data || []).map(chunk => ({
          content: chunk.content,
          source: sourceMap.get(chunk.source_id) || 'Desconhecido',
          similarity: 0.85, // placeholder for text search
        }))
      );
    } catch (err: any) {
      toast.error('Erro na busca: ' + err.message);
    } finally {
      setIsSearching(false);
    }
  };

  return { search, isSearching, results };
}
