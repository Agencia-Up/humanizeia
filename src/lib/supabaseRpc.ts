import { supabase } from '@/integrations/supabase/client';

export interface SupabaseRpcError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

type RpcClient = {
  rpc: <T>(name: string, args?: Record<string, unknown>) => PromiseLike<{
    data: T | null;
    error: SupabaseRpcError | null;
  }>;
};

/** RPCs adicionadas por migrations podem ainda nao constar no arquivo gerado. */
export async function supabaseRpc<T>(name: string, args?: Record<string, unknown>) {
  return await (supabase as unknown as RpcClient).rpc<T>(name, args);
}

