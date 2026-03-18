import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

export interface FunnelEvent {
  id: string;
  phone: string;
  contact_id: string | null;
  event_name: string;
  funnel_stage: string;
  event_sent: boolean;
  fbclid: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  value: number | null;
  currency: string;
  meta_response: any;
  created_at: string;
  sent_at: string | null;
}

export interface FunnelStats {
  total_leads: number;
  total_qualified: number;
  total_checkout: number;
  total_purchase: number;
  total_value: number;
  events_sent: number;
  events_pending: number;
}

export function useWhatsAppCAPI() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isTracking, setIsTracking] = useState(false);

  const trackStage = useCallback(async (params: {
    phone: string;
    contact_id?: string;
    event_name: string;
    funnel_stage: string;
    value?: number;
    currency?: string;
    custom_data?: Record<string, any>;
    pixel_id?: string;
  }) => {
    if (!user) return null;
    setIsTracking(true);
    try {
      const { data, error } = await supabase.functions.invoke('wa-capi-track-lead', {
        body: { user_id: user.id, ...params },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.already_sent) {
        toast({ title: 'Evento já enviado', description: `${params.event_name} já foi registrado para este contato.` });
      } else {
        toast({ title: 'Evento registrado!', description: `${params.event_name} → ${data?.pixel_configured ? 'Enviado ao Meta' : 'Salvo (pixel não configurado)'}` });
      }
      return data;
    } catch (err: any) {
      toast({ title: 'Erro ao registrar evento', description: err.message, variant: 'destructive' });
      return null;
    } finally {
      setIsTracking(false);
    }
  }, [user, toast]);

  const trackPurchase = useCallback(async (phone: string, value: number, contactId?: string, orderId?: string) => {
    return trackStage({
      phone,
      contact_id: contactId,
      event_name: 'Purchase',
      funnel_stage: 'purchase',
      value,
      currency: 'BRL',
      custom_data: orderId ? { order_id: orderId } : undefined,
    });
  }, [trackStage]);

  const trackCheckout = useCallback(async (phone: string, value?: number, contactId?: string) => {
    return trackStage({
      phone,
      contact_id: contactId,
      event_name: 'InitiateCheckout',
      funnel_stage: 'checkout',
      value,
    });
  }, [trackStage]);

  const getFunnelEvents = useCallback(async (limit = 100): Promise<FunnelEvent[]> => {
    if (!user) return [];
    const { data, error } = await supabase
      .from('wa_capi_funnel')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data || []) as FunnelEvent[];
  }, [user]);

  const getFunnelStats = useCallback(async (): Promise<FunnelStats> => {
    if (!user) return { total_leads: 0, total_qualified: 0, total_checkout: 0, total_purchase: 0, total_value: 0, events_sent: 0, events_pending: 0 };
    
    const { data, error } = await supabase
      .from('wa_capi_funnel')
      .select('event_name, event_sent, value')
      .eq('user_id', user.id);

    if (error) throw error;

    const events = data || [];
    return {
      total_leads: events.filter(e => e.event_name === 'Lead').length,
      total_qualified: events.filter(e => e.event_name === 'LeadQualified').length,
      total_checkout: events.filter(e => e.event_name === 'InitiateCheckout').length,
      total_purchase: events.filter(e => e.event_name === 'Purchase').length,
      total_value: events.filter(e => e.event_name === 'Purchase').reduce((sum, e) => sum + (Number(e.value) || 0), 0),
      events_sent: events.filter(e => e.event_sent).length,
      events_pending: events.filter(e => !e.event_sent).length,
    };
  }, [user]);

  return {
    trackStage,
    trackPurchase,
    trackCheckout,
    getFunnelEvents,
    getFunnelStats,
    isTracking,
  };
}
