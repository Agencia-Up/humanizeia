import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

// Pixel CRUD
export function useMetaPixels() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const pixelsQuery = useQuery({
    queryKey: ['meta-pixels', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meta_pixels')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const addPixel = useMutation({
    mutationFn: async (pixel: { pixel_id: string; pixel_name: string; domain?: string }) => {
      const { data, error } = await supabase
        .from('meta_pixels')
        .insert({ ...pixel, user_id: user!.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meta-pixels'] });
      toast.success('Pixel adicionado com sucesso');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const togglePixel = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('meta_pixels')
        .update({ is_active })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meta-pixels'] }),
  });

  const deletePixel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('meta_pixels').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meta-pixels'] });
      toast.success('Pixel removido');
    },
  });

  return { pixels: pixelsQuery.data || [], isLoading: pixelsQuery.isLoading, addPixel, togglePixel, deletePixel };
}

// CAPI event sending
export function useCAPISend() {
  const sendEvents = useCallback(
    async (pixelId: string, events: CAPIEvent[]) => {
      const { data, error } = await supabase.functions.invoke('meta-capi-send', {
        body: { pixel_id: pixelId, events },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    []
  );

  return { sendEvents };
}

// CAPI event history
export function useCAPIEvents(pixelId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['capi-events', pixelId],
    queryFn: async () => {
      let query = supabase
        .from('meta_capi_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (pixelId) query = query.eq('pixel_id', pixelId);

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export interface CAPIEvent {
  event_name: string;
  event_time?: string;
  event_source_url?: string;
  action_source?: string;
  user_data?: Record<string, any>;
  custom_data?: Record<string, any>;
}
