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
  sidebar_painel_geral: boolean;
  sidebar_treinamento: boolean;
  sidebar_meu_plano: boolean;
  sidebar_integracoes: boolean;
  sidebar_configuracoes: boolean;
  // Agentes (controla cards do Dashboard E itens do sidebar)
  agent_pedro: boolean;
  agent_marcos: boolean;
  agent_jose: boolean;
  agent_salomao: boolean;
  agent_paulo: boolean;
  agent_maria: boolean;
  agent_davi: boolean;
  agent_joao: boolean;
  agent_daniel: boolean;
}

// Padrão de permissões pra novo vendedor convidado (atualizado 28/05/2026).
// Cobre o caso de uso típico: vendedor opera Pedro (atendimento IA + Painel
// ao Vivo + Instâncias do whatsapp dele) E Marcos (Kanban + Contatos + Inbox
// + Disparo). Sem agentes de marketing (José/Paulo/Maria etc.) por default —
// master libera caso queira.
export const DEFAULT_SELLER_FEATURES: VisibleFeatures = {
  // ── Abas do agente Pedro ────────────────────────────────────────────
  tab_crm: true,          // Meus Leads
  tab_inbox: true,        // Inbox IA
  tab_instancias: true,   // Instâncias WhatsApp (whatsapp do vendedor)
  tab_crm_ao_vivo: true,  // Painel ao Vivo (visão geral)
  tab_performance: false, // métricas (default off — master libera)
  tab_agente_ia: false,   // config do agente IA (só master)
  tab_vendedores: false,  // gestão de equipe (só master)
  // ── Abas do agente Marcos (CRM & WhatsApp) ──────────────────────────
  marcos_crm: true,        // CRM Kanban
  marcos_contatos: true,   // Base de contatos
  marcos_disparo: true,    // Disparo em Massa
  marcos_inbox: true,      // Inbox WhatsApp
  marcos_formularios: false,
  marcos_instancias: false,
  marcos_automacoes: false,
  // ── Sidebar ─────────────────────────────────────────────────────────
  sidebar_dashboard: true,    // Painel principal
  sidebar_painel_geral: false,// Painel Geral (visão dos próprios leads) — master libera
  sidebar_treinamento: true,  // Base de conhecimento
  sidebar_meu_plano: false,
  sidebar_integracoes: false,
  sidebar_configuracoes: false,
  // ── Agentes liberados (cards dashboard + sidebar) ────────────────────
  // Pedro + Marcos por default — sao os 2 agentes que o vendedor usa.
  // Demais (José/Salomão/Paulo/Maria/Davi/João/Daniel) ficam off ate
  // master liberar caso queira.
  agent_pedro: true,
  agent_marcos: true,
  agent_jose: false,
  agent_salomao: false,
  agent_paulo: false,
  agent_maria: false,
  agent_davi: false,
  agent_joao: false,
  agent_daniel: false,
};

export interface SellerProfileResult {
  isSeller: boolean;
  seller: SellerInfo | null;
  masterUserId: string | null;
  // Todos os ids de ai_team_members do vendedor (ele pode pertencer a varios
  // agentes). Usado p/ escopar leads atribuidos a ele (ex: Inbox IA, CRM).
  memberIds: string[];
  visibleFeatures: VisibleFeatures;
  loading: boolean;
}

export function useSellerProfile(authUserId?: string | null): SellerProfileResult {
  const [result, setResult] = useState<SellerProfileResult>({
    isSeller: false,
    seller: null,
    masterUserId: null,
    memberIds: [],
    visibleFeatures: DEFAULT_SELLER_FEATURES,
    loading: true,
  });

  useEffect(() => {
    if (!authUserId) {
      setResult({ isSeller: false, seller: null, masterUserId: null, memberIds: [], visibleFeatures: DEFAULT_SELLER_FEATURES, loading: false });
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
        setResult({ isSeller: false, seller: null, masterUserId: null, memberIds: [], visibleFeatures: DEFAULT_SELLER_FEATURES, loading: false });
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
        memberIds: allRecords.map((r) => r.id).filter(Boolean),
        visibleFeatures: features,
        loading: false,
      });
    }

    check();

    return () => { cancelled = true; };
  }, [authUserId]);

  return result;
}
