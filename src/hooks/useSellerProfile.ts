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
}

export interface SellerProfileResult {
  isSeller: boolean;
  seller: SellerInfo | null;
  masterUserId: string | null;
  loading: boolean;
}

export function useSellerProfile(authUserId?: string | null): SellerProfileResult {
  const [result, setResult] = useState<SellerProfileResult>({
    isSeller: false,
    seller: null,
    masterUserId: null,
    loading: true,
  });

  useEffect(() => {
    if (!authUserId) {
      setResult({ isSeller: false, seller: null, masterUserId: null, loading: false });
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
        setResult({ isSeller: false, seller: null, masterUserId: null, loading: false });
        return;
      }

      // 2. Se é seller, busca os dados do ai_team_members
      const { data: memberData } = await (supabase as any)
        .from('ai_team_members')
        .select('id, name, whatsapp_number, email, user_id, agent_id, is_active')
        .eq('auth_user_id', authUserId)
        .limit(1);

      if (cancelled) return;

      const seller = Array.isArray(memberData) && memberData.length > 0
        ? memberData[0] as SellerInfo
        : null;

      setResult({
        isSeller: true,
        seller,
        masterUserId: seller?.user_id || (profile as any)?.manager_id || null,
        loading: false,
      });
    }

    check();

    return () => { cancelled = true; };
  }, [authUserId]);

  return result;
}
