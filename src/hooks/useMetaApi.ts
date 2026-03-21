import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface MetaApiOptions {
  endpoint: string;
  params?: Record<string, any>;
  method?: 'GET' | 'POST' | 'DELETE';
  body?: Record<string, any>;
  /** Pass the account_id (e.g. "act_123456") to target a specific ad account */
  targetAccountId?: string;
}

export function useMetaApi() {
  const callMetaApi = useCallback(async <T = any>(options: MetaApiOptions): Promise<T> => {
    const { data, error } = await supabase.functions.invoke('meta-api', {
      body: options,
    });

    if (error) throw error;
    if (data?.error) {
      const err = new Error(data.error) as any;
      err.code = data.code;
      throw err;
    }

    return data as T;
  }, []);

  return { callMetaApi };
}
