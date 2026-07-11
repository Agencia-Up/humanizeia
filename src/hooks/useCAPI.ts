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
    mutationFn: async (pixel: { pixel_id: string; pixel_name: string; domain?: string; access_token?: string }) => {
      const { access_token, ...rest } = pixel;
      const row: any = { ...rest, user_id: user!.id, is_active: true };
      if (access_token) row.access_token_encrypted = access_token.trim();
      const { data, error } = await supabase
        .from('meta_pixels')
        .insert(row)
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

  // Atualiza dados do pixel — inclusive o token da API de Conversões (chave API).
  const updatePixel = useMutation({
    mutationFn: async ({ id, access_token, pixel_name, domain }: { id: string; access_token?: string; pixel_name?: string; domain?: string }) => {
      const patch: any = {};
      if (access_token !== undefined) patch.access_token_encrypted = access_token ? access_token.trim() : null;
      if (pixel_name !== undefined) patch.pixel_name = pixel_name;
      if (domain !== undefined) patch.domain = domain;
      const { error } = await supabase.from('meta_pixels').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meta-pixels'] });
      toast.success('Pixel atualizado');
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

  return { pixels: pixelsQuery.data || [], isLoading: pixelsQuery.isLoading, addPixel, updatePixel, togglePixel, deletePixel };
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

// Full-funnel CAPI tracking hooks
export function useCAPITracking() {
  const { sendEvents } = useCAPISend();
  const { pixels } = useMetaPixels();

  const getActivePixelId = () => pixels.find((p: any) => p.is_active)?.id;

  const buildEvent = (eventName: string, opts: {
    phone?: string; email?: string; value?: number;
    currency?: string; source?: string; customData?: Record<string, any>;
  } = {}): CAPIEvent => ({
    event_name: eventName,
    action_source: 'system_generated',
    user_data: {
      ...(opts.phone && { ph: [opts.phone] }),
      ...(opts.email && { em: [opts.email] }),
    },
    custom_data: {
      ...(opts.value !== undefined && { value: opts.value, currency: opts.currency || 'BRL' }),
      source: opts.source || 'whatsapp',
      ...opts.customData,
    },
  });

  // Stage 1: Lead (first contact via WhatsApp)
  const trackLead = useCallback(
    async (data?: { phone?: string; email?: string; value?: number; source?: string }) => {
      const pixelId = getActivePixelId();
      if (!pixelId) { console.warn('[CAPI] No active pixel'); return; }
      return sendEvents(pixelId, [buildEvent('Lead', data)]);
    },
    [pixels]
  );

  // Stage 2: Qualified Lead (AI qualifies the contact)
  const trackQualifiedLead = useCallback(
    async (data?: { phone?: string; email?: string; source?: string }) => {
      const pixelId = getActivePixelId();
      if (!pixelId) return;
      return sendEvents(pixelId, [buildEvent('CompleteRegistration', {
        ...data,
        customData: { status: 'qualified', lead_category: 'qualified' },
      })]);
    },
    [pixels]
  );

  // Stage 3: Proposal/Checkout (user sends proposal)
  const trackInitiateCheckout = useCallback(
    async (data: { phone?: string; email?: string; value?: number; currency?: string }) => {
      const pixelId = getActivePixelId();
      if (!pixelId) return;
      return sendEvents(pixelId, [buildEvent('InitiateCheckout', data)]);
    },
    [pixels]
  );

  // Stage 4: Purchase (sale confirmed)
  const trackPurchase = useCallback(
    async (data: { value: number; currency?: string; phone?: string; email?: string }) => {
      const pixelId = getActivePixelId();
      if (!pixelId) return;
      return sendEvents(pixelId, [buildEvent('Purchase', data)]);
    },
    [pixels]
  );

  // Custom event
  const trackCustom = useCallback(
    async (eventName: string, customData?: Record<string, any>, userData?: Record<string, any>) => {
      const pixelId = getActivePixelId();
      if (!pixelId) return;
      return sendEvents(pixelId, [{
        event_name: eventName,
        action_source: 'system_generated',
        user_data: userData || {},
        custom_data: customData || {},
      }]);
    },
    [pixels]
  );

  return { trackLead, trackQualifiedLead, trackInitiateCheckout, trackPurchase, trackCustom };
}
