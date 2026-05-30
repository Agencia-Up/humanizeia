import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useSubscription } from '@/hooks/useSubscription';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { EvolutionConnectDialog } from '@/components/evolution/EvolutionConnectDialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Smartphone,
  Plus,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Trash2,
  RefreshCw,
  Heart,
  Globe,
  QrCode,
  Wifi,
  WifiOff,
  Signal,
  Link2,
  User,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface WaInstance {
  id: string;
  instance_name: string;
  friendly_name: string | null;
  phone_number: string | null;
  status: string | null;
  is_active: boolean | null;
  health_score: number | null;
  provider: string | null;
  api_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  failover_status: string | null;
  seller_member_id: string | null;
}

interface TeamMemberLite {
  id: string;
  name: string;
  is_active?: boolean;
}

function getStatusConfig(instance: WaInstance) {
  if (instance.status === 'connected' && instance.is_active) {
    return { label: 'Conectado', color: 'bg-green-500/20 text-green-500 border-green-500/30', icon: CheckCircle };
  }
  if (instance.status === 'waiting_qr') {
    return { label: 'Aguardando QR', color: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30', icon: AlertTriangle };
  }
  if (instance.status === 'banned' || instance.failover_status === 'banned') {
    return { label: 'Banido', color: 'bg-red-500/20 text-red-500 border-red-500/30', icon: XCircle };
  }
  if (!instance.is_active) {
    return { label: 'Desativado', color: 'bg-muted text-muted-foreground border-border', icon: WifiOff };
  }
  return { label: instance.status || 'Desconhecido', color: 'bg-muted text-muted-foreground border-border', icon: Wifi };
}

function getHealthColor(score: number | null) {
  if (score === null || score === undefined) return 'text-muted-foreground';
  if (score >= 80) return 'text-green-500';
  if (score >= 50) return 'text-yellow-500';
  return 'text-red-500';
}

function getHealthBg(score: number | null) {
  if (score === null || score === undefined) return 'bg-muted';
  if (score >= 80) return 'bg-green-500';
  if (score >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

// Formata o número conectado (só dígitos no banco) num formato BR legível.
// Ex.: "554199999999" -> "+55 (41) 99999-9999". Se não casar, mostra "+<digitos>".
function formatWaNumber(raw: string | null | undefined): string {
  const d = (raw || '').replace(/\D/g, '');
  if (!d) return '';
  const br = d.startsWith('55') ? d.slice(2) : d;
  if (br.length === 11) return `+55 (${br.slice(0, 2)}) ${br.slice(2, 7)}-${br.slice(7)}`;
  if (br.length === 10) return `+55 (${br.slice(0, 2)}) ${br.slice(2, 6)}-${br.slice(6)}`;
  return `+${d}`;
}

const INSTANCE_LIMITS: Record<string, number> = {
  basico: 5,
  pro: 10,
  enterprise: 15,
};

export default function WhatsAppInstances({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { subscription } = useSubscription();
  const { isAdmin } = useIsAdmin();
  const { isSeller, seller, visibleFeatures, loading: sellerLoading } = useSellerProfile(user?.id);
  const blockSellerAccess = !sellerLoading && isSeller && !visibleFeatures.marcos_instancias && !embedded;
  // Instâncias multi-tenant: master vê todas as da conta + atribui a vendedores;
  // vendedor vê só instâncias com seller_member_id = seu seller.id
  const effectiveOwnerId = isSeller && seller?.user_id ? seller.user_id : user?.id;
  const userPlan = isAdmin ? 'enterprise' : (subscription?.plan_id || 'basico');
  const maxInstances = isSeller ? 1 : (INSTANCE_LIMITS[userPlan] ?? 5);
  const [instances, setInstances] = useState<WaInstance[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMemberLite[]>([]);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [isVerifyingAll, setIsVerifyingAll] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [selectedInstance, setSelectedInstance] = useState<{ name: string; friendlyName: string } | null>(null);

  const verifyInstanceStatus = async (instanceId: string, silent = false) => {
    setVerifyingId(instanceId);
    try {
      const { data, error } = await supabase.functions.invoke('verify-instance-status', {
        body: { instance_id: instanceId },
      });
      if (error) throw error;
      
      if (data?.status_changed) {
        // Update local state
        setInstances(prev => prev.map(i => 
          i.id === instanceId 
            ? { ...i, status: data.current_status, is_active: data.is_connected, health_score: data.is_connected ? i.health_score : 0 }
            : i
        ));
        if (!silent) {
          toast({ 
            title: data.is_connected ? 'Instância conectada' : '⚠️ Instância desconectada',
            description: data.message,
            variant: data.is_connected ? 'default' : 'destructive',
          });
        }
      } else if (!silent) {
        toast({ title: 'Status verificado', description: data.message });
      }
    } catch (err: any) {
      if (!silent) {
        toast({ title: 'Erro ao verificar', description: err.message, variant: 'destructive' });
      }
    } finally {
      setVerifyingId(null);
    }
  };

  const verifyAllInstances = async (_instanceList: WaInstance[]) => {
    setIsVerifyingAll(true);
    try {
      // Bulk audit no servidor: verifica todas as instâncias da conta contra a
      // Evolution API e DESATIVA (is_active=false) as que estão zumbi.
      const { data, error } = await supabase.functions.invoke('audit-master-instances', { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const summary = data?.summary || {};
      toast({
        title: '✅ Auditoria completa',
        description: `${summary.connected || 0} conectadas, ${summary.disconnected || 0} desativadas (${summary.changed || 0} mudaram).`,
      });
    } catch (err: any) {
      toast({ title: 'Erro na auditoria', description: err.message, variant: 'destructive' });
    } finally {
      setIsVerifyingAll(false);
      await fetchInstances(true);
    }
  };

  const fetchInstances = async (skipVerify = false) => {
    if (!effectiveOwnerId) return;
    setIsLoading(true);
    try {
      // Master vê todas as instâncias da conta; vendedor vê só as atribuídas a ele
      let query = (supabase as any)
        .from('wa_instances')
        .select('id, instance_name, friendly_name, phone_number, status, is_active, health_score, provider, api_url, created_at, updated_at, failover_status, seller_member_id')
        .eq('user_id', effectiveOwnerId)
        .order('created_at', { ascending: false });
      if (isSeller && seller?.id) {
        query = query.eq('seller_member_id', seller.id);
      }
      const { data, error } = await query;

      if (error) throw error;
      const list = (data as unknown as WaInstance[]) || [];
      setInstances(list);
      // NÃO disparar auto-verify ao abrir a página — era a causa principal da
      // instabilidade: a cada montagem rodava audit-master-instances que faz
      // N requests à UaZapi (uma por instância) e gerava toasts de erro em
      // cascata. Master clica "Verificar Todos" quando quiser checar.
    } catch (err: any) {
      console.error('Error fetching instances:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Master: carrega vendedores da conta para o dropdown de atribuição.
  // Inclui INATIVOS também — se instância tem seller_member_id de vendedor
  // removido, o dropdown precisa mostrar o nome (não ficar em branco).
  const fetchTeamMembers = async () => {
    if (!effectiveOwnerId || isSeller) return;
    try {
      const { data } = await (supabase as any)
        .from('ai_team_members')
        .select('id, name, is_active')
        .eq('user_id', effectiveOwnerId)
        .order('is_active', { ascending: false })
        .order('name');
      // Dedup por id (não por nome — id é único; nome pode repetir).
      const seen = new Set<string>();
      const unique: TeamMemberLite[] = [];
      for (const m of (data || []) as TeamMemberLite[]) {
        if (!seen.has(m.id)) { seen.add(m.id); unique.push(m); }
      }
      setTeamMembers(unique);
    } catch (err) {
      console.error('Error fetching team members:', err);
    }
  };

  // Master: atribui (ou desatribui) uma instância a um vendedor
  const handleAssignSeller = async (instanceId: string, sellerMemberId: string | null) => {
    setAssigningId(instanceId);
    try {
      const { error } = await (supabase as any)
        .from('wa_instances')
        .update({ seller_member_id: sellerMemberId })
        .eq('id', instanceId);
      if (error) throw error;
      setInstances(prev => prev.map(i => i.id === instanceId ? { ...i, seller_member_id: sellerMemberId } : i));
      toast({
        title: sellerMemberId ? '✅ Instância atribuída ao vendedor' : 'Instância desatribuída (volta para o master)',
      });
    } catch (err: any) {
      toast({ title: 'Erro ao atribuir', description: err.message, variant: 'destructive' });
    } finally {
      setAssigningId(null);
    }
  };

  useEffect(() => {
    fetchInstances();
    fetchTeamMembers();
  }, [effectiveOwnerId, isSeller, seller?.id]);

  const handleDelete = async () => {
    if (!deleteId || !user?.id) return;
    setIsDeleting(true);
    try {
      // requester_auth_id = auth.uid() do solicitante (master OU vendedor).
      // A edge function valida autorização: master via user_id, vendedor via seller_member_id.
      const { data, error } = await supabase.functions.invoke('delete-evolution-instance', {
        body: { instance_id: deleteId, requester_auth_id: user.id },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao remover instância');
      toast({ title: 'Instância removida com sucesso' });
      setInstances(prev => prev.filter(i => i.id !== deleteId));
    } catch (err: any) {
      toast({ title: 'Erro ao remover', description: err.message, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
      setDeleteId(null);
    }
  };

  const handleConnectInstance = (instance: WaInstance) => {
    setSelectedInstance({ 
      name: instance.instance_name, 
      friendlyName: instance.friendly_name || instance.instance_name 
    });
    setConnectOpen(true);
  };

  const handleSyncWebhook = async (instance: WaInstance) => {
    setSyncingId(instance.id);
    try {
      const { data, error } = await supabase.functions.invoke('sync-evolution-webhook', {
        body: { instance_id: instance.id, user_id: user?.id },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao sincronizar webhook');
      toast({
        title: '✅ Webhook sincronizado!',
        description: `Webhook registrado: ${data.webhookUrl}`,
      });
    } catch (err: any) {
      toast({ title: 'Erro ao sincronizar webhook', description: err.message, variant: 'destructive' });
    } finally {
      setSyncingId(null);
    }
  };

  const handleToggleActive = async (instance: WaInstance) => {
    try {
      const { error } = await supabase
        .from('wa_instances')
        .update({ is_active: !instance.is_active } as any)
        .eq('id', instance.id);
      if (error) throw error;
      setInstances(prev => prev.map(i => i.id === instance.id ? { ...i, is_active: !i.is_active } : i));
      toast({ title: instance.is_active ? 'Instância desativada' : 'Instância ativada' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const activeCount = instances.filter(i => i.is_active && i.status === 'connected').length;
  // Pool conta SOMENTE ativas (is_active = true). Desativadas liberam vaga.
  const poolUsed = instances.filter(i => i.is_active).length;
  const totalHealth = instances.length > 0
    ? Math.round(instances.reduce((s, i) => s + (i.health_score ?? 0), 0) / instances.length)
    : 0;

  const Wrapper = embedded ? ({ children }: { children: React.ReactNode }) => <div className="h-full overflow-y-auto">{children}</div> : MainLayout;

  // Bloqueia vendedor sem permissão marcos_instancias (acesso direto via URL)
  if (blockSellerAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <Wrapper>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl">Números de WhatsApp</h1>
            <p className="text-muted-foreground">
              Conecte seus chips de WhatsApp para enviar campanhas em massa
            </p>
          </div>
          <div className="flex gap-2">
            {instances.length > 0 && (
              <Button
                variant="outline"
                onClick={() => verifyAllInstances(instances)}
                disabled={isVerifyingAll}
                className="gap-2"
              >
                {isVerifyingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Verificar Todos
              </Button>
            )}
            <Button
              onClick={() => {
                if (isSeller && instances.length > 0) {
                  handleConnectInstance(instances[0]);
                  return;
                }
                if (poolUsed >= maxInstances) {
                  toast({
                    title: `Limite de ${maxInstances} instâncias atingido`,
                    description: isSeller
                      ? 'Você já possui um número conectado. Desative-o antes de conectar outro.'
                      : 'Limite do plano atingido. Desative uma instância ou faça upgrade.',
                    variant: 'destructive',
                  });
                  return;
                }
                setConnectOpen(true);
              }}
              className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white gap-2"
            >
              <Plus className="h-4 w-4" />
              Conectar Número ({poolUsed}/{maxInstances})
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/10">
                <Smartphone className="h-6 w-6 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{instances.length}</p>
                <p className="text-sm text-muted-foreground">Total de instâncias</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Signal className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeCount}</p>
                <p className="text-sm text-muted-foreground">Ativas e conectadas</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="flex items-center gap-4 p-4">
              <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${totalHealth >= 80 ? 'bg-green-500/10' : totalHealth >= 50 ? 'bg-yellow-500/10' : 'bg-red-500/10'}`}>
                <Heart className={`h-6 w-6 ${getHealthColor(totalHealth)}`} />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalHealth}%</p>
                <p className="text-sm text-muted-foreground">Saúde média</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Health score legend */}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500 inline-block" /> Saúde 80–100 = Ótimo</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-500 inline-block" /> Saúde 50–79 = Monitorar</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500 inline-block" /> Saúde &lt;50 = Atenção</span>
        </div>

        {/* Instance List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : instances.length === 0 ? (
          <div className="space-y-4">
            {/* Onboarding explanation */}
            <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-5 flex gap-3">
              <span className="text-2xl shrink-0">📱</span>
              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground">O que são instâncias / números?</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Cada <strong>"instância"</strong> é um número de WhatsApp conectado à plataforma. Você precisa de pelo menos um número para enviar campanhas em massa, responder leads pelo Inbox e usar o Agente IA.
                </p>
                <div className="space-y-1 pt-1">
                  {[
                    '📲 Você vai escanear um QR Code com o WhatsApp do seu celular',
                    '✅ Após conectar, o número fica disponível para campanhas',
                    '💡 Recomendamos usar chips dedicados (não seu número pessoal)',
                  ].map(tip => <p key={tip} className="text-xs text-muted-foreground">{tip}</p>)}
                </div>
              </div>
            </div>
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="flex flex-col items-center gap-4 py-12">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
                  <Smartphone className="h-8 w-8 text-green-500" />
                </div>
                <div className="text-center">
                  <p className="text-lg font-medium">Nenhum número conectado ainda</p>
                  <p className="text-sm text-muted-foreground mt-1">Clique no botão abaixo e escaneie o QR Code com seu WhatsApp</p>
                </div>
                <Button
                  onClick={() => setConnectOpen(true)}
                  className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Conectar Meu Número
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {instances.map(instance => {
              const statusCfg = getStatusConfig(instance);
              const StatusIcon = statusCfg.icon;
              const health = instance.health_score ?? 0;

              return (
                <Card key={instance.id} className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-border transition-colors">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${instance.provider === 'meta' ? 'bg-blue-500/10' : 'bg-green-500/10'}`}>
                          {instance.provider === 'meta' ? (
                            <Globe className="h-5 w-5 text-blue-500" />
                          ) : (
                            <QrCode className="h-5 w-5 text-green-500" />
                          )}
                        </div>
                        <div>
                          <CardTitle className="text-base">
                            {instance.friendly_name || instance.instance_name}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            {instance.phone_number ? (
                              <span className="font-mono text-foreground">{formatWaNumber(instance.phone_number)}</span>
                            ) : (
                              instance.provider === 'meta' ? 'Meta API Oficial' : 'Uazapi'
                            )}
                          </CardDescription>
                        </div>
                      </div>
                      <Badge className={statusCfg.color}>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {statusCfg.label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Details */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">Provedor</p>
                        <p className="font-medium text-xs">{instance.provider === 'meta' ? 'Meta API' : 'Uazapi'}</p>
                      </div>
                      {instance.phone_number && (
                        <div>
                          <p className="text-muted-foreground text-xs">Número conectado</p>
                          <p className="font-mono text-xs">{formatWaNumber(instance.phone_number)}</p>
                        </div>
                      )}
                    </div>

                    {/* Health Bar */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Saúde</span>
                        <span className={`text-xs font-medium ${getHealthColor(health)}`}>{health}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${getHealthBg(health)}`}
                          style={{ width: `${health}%` }}
                        />
                      </div>
                    </div>

                    {/* Atribuir a vendedor (apenas master) */}
                    {!isSeller && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <User className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Atribuído a</span>
                          {instance.seller_member_id && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-emerald-500/30 text-emerald-400">
                              vendedor
                            </Badge>
                          )}
                        </div>
                        <Select
                          value={instance.seller_member_id || 'none'}
                          onValueChange={(v) => handleAssignSeller(instance.id, v === 'none' ? null : v)}
                          disabled={assigningId === instance.id}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Não atribuída" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none" className="text-xs text-muted-foreground">
                              Não atribuída (master)
                            </SelectItem>
                            {teamMembers.map(m => (
                              <SelectItem key={m.id} value={m.id} className="text-xs">
                                {m.name}{m.is_active === false ? ' (inativo)' : ''}
                              </SelectItem>
                            ))}
                            {/* Fallback — instância referencia vendedor que sumiu
                                da lista (ex: deletado). Mostra opção fantasma
                                pra master conseguir desatribuir/reatribuir. */}
                            {instance.seller_member_id &&
                              !teamMembers.some(m => m.id === instance.seller_member_id) && (
                              <SelectItem
                                value={instance.seller_member_id}
                                className="text-xs text-amber-500"
                              >
                                Vendedor removido (desatribua)
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => verifyInstanceStatus(instance.id)}
                        disabled={verifyingId === instance.id}
                        title="Verificar status"
                      >
                        {verifyingId === instance.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      {instance.provider !== 'meta' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSyncWebhook(instance)}
                          disabled={syncingId === instance.id}
                          title="Sincronizar Webhook (corrige Pedro sem transferir)"
                          className="text-amber-500 border-amber-500/30 hover:bg-amber-500/10"
                        >
                          {syncingId === instance.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Link2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}
                      {instance.status === 'connected' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => handleToggleActive(instance)}
                        >
                          {instance.is_active ? (
                            <>
                              <WifiOff className="h-3.5 w-3.5 mr-1.5" />
                              Desativar
                            </>
                          ) : (
                            <>
                              <Wifi className="h-3.5 w-3.5 mr-1.5" />
                              Ativar
                            </>
                          )}
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          className="flex-1 bg-primary hover:bg-primary/90"
                          onClick={() => handleConnectInstance(instance)}
                        >
                          <QrCode className="h-3.5 w-3.5 mr-1.5" />
                          Conectar
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteId(instance.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Help Card */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-lg">Como funciona</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <ol className="list-decimal list-inside space-y-2">
              <li>Clique em <strong>"Conectar Número"</strong> e escolha o provedor (Uazapi ou Meta API Oficial)</li>
              <li>Para <strong>Uazapi</strong>: informe URL + API Key, teste a conexão e escaneie o QR Code</li>
              <li>Para <strong>Meta API</strong>: informe o Phone Number ID e Access Token da sua conta Business</li>
              <li>O sistema fará <strong>rodízio inteligente</strong> entre as instâncias ativas durante o disparo</li>
              <li>Instâncias com <strong>saúde baixa</strong> são automaticamente desativadas para proteger seus números</li>
            </ol>
          </CardContent>
        </Card>
      </div>

      <EvolutionConnectDialog
        open={connectOpen}
        onOpenChange={(open) => {
          setConnectOpen(open);
          if (!open) setSelectedInstance(null);
        }}
        initialInstanceName={selectedInstance?.name}
        initialFriendlyName={selectedInstance?.friendlyName}
        onConnected={() => {
          setConnectOpen(false);
          setSelectedInstance(null);
          fetchInstances();
        }}
      />

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover instância</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover esta instância? Esta ação não pode ser desfeita e os contatos associados ficarão sem instância ativa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Wrapper>
  );
}
