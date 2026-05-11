import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SellerInfo {
  id: string;
  name: string;
  whatsapp_number: string;
  email: string | null;
  user_id: string;   // master's user_id
  agent_id: string | null;
  is_active: boolean;
  visible_features: VisibleFeatures | null;
}

/** Configuração de visibilidade do painel do vendedor */
export interface VisibleFeatures {
  // Tabs do Pedro
  tab_crm: boolean;
  tab_inbox: boolean;
  tab_instancias: boolean;
  tab_performance: boolean;
  tab_agente_ia: boolean;
  tab_crm_ao_vivo: boolean;
  tab_vendedores: boolean;
  // Sidebar
  sidebar_dashboard: boolean;
  sidebar_treinamento: boolean;
  sidebar_meu_plano: boolean;
  sidebar_integracoes: boolean;
  sidebar_configuracoes: boolean;
}

export const DEFAULT_SELLER_FEATURES: VisibleFeatures = {
  tab_crm: true,
  tab_inbox: true,
  tab_instancias: false,
  tab_performance: false,
  tab_agente_ia: false,
  tab_crm_ao_vivo: false,
  tab_vendedores: false,
  sidebar_dashboard: false,
  sidebar_treinamento: false,
  sidebar_meu_plano: false,
  sidebar_integracoes: false,
  sidebar_configuracoes: false,
};

export interface SellerProfileResult {
  isSeller: boolean;
  seller: SellerInfo | null;
  masterUserId: string | null;
  visibleFeatures: VisibleFeatures;
  loading: boolean;
}

export function useSellerProfile(authUserId?: string | null): SellerProfileResult {
  const [result, setResult] = useState<SellerProfileResult>({
    isSeller: false,
    seller: null,
    masterUserId: null,
    visibleFeatures: DEFAULT_SELLER_FEATURES,
    loading: true,
  });

  useEffect(() => {
    if (!authUserId) {
      setResult({ isSeller: false, seller: null, masterUserId: null, visibleFeatures: DEFAULT_SELLER_FEATURES, loading: false });
      return;
    }

    let cancelled = false;

    async function check() {
      // 1. Primeiro verifica profiles.role (confiável, sem RLS issues)
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, manager_id')
        .eq('id', authUserId!)
        .single();

      if (cancelled) return;

      const isSeller = profile?.role === 'seller';

      if (!isSeller) {
        setResult({ isSeller: false, seller: null, masterUserId: null, visibleFeatures: DEFAULT_SELLER_FEATURES, loading: false });
        return;
      }

      // 2. Se é seller, busca os dados do ai_team_members (inclui visible_features)
      //    Ordena por is_active desc + created_at desc para garantir pegar o registro ativo mais recente
      const { data: memberData } = await (supabase as any)
        .from('ai_team_members')
        .select('id, name, whatsapp_number, email, user_id, agent_id, is_active, visible_features')
        .eq('auth_user_id', authUserId)
        .order('is_active', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1);

      if (cancelled) return;

      const seller = Array.isArray(memberData) && memberData.length > 0
        ? memberData[0] as SellerInfo
        : null;

      // Merge com defaults — features não definidas usam o default
      const features: VisibleFeatures = {
        ...DEFAULT_SELLER_FEATURES,
        ...(seller?.visible_features || {}),
      };

      setResult({
        isSeller: true,
        seller,
        masterUserId: seller?.user_id || (profile as any)?.manager_id || null,
        visibleFeatures: features,
        loading: false,
      });
    }

    check();

    return () => { cancelled = true; };
  }, [authUserId]);

  return result;
}
