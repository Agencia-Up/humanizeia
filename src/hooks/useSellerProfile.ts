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

    (supabase as any)
      .from('ai_team_members')
      .select('id, name, whatsapp_number, email, user_id, agent_id, is_active')
      .eq('auth_user_id', authUserId)
      .maybeSingle()
      .then(({ data }: any) => {
        if (data) {
          setResult({
            isSeller: true,
            seller: data as SellerInfo,
            masterUserId: data.user_id,
            loading: false,
          });
        } else {
          setResult({ isSeller: false, seller: null, masterUserId: null, loading: false });
        }
      });
  }, [authUserId]);

  return result;
}
