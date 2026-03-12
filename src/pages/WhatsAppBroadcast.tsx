import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  Send,
  Loader2,
  Plus,
  Play,
  Pause,
  CheckCircle,
  XCircle,
  Clock,
  MessageCircle,
  Users,
  Zap,
  AlertTriangle,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';

interface WACampaign {
  id: string;
  name: string;
  message_template: string;
  status: string;
  total_contacts: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  min_delay_seconds: number;
  max_delay_seconds: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface ContactList {
  id: string;
  name: string;
  contact_count: number;
}

interface WAInstance {
  id: string;
  friendly_name: string;
  phone_number: string | null;
  is_active: boolean;
}

export default function WhatsAppBroadcast() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<WACampaign[]>([]);
  const [lists, setLists] = useState<ContactList[]>([]);
  const [instances, setInstances] = useState<WAInstance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // New campaign form
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [selectedLists, setSelectedLists] = useState<string[]>([]);
  const [selectedInstance, setSelectedInstance] = useState('');
  const [minDelay, setMinDelay] = useState(5);
  const [maxDelay, setMaxDelay] = useState(15);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const [campaignsRes, listsRes, instancesRes] = await Promise.all([
        supabase
          .from('wa_campaigns')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('wa_contact_lists')
          .select('id, name, contact_count')
          .eq('user_id', user.id),
        supabase
          .from('wa_instances')
          .select('id, friendly_name, phone_number, is_active')
          .eq('user_id', user.id)
          .eq('is_active', true),
      ]);

      if (campaignsRes.error) throw campaignsRes.error;
      setCampaigns((campaignsRes.data as WACampaign[]) || []);
      setLists((listsRes.data as ContactList[]) || []);
      setInstances((instancesRes.data as WAInstance[]) || []);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const createCampaign = async () => {
    if (!user || !name.trim() || !message.trim() || selectedLists.length === 0) return;
    setIsSaving(true);
    try {
      // Count total contacts
      const { data: contactCount } = await supabase
        .from('wa_contacts')
        .select('id', { count: 'exact', head: true })
        .in('list_id', selectedLists)
        .eq('user_id', user.id);

      const total = (contactCount as any)?.length || 0;

      const { error } = await supabase.from('wa_campaigns').insert({
        user_id: user.id,
        instance_id: selectedInstance || null,
        name: name.trim(),
        message_template: message.trim(),
        list_ids: selectedLists,
        total_contacts: total,
        min_delay_seconds: minDelay,
        max_delay_seconds: maxDelay,
        status: 'draft',
      });
      if (error) throw error;

      toast({ title: 'Campanha criada!' });
      setShowNew(false);
      resetForm();
      fetchData();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setName('');
    setMessage('');
    setSelectedLists([]);
    setSelectedInstance('');
    setMinDelay(5);
    setMaxDelay(15);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" /> Rascunho</Badge>;
      case 'running':
        return <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30"><Zap className="h-3 w-3 mr-1" /> Enviando</Badge>;
      case 'paused':
        return <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30"><Pause className="h-3 w-3 mr-1" /> Pausada</Badge>;
      case 'completed':
        return <Badge className="bg-green-500/20 text-green-500 border-green-500/30"><CheckCircle className="h-3 w-3 mr-1" /> Concluída</Badge>;
      case 'failed':
        return <Badge className="bg-destructive/20 text-destructive border-destructive/30"><XCircle className="h-3 w-3 mr-1" /> Falhou</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getProgress = (c: WACampaign) => {
    if (c.total_contacts === 0) return 0;
    return Math.round((c.sent_count / c.total_contacts) * 100);
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl flex items-center gap-2">
              <Send className="h-7 w-7 text-purple-500" />
              Disparo em Massa
            </h1>
            <p className="text-muted-foreground">
              Crie e gerencie campanhas de disparo via WhatsApp
            </p>
          </div>
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4 mr-2" /> Nova Campanha
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/20">
                <MessageCircle className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{campaigns.length}</p>
                <p className="text-xs text-muted-foreground">Campanhas</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/20">
                <CheckCircle className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{campaigns.reduce((sum, c) => sum + c.sent_count, 0)}</p>
                <p className="text-xs text-muted-foreground">Enviadas</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/20">
                <Users className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{lists.reduce((sum, l) => sum + l.contact_count, 0)}</p>
                <p className="text-xs text-muted-foreground">Contatos</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/20">
                <XCircle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{campaigns.reduce((sum, c) => sum + c.failed_count, 0)}</p>
                <p className="text-xs text-muted-foreground">Falhas</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Campaigns */}
        <div className="space-y-4">
          {campaigns.map(campaign => (
            <Card key={campaign.id} className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-lg">{campaign.name}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                      {campaign.message_template}
                    </p>
                  </div>
                  {getStatusBadge(campaign.status)}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {campaign.sent_count} / {campaign.total_contacts} enviadas
                    </span>
                    <span className="font-medium">{getProgress(campaign)}%</span>
                  </div>
                  <Progress value={getProgress(campaign)} className="h-2" />

                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CheckCircle className="h-3 w-3 text-green-500" /> {campaign.delivered_count} entregues
                    </span>
                    <span className="flex items-center gap-1">
                      <XCircle className="h-3 w-3 text-red-500" /> {campaign.failed_count} falhas
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {minDelay}-{maxDelay}s delay
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {campaigns.length === 0 && !isLoading && (
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                <Send className="h-12 w-12 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">Nenhuma campanha criada</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Crie sua primeira campanha de disparo em massa
                  </p>
                </div>
                <Button onClick={() => setShowNew(true)}>
                  <Plus className="h-4 w-4 mr-2" /> Nova Campanha
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* New Campaign Dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova Campanha de Disparo</DialogTitle>
            <DialogDescription>
              Configure a mensagem e selecione as listas de contatos
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="space-y-2">
              <Label>Nome da campanha</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Black Friday 2026" />
            </div>

            <div className="space-y-2">
              <Label>Instância WhatsApp</Label>
              <Select value={selectedInstance} onValueChange={setSelectedInstance}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma instância" />
                </SelectTrigger>
                <SelectContent>
                  {instances.map(i => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.friendly_name} {i.phone_number ? `(${i.phone_number})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {instances.length === 0 && (
                <p className="text-xs text-yellow-500 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Nenhuma instância ativa
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Mensagem</Label>
              <Textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Olá! Temos uma oferta especial para você..."
                rows={5}
              />
              <p className="text-xs text-muted-foreground">
                Use {'{{nome}}'} para personalizar com o nome do contato
              </p>
            </div>

            <div className="space-y-2">
              <Label>Listas de contatos</Label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {lists.map(list => (
                  <div key={list.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedLists.includes(list.id)}
                      onCheckedChange={() => {
                        setSelectedLists(prev =>
                          prev.includes(list.id) ? prev.filter(l => l !== list.id) : [...prev, list.id]
                        );
                      }}
                    />
                    <span className="text-sm flex-1">{list.name}</span>
                    <Badge variant="secondary" className="text-xs">{list.contact_count}</Badge>
                  </div>
                ))}
                {lists.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhuma lista disponível</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Intervalo entre mensagens: {minDelay}s - {maxDelay}s</Label>
              <div className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground w-8">Min</span>
                <Slider
                  value={[minDelay]}
                  onValueChange={([v]) => setMinDelay(v)}
                  min={3}
                  max={30}
                  step={1}
                  className="flex-1"
                />
                <span className="text-xs font-mono w-8">{minDelay}s</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground w-8">Max</span>
                <Slider
                  value={[maxDelay]}
                  onValueChange={([v]) => setMaxDelay(Math.max(v, minDelay + 1))}
                  min={5}
                  max={60}
                  step={1}
                  className="flex-1"
                />
                <span className="text-xs font-mono w-8">{maxDelay}s</span>
              </div>
            </div>

            <Button
              onClick={createCampaign}
              disabled={isSaving || !name.trim() || !message.trim() || selectedLists.length === 0}
              className="w-full"
            >
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Criar Campanha
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
