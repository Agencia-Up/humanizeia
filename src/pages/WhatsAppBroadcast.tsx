import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { CampaignFormDialog, CampaignFormData } from '@/components/whatsapp/CampaignFormDialog';
import {
  Send, Plus, CheckCircle, XCircle, MessageCircle, Users,
  Upload, Loader2, Trash2, List, Zap, Sparkles, Pencil, Check, X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { CSVUploadDialog } from '@/components/broadcast/CSVUploadDialog';
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
  status: string;
}

export default function WhatsAppBroadcast() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<WACampaign[]>([]);
  const [lists, setLists] = useState<ContactList[]>([]);
  const [instances, setInstances] = useState<WAInstance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteListId, setDeleteListId] = useState<string | null>(null);
  const [isDeletingList, setIsDeletingList] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<(CampaignFormData & { id: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [aiVariations, setAiVariations] = useState<string[]>([]);
  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const { sendSingleMessage, isLoading: aiLoading } = useClaudeChat({
    context: 'copywriter',
    config: { creativity: 0.8, variations: 3 },
  });

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
          .select('id, name, contact_count, source, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('wa_instances')
          .select('id, friendly_name, phone_number, is_active, health_score, provider, status')
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

  // Campaign form submit (create or edit)
  const handleFormSubmit = async (data: CampaignFormData) => {
    if (!user) return;
    if (!data.name.trim()) {
      toast({ title: 'Nome obrigatório', variant: 'destructive' });
      return;
    }
    if (!data.message_template.trim() && !data.prompt_base.trim()) {
      toast({ title: 'Informe a mensagem base ou o prompt para IA', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        campaign_id: editingCampaign?.id || null,
        name: data.name.trim(),
        message_template: data.message_template.trim(),
        prompt_base: data.prompt_base.trim() || null,
        listas_alvo: data.listas_alvo,
        regras_delay: data.regras_delay,
        regras_rodizio: data.regras_rodizio,
        regras_aquecimento: data.regras_aquecimento,
        start_time: data.start_time,
        end_time: data.end_time,
        instance_id: data.instance_id,
        media_url: data.media_url || null,
        media_type: data.media_type || null,
        tags: data.tags.length > 0 ? data.tags : null,
        variation_level: data.variation_level || 'medium',
        include_optout_buttons: data.include_optout_buttons ?? false,
      };

      const { data: result, error } = await supabase.functions.invoke('save-campaign', {
        body: payload,
      });

      if (error) throw error;
      if (result?.error) {
        const details = result.details ? `\n${(result.details as string[]).join('\n')}` : '';
        toast({ title: result.error, description: details, variant: 'destructive' });
        setSaving(false);
        return;
      }

      toast({ title: editingCampaign ? '✅ Campanha atualizada!' : '✅ Campanha criada!' });
      setEditingCampaign(null);
      setDialogOpen(false);
      fetchData();
    } catch (err: any) {
      toast({ title: 'Erro ao salvar campanha', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePreview = async (prompt: string) => {
    if (!prompt.trim()) {
      toast({ title: 'Escreva o prompt base antes de gerar prévia', variant: 'destructive' });
      return;
    }
    try {
      const response = await sendSingleMessage(
        `Gere exatamente 3 variações de mensagem de WhatsApp com base nesta intenção: "${prompt}". 
Cada variação deve ser humanizada, pessoal e diferente das outras. 
Use emojis com moderação. Separe cada variação com "---".
Não numere as variações. Não inclua explicações adicionais.`
      );
      const variations = response.split('---').map((v: string) => v.trim()).filter(Boolean);
      setAiVariations(variations);
      setPreviewOpen(true);
    } catch {
      toast({ title: 'Erro ao gerar variações', variant: 'destructive' });
    }
  };

  const handleEdit = (campaign: any) => {
    setEditingCampaign({
      id: campaign.id,
      name: campaign.name,
      prompt_base: campaign.prompt_base || '',
      message_template: campaign.message_template,
      listas_alvo: campaign.listas_alvo || campaign.list_ids || [],
      regras_delay: campaign.regras_delay || { min: campaign.min_delay_seconds, max: campaign.max_delay_seconds },
      regras_rodizio: campaign.regras_rodizio || { mensagens_por_instancia: campaign.rotation_messages_per_instance, pausa_entre_instancias: 300 },
      regras_aquecimento: campaign.regras_aquecimento || { enabled: false, initial_messages: 20 },
      start_time: campaign.start_time || campaign.scheduled_at,
      end_time: campaign.end_time || null,
      instance_id: campaign.instance_id,
      media_url: campaign.media_url || '',
      media_type: campaign.media_type || '',
      tags: campaign.tags || [],
      variation_level: campaign.variation_level || 'medium',
      include_optout_buttons: campaign.include_optout_buttons ?? false,
    });
    setDialogOpen(true);
  };

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
            <Button onClick={() => { setEditingCampaign(null); setDialogOpen(true); }}>
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
                    <Button onClick={() => { setEditingCampaign(null); setDialogOpen(true); }}>
                      <Plus className="h-4 w-4 mr-2" /> Nova Campanha
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              campaigns.map(campaign => (
                <CampaignCard key={campaign.id} campaign={campaign} onRefresh={fetchData} onEdit={handleEdit} />
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

      {/* Campaign Form Dialog (create + edit) */}
      <CampaignFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleFormSubmit}
        onGeneratePreview={handleGeneratePreview}
        contactLists={lists}
        instances={instances}
        saving={saving}
        aiLoading={aiLoading}
        editingCampaign={editingCampaign}
      />

      {/* AI Variations Preview */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Prévia de Variações IA
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {aiVariations.map((v, i) => (
              <Card key={i} className="bg-muted/30">
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground mb-1">Variação {i + 1}</p>
                  <p className="text-sm whitespace-pre-wrap">{v}</p>
                </CardContent>
              </Card>
            ))}
            {aiVariations.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhuma variação gerada ainda.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* CSV Upload Dialog */}
      {user && (
        <CSVUploadDialog
          open={showUpload}
          onOpenChange={setShowUpload}
          userId={user.id}
          onUploadComplete={fetchData}
        />
      )}

      {/* Delete list confirm */}
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
