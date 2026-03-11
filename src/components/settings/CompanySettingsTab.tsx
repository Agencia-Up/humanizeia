import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Building2, Users, Mail, Crown, Shield, UserCheck,
  Loader2, Plus, Trash2, Check, X
} from 'lucide-react';

interface OrgMember {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
  profiles?: { full_name: string | null } | null;
}

interface OrgInvite {
  id: string;
  email: string;
  status: string;
  created_at: string;
}

export function CompanySettingsTab() {
  const { organization, sendInvite } = useOrganization();
  const { user } = useAuth();
  const { toast } = useToast();

  const [orgName, setOrgName] = useState('');
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);

  useEffect(() => {
    if (organization) {
      setOrgName(organization.name);
      loadMembers();
      loadInvites();
    }
  }, [organization]);

  const loadMembers = async () => {
    if (!organization) return;
    setIsLoadingMembers(true);
    const { data: membersData } = await supabase
      .from('organization_members')
      .select('*')
      .eq('organization_id', organization.id);

    if (membersData && membersData.length > 0) {
      const userIds = membersData.map(m => m.user_id);
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);

      const profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);
      const enriched = membersData.map(m => ({
        ...m,
        profiles: profilesMap.get(m.user_id) || null,
      }));
      setMembers(enriched as OrgMember[]);
    } else {
      setMembers([]);
    }
    setIsLoadingMembers(false);
  };

  const loadInvites = async () => {
    if (!organization) return;
    const { data } = await supabase
      .from('organization_invites')
      .select('*')
      .eq('organization_id', organization.id)
      .eq('status', 'pending');
    setInvites(data || []);
  };

  const handleSaveName = async () => {
    if (!organization || !orgName.trim()) return;
    setIsSaving(true);
    const { error } = await supabase
      .from('organizations')
      .update({ name: orgName.trim() })
      .eq('id', organization.id);
    setIsSaving(false);

    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Empresa atualizada!' });
    }
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setIsSendingInvite(true);
    const { error } = await sendInvite(inviteEmail.trim());
    setIsSendingInvite(false);

    if (error) {
      toast({ title: 'Erro ao enviar convite', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '📧 Convite enviado!', description: `Convite enviado para ${inviteEmail}` });
      setInviteEmail('');
      loadInvites();
    }
  };

  const handleRemoveMember = async (memberId: string, memberUserId: string) => {
    if (memberUserId === user?.id) {
      toast({ title: 'Não é possível remover a si mesmo', variant: 'destructive' });
      return;
    }
    const { error } = await supabase
      .from('organization_members')
      .delete()
      .eq('id', memberId);

    if (error) {
      toast({ title: 'Erro ao remover membro', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Membro removido' });
      loadMembers();
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner': return <Crown className="h-3.5 w-3.5" />;
      case 'admin': return <Shield className="h-3.5 w-3.5" />;
      default: return <UserCheck className="h-3.5 w-3.5" />;
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'owner': return 'Proprietário';
      case 'admin': return 'Administrador';
      default: return 'Membro';
    }
  };

  if (!organization) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Nenhuma empresa vinculada.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Company Info */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Dados da Empresa</CardTitle>
              <CardDescription>Informações da sua organização</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Nome da empresa</Label>
            <Input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </div>
          <Button
            onClick={handleSaveName}
            disabled={isSaving || orgName === organization.name}
            className="gradient-primary"
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </CardContent>
      </Card>

      {/* Members */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Membros</CardTitle>
              <CardDescription>{members.length} membro(s) na organização</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoadingMembers ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between rounded-lg border border-border/50 p-3"
              >
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="text-sm">
                      {(member.profiles as any)?.full_name?.charAt(0) || '?'}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">
                      {(member.profiles as any)?.full_name || 'Sem nome'}
                      {member.user_id === user?.id && (
                        <span className="ml-2 text-xs text-muted-foreground">(você)</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={member.role === 'owner' ? 'default' : 'secondary'} className="gap-1">
                    {getRoleIcon(member.role)}
                    {getRoleLabel(member.role)}
                  </Badge>
                  {member.role !== 'owner' && member.user_id !== user?.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => handleRemoveMember(member.id, member.user_id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Invite */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Convidar membro</CardTitle>
              <CardDescription>Envie um convite por email para adicionar alguém à equipe</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSendInvite} className="flex gap-2">
            <Input
              type="email"
              placeholder="email@exemplo.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={isSendingInvite || !inviteEmail} className="gradient-primary">
              {isSendingInvite ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-1" />
              )}
              Convidar
            </Button>
          </form>

          {invites.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Convites pendentes</p>
              {invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{invite.email}</span>
                  </div>
                  <Badge variant="outline" className="text-xs">Pendente</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
