export const MARCOS_DEFAULT_PIPELINE_STAGES = [
  { name: 'Leads Inativos', color: '#9ca3af', position: 0 },
  { name: 'Marketplace', color: '#f97316', position: 1 },
  { name: 'Porta/loja', color: '#14b8a6', position: 2 },
  { name: 'Não tem no Estoque', color: '#f43f5e', position: 3 },
  { name: 'Agendamento', color: '#06b6d4', position: 4 },
  { name: 'Negociação', color: '#8b5cf6', position: 5 },
  { name: 'Venda concluída', color: '#10b981', position: 6 },
  { name: 'Consignado', color: '#a78bfa', position: 7 },
  { name: 'Indicação', color: '#fb923c', position: 8 },
  { name: 'Redes Sociais', color: '#ec4899', position: 9 },
] as const;

export type MarcosCrmStageRow = {
  id: string;
  name: string;
  color: string | null;
  position: number | null;
};

type SupabaseLike = {
  from: (table: string) => any;
  rpc?: (fn: string, args?: Record<string, unknown>) => Promise<{ error?: unknown }>;
};

async function fetchVisibleMarcosStages(
  supabase: SupabaseLike,
  userId: string,
  authUserId?: string | null,
): Promise<MarcosCrmStageRow[]> {
  let query = supabase
    .from('crm_pipeline_stages')
    .select('id, name, color, position')
    .eq('user_id', userId)
    .order('position', { ascending: true });

  if (authUserId) {
    query = query.or(`seller_auth_id.is.null,seller_auth_id.eq.${authUserId}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as MarcosCrmStageRow[];
}

export async function ensureMarcosPipelineStages(
  supabase: SupabaseLike,
  userId: string,
  authUserId?: string | null,
): Promise<MarcosCrmStageRow[]> {
  const currentStages = await fetchVisibleMarcosStages(supabase, userId, authUserId);
  if (currentStages.length > 0) return currentStages;

  const { count, error: countError } = await supabase
    .from('crm_pipeline_stages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('seller_auth_id', null);
  if (countError) throw countError;

  if ((count ?? 0) === 0) {
    const rpc = await supabase.rpc?.('ensure_marcos_default_pipeline_stages', { p_user_id: userId });

    if (rpc?.error) {
      const rows = MARCOS_DEFAULT_PIPELINE_STAGES.map(stage => ({
        user_id: userId,
        name: stage.name,
        color: stage.color,
        position: stage.position,
        is_default: false,
        ativo: true,
        show_in_live: true,
        seller_auth_id: null,
      }));

      const { error: insertError } = await supabase
        .from('crm_pipeline_stages')
        .upsert(rows, { onConflict: 'user_id,name', ignoreDuplicates: true });
      if (insertError) throw insertError;
    }
  }

  const freshStages = await fetchVisibleMarcosStages(supabase, userId, authUserId);
  if (freshStages.length === 0) {
    throw new Error('Não foi possível criar as etapas padrão do CRM do Marcos para esta conta.');
  }
  return freshStages;
}

export async function resolveFirstMarcosStageId(
  supabase: SupabaseLike,
  userId: string,
  authUserId?: string | null,
): Promise<string> {
  const stages = await ensureMarcosPipelineStages(supabase, userId, authUserId);
  return stages[0].id;
}
