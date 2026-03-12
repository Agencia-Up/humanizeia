import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  createCampaign,
  createAdSet,
  createAd,
  getCampaigns,
  getAdSets,
  getAds,
  updateCampaignStatus,
  getCampaignInsights,
  getAccountInsights,
  getPages,
  searchInterests,
  getCustomAudiences,
  uploadImage,
} from '@/services/meta/metaAdsService';
import type {
  CreateCampaignPayload,
  CreateAdSetPayload,
  CreateAdPayload,
  MetaCampaignRow,
  MetaAdSetRow,
  MetaInsights,
  MetaDateRange,
  MetaPage,
  MetaInterest,
  MetaCustomAudience,
  MetaObjective,
  MetaOptimizationGoal,
  OBJECTIVE_MAP,
  OPTIMIZATION_MAP,
} from '@/services/meta/types';

export interface CampaignCreationParams {
  name: string;
  objective: string; // internal key: vendas, leads, trafego, awareness
  budget: number; // in BRL (will be converted to cents)
  budgetType: 'daily' | 'lifetime';
  targeting: {
    countries?: string[];
    ageMin?: number;
    ageMax?: number;
    genders?: number[];
    interests?: { id: string; name?: string }[];
  };
  duration?: number; // days, for lifetime budget
  pageId: string;
  creative?: {
    message: string;
    link: string;
    imageUrl?: string;
    headline?: string;
    description?: string;
    cta?: string;
  };
}

export function useMetaCampaignManager() {
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Import the maps at runtime to avoid circular issues
  const objectiveMap: Record<string, MetaObjective> = {
    vendas: 'OUTCOME_SALES',
    leads: 'OUTCOME_LEADS',
    trafego: 'OUTCOME_TRAFFIC',
    awareness: 'OUTCOME_AWARENESS',
  };

  const optimizationMap: Record<string, MetaOptimizationGoal> = {
    vendas: 'OFFSITE_CONVERSIONS',
    leads: 'LEAD_GENERATION',
    trafego: 'LANDING_PAGE_VIEWS',
    awareness: 'REACH',
  };

  /**
   * Full campaign creation flow: Campaign → Ad Set → Ad
   * All calls go through the secure meta-api edge function.
   */
  const createFullCampaign = useCallback(
    async (params: CampaignCreationParams) => {
      setIsCreating(true);
      try {
        const budgetCents = Math.round(params.budget * 100);
        const metaObjective =
          objectiveMap[params.objective] ?? 'OUTCOME_TRAFFIC';
        const metaOptGoal =
          optimizationMap[params.objective] ?? 'LANDING_PAGE_VIEWS';

        // 1 — Campaign
        toast({ title: '⏳ Criando campanha...' });
        const campaign = await createCampaign({
          name: params.name,
          objective: metaObjective,
          status: 'PAUSED',
          special_ad_categories: [],
          ...(params.budgetType === 'daily'
            ? { daily_budget: budgetCents }
            : { lifetime_budget: budgetCents }),
        });

        // 2 — Ad Set
        toast({ title: '⏳ Criando conjunto de anúncios...' });
        const now = new Date();
        const endDate = new Date(
          now.getTime() + (params.duration ?? 30) * 86400000
        );

        const adSet = await createAdSet({
          campaign_id: campaign.id,
          name: `${params.name} — Conjunto`,
          status: 'PAUSED',
          ...(params.budgetType === 'daily'
            ? { daily_budget: budgetCents }
            : {
                lifetime_budget: budgetCents,
                end_time: endDate.toISOString(),
              }),
          start_time: now.toISOString(),
          targeting: {
            geo_locations: {
              countries: params.targeting.countries ?? ['BR'],
            },
            age_min: params.targeting.ageMin ?? 18,
            age_max: params.targeting.ageMax ?? 65,
            ...(params.targeting.genders?.length
              ? { genders: params.targeting.genders }
              : {}),
            ...(params.targeting.interests?.length
              ? { interests: params.targeting.interests }
              : {}),
          },
          optimization_goal: metaOptGoal,
          billing_event: 'IMPRESSIONS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        });

        // 3 — Ad (if creative data supplied)
        let adId: string | undefined;
        if (params.creative) {
          toast({ title: '⏳ Criando anúncio...' });
          const ad = await createAd({
            adset_id: adSet.id,
            name: `${params.name} — Anúncio`,
            status: 'PAUSED',
            creative: {
              name: `${params.name} — Criativo`,
              object_story_spec: {
                page_id: params.pageId,
                link_data: {
                  message: params.creative.message,
                  link: params.creative.link,
                  name: params.creative.headline,
                  description: params.creative.description,
                  ...(params.creative.imageUrl
                    ? { image_url: params.creative.imageUrl }
                    : {}),
                  ...(params.creative.cta
                    ? {
                        call_to_action: {
                          type: params.creative.cta as any,
                          value: { link: params.creative.link },
                        },
                      }
                    : {}),
                },
              },
            },
          });
          adId = ad.id;
        }

        toast({
          title: '✅ Campanha criada com sucesso!',
          description: `ID: ${campaign.id}. Status: PAUSADA (ative quando estiver pronto).`,
        });

        return {
          campaignId: campaign.id,
          adSetId: adSet.id,
          adId,
        };
      } catch (err: any) {
        toast({
          title: '❌ Erro ao criar campanha',
          description: err.message || 'Tente novamente.',
          variant: 'destructive',
        });
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [toast]
  );

  // ---------- Read helpers ----------

  const fetchCampaigns = useCallback(async (limit?: number) => {
    setIsLoading(true);
    try {
      const res = await getCampaigns(limit);
      return res.data ?? [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchAdSets = useCallback(
    async (campaignId?: string, limit?: number) => {
      setIsLoading(true);
      try {
        const res = await getAdSets(campaignId, limit);
        return res.data ?? [];
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const fetchAds = useCallback(
    async (adsetId?: string, limit?: number) => {
      setIsLoading(true);
      try {
        const res = await getAds(adsetId, limit);
        return res.data ?? [];
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const fetchInsights = useCallback(
    async (campaignId: string, dateRange: MetaDateRange) => {
      return getCampaignInsights(campaignId, dateRange);
    },
    []
  );

  const fetchAccountInsights = useCallback(
    async (dateRange: MetaDateRange) => {
      return getAccountInsights(dateRange);
    },
    []
  );

  const fetchPages = useCallback(async () => {
    return getPages();
  }, []);

  const fetchInterests = useCallback(async (query: string) => {
    return searchInterests(query);
  }, []);

  const fetchCustomAudiences = useCallback(async () => {
    return getCustomAudiences();
  }, []);

  const toggleCampaignStatus = useCallback(
    async (campaignId: string, newStatus: 'ACTIVE' | 'PAUSED') => {
      try {
        await updateCampaignStatus(campaignId, newStatus);
        toast({
          title:
            newStatus === 'ACTIVE'
              ? '▶️ Campanha ativada'
              : '⏸️ Campanha pausada',
        });
      } catch (err: any) {
        toast({
          title: '❌ Erro',
          description: err.message,
          variant: 'destructive',
        });
      }
    },
    [toast]
  );

  return {
    // State
    isCreating,
    isLoading,

    // Actions
    createFullCampaign,
    toggleCampaignStatus,

    // Data fetching
    fetchCampaigns,
    fetchAdSets,
    fetchAds,
    fetchInsights,
    fetchAccountInsights,
    fetchPages,
    fetchInterests,
    fetchCustomAudiences,

    // Re-export low-level for advanced usage
    uploadImage,
  };
}
