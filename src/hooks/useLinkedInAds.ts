import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface LinkedInCampaign {
  id: string;
  name: string;
  status: string;
  type: string;
  objective: string;
  daily_budget: number;
  total_budget: number;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  conversions: number;
  leads: number;
  cost_per_lead: number;
  engagement_rate: number;
  health_score: number;
}

export interface LinkedInAdsData {
  platform: string;
  account: { id: string; name: string; currency: string };
  campaigns: LinkedInCampaign[];
  health_score: number;
  date_range: string;
}

export function useLinkedInAds() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LinkedInAdsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchCampaigns = useCallback(async (dateRange = 'LAST_30_DAYS') => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Não autenticado');

      const res = await supabase.functions.invoke('linkedin-ads-api', {
        body: { action: 'get_campaigns', date_range: dateRange },
      });

      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);

      setData(res.data);
      return res.data;
    } catch (err: any) {
      setError(err.message);
      toast({ title: 'Erro LinkedIn Ads', description: err.message, variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const updateCampaignStatus = useCallback(async (campaignId: string, newStatus: 'ACTIVE' | 'PAUSED') => {
    try {
      const res = await supabase.functions.invoke('linkedin-ads-api', {
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

  const updateBudget = useCallback(async (campaignId: string, newAmount: number) => {
    try {
      const res = await supabase.functions.invoke('linkedin-ads-api', {
        body: { action: 'update_budget', campaign_id: campaignId, new_amount: newAmount },
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

  return { loading, data, error, fetchCampaigns, updateCampaignStatus, updateBudget };
}
