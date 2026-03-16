import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { EvolutionConnectDialog } from '@/components/evolution/EvolutionConnectDialog';
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

export default function WhatsAppInstances() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [instances, setInstances] = useState<WaInstance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [isVerifyingAll, setIsVerifyingAll] = useState(false);

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

  const verifyAllInstances = async (instanceList: WaInstance[]) => {
    setIsVerifyingAll(true);
    const evolutionInstances = instanceList.filter(i => i.provider !== 'meta');
    for (const inst of evolutionInstances) {
      await verifyInstanceStatus(inst.id, true);
    }
    setIsVerifyingAll(false);
    // Re-fetch to get updated data
    await fetchInstances(true);
  };

  const fetchInstances = async (skipVerify = false) => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('wa_instances')
        .select('id, instance_name, friendly_name, phone_number, status, is_active, health_score, provider, api_url, created_at, updated_at, failover_status')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setInstances((data as unknown as WaInstance[]) || []);
    } catch (err: any) {
      console.error('Error fetching instances:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInstances();
  }, [user]);

  const handleDelete = async () => {
    if (!deleteId) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase.from('wa_instances').delete().eq('id', deleteId);
      if (error) throw error;
      toast({ title: 'Instância removida com sucesso' });
      setInstances(prev => prev.filter(i => i.id !== deleteId));
    } catch (err: any) {
      toast({ title: 'Erro ao remover', description: err.message, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
      setDeleteId(null);
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
  const totalHealth = instances.length > 0
    ? Math.round(instances.reduce((s, i) => s + (i.health_score ?? 0), 0) / instances.length)
    : 0;

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl">Instâncias WhatsApp</h1>
            <p className="text-muted-foreground">
              Gerencie seus números de WhatsApp conectados para disparo em massa
            </p>
          </div>
          <Button
            onClick={() => setConnectOpen(true)}
            className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white gap-2"
          >
            <Plus className="h-4 w-4" />
            Conectar Número
          </Button>
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

        {/* Instance List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : instances.length === 0 ? (
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="flex flex-col items-center gap-4 py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Smartphone className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="text-lg font-medium">Nenhuma instância conectada</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Conecte seu primeiro número de WhatsApp para começar a usar o disparo em massa
                </p>
              </div>
              <Button
                onClick={() => setConnectOpen(true)}
                className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white gap-2"
              >
                <Plus className="h-4 w-4" />
                Conectar Número
              </Button>
            </CardContent>
          </Card>
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
                            {instance.provider === 'meta' ? 'Meta API Oficial' : 'Evolution API'}
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
                      {instance.phone_number && (
                        <div>
                          <p className="text-muted-foreground text-xs">Número</p>
                          <p className="font-mono text-xs">{instance.phone_number}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-muted-foreground text-xs">Provedor</p>
                        <p className="font-medium text-xs">{instance.provider === 'meta' ? 'Meta API' : 'Evolution'}</p>
                      </div>
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

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
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
              <li>Clique em <strong>"Conectar Número"</strong> e escolha o provedor (Evolution API ou Meta API Oficial)</li>
              <li>Para <strong>Evolution API</strong>: informe URL + API Key, teste a conexão e escaneie o QR Code</li>
              <li>Para <strong>Meta API</strong>: informe o Phone Number ID e Access Token da sua conta Business</li>
              <li>O sistema fará <strong>rodízio inteligente</strong> entre as instâncias ativas durante o disparo</li>
              <li>Instâncias com <strong>saúde baixa</strong> são automaticamente desativadas para proteger seus números</li>
            </ol>
          </CardContent>
        </Card>
      </div>

      <EvolutionConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={() => {
          setConnectOpen(false);
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
    </MainLayout>
  );
}
