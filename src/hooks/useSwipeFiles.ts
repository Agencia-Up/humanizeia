import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface SwipeFile {
  id: string;
  user_id: string;
  title: string;
  content: string;
  category: string;
  platform: string;
  tags: string[];
  is_favorite: boolean;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface SwipeFileInsert {
  title: string;
  content: string;
  category?: string;
  platform?: string;
  tags?: string[];
  notes?: string;
  source?: string;
}

export function useSwipeFiles() {
  const { toast } = useToast();
  const [swipeFiles, setSwipeFiles] = useState<SwipeFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSwipeFiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('swipe_files')
        .select('*')
        .eq('user_id', user.id)
        .order('is_favorite', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSwipeFiles((data as SwipeFile[]) || []);
    } catch (err) {
      console.error('Error fetching swipe files:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const addSwipeFile = useCallback(async (file: SwipeFileInsert) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({ title: 'Erro', description: 'Você precisa estar logado.', variant: 'destructive' });
        return null;
      }

      const { data, error } = await supabase
        .from('swipe_files')
        .insert({
          user_id: user.id,
          title: file.title,
          content: file.content,
          category: file.category || 'geral',
          platform: file.platform || 'meta',
          tags: file.tags || [],
          notes: file.notes || null,
          source: file.source || 'manual',
        })
        .select()
        .single();

      if (error) throw error;
      
      setSwipeFiles(prev => [data as SwipeFile, ...prev]);
      toast({ title: '✅ Swipe file salvo!', description: `"${file.title}" adicionado à sua coleção.` });
      return data as SwipeFile;
    } catch (err) {
      console.error('Error adding swipe file:', err);
      toast({ title: 'Erro ao salvar', description: 'Não foi possível salvar o swipe file.', variant: 'destructive' });
      return null;
    }
  }, [toast]);

  const deleteSwipeFile = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('swipe_files')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setSwipeFiles(prev => prev.filter(f => f.id !== id));
      toast({ title: 'Removido', description: 'Swipe file removido com sucesso.' });
    } catch (err) {
      console.error('Error deleting swipe file:', err);
      toast({ title: 'Erro', description: 'Não foi possível remover.', variant: 'destructive' });
    }
  }, [toast]);

  const updateSwipeFile = useCallback(async (id: string, updates: Partial<Pick<SwipeFile, 'title' | 'content' | 'notes' | 'category' | 'platform'>>) => {
    try {
      const { error } = await supabase
        .from('swipe_files')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
      setSwipeFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
      toast({ title: '✅ Atualizado!', description: 'Swipe file atualizado com sucesso.' });
    } catch (err) {
      console.error('Error updating swipe file:', err);
      toast({ title: 'Erro', description: 'Não foi possível atualizar.', variant: 'destructive' });
    }
  }, [toast]);

  const toggleFavorite = useCallback(async (id: string) => {
    const file = swipeFiles.find(f => f.id === id);
    if (!file) return;

    try {
      const { error } = await supabase
        .from('swipe_files')
        .update({ is_favorite: !file.is_favorite })
        .eq('id', id);

      if (error) throw error;
      setSwipeFiles(prev => prev.map(f => f.id === id ? { ...f, is_favorite: !f.is_favorite } : f));
    } catch (err) {
      console.error('Error toggling favorite:', err);
    }
  }, [swipeFiles]);

  useEffect(() => {
    fetchSwipeFiles();
  }, [fetchSwipeFiles]);

  return {
    swipeFiles,
    isLoading,
    addSwipeFile,
    deleteSwipeFile,
    toggleFavorite,
    updateSwipeFile,
    refetch: fetchSwipeFiles,
  };
}
