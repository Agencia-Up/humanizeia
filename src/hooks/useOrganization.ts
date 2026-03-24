import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useQuery } from '@tanstack/react-query';

interface Organization {
  id: string;
  name: string;
  slug: string | null;
  created_by: string;
  created_at: string;
}

interface OrganizationInvite {
  id: string;
  organization_id: string;
  email: string;
  status: string;
  created_at: string;
  organizations?: { name: string } | null;
}

export function useOrganization() {
  const { user } = useAuth();

  // Load Organization using React Query for automatic deduplication and caching
  const { data: organization = null, isLoading: loadingOrg, refetch: reload } = useQuery({
    queryKey: ['organization', user?.id],
    queryFn: async () => {
      if (!user) return null;
      
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (profileError || !profile?.organization_id) return null;

      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', profile.organization_id)
        .single();
      
      if (orgError) return null;
      return org as Organization;
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  // Load Pending Invites
  const { data: pendingInvites = [], isLoading: loadingInvites } = useQuery({
    queryKey: ['organization-invites', user?.email],
    queryFn: async () => {
      if (!user?.email) return [];

      const { data } = await supabase
        .from('organization_invites')
        .select('*, organizations(name)')
        .eq('email', user.email)
        .eq('status', 'pending');

      return (data as unknown as OrganizationInvite[]) || [];
    },
    enabled: !!user?.email,
    staleTime: 1000 * 60 * 2, // Cache for 2 minutes
  });

  const createOrganization = async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return { error: new Error('Organization name is required') };

    const { data, error } = await (supabase as any).rpc('create_organization_with_owner', {
      org_name: trimmedName,
    });

    if (error) {
      console.error('Organization creation error:', error);
      return { error };
    }

    reload(); // Refresh the query
    return { error: null, organization: data as Organization };
  };

  const acceptInvite = async (inviteId: string) => {
    if (!user) return { error: new Error('Not authenticated') };

    const invite = pendingInvites.find(i => i.id === inviteId);
    if (!invite) return { error: new Error('Invite not found') };

    // Accept invite
    const { error: updateError } = await supabase
      .from('organization_invites')
      .update({ status: 'accepted' as any })
      .eq('id', inviteId);

    if (updateError) return { error: updateError };

    // Join organization
    const { error: joinError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: invite.organization_id,
        user_id: user.id,
        role: 'member' as any,
      });

    if (joinError) return { error: joinError };

    // Update profile
    await supabase
      .from('profiles')
      .update({ organization_id: invite.organization_id })
      .eq('id', user.id);

    reload();
    return { error: null };
  };

  const sendInvite = async (email: string) => {
    if (!user || !organization) return { error: new Error('No organization') };

    const { error } = await supabase
      .from('organization_invites')
      .insert({
        organization_id: organization.id,
        email,
        invited_by: user.id,
      });

    return { error };
  };

  return {
    organization,
    pendingInvites,
    loading: loadingOrg || loadingInvites,
    createOrganization,
    acceptInvite,
    sendInvite,
    reload,
  };
}

