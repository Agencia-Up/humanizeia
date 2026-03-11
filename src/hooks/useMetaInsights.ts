import { useCallback } from 'react';
import { useMetaApi } from './useMetaApi';
import { useMetaCachedQuery } from './useMetaCachedQuery';

interface UseMetaInsightsOptions {
  accountId?: string | null;
  datePreset?: string;
  timeRange?: { since: string; until: string };
  timeIncrement?: string;
  breakdowns?: string;
  level?: string;
  fields?: string;
  enabled?: boolean;
}

function buildCacheKey(options: UseMetaInsightsOptions): string {
  const parts = ['insights'];
  if (options.datePreset) parts.push(options.datePreset);
  if (options.timeRange) parts.push(`${options.timeRange.since}_${options.timeRange.until}`);
  if (options.timeIncrement) parts.push(`ti${options.timeIncrement}`);
  if (options.breakdowns) parts.push(`bd${options.breakdowns}`);
  if (options.level) parts.push(options.level);
  if (options.fields) {
    // Hash fields to keep key short
    const hash = options.fields.split(',').sort().join(',');
    parts.push(hash.length > 40 ? hash.slice(0, 40) : hash);
  }
  return parts.join(':');
}

export function useMetaInsights(options: UseMetaInsightsOptions = {}) {
  const { callMetaApi } = useMetaApi();

  const {
    accountId,
    datePreset = 'last_7d',
    timeRange,
    timeIncrement,
    breakdowns,
    level,
    fields = 'spend,impressions,clicks,ctr,cpc,cpm,actions,cost_per_action_type,action_values,frequency,reach',
    enabled = true,
  } = options;

  const cacheKey = buildCacheKey(options);

  const fetchFn = useCallback(async () => {
    const params: Record<string, any> = { fields };

    if (timeRange) {
      params.time_range = JSON.stringify(timeRange);
    } else {
      params.date_preset = datePreset;
    }

    if (timeIncrement) params.time_increment = timeIncrement;
    if (breakdowns) params.breakdowns = breakdowns;
    if (level) params.level = level;

    return callMetaApi({
      endpoint: `act_{ad_account_id}/insights`,
      params,
    });
  }, [callMetaApi, fields, timeRange, datePreset, timeIncrement, breakdowns, level]);

  const result = useMetaCachedQuery({
    cacheKey,
    fetchFn,
    enabled: enabled && !!accountId,
  });

  return {
    data: result.data,
    isLoading: result.isLoading,
    isRefreshing: result.isRefreshing,
    lastUpdated: result.lastUpdated,
    error: result.error,
    refresh: result.refresh,
  };
}
