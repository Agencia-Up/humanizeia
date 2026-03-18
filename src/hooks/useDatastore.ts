import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

// ── useDatastore ──────────────────────────────────────────────
export function useDatastore() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

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
    refetchInterval: 5000,
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

      // Trigger edge function for embedding processing
      supabase.functions.invoke('process-datastore-source', {
        body: { source_id: data.id },
      }).catch(err => console.error('Process error:', err));

      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Conteúdo adicionado! Processando embeddings...');
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

      supabase.functions.invoke('process-datastore-source', {
        body: { source_id: data.id },
      }).catch(err => console.error('Process error:', err));

      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('URL adicionada! Processando...');
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

      const { data, error } = await supabase
        .from('datastore_sources')
        .insert({
          datastore_id: datastoreId!,
          user_id: user!.id,
          name: file.name,
          source_type: 'file',
          file_path: filePath,
          status: 'pending',
        })
        .select()
        .single();
      if (error) throw error;

      supabase.functions.invoke('process-datastore-source', {
        body: { source_id: data.id },
      }).catch(err => console.error('Process error:', err));

      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Arquivo enviado! Processando...');
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
      await supabase
        .from('datastore_sources')
        .update({ status: 'pending' })
        .eq('id', sourceId);

      const { error } = await supabase.functions.invoke('process-datastore-source', {
        body: { source_id: sourceId },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Reprocessando...');
    },
    onError: (err: any) => toast.error(err.message),
  });

  return { sources, isLoading, addTextSource, addUrlSource, uploadFile, deleteSource, reprocessSource };
}

// ── useDatastoreSearch ────────────────────────────────────────
export function useDatastoreSearch(datastoreId: string | null) {
  const searchMutation = useMutation({
    mutationFn: async (query: string) => {
      if (!datastoreId || !query.trim()) return { results: [] };

      const { data, error } = await supabase.functions.invoke('search-datastore', {
        body: {
          datastore_id: datastoreId,
          query,
          match_count: 5,
        },
      });

      if (error) throw error;
      return data;
    },
    onError: (err: any) => toast.error('Erro na busca: ' + err.message),
  });

  return {
    search: searchMutation.mutateAsync,
    isSearching: searchMutation.isPending,
    results: searchMutation.data?.results || [],
  };
}
