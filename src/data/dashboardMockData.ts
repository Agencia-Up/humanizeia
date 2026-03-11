// Dashboard Performance - Legacy file
// Data has been migrated to useMetaDashboard hook

export type DateRange = 'today' | 'yesterday' | '7days' | '30days';

export interface DashboardKPI {
  id: string;
  label: string;
  value: number;
  formattedValue: string;
  change: number;
  prefix?: string;
  suffix?: string;
  sparkline: number[];
}

export interface FunnelRow {
  id: string;
  origem: string;
  platform: 'meta' | 'google' | 'tiktok';
  impressions: number;
  cpm: number;
  clicks: number;
  ctr: number;
  cpc: number;
  addToCart: number;
  addToCartRate: number;
  checkouts: number;
  vendas: number;
  cpa: number;
  spend: number;
  revenue: number;
  frequency?: number;
}

export interface CreativeAlert {
  id: string;
  name: string;
  platform: 'meta' | 'google' | 'tiktok';
  thumbnail: string;
  ctr: number;
  cpa: number;
  impressions: number;
  spend: number;
  conversions: number;
  hookRate?: number;
}

export const midasBenchmarks = {
  cpa: { green: 85, yellow: 105, red: 106 },
  cpaMeta: 55,
  merMeta: 4.0,
  ctr: { green: 1.4, red: 0.8 },
  thumbStopRate: 30,
  checkoutRate: 10,
  merRange: { min: 3.0, max: 5.0 },
};

// Exports kept for type compatibility but empty
export const dashboardKPIs: Record<DateRange, DashboardKPI[]> = {
  today: [], yesterday: [], '7days': [], '30days': []
};
export const trendData = [];
export const funnelData = [];
export const bestCreatives = [];
export const worstCreatives = [];
