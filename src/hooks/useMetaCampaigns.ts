import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMetaApi } from './useMetaApi';
import { useMetaConnection } from './useMetaConnection';
import { useMetaCachedQuery } from './useMetaCachedQuery';
import { useToast } from '@/hooks/use-toast';

interface UseMetaCampaignsOptions {
  fields?: string;
  filtering?: any[];
  datePreset?: string;
  enabled?: boolean;
  /** Explicitly pass the account_id to fetch campaigns for the correct account */
  accountId?: string;
}

export function useMetaCampaigns(options: UseMetaCampaignsOptions = {}) {
  const { callMetaApi } = useMetaApi();
  const { connectedAccount } = useMetaConnection();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    fields = 'name,status,objective,daily_budget,lifetime_budget,start_time,effective_status,created_time',
    filtering,
    datePreset = 'last_7d',
    enabled = true,
    accountId: propAccountId,
  } = options;

  // Use explicitly passed accountId, else fall back to hook's own connection instance
  const resolvedAccountId = propAccountId || connectedAccount?.account_id;

  const cacheKey = `campaigns:${resolvedAccountId}:${fields}:${filtering ? JSON.stringify(filtering) : 'all'}`;

  const fetchFn = useCallback(async () => {
    const params: Record<string, any> = { fields, limit: '100' };
    if (filtering) {
      params.filtering = JSON.stringify(filtering);
    }
    return callMetaApi({
      endpoint: `act_{ad_account_id}/campaigns`,
      params,
      targetAccountId: resolvedAccountId,
    });
  }, [callMetaApi, fields, filtering, resolvedAccountId]);

  const cached = useMetaCachedQuery({
    cacheKey,
    fetchFn,
    enabled: enabled && !!resolvedAccountId,
  });

  const updateCampaignStatus = useMutation({
    mutationFn: async ({ campaignId, status }: { campaignId: string; status: 'ACTIVE' | 'PAUSED' }) => {
      return callMetaApi({
        endpoint: campaignId,
        method: 'POST',
        body: { status },
        targetAccountId: resolvedAccountId,
      });
    },
    onSuccess: () => {
      cached.refresh();
      toast({ title: 'Campanha atualizada com sucesso!' });
    },
    onError: (err: any) => {
      toast({
        title: 'Erro ao atualizar campanha',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const updateCampaignBudget = useMutation({
    mutationFn: async ({ campaignId, dailyBudget }: { campaignId: string; dailyBudget: number }) => {
      return callMetaApi({
        endpoint: campaignId,
        method: 'POST',
        params: { daily_budget: String(Math.round(dailyBudget * 100)) },
        targetAccountId: resolvedAccountId,
      });
    },
    onSuccess: () => {
      cached.refresh();
      toast({ title: 'Orçamento atualizado com sucesso!' });
    },
    onError: (err: any) => {
      toast({
        title: 'Erro ao atualizar orçamento',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  return {
    campaigns: cached.data?.data || [],
    isLoading: cached.isLoading,
    isRefreshing: cached.isRefreshing,
    lastUpdated: cached.lastUpdated,
    error: cached.error,
    refetch: cached.refresh,
    refresh: cached.refresh,
    updateCampaignStatus,
    updateCampaignBudget,
  };
}
