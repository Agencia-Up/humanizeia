// ============================================================================
// useSecurityRules — consumo da API de Regras de Segurança (FASE 3)
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type {
  SecurityRuleProfile, SecurityRuleProfileInput,
  SecurityRuleViolation, AssignmentTargetType,
} from '@/types/securityRules';

export interface ProfileWithAssignments extends SecurityRuleProfile {
  assignments: { id: string; target_type: AssignmentTargetType; target_member_id: string | null }[];
}
export interface TeamMember { id: string; name: string; email: string | null; active_in_system: boolean; }

async function call<T = any>(action: string, payload: Record<string, any> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('security-rules-api', {
    body: { action, ...payload },
  });
  if (error) {
    // tenta extrair a mensagem PT do corpo do erro
    let msg = error.message || 'Erro ao falar com o servidor.';
    try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* noop */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data?.data as T;
}

export function useSecurityRules() {
  const [profiles, setProfiles] = useState<ProfileWithAssignments[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [p, m] = await Promise.all([
        call<ProfileWithAssignments[]>('list_profiles'),
        call<TeamMember[]>('list_members').catch(() => [] as TeamMember[]),
      ]);
      setProfiles(p || []); setMembers(m || []);
    } catch (e: any) {
      setError(e?.message || 'Não foi possível carregar as regras.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return {
    profiles, members, loading, error, refresh,
    createProfile: (profile: SecurityRuleProfileInput) => call<SecurityRuleProfile>('create_profile', { profile }),
    updateProfile: (id: string, profile: SecurityRuleProfileInput) => call<SecurityRuleProfile>('update_profile', { id, profile }),
    deleteProfile: (id: string) => call('delete_profile', { id }),
    duplicateProfile: (id: string) => call<SecurityRuleProfile>('duplicate_profile', { id }),
    toggleProfile: (id: string, is_active: boolean) => call<SecurityRuleProfile>('toggle_profile', { id, is_active }),
    saveAssignment: (profile_id: string, target_type: AssignmentTargetType, member_ids: string[]) =>
      call('save_assignment', { profile_id, target_type, member_ids }),
    listViolations: (limit = 100) => call<SecurityRuleViolation[]>('list_violations', { limit }),
  };
}
