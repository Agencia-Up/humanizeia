// ============================================================================
// useComercialData — carrega os dados do módulo comercial (vendas/metas).
// ----------------------------------------------------------------------------
// Carrega as VENDAS do ANO (uma vez) e as METAS do mês de referência. O recorte
// por período e por vendedor (drill-down) é feito no componente, a partir desse
// conjunto — o volume é pequeno (lançamento manual). RLS no banco garante que o
// vendedor só recebe as próprias vendas; o gestor recebe tudo da equipe.
// Realtime em comercial_vendas: ao inserir uma venda, recarrega.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { VendaComercial, MetaComercial, VendedorComercial } from '@/types/comercial';

interface Params {
  /** user_id do dono dos dados (gestor = próprio uid; vendedor = uid do master). */
  ownerUserId?: string | null;
  /** Data de referência do recorte (geralmente o fim do período do painel). */
  refDate: Date;
  /** Se o usuário logado é vendedor (não carrega a lista de vendedores). */
  isSeller: boolean;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function useComercialData({ ownerUserId, refDate, isSeller }: Params) {
  const [vendasAno, setVendasAno] = useState<VendaComercial[]>([]);
  const [metas, setMetas] = useState<MetaComercial[]>([]);
  const [sellers, setSellers] = useState<VendedorComercial[]>([]);
  const [loading, setLoading] = useState(true);

  const year = refDate.getFullYear();
  const monthRef = `${year}-${String(refDate.getMonth() + 1).padStart(2, '0')}-01`;

  // fetch guardado em ref pra ser chamado pelo realtime sem closure velha.
  const fetchRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    if (!ownerUserId) { setVendasAno([]); setMetas([]); setSellers([]); setLoading(false); return; }
    setLoading(true);
    try {
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;

      const sellersPromise = isSeller
        ? Promise.resolve({ data: [] as any[] })
        : (supabase as any)
            .from('ai_team_members')
            .select('id, name')
            .eq('user_id', ownerUserId)
            .neq('active_in_system', false);

      const [vendasRes, metasRes, sellersRes] = await Promise.all([
        (supabase as any)
          .from('comercial_vendas')
          .select('id, user_id, seller_id, data_venda, valor, origem, portal, veiculo, observacao, created_at')
          .eq('user_id', ownerUserId)
          .gte('data_venda', yearStart)
          .lte('data_venda', yearEnd)
          .order('data_venda', { ascending: true }),
        (supabase as any)
          .from('comercial_metas')
          .select('id, user_id, seller_id, tipo, mes_referencia, valor_meta')
          .eq('user_id', ownerUserId)
          .eq('mes_referencia', monthRef),
        sellersPromise,
      ]);

      const vendas: VendaComercial[] = (vendasRes?.data || []).map((v: any) => ({ ...v, valor: Number(v.valor) || 0 }));
      setVendasAno(vendas);
      setMetas((metasRes?.data || []) as MetaComercial[]);
      setSellers(((sellersRes?.data || []) as any[]).map(s => ({ id: s.id, nome: s.name })));
    } catch {
      setVendasAno([]); setMetas([]); setSellers([]);
    } finally {
      setLoading(false);
    }
  }, [ownerUserId, year, monthRef, isSeller]);

  useEffect(() => { fetchRef.current = load; }, [load]);
  useEffect(() => { load(); }, [load]);

  // Realtime: nova venda do dono -> recarrega.
  useEffect(() => {
    if (!ownerUserId) return;
    const channel = supabase
      .channel(`comercial-${ownerUserId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'comercial_vendas', filter: `user_id=eq.${ownerUserId}`,
      }, () => fetchRef.current())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'comercial_metas', filter: `user_id=eq.${ownerUserId}`,
      }, () => fetchRef.current())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [ownerUserId]);

  return { vendasAno, metas, sellers, loading, refresh: load, year, monthRef, refDateKey: ymd(refDate) };
}
