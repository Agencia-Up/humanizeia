/**
 * Secure Meta Ads Service
 *
 * All calls go through the `meta-api` edge function which:
 *  - Validates the user JWT
 *  - Retrieves the encrypted access token from the database
 *  - Proxies the request to the Meta Graph API server-side
 *
 * No tokens or secrets ever reach the browser.
 */

import { supabase } from '@/integrations/supabase/client';
import type {
  CreateCampaignPayload,
  CreateAdSetPayload,
  CreateAdPayload,
  CreateCreativePayload,
  MetaCampaignRow,
  MetaAdSetRow,
  MetaInsights,
  MetaDateRange,
  MetaPage,
  MetaInterest,
  MetaCustomAudience,
} from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MetaApiCall {
  endpoint: string;
  params?: Record<string, unknown>;
  method?: 'GET' | 'POST' | 'DELETE';
  body?: Record<string, unknown>;
}

async function callApi<T = unknown>(options: MetaApiCall): Promise<T> {
  const { data, error } = await supabase.functions.invoke('meta-api', {
    body: options,
  });

  if (error) throw error;
  if (data?.error) {
    const err = new Error(data.error) as Error & { code?: number };
    err.code = data.code;
    throw err;
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export async function createCampaign(
  payload: CreateCampaignPayload
): Promise<{ id: string }> {
  return callApi<{ id: string }>({
    endpoint: 'act_{ad_account_id}/campaigns',
    method: 'POST',
    params: {
      name: payload.name,
      objective: payload.objective,
      status: payload.status ?? 'PAUSED',
      special_ad_categories: JSON.stringify(
        payload.special_ad_categories ?? []
      ),
      ...(payload.daily_budget
        ? { daily_budget: String(payload.daily_budget) }
        : {}),
      ...(payload.lifetime_budget
        ? { lifetime_budget: String(payload.lifetime_budget) }
        : {}),
    },
  });
}

export async function getCampaigns(
  limit = 50
): Promise<{ data: MetaCampaignRow[] }> {
  return callApi({
    endpoint: 'act_{ad_account_id}/campaigns',
    params: {
      fields:
        'id,name,objective,status,daily_budget,lifetime_budget,created_time,updated_time',
      limit: String(limit),
    },
  });
}

export async function updateCampaign(
  campaignId: string,
  updates: Partial<CreateCampaignPayload>
): Promise<{ success: boolean }> {
  return callApi({
    endpoint: campaignId,
    method: 'POST',
    params: updates as Record<string, unknown>,
  });
}

export async function updateCampaignStatus(
  campaignId: string,
  status: 'ACTIVE' | 'PAUSED'
): Promise<{ success: boolean }> {
  return updateCampaign(campaignId, { status });
}

// ---------------------------------------------------------------------------
// Ad Sets
// ---------------------------------------------------------------------------

export async function createAdSet(
  payload: CreateAdSetPayload
): Promise<{ id: string }> {
  const params: Record<string, unknown> = {
    campaign_id: payload.campaign_id,
    name: payload.name,
    status: payload.status ?? 'PAUSED',
    targeting: JSON.stringify(payload.targeting),
    optimization_goal: payload.optimization_goal,
    billing_event: payload.billing_event ?? 'IMPRESSIONS',
    bid_strategy: payload.bid_strategy ?? 'LOWEST_COST_WITHOUT_CAP',
  };

  if (payload.daily_budget) params.daily_budget = String(payload.daily_budget);
  if (payload.lifetime_budget) {
    params.lifetime_budget = String(payload.lifetime_budget);
    if (payload.end_time) params.end_time = payload.end_time;
  }
  if (payload.start_time) params.start_time = payload.start_time;
  if (payload.bid_amount) params.bid_amount = String(payload.bid_amount);

  return callApi<{ id: string }>({
    endpoint: 'act_{ad_account_id}/adsets',
    method: 'POST',
    params,
  });
}

export async function getAdSets(
  campaignId?: string,
  limit = 50
): Promise<{ data: MetaAdSetRow[] }> {
  const base = campaignId
    ? `${campaignId}/adsets`
    : 'act_{ad_account_id}/adsets';

  return callApi({
    endpoint: base,
    params: {
      fields:
        'id,name,campaign_id,status,daily_budget,lifetime_budget,targeting,optimization_goal',
      limit: String(limit),
    },
  });
}

export async function updateAdSet(
  adsetId: string,
  updates: Partial<CreateAdSetPayload>
): Promise<{ success: boolean }> {
  const params: Record<string, unknown> = { ...updates };
  if (updates.targeting)
    params.targeting = JSON.stringify(updates.targeting);

  return callApi({ endpoint: adsetId, method: 'POST', params });
}

// ---------------------------------------------------------------------------
// Creatives & Ads
// ---------------------------------------------------------------------------

export async function createCreative(
  payload: CreateCreativePayload
): Promise<{ id: string }> {
  return callApi<{ id: string }>({
    endpoint: 'act_{ad_account_id}/adcreatives',
    method: 'POST',
    params: {
      name: payload.name ?? `Creative_${Date.now()}`,
      object_story_spec: JSON.stringify(payload.object_story_spec),
    },
  });
}

export async function createAd(
  payload: CreateAdPayload
): Promise<{ id: string }> {
  // Step 1: create the creative server-side
  const creative = await createCreative(payload.creative);

  // Step 2: create the ad linked to that creative
  return callApi<{ id: string }>({
    endpoint: 'act_{ad_account_id}/ads',
    method: 'POST',
    params: {
      adset_id: payload.adset_id,
      name: payload.name,
      status: payload.status ?? 'PAUSED',
      creative: JSON.stringify({ creative_id: creative.id }),
    },
  });
}

export async function getAds(
  adsetId?: string,
  limit = 50
): Promise<{ data: unknown[] }> {
  const base = adsetId ? `${adsetId}/ads` : 'act_{ad_account_id}/ads';

  return callApi({
    endpoint: base,
    params: {
      fields:
        'id,name,adset_id,status,creative,created_time,updated_time',
      limit: String(limit),
    },
  });
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export async function getCampaignInsights(
  campaignId: string,
  dateRange: MetaDateRange
): Promise<MetaInsights | null> {
  const res = await callApi<{ data?: Record<string, string>[] }>({
    endpoint: `${campaignId}/insights`,
    params: {
      fields:
        'impressions,clicks,spend,reach,ctr,cpc,cpm,actions,cost_per_action_type',
      time_range: JSON.stringify({
        since: dateRange.since,
        until: dateRange.until,
      }),
    },
  });

  if (!res.data?.length) return null;

  const d = res.data[0];
  return {
    impressions: parseInt(d.impressions) || 0,
    clicks: parseInt(d.clicks) || 0,
    spend: parseFloat(d.spend) || 0,
    reach: parseInt(d.reach) || 0,
    ctr: parseFloat(d.ctr) || 0,
    cpc: parseFloat(d.cpc) || 0,
    cpm: parseFloat(d.cpm) || 0,
  };
}

export async function getAccountInsights(
  dateRange: MetaDateRange
): Promise<MetaInsights | null> {
  const res = await callApi<{ data?: Record<string, string>[] }>({
    endpoint: 'act_{ad_account_id}/insights',
    params: {
      fields: 'impressions,clicks,spend,reach,ctr,cpc,cpm',
      time_range: JSON.stringify({
        since: dateRange.since,
        until: dateRange.until,
      }),
    },
  });

  if (!res.data?.length) return null;

  const d = res.data[0];
  return {
    impressions: parseInt(d.impressions) || 0,
    clicks: parseInt(d.clicks) || 0,
    spend: parseFloat(d.spend) || 0,
    reach: parseInt(d.reach) || 0,
    ctr: parseFloat(d.ctr) || 0,
    cpc: parseFloat(d.cpc) || 0,
    cpm: parseFloat(d.cpm) || 0,
  };
}

// ---------------------------------------------------------------------------
// Pages, Interests & Audiences
// ---------------------------------------------------------------------------

export async function getPages(): Promise<MetaPage[]> {
  const res = await callApi<{ data?: MetaPage[] }>({
    endpoint: 'me/accounts',
    params: { fields: 'id,name,access_token' },
  });
  return res.data ?? [];
}

export async function searchInterests(
  query: string
): Promise<MetaInterest[]> {
  const res = await callApi<{ data?: MetaInterest[] }>({
    endpoint: 'search',
    params: { type: 'adinterest', q: query },
  });
  return res.data ?? [];
}

export async function getCustomAudiences(): Promise<MetaCustomAudience[]> {
  const res = await callApi<{ data?: MetaCustomAudience[] }>({
    endpoint: 'act_{ad_account_id}/customaudiences',
    params: { fields: 'id,name,subtype,approximate_count' },
  });
  return res.data ?? [];
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export async function uploadImage(
  imageUrl: string
): Promise<{ hash: string }> {
  const res = await callApi<{ images: Record<string, { hash: string }> }>({
    endpoint: 'act_{ad_account_id}/adimages',
    method: 'POST',
    params: { url: imageUrl },
  });

  const firstKey = Object.keys(res.images)[0];
  return { hash: res.images[firstKey].hash };
}
