import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  Send, Plus, CheckCircle, XCircle, MessageCircle, Users,
  Upload, Loader2, Trash2, List, Zap,
} from 'lucide-react';
import { CSVUploadDialog } from '@/components/broadcast/CSVUploadDialog';
import { NewCampaignDialog } from '@/components/broadcast/NewCampaignDialog';
import { CampaignCard, type WACampaign } from '@/components/broadcast/CampaignCard';
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

interface ContactList {
  id: string;
  name: string;
  contact_count: number;
  source: string;
  created_at: string;
}

interface WAInstance {
  id: string;
  friendly_name: string;
  phone_number: string | null;
  is_active: boolean;
  health_score: number;
  provider: string;
}

export default function WhatsAppBroadcast() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<WACampaign[]>([]);
  const [lists, setLists] = useState<ContactList[]>([]);
  const [instances, setInstances] = useState<WAInstance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [deleteListId, setDeleteListId] = useState<string | null>(null);
  const [isDeletingList, setIsDeletingList] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const [campaignsRes, listsRes, instancesRes] = await Promise.all([
        supabase
          .from('wa_campaigns')
          .select('id, name, message_template, prompt_base, status, total_contacts, sent_count, delivered_count, failed_count, min_delay_seconds, max_delay_seconds, variation_level, rotation_messages_per_instance, created_at, started_at, completed_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('wa_contact_lists')
          .select('id, name, contact_count, source, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('wa_instances')
          .select('id, friendly_name, phone_number, is_active, health_score, provider')
          .eq('user_id', user.id)
          .eq('is_active', true),
      ]);

      if (campaignsRes.error) throw campaignsRes.error;
      setCampaigns((campaignsRes.data as unknown as WACampaign[]) || []);
      setLists((listsRes.data as ContactList[]) || []);
      setInstances((instancesRes.data as WAInstance[]) || []);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [user, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh running campaigns
  useEffect(() => {
    const hasRunning = campaigns.some(c => c.status === 'running');
    if (!hasRunning) return;
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [campaigns, fetchData]);

  const deleteList = async () => {
    if (!deleteListId) return;
    setIsDeletingList(true);
    try {
      await supabase.from('wa_contacts').delete().eq('list_id', deleteListId);
      await supabase.from('wa_contact_lists').delete().eq('id', deleteListId);
      toast({ title: '🗑️ Lista excluída' });
      setDeleteListId(null);
      fetchData();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsDeletingList(false);
    }
  };

  const totalContacts = lists.reduce((sum, l) => sum + l.contact_count, 0);
  const totalSent = campaigns.reduce((sum, c) => sum + c.sent_count, 0);
  const totalFailed = campaigns.reduce((sum, c) => sum + c.failed_count, 0);

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl flex items-center gap-2">
              <Send className="h-7 w-7 text-primary" />
              Disparo em Massa
            </h1>
            <p className="text-muted-foreground">
              Campanhas inteligentes com IA, rodízio de números e comportamento humano
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowUpload(true)}>
              <Upload className="h-4 w-4 mr-2" /> Importar Contatos
            </Button>
            <Button onClick={() => setShowNewCampaign(true)}>
              <Plus className="h-4 w-4 mr-2" /> Nova Campanha
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: MessageCircle, label: 'Campanhas', value: campaigns.length, color: 'text-primary', bg: 'bg-primary/10' },
            { icon: Users, label: 'Contatos', value: totalContacts, color: 'text-blue-500', bg: 'bg-blue-500/10' },
            { icon: CheckCircle, label: 'Enviadas', value: totalSent, color: 'text-green-500', bg: 'bg-green-500/10' },
            { icon: XCircle, label: 'Falhas', value: totalFailed, color: 'text-destructive', bg: 'bg-destructive/10' },
          ].map(stat => (
            <Card key={stat.label} className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${stat.bg}`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="campaigns" className="w-full">
          <TabsList>
            <TabsTrigger value="campaigns" className="flex items-center gap-1">
              <Zap className="h-4 w-4" /> Campanhas
            </TabsTrigger>
            <TabsTrigger value="lists" className="flex items-center gap-1">
              <List className="h-4 w-4" /> Listas ({lists.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns" className="mt-4 space-y-4">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : campaigns.length === 0 ? (
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                  <Send className="h-12 w-12 text-muted-foreground" />
                  <div className="text-center">
                    <p className="font-medium">Nenhuma campanha criada</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Importe contatos e crie sua primeira campanha de disparo
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setShowUpload(true)}>
                      <Upload className="h-4 w-4 mr-2" /> Importar Contatos
                    </Button>
                    <Button onClick={() => setShowNewCampaign(true)}>
                      <Plus className="h-4 w-4 mr-2" /> Nova Campanha
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              campaigns.map(campaign => (
                <CampaignCard key={campaign.id} campaign={campaign} onRefresh={fetchData} />
              ))
            )}
          </TabsContent>

          <TabsContent value="lists" className="mt-4 space-y-4">
            {lists.length === 0 ? (
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                  <Users className="h-12 w-12 text-muted-foreground" />
                  <div className="text-center">
                    <p className="font-medium">Nenhuma lista de contatos</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Importe um arquivo CSV com seus contatos
                    </p>
                  </div>
                  <Button onClick={() => setShowUpload(true)}>
                    <Upload className="h-4 w-4 mr-2" /> Importar CSV
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {lists.map(list => (
                  <Card key={list.id} className="border-border/50 bg-card/50 backdrop-blur-sm">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                          <Users className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{list.name}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="secondary" className="text-[10px]">{list.contact_count} contatos</Badge>
                            <span>•</span>
                            <span>{list.source === 'csv_upload' ? 'CSV' : list.source}</span>
                            <span>•</span>
                            <span>{new Date(list.created_at).toLocaleDateString('pt-BR')}</span>
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteListId(list.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialogs */}
      {user && (
        <>
          <CSVUploadDialog
            open={showUpload}
            onOpenChange={setShowUpload}
            userId={user.id}
            onUploadComplete={fetchData}
          />
          <NewCampaignDialog
            open={showNewCampaign}
            onOpenChange={setShowNewCampaign}
            userId={user.id}
            lists={lists}
            instances={instances}
            onCreated={fetchData}
          />
        </>
      )}

      <AlertDialog open={!!deleteListId} onOpenChange={() => setDeleteListId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lista?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos os contatos desta lista serão removidos. Esta ação é irreversível.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={deleteList} disabled={isDeletingList} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isDeletingList ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
