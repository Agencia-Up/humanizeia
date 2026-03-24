import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface GoogleCampaign {
  id: string;
  name: string;
  status: string;
  channel_type: string;
  bidding_strategy: string;
  daily_budget: number;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  conversions: number;
  revenue: number;
  roas: number;
  cpa: number;
  health_score: number;
}

export interface GoogleAdsData {
  platform: string;
  account: { id: string; name: string; currency: string };
  campaigns: GoogleCampaign[];
  health_score: number;
  date_range: string;
}

export function useGoogleAds() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GoogleAdsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchCampaigns = useCallback(async (dateRange = 'LAST_30_DAYS') => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Não autenticado');

      const res = await supabase.functions.invoke('google-ads-api', {
        body: { action: 'get_campaigns', date_range: dateRange },
      });

      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);

      setData(res.data);
      return res.data;
    } catch (err: any) {
      setError(err.message);
      toast({ title: 'Erro Google Ads', description: err.message, variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchAdGroups = useCallback(async (campaignId: string, dateRange = 'LAST_30_DAYS') => {
    try {
      const res = await supabase.functions.invoke('google-ads-api', {
        body: { action: 'get_ad_groups', campaign_id: campaignId, date_range: dateRange },
      });
      if (res.error) throw new Error(res.error.message);
      return res.data?.ad_groups || [];
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
      return [];
    }
  }, [toast]);

  const updateCampaignStatus = useCallback(async (campaignId: string, newStatus: 'ENABLED' | 'PAUSED') => {
    try {
      const res = await supabase.functions.invoke('google-ads-api', {
        body: { action: 'update_campaign_status', campaign_id: campaignId, new_status: newStatus },
      });
      if (res.data?.success) {
        toast({ title: `Campanha ${newStatus === 'PAUSED' ? 'pausada' : 'ativada'}` });
        return true;
      }
      throw new Error(res.data?.error || 'Erro ao atualizar');
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
      return false;
    }
  }, [toast]);

  const updateBudget = useCallback(async (budgetId: string, newAmount: number) => {
    try {
      const res = await supabase.functions.invoke('google-ads-api', {
        body: { action: 'update_budget', budget_id: budgetId, new_amount: newAmount },
      });
      if (res.data?.success) {
        toast({ title: 'Orçamento atualizado' });
        return true;
      }
      throw new Error(res.data?.error || 'Erro ao atualizar');
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
      return false;
    }
  }, [toast]);

  return { loading, data, error, fetchCampaigns, fetchAdGroups, updateCampaignStatus, updateBudget };
}
