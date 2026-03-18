import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

export interface CAPIEvent {
  pixel_id: string;
  event_name: string;
  event_source_url?: string;
  action_source?: string;
  user_email_hash?: string;
  user_phone_hash?: string;
  user_external_id?: string;
  user_fbc?: string;
  user_fbp?: string;
  user_ip?: string;
  user_user_agent?: string;
  user_city?: string;
  user_country?: string;
  value?: number;
  currency?: string;
  content_name?: string;
  content_category?: string;
  content_ids?: string[];
  content_type?: string;
  num_items?: number;
  order_id?: string;
  predicted_ltv?: number;
  custom_data?: Record<string, any>;
}

export interface MetaPixelRecord {
  id: string;
  pixel_id: string;
  pixel_name: string;
  is_active: boolean;
  domain: string | null;
  access_token_encrypted: string | null;
  events_total: number | null;
  events_today: number | null;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useCAPI() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isTracking, setIsTracking] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const trackEvent = useCallback(async (event: CAPIEvent) => {
    setIsTracking(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-capi-track', {
        body: event,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    } catch (err: any) {
      toast({
        title: 'Erro ao rastrear evento',
        description: err.message,
        variant: 'destructive',
      });
      throw err;
    } finally {
      setIsTracking(false);
    }
  }, [toast]);

  const sendBatch = useCallback(async (pixelId: string, eventIds: string[]) => {
    setIsSending(true);
    try {
      // Fetch pending events
      const { data: events, error: fetchError } = await supabase
        .from('meta_capi_events')
        .select('*')
        .eq('pixel_id', pixelId)
        .in('id', eventIds)
        .eq('status', 'pending');

      if (fetchError) throw fetchError;
      if (!events || events.length === 0) {
        toast({ title: 'Nenhum evento pendente encontrado' });
        return null;
      }

      const { data, error } = await supabase.functions.invoke('meta-capi-send', {
        body: { pixel_id: pixelId, events },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: 'Eventos enviados!',
        description: `${data.events_sent} evento(s) enviado(s) com sucesso.`,
      });
      return data;
    } catch (err: any) {
      toast({
        title: 'Erro ao enviar eventos',
        description: err.message,
        variant: 'destructive',
      });
      throw err;
    } finally {
      setIsSending(false);
    }
  }, [toast]);

  const sendAllPending = useCallback(async (pixelId: string) => {
    setIsSending(true);
    try {
      const { data: events, error: fetchError } = await supabase
        .from('meta_capi_events')
        .select('*')
        .eq('pixel_id', pixelId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1000);

      if (fetchError) throw fetchError;
      if (!events || events.length === 0) {
        toast({ title: 'Nenhum evento pendente' });
        return null;
      }

      const { data, error } = await supabase.functions.invoke('meta-capi-send', {
        body: { pixel_id: pixelId, events },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: 'Lote enviado!',
        description: `${data.events_sent} de ${events.length} evento(s) enviado(s).`,
      });
      return data;
    } catch (err: any) {
      toast({
        title: 'Erro ao enviar lote',
        description: err.message,
        variant: 'destructive',
      });
      throw err;
    } finally {
      setIsSending(false);
    }
  }, [toast]);

  const getPixels = useCallback(async (): Promise<MetaPixelRecord[]> => {
    if (!user) return [];
    const { data, error } = await supabase
      .from('meta_pixels')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as MetaPixelRecord[];
  }, [user]);

  const getEvents = useCallback(async (pixelId: string, status?: string, limit = 50) => {
    let query = supabase
      .from('meta_capi_events')
      .select('*')
      .eq('pixel_id', pixelId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }, []);

  const getBatches = useCallback(async (pixelId: string, limit = 20) => {
    const { data, error } = await supabase
      .from('meta_capi_batches')
      .select('*')
      .eq('pixel_id', pixelId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }, []);

  // ---- Convenience methods for common Meta standard events ----

  const trackLead = useCallback(async (
    pixelId: string,
    userData: {
      email?: string;
      phone?: string;
      externalId?: string;
      fbc?: string;
      fbp?: string;
      ip?: string;
      userAgent?: string;
      city?: string;
      country?: string;
    },
    extra?: {
      value?: number;
      currency?: string;
      contentName?: string;
      sourceUrl?: string;
      customData?: Record<string, any>;
    }
  ) => {
    return trackEvent({
      pixel_id: pixelId,
      event_name: 'Lead',
      action_source: 'website',
      event_source_url: extra?.sourceUrl,
      user_email_hash: userData.email,
      user_phone_hash: userData.phone,
      user_external_id: userData.externalId,
      user_fbc: userData.fbc,
      user_fbp: userData.fbp,
      user_ip: userData.ip,
      user_user_agent: userData.userAgent,
      user_city: userData.city,
      user_country: userData.country,
      value: extra?.value,
      currency: extra?.currency || 'BRL',
      content_name: extra?.contentName,
      custom_data: extra?.customData,
    });
  }, [trackEvent]);

  const trackPurchase = useCallback(async (
    pixelId: string,
    userData: {
      email?: string;
      phone?: string;
      externalId?: string;
      fbc?: string;
      fbp?: string;
      ip?: string;
      userAgent?: string;
    },
    purchaseData: {
      value: number;
      currency?: string;
      contentIds?: string[];
      contentName?: string;
      contentType?: string;
      numItems?: number;
      orderId?: string;
      sourceUrl?: string;
    }
  ) => {
    return trackEvent({
      pixel_id: pixelId,
      event_name: 'Purchase',
      action_source: 'website',
      event_source_url: purchaseData.sourceUrl,
      user_email_hash: userData.email,
      user_phone_hash: userData.phone,
      user_external_id: userData.externalId,
      user_fbc: userData.fbc,
      user_fbp: userData.fbp,
      user_ip: userData.ip,
      user_user_agent: userData.userAgent,
      value: purchaseData.value,
      currency: purchaseData.currency || 'BRL',
      content_ids: purchaseData.contentIds,
      content_name: purchaseData.contentName,
      content_type: purchaseData.contentType,
      num_items: purchaseData.numItems,
      order_id: purchaseData.orderId,
    });
  }, [trackEvent]);

  const trackInitiateCheckout = useCallback(async (
    pixelId: string,
    userData: { email?: string; phone?: string; externalId?: string; fbc?: string; fbp?: string },
    extra?: { value?: number; currency?: string; contentIds?: string[]; numItems?: number; sourceUrl?: string }
  ) => {
    return trackEvent({
      pixel_id: pixelId,
      event_name: 'InitiateCheckout',
      action_source: 'website',
      event_source_url: extra?.sourceUrl,
      user_email_hash: userData.email,
      user_phone_hash: userData.phone,
      user_external_id: userData.externalId,
      user_fbc: userData.fbc,
      user_fbp: userData.fbp,
      value: extra?.value,
      currency: extra?.currency || 'BRL',
      content_ids: extra?.contentIds,
      num_items: extra?.numItems,
    });
  }, [trackEvent]);

  const trackViewContent = useCallback(async (
    pixelId: string,
    userData: { email?: string; phone?: string; fbc?: string; fbp?: string },
    extra?: { value?: number; currency?: string; contentName?: string; contentCategory?: string; contentIds?: string[]; sourceUrl?: string }
  ) => {
    return trackEvent({
      pixel_id: pixelId,
      event_name: 'ViewContent',
      action_source: 'website',
      event_source_url: extra?.sourceUrl,
      user_email_hash: userData.email,
      user_phone_hash: userData.phone,
      user_fbc: userData.fbc,
      user_fbp: userData.fbp,
      value: extra?.value,
      currency: extra?.currency || 'BRL',
      content_name: extra?.contentName,
      content_category: extra?.contentCategory,
      content_ids: extra?.contentIds,
    });
  }, [trackEvent]);

  return {
    trackEvent,
    trackLead,
    trackPurchase,
    trackInitiateCheckout,
    trackViewContent,
    sendBatch,
    sendAllPending,
    getPixels,
    getEvents,
    getBatches,
    isTracking,
    isSending,
  };
}
