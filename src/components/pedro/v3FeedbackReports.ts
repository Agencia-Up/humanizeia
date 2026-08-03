import { supabase } from '@/integrations/supabase/client';

type JsonRecord = Record<string, unknown>;

export interface V3FeedbackReport {
  source: 'v3';
  days: number;
  conversas: JsonRecord[];
  produtos: JsonRecord[];
  rollup: JsonRecord[];
  historico: JsonRecord[];
  health: JsonRecord | null;
}

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item): item is JsonRecord => !!item && typeof item === 'object') : [];
}

/**
 * Fonte única das abas de Relatórios do Pedro v3.
 * A RPC já resolve o tenant pelo usuário autenticado e só devolve agregados
 * seguros; as abas continuam responsáveis apenas por renderizar o layout.
 */
export async function loadV3FeedbackReport(days = 30): Promise<V3FeedbackReport> {
  const { data, error } = await (supabase as unknown as RpcClient).rpc('v3_feedback_reports', { p_days: days });
  if (error) throw error;
  const value = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  return {
    source: 'v3',
    days: Number(value.days) || days,
    conversas: records(value.conversas),
    produtos: records(value.produtos),
    rollup: records(value.rollup),
    historico: records(value.historico),
    health: value.health && typeof value.health === 'object' ? value.health as Record<string, unknown> : null,
  };
}
