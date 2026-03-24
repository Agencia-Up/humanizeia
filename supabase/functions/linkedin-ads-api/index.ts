import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';
const LINKEDIN_ADS_BASE = 'https://api.linkedin.com/v2/adCampaignsV2';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Não autorizado');
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Token inválido');

    const body = await req.json();
    const { action, date_range = 'LAST_30_DAYS', campaign_id, new_status, new_amount } = body;

    // Get LinkedIn tokens
    const { data: tokens } = await supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('platform', 'linkedin')
      .single();

    if (!tokens) {
      return new Response(JSON.stringify({ error: 'Conta LinkedIn não conectada. Conecte em Configurações > Contas Conectadas.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const accessToken = tokens.access_token;
    const accountId = tokens.account_id;

    // Refresh token if needed
    const refreshedToken = await ensureFreshToken(supabase, user.id, tokens);
    const finalToken = refreshedToken || accessToken;

    if (action === 'get_campaigns') {
      return await getCampaigns(finalToken, accountId, date_range, corsHeaders);
    }

    if (action === 'update_campaign_status') {
      return await updateCampaignStatus(finalToken, accountId, campaign_id, new_status, corsHeaders);
    }

    if (action === 'update_budget') {
      return await updateBudget(finalToken, accountId, campaign_id, new_amount, corsHeaders);
    }

    throw new Error(`Ação desconhecida: ${action}`);

  } catch (err: any) {
    console.error('linkedin-ads-api error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }
});

// ─── Token Refresh ─────────────────────────────────────────────────────────
async function ensureFreshToken(supabase: any, userId: string, tokenRecord: any): Promise<string | null> {
  if (!tokenRecord.expires_at) return null;
  const expiresAt = new Date(tokenRecord.expires_at).getTime();
  const now = Date.now();
  // Refresh if within 5 minutes of expiry
  if (expiresAt - now > 5 * 60 * 1000) return null;

  try {
    const clientId = Deno.env.get('LINKEDIN_CLIENT_ID');
    const clientSecret = Deno.env.get('LINKEDIN_CLIENT_SECRET');
    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokenRecord.refresh_token,
        client_id: clientId ?? '',
        client_secret: clientSecret ?? '',
      }),
    });
    const data = await res.json();
    if (!data.access_token) return null;

    // Save refreshed tokens
    await supabase.from('connected_accounts').update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokenRecord.refresh_token,
      expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    }).eq('user_id', userId).eq('platform', 'linkedin');

    return data.access_token;
  } catch {
    return null;
  }
}

// ─── Get Campaigns ─────────────────────────────────────────────────────────
async function getCampaigns(token: string, accountId: string, dateRange: string, corsHeaders: Record<string, string>) {
  const { startDate, endDate } = getDateRange(dateRange);

  // Fetch campaigns list
  const campaignsUrl = `${LINKEDIN_ADS_BASE}?q=search&search.account.values[0]=urn:li:sponsoredAccount:${accountId}&search.status.values[0]=ACTIVE&search.status.values[1]=PAUSED&count=50`;

  const campRes = await fetch(campaignsUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      'LinkedIn-Version': '202304',
    },
  });

  if (!campRes.ok) {
    const err = await campRes.text();
    throw new Error(`LinkedIn Campaigns API: ${campRes.status} — ${err}`);
  }

  const campData = await campRes.json();
  const rawCampaigns = campData.elements || [];

  // Fetch analytics for each campaign
  const campaignsWithStats = await Promise.all(
    rawCampaigns.slice(0, 20).map(async (camp: any) => {
      const stats = await fetchCampaignStats(token, camp.id, startDate, endDate);
      return buildCampaign(camp, stats);
    })
  );

  // Sort by spend desc
  campaignsWithStats.sort((a: any, b: any) => b.spend - a.spend);

  // Account info
  const accountRes = await fetch(`https://api.linkedin.com/v2/adAccountsV2/${accountId}`, {
    headers: { Authorization: `Bearer ${token}`, 'LinkedIn-Version': '202304' },
  });
  const accountData = accountRes.ok ? await accountRes.json() : {};

  const healthScore = calculateHealthScore(campaignsWithStats);

  return new Response(JSON.stringify({
    platform: 'linkedin',
    account: {
      id: accountId,
      name: accountData.name || `Conta ${accountId}`,
      currency: accountData.currency || 'BRL',
    },
    campaigns: campaignsWithStats,
    health_score: healthScore,
    date_range: dateRange,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function fetchCampaignStats(token: string, campaignId: string, startDate: string, endDate: string) {
  try {
    const [sy, sm, sd] = startDate.split('-');
    const [ey, em, ed] = endDate.split('-');

    const url = `https://api.linkedin.com/v2/adAnalyticsV2?q=analytics&pivot=CAMPAIGN&dateRange.start.year=${sy}&dateRange.start.month=${sm}&dateRange.start.day=${sd}&dateRange.end.year=${ey}&dateRange.end.month=${em}&dateRange.end.day=${ed}&campaigns[0]=urn:li:sponsoredCampaign:${campaignId}&fields=impressions,clicks,costInLocalCurrency,conversions,leadGenerationMailInterestedClicks,videoViews,approximateUniqueImpressions`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'LinkedIn-Version': '202304' },
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.elements?.[0] || null;
  } catch {
    return null;
  }
}

function buildCampaign(raw: any, stats: any) {
  const spend = stats ? parseFloat(stats.costInLocalCurrency || '0') : 0;
  const impressions = stats?.impressions || 0;
  const clicks = stats?.clicks || 0;
  const conversions = stats?.conversions || 0;
  const leads = stats?.leadGenerationMailInterestedClicks || 0;

  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cpc = clicks > 0 ? spend / clicks : 0;
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
  const cpl = leads > 0 ? spend / leads : 0;
  const engagementRate = impressions > 0 ? ((clicks + leads) / impressions) * 100 : 0;

  const health = computeHealthScore({ ctr, cpc, leads, spend, conversions });

  return {
    id: String(raw.id),
    name: raw.name || `Campanha ${raw.id}`,
    status: raw.status || 'PAUSED',
    type: raw.type || 'SPONSORED_UPDATES',
    objective: raw.objectiveType || 'WEBSITE_VISITS',
    daily_budget: raw.dailyBudget ? parseFloat(raw.dailyBudget.amount) / 100 : 0,
    total_budget: raw.totalBudget ? parseFloat(raw.totalBudget.amount) / 100 : 0,
    spend,
    impressions,
    clicks,
    ctr: Math.round(ctr * 100) / 100,
    cpc: Math.round(cpc * 100) / 100,
    cpm: Math.round(cpm * 100) / 100,
    conversions,
    leads,
    cost_per_lead: Math.round(cpl * 100) / 100,
    engagement_rate: Math.round(engagementRate * 100) / 100,
    health_score: health,
  };
}

function computeHealthScore(m: { ctr: number; cpc: number; leads: number; spend: number; conversions: number }): number {
  let score = 50;
  if (m.ctr > 0.5) score += 10;
  if (m.ctr > 1.0) score += 10;
  if (m.leads > 0) score += 15;
  if (m.conversions > 0) score += 10;
  if (m.spend > 0 && m.leads === 0 && m.conversions === 0) score -= 15;
  if (m.cpc > 50) score -= 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function calculateHealthScore(campaigns: any[]): number {
  if (!campaigns.length) return 0;
  const active = campaigns.filter(c => c.status === 'ACTIVE');
  if (!active.length) return 0;
  return Math.round(active.reduce((s, c) => s + c.health_score, 0) / active.length);
}

// ─── Update Campaign Status ─────────────────────────────────────────────────
async function updateCampaignStatus(token: string, _accountId: string, campaignId: string, newStatus: string, corsHeaders: Record<string, string>) {
  const res = await fetch(`${LINKEDIN_ADS_BASE}/${campaignId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': '202304',
      'X-RestLi-Method': 'PARTIAL_UPDATE',
    },
    body: JSON.stringify({ patch: { $set: { status: newStatus } } }),
  });

  if (!res.ok) {
    const err = await res.text();
    return new Response(JSON.stringify({ success: false, error: `LinkedIn API: ${res.status} — ${err}` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── Update Budget ─────────────────────────────────────────────────────────
async function updateBudget(token: string, _accountId: string, campaignId: string, newAmount: number, corsHeaders: Record<string, string>) {
  const res = await fetch(`${LINKEDIN_ADS_BASE}/${campaignId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': '202304',
      'X-RestLi-Method': 'PARTIAL_UPDATE',
    },
    body: JSON.stringify({
      patch: {
        $set: {
          dailyBudget: { amount: String(newAmount * 100), currencyCode: 'BRL' },
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return new Response(JSON.stringify({ success: false, error: `LinkedIn API: ${res.status} — ${err}` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── Date Helpers ──────────────────────────────────────────────────────────
function getDateRange(range: string): { startDate: string; endDate: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const subtract = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    return d;
  };

  switch (range) {
    case 'TODAY': return { startDate: fmt(today), endDate: fmt(today) };
    case 'YESTERDAY': return { startDate: fmt(subtract(1)), endDate: fmt(subtract(1)) };
    case 'LAST_7_DAYS': return { startDate: fmt(subtract(7)), endDate: fmt(today) };
    case 'LAST_14_DAYS': return { startDate: fmt(subtract(14)), endDate: fmt(today) };
    case 'THIS_MONTH': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { startDate: fmt(start), endDate: fmt(today) };
    }
    default: return { startDate: fmt(subtract(30)), endDate: fmt(today) };
  }
}
