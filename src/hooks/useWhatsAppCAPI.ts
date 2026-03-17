import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

type FunnelStage = 'lead' | 'qualified' | 'checkout' | 'purchase';

interface TrackParams {
  phone: string;
  funnel_stage: FunnelStage;
  value?: number;
  currency?: string;
  fbclid?: string;
  utm_source?: string;
  utm_campaign?: string;
  custom_data?: Record<string, any>;
}

export function useWhatsAppCAPITrack() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: TrackParams) => {
      const { data, error } = await supabase.functions.invoke('wa-capi-track-lead', {
        body: params,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['wa-capi-funnel'] });
      queryClient.invalidateQueries({ queryKey: ['meta-pixels'] });
      toast.success(`Evento ${data.event_name} enviado ao Meta (${data.funnel_stage})`);
    },
    onError: (err: any) => toast.error(err.message),
  });
}

export function useWhatsAppCAPIFunnel() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['wa-capi-funnel', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wa_capi_funnel' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!user,
  });
}

export function useWhatsAppCAPIStats() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['wa-capi-stats', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wa_capi_funnel' as any)
        .select('funnel_stage, event_sent, value')
        .eq('event_sent', true);
      if (error) throw error;

      const items = data as any[];
      const stages: Record<string, { count: number; value: number }> = {
        lead: { count: 0, value: 0 },
        qualified: { count: 0, value: 0 },
        checkout: { count: 0, value: 0 },
        purchase: { count: 0, value: 0 },
      };

      for (const item of items) {
        const stage = item.funnel_stage;
        if (stages[stage]) {
          stages[stage].count++;
          stages[stage].value += Number(item.value) || 0;
        }
      }

      return stages;
    },
    enabled: !!user,
  });
}

// Convenience hooks for each funnel stage
export function useTrackSale() {
  const track = useWhatsAppCAPITrack();

  const trackSale = useCallback(
    (phone: string, value: number, currency = 'BRL') => {
      track.mutate({ phone, funnel_stage: 'purchase', value, currency });
    },
    [track]
  );

  const trackCheckout = useCallback(
    (phone: string, value?: number) => {
      track.mutate({ phone, funnel_stage: 'checkout', value });
    },
    [track]
  );

  const trackQualified = useCallback(
    (phone: string) => {
      track.mutate({ phone, funnel_stage: 'qualified' });
    },
    [track]
  );

  return { trackSale, trackCheckout, trackQualified, isLoading: track.isPending };
}
