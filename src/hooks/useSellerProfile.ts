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
  // Marcos — sub-itens CRM & WhatsApp
  marcos_crm: boolean;
  marcos_formularios: boolean;
  marcos_contatos: boolean;
  marcos_disparo: boolean;
  marcos_inbox: boolean;
  marcos_instancias: boolean;
  marcos_automacoes: boolean;
  // Sidebar
  sidebar_dashboard: boolean;
  sidebar_jose: boolean;
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
  marcos_crm: false,
  marcos_formularios: false,
  marcos_contatos: false,
  marcos_disparo: false,
  marcos_inbox: false,
  marcos_instancias: false,
  marcos_automacoes: false,
  sidebar_dashboard: false,
  sidebar_jose: false,
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

      // 2. Se é seller, busca TODOS os registros do ai_team_members
      //    (o vendedor pode pertencer a múltiplos agentes, cada um com suas visible_features)
      const { data: memberData } = await (supabase as any)
        .from('ai_team_members')
        .select('id, name, whatsapp_number, email, user_id, agent_id, is_active, visible_features')
        .eq('auth_user_id', authUserId)
        .order('is_active', { ascending: false })
        .order('created_at', { ascending: false });

      if (cancelled) return;

      const allRecords = Array.isArray(memberData) ? memberData as SellerInfo[] : [];
      // Usa o registro ativo mais recente como dados base (nome, email, etc.)
      const seller = allRecords.length > 0 ? allRecords[0] : null;

      // Merge features de TODOS os registros com lógica OR:
      // se qualquer registro libera uma feature, o vendedor a vê
      const features: VisibleFeatures = { ...DEFAULT_SELLER_FEATURES };
      for (const rec of allRecords) {
        const f = rec.visible_features;
        if (!f) continue;
        for (const key of Object.keys(DEFAULT_SELLER_FEATURES) as (keyof VisibleFeatures)[]) {
          if (f[key]) features[key] = true;
        }
      }

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
