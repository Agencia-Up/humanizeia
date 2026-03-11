import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

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
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [pendingInvites, setPendingInvites] = useState<OrganizationInvite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    loadOrganization();
    loadPendingInvites();
  }, [user]);

  const loadOrganization = async () => {
    if (!user) return;
    
    // Check profile for organization_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (profile?.organization_id) {
      const { data: org } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', profile.organization_id)
        .single();
      
      setOrganization(org);
    }
    setLoading(false);
  };

  const loadPendingInvites = async () => {
    if (!user?.email) return;

    const { data } = await supabase
      .from('organization_invites')
      .select('*, organizations(name)')
      .eq('email', user.email)
      .eq('status', 'pending');

    setPendingInvites((data as unknown as OrganizationInvite[]) || []);
  };

  const createOrganization = async (name: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    const currentUser = session?.user ?? user;
    if (!currentUser) return { error: new Error('Not authenticated') };

    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const suffix = Math.random().toString(36).substring(2, 6);
    const slug = `${base}-${suffix}`;

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({ name, slug, created_by: currentUser.id })
      .select()
      .single();

    if (orgError) return { error: orgError };

    // Add creator as owner
    const { error: memberError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: org.id,
        user_id: currentUser.id,
        role: 'owner' as any,
      });

    if (memberError) return { error: memberError };

    // Update profile
    await supabase
      .from('profiles')
      .update({ organization_id: org.id })
      .eq('id', currentUser.id);

    setOrganization(org);
    return { error: null, organization: org };
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

    await loadOrganization();
    await loadPendingInvites();
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
    loading,
    createOrganization,
    acceptInvite,
    sendInvite,
    reload: loadOrganization,
  };
}
