import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface UseMetaCachedQueryOptions<T> {
  cacheKey: string;
  fetchFn: () => Promise<T>;
  enabled?: boolean;
  alwaysReadCache?: boolean;
}

interface MetaCachedResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isRefreshing: boolean;
  lastUpdated: Date | null;
  error: Error | null;
  refresh: () => void;
}

export function useMetaCachedQuery<T = any>(
  options: UseMetaCachedQueryOptions<T>
): MetaCachedResult<T> {
  const { cacheKey, fetchFn, enabled = true, alwaysReadCache = false } = options;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [freshData, setFreshData] = useState<T | undefined>(undefined);
  const [freshUpdatedAt, setFreshUpdatedAt] = useState<Date | null>(null);
  const [fetchError, setFetchError] = useState<Error | null>(null);
  const hasFetchedRef = useRef(false);
  const mountIdRef = useRef(0);

  // Step 1: Read from cache (instant, <100ms)
  const cacheQuery = useQuery({
    queryKey: ['meta-cache', user?.id, cacheKey],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('meta_cache')
        .select('data, updated_at')
        .eq('user_id', user.id)
        .eq('cache_key', cacheKey)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user && (alwaysReadCache || enabled),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // Step 2: Fetch fresh data in background
  const fetchFresh = useCallback(async () => {
    if (!enabled || !user) return;
    const currentMountId = mountIdRef.current;
    setIsRefreshing(true);
    setFetchError(null);

    try {
      const result = await fetchFn();

      // Check if component is still mounted with same params
      if (currentMountId !== mountIdRef.current) return;

      // Save to cache
      await supabase
        .from('meta_cache')
        .upsert(
          {
            user_id: user.id,
            cache_key: cacheKey,
            data: result as any,
          },
          { onConflict: 'user_id,cache_key' }
        );

      setFreshData(result);
      setFreshUpdatedAt(new Date());

      // Invalidate cache query so it reflects latest
      queryClient.invalidateQueries({ queryKey: ['meta-cache', user.id, cacheKey] });
    } catch (err: any) {
      if (currentMountId !== mountIdRef.current) return;
      setFetchError(err);
    } finally {
      if (currentMountId === mountIdRef.current) {
        setIsRefreshing(false);
      }
    }
  }, [enabled, user, cacheKey, fetchFn, queryClient]);

  // Trigger background fetch on mount / when enabled changes
  useEffect(() => {
    mountIdRef.current += 1;
    hasFetchedRef.current = false;
    setFreshData(undefined);
    setFreshUpdatedAt(null);
    setFetchError(null);
  }, [cacheKey, enabled]);

  useEffect(() => {
    if (enabled && user && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchFresh();
    }
  }, [enabled, user, fetchFresh]);

  const cachedData = cacheQuery.data?.data as T | undefined;
  const cachedUpdatedAt = cacheQuery.data?.updated_at
    ? new Date(cacheQuery.data.updated_at)
    : null;

  const data = freshData ?? cachedData;
  const isLoading = !data && (cacheQuery.isLoading || isRefreshing);
  const lastUpdated = freshUpdatedAt ?? cachedUpdatedAt;

  const refresh = useCallback(() => {
    hasFetchedRef.current = false;
    setFreshData(undefined);
    fetchFresh();
  }, [fetchFresh]);

  return {
    data,
    isLoading,
    isRefreshing: isRefreshing && !!data,
    lastUpdated,
    error: data ? null : fetchError, // Suppress errors when cached data is available
    refresh,
  };
}
