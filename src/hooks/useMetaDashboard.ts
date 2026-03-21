import { useMemo, useCallback } from 'react';
import { useMetaInsights } from './useMetaInsights';
import { useMetaConnection } from './useMetaConnection';

export type MetaDatePreset = 'today' | 'yesterday' | 'last_7d' | 'last_30d';

export interface DashboardKPI {
  id: string;
  label: string;
  value: number;
  formattedValue: string;
  change: number;
  sparkline: number[];
}

export interface Anomaly {
  id: string;
  type: 'warning' | 'danger' | 'info';
  metric: string;
  title: string;
  description: string;
  changePercent: number;
}

function formatCurrency(value: number, currency: string): string {
  const symbol = currency === 'USD' ? 'US$' : currency === 'BRL' ? 'R$' : currency;
  return `${symbol} ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getPreviousPeriodRange(datePreset: MetaDatePreset): { since: string; until: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  switch (datePreset) {
    case 'today': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { since: fmt(yesterday), until: fmt(yesterday) };
    }
    case 'yesterday': {
      const dayBefore = new Date(today);
      dayBefore.setDate(dayBefore.getDate() - 2);
      return { since: fmt(dayBefore), until: fmt(dayBefore) };
    }
    case 'last_7d': {
      const end = new Date(today);
      end.setDate(end.getDate() - 8);
      const start = new Date(today);
      start.setDate(start.getDate() - 14);
      return { since: fmt(start), until: fmt(end) };
    }
    case 'last_30d': {
      const end = new Date(today);
      end.setDate(end.getDate() - 31);
      const start = new Date(today);
      start.setDate(start.getDate() - 60);
      return { since: fmt(start), until: fmt(end) };
    }
    default: {
      const end = new Date(today);
      end.setDate(end.getDate() - 8);
      const start = new Date(today);
      start.setDate(start.getDate() - 14);
      return { since: fmt(start), until: fmt(end) };
    }
  }
}

function calcChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

export function useMetaDashboard(datePreset: MetaDatePreset = 'last_7d', selectedAccountId?: string, selectedCurrency?: string) {
  const { connectedAccount, isLoading: isLoadingConnection } = useMetaConnection();
  const isConnected = !!connectedAccount;
  // Use explicitly passed accountId/currency if provided (account switcher), else fall back to hook's own instance
  const currency = selectedCurrency || connectedAccount?.currency || 'BRL';

  const previousRange = useMemo(() => getPreviousPeriodRange(datePreset), [datePreset]);

  const accountId = selectedAccountId || connectedAccount?.account_id;

  const accountInsights = useMetaInsights({
    accountId,
    datePreset,
    fields: 'spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type,action_values',
    enabled: isConnected,
  });

  const previousInsights = useMetaInsights({
    accountId,
    timeRange: previousRange,
    fields: 'spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type,action_values',
    enabled: isConnected,
  });

  const dailyInsights = useMetaInsights({
    accountId,
    datePreset: 'last_30d',
    timeIncrement: '1',
    fields: 'spend,impressions,clicks,cpm,ctr',
    enabled: isConnected,
  });

  const campaignInsights = useMetaInsights({
    accountId,
    datePreset,
    level: 'campaign',
    fields: 'campaign_name,campaign_id,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency',
    enabled: isConnected,
  });

  const adInsights = useMetaInsights({
    accountId,
    datePreset,
    level: 'ad',
    fields: 'ad_name,ad_id,spend,impressions,clicks,ctr,cpc,cpm',
    enabled: isConnected,
  });

  const dailySpend = useMetaInsights({
    accountId,
    datePreset: 'last_14d' as any,
    timeIncrement: '1',
    fields: 'spend',
    enabled: isConnected,
  });

  // Helper to extract CPA and ROAS from Meta actions data
  const extractConversionMetrics = (data: any) => {
    let cpa = 0;
    let roas = 0;
    const spend = Number(data.spend || 0);

    // CPA from cost_per_action_type
    if (data.cost_per_action_type) {
      const purchaseAction = data.cost_per_action_type.find(
        (a: any) => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase'
      );
      const leadAction = data.cost_per_action_type.find(
        (a: any) => a.action_type === 'lead' || a.action_type === 'offsite_conversion.fb_pixel_lead'
      );
      const anyAction = data.cost_per_action_type[0];
      cpa = Number(purchaseAction?.value || leadAction?.value || anyAction?.value || 0);
    }

    // ROAS from action_values
    if (data.action_values && spend > 0) {
      const purchaseValue = data.action_values.find(
        (a: any) => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase'
      );
      if (purchaseValue) {
        roas = Number(purchaseValue.value) / spend;
      }
    }

    return { cpa, roas };
  };

  // Parse KPIs
  const parseKPIs = (): DashboardKPI[] => {
    const data = accountInsights.data?.data?.[0] || accountInsights.data?.[0];
    if (!data) return [];
    const prev = previousInsights.data?.data?.[0] || previousInsights.data?.[0] || {};

    const spend = Number(data.spend || 0);
    const impressions = Number(data.impressions || 0);
    const clicks = Number(data.clicks || 0);
    const ctr = Number(data.ctr || 0);
    const cpc = Number(data.cpc || 0);
    const cpm = Number(data.cpm || 0);
    const reach = Number(data.reach || 0);
    const frequency = Number(data.frequency || 0);
    const { cpa, roas } = extractConversionMetrics(data);

    const pSpend = Number(prev.spend || 0);
    const pImpressions = Number(prev.impressions || 0);
    const pClicks = Number(prev.clicks || 0);
    const pCtr = Number(prev.ctr || 0);
    const pCpc = Number(prev.cpc || 0);
    const pCpm = Number(prev.cpm || 0);
    const pReach = Number(prev.reach || 0);
    const pFrequency = Number(prev.frequency || 0);
    const { cpa: pCpa, roas: pRoas } = prev.spend ? extractConversionMetrics(prev) : { cpa: 0, roas: 0 };

    return [
      { id: 'gasto', label: 'Total Gasto', value: spend, formattedValue: formatCurrency(spend, currency), change: calcChange(spend, pSpend), sparkline: [] },
      { id: 'impressoes', label: 'Impressões', value: impressions, formattedValue: impressions >= 1000 ? `${(impressions / 1000).toFixed(1)}k` : impressions.toLocaleString('pt-BR'), change: calcChange(impressions, pImpressions), sparkline: [] },
      { id: 'cliques', label: 'Cliques', value: clicks, formattedValue: clicks >= 1000 ? `${(clicks / 1000).toFixed(1)}k` : clicks.toLocaleString('pt-BR'), change: calcChange(clicks, pClicks), sparkline: [] },
      { id: 'ctr', label: 'CTR', value: ctr, formattedValue: `${ctr.toFixed(2)}%`, change: calcChange(ctr, pCtr), sparkline: [] },
      { id: 'cpc', label: 'CPC', value: cpc, formattedValue: formatCurrency(cpc, currency), change: calcChange(cpc, pCpc), sparkline: [] },
      { id: 'cpm', label: 'CPM', value: cpm, formattedValue: formatCurrency(cpm, currency), change: calcChange(cpm, pCpm), sparkline: [] },
      { id: 'roas', label: 'ROAS', value: roas, formattedValue: roas > 0 ? `${roas.toFixed(2)}x` : '—', change: calcChange(roas, pRoas), sparkline: [] },
      { id: 'cpa', label: 'CPA', value: cpa, formattedValue: cpa > 0 ? formatCurrency(cpa, currency) : '—', change: calcChange(cpa, pCpa), sparkline: [] },
    ];
  };

  const parseTrendData = () => {
    const rawData = dailyInsights.data?.data || dailyInsights.data || [];
    return rawData.map((day: any) => ({
      date: day.date_start || day.date_stop,
      investimento: Number(day.spend || 0),
      cliques: Number(day.clicks || 0),
      cpm: Number(Number(day.cpm || 0).toFixed(2)),
      ctr: Number(Number(day.ctr || 0).toFixed(2)),
    }));
  };

  const parseCampaignData = () => {
    const rawData = campaignInsights.data?.data || campaignInsights.data || [];
    return rawData.map((row: any, index: number) => ({
      id: row.campaign_id || String(index),
      name: row.campaign_name || 'Campanha',
      platform: 'meta' as const,
      impressions: Number(row.impressions || 0),
      cpm: Number(row.cpm || 0),
      clicks: Number(row.clicks || 0),
      ctr: Number(row.ctr || 0),
      cpc: Number(row.cpc || 0),
      spend: Number(row.spend || 0),
      reach: Number(row.reach || 0),
      frequency: Number(row.frequency || 0),
    }));
  };

  const parseAdData = () => {
    const rawData = adInsights.data?.data || adInsights.data || [];
    return rawData.map((ad: any) => ({
      id: ad.ad_id,
      name: ad.ad_name || 'Anúncio',
      platform: 'meta' as const,
      ctr: Number(ad.ctr || 0),
      cpc: Number(ad.cpc || 0),
      impressions: Number(ad.impressions || 0),
      spend: Number(ad.spend || 0),
      clicks: Number(ad.clicks || 0),
    }));
  };

  const parseDailySpend = () => {
    const rawData = dailySpend.data?.data || dailySpend.data || [];
    return rawData.map((day: any) => ({
      date: day.date_start || day.date_stop,
      spend: Number(day.spend || 0),
    }));
  };

  const kpis = parseKPIs();
  const trendData = parseTrendData();
  const campaignData = parseCampaignData();
  const adData = parseAdData();
  const dailySpendData = parseDailySpend();

  // Anomaly detection based on KPI changes
  const detectAnomalies = (): Anomaly[] => {
    const anomalies: Anomaly[] = [];
    const THRESHOLD_WARNING = 30; // 30% change
    const THRESHOLD_DANGER = 50;  // 50% change

    const anomalyConfig: Record<string, { name: string; lowerIsBetter: boolean }> = {
      gasto: { name: 'Investimento', lowerIsBetter: false },
      ctr: { name: 'Taxa de Cliques (CTR)', lowerIsBetter: false },
      cpc: { name: 'Custo por Clique (CPC)', lowerIsBetter: true },
      cpm: { name: 'Custo por Mil (CPM)', lowerIsBetter: true },
      roas: { name: 'Retorno (ROAS)', lowerIsBetter: false },
      cpa: { name: 'Custo por Ação (CPA)', lowerIsBetter: true },
    };

    for (const kpi of kpis) {
      const config = anomalyConfig[kpi.id];
      if (!config || kpi.change === 0) continue;

      const absChange = Math.abs(kpi.change);
      if (absChange < THRESHOLD_WARNING) continue;

      const isGettingWorse = config.lowerIsBetter
        ? kpi.change > 0  // increasing cost = bad
        : kpi.change < 0; // decreasing performance = bad

      const severity = absChange >= THRESHOLD_DANGER ? 'danger' : 'warning';
      const direction = kpi.change > 0 ? 'subiu' : 'caiu';

      if (isGettingWorse) {
        anomalies.push({
          id: `anomaly-${kpi.id}`,
          type: severity,
          metric: kpi.id,
          title: `${config.name} ${direction} ${absChange.toFixed(0)}%`,
          description: config.lowerIsBetter
            ? `O ${config.name} aumentou significativamente. Revise suas campanhas para otimizar custos.`
            : `O ${config.name} caiu bastante em relação ao período anterior. Investigue possíveis causas.`,
          changePercent: kpi.change,
        });
      } else if (absChange >= THRESHOLD_DANGER) {
        // Big positive change — info alert
        anomalies.push({
          id: `anomaly-${kpi.id}`,
          type: 'info',
          metric: kpi.id,
          title: `${config.name} ${direction} ${absChange.toFixed(0)}% 🎉`,
          description: `Ótima notícia! O ${config.name} melhorou significativamente em relação ao período anterior.`,
          changePercent: kpi.change,
        });
      }
    }

    return anomalies.sort((a, b) => {
      const order = { danger: 0, warning: 1, info: 2 };
      return order[a.type] - order[b.type];
    });
  };

  const anomalies = detectAnomalies();

  const sortedByCTR = [...adData].sort((a, b) => b.ctr - a.ctr);
  const sortedByCPC = [...adData].filter(a => a.cpc > 0).sort((a, b) => b.cpc - a.cpc);
  const bestCreatives = sortedByCTR.slice(0, 3);
  const worstCreatives = sortedByCPC.slice(0, 3);

  const isLoading = isLoadingConnection || accountInsights.isLoading;
  const error = accountInsights.error;

  const rawData = accountInsights.data?.data?.[0] || accountInsights.data?.[0];
  const performanceSummary = rawData ? {
    totalSpend: Number(rawData.spend || 0),
    avgCPC: Number(rawData.cpc || 0),
    avgCPM: Number(rawData.cpm || 0),
    totalReach: Number(rawData.reach || 0),
    frequency: Number(rawData.frequency || 0),
  } : null;

  // Aggregate refresh state from all queries
  const isRefreshing = accountInsights.isRefreshing || dailyInsights.isRefreshing ||
    campaignInsights.isRefreshing || adInsights.isRefreshing || dailySpend.isRefreshing;

  const lastUpdated = accountInsights.lastUpdated;

  const refreshAll = useCallback(() => {
    accountInsights.refresh();
    previousInsights.refresh();
    dailyInsights.refresh();
    campaignInsights.refresh();
    adInsights.refresh();
    dailySpend.refresh();
  }, [accountInsights, previousInsights, dailyInsights, campaignInsights, adInsights, dailySpend]);

  return {
    isConnected,
    isLoading,
    isLoadingConnection,
    error,
    kpis,
    trendData,
    campaignData,
    adData,
    dailySpendData,
    bestCreatives,
    worstCreatives,
    performanceSummary,
    anomalies,
    isTrendLoading: dailyInsights.isLoading,
    isCampaignLoading: campaignInsights.isLoading,
    isAdLoading: adInsights.isLoading,
    isSpendLoading: dailySpend.isLoading,
    isRefreshing,
    lastUpdated,
    refreshAll,
  };
}
