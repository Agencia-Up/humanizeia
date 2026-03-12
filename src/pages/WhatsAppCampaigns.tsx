import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { CampaignFormDialog, CampaignFormData } from '@/components/whatsapp/CampaignFormDialog';
import {
  Plus, Loader2, Play, Pause, Trash2, Sparkles,
  Clock, Megaphone, Pencil, CalendarIcon,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Campaign {
  id: string;
  name: string;
  message_template: string;
  prompt_base: string | null;
  status: string;
  list_ids: string[];
  listas_alvo: string[];
  min_delay_seconds: number;
  max_delay_seconds: number;
  rotation_messages_per_instance: number;
  regras_delay: { min: number; max: number } | null;
  regras_rodizio: { mensagens_por_instancia: number; pausa_entre_instancias: number } | null;
  regras_aquecimento: { enabled: boolean; initial_messages: number } | null;
  total_contacts: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  created_at: string;
  scheduled_at: string | null;
  start_time: string | null;
  end_time: string | null;
  instance_id: string | null;
  media_url: string | null;
  media_type: string | null;
  tags: string[] | null;
}

interface ContactList {
  id: string;
  name: string;
  contact_count: number;
}

interface WaInstance {
  id: string;
  friendly_name: string;
  phone_number: string | null;
  status: string;
}

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'Rascunho', variant: 'secondary' },
  scheduled: { label: 'Agendada', variant: 'outline' },
  running: { label: 'Em execução', variant: 'default' },
  paused: { label: 'Pausada', variant: 'outline' },
  completed: { label: 'Concluída', variant: 'secondary' },
  cancelled: { label: 'Cancelada', variant: 'destructive' },
};

export default function WhatsAppCampaigns() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [instances, setInstances] = useState<WaInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [aiVariations, setAiVariations] = useState<string[]>([]);
  const [editingCampaign, setEditingCampaign] = useState<(CampaignFormData & { id: string }) | null>(null);
  const [saving, setSaving] = useState(false);

  const { sendSingleMessage, isLoading: aiLoading } = useClaudeChat({
    context: 'copywriter',
    config: { creativity: 0.8, variations: 3 },
  });

  const fetchCampaigns = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('wa_campaigns')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (!error && data) setCampaigns(data as unknown as Campaign[]);
    setLoading(false);
  }, [user]);

  const fetchLists = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('wa_contact_lists')
      .select('id, name, contact_count')
      .eq('user_id', user.id)
      .order('name');
    if (data) setContactLists(data);
  }, [user]);

  const fetchInstances = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('wa_instances')
      .select('id, friendly_name, phone_number, status')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('friendly_name');
    if (data) setInstances(data);
  }, [user]);

  useEffect(() => {
    fetchCampaigns();
    fetchLists();
    fetchInstances();
  }, [fetchCampaigns, fetchLists, fetchInstances]);

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

      toast({ title: editingCampaign ? 'Campanha atualizada!' : 'Campanha criada com sucesso!' });
      setEditingCampaign(null);
      setDialogOpen(false);
      fetchCampaigns();
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

  const handleEdit = (c: Campaign) => {
    setEditingCampaign({
      id: c.id,
      name: c.name,
      prompt_base: c.prompt_base || '',
      message_template: c.message_template,
      listas_alvo: c.listas_alvo || c.list_ids || [],
      regras_delay: c.regras_delay || { min: c.min_delay_seconds, max: c.max_delay_seconds },
      regras_rodizio: c.regras_rodizio || { mensagens_por_instancia: c.rotation_messages_per_instance, pausa_entre_instancias: 300 },
      regras_aquecimento: c.regras_aquecimento || { enabled: false, initial_messages: 20 },
      start_time: c.start_time || c.scheduled_at,
      end_time: c.end_time || null,
      instance_id: c.instance_id,
      media_url: c.media_url || '',
      media_type: c.media_type || '',
      tags: c.tags || [],
    });
    setDialogOpen(true);
  };

  const handleStartCampaign = async (id: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('enqueue-campaign', {
        body: { campaign_id: id },
      });
      if (error) throw error;
      toast({ title: 'Campanha iniciada!', description: `${data.enqueued} contatos enfileirados.` });
      fetchCampaigns();
    } catch (err: any) {
      toast({ title: 'Erro ao iniciar campanha', description: err.message, variant: 'destructive' });
    }
  };

  const handlePauseCampaign = async (id: string) => {
    const { error } = await supabase.from('wa_campaigns').update({ status: 'paused' } as any).eq('id', id);
    if (!error) {
      toast({ title: 'Campanha pausada' });
      fetchCampaigns();
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('wa_campaigns').delete().eq('id', id);
    if (!error) {
      setCampaigns(prev => prev.filter(c => c.id !== id));
      toast({ title: 'Campanha excluída' });
    }
  };

  const getProgressPercent = (c: Campaign) => c.total_contacts > 0 ? Math.round((c.sent_count / c.total_contacts) * 100) : 0;

  return (
    <MainLayout>
      <div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Megaphone className="h-6 w-6 text-primary" />
              Campanhas WhatsApp
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Crie e gerencie suas campanhas de disparo com IA
            </p>
          </div>
          <Button className="gap-2" onClick={() => { setEditingCampaign(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Nova Campanha
          </Button>
        </div>

        {/* Form Dialog */}
        <CampaignFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSubmit={handleFormSubmit}
          onGeneratePreview={handleGeneratePreview}
          contactLists={contactLists}
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

        {/* Campaign List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Suas Campanhas</CardTitle>
            <CardDescription>{campaigns.length} campanha(s) encontrada(s)</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : campaigns.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p>Nenhuma campanha criada ainda.</p>
                <p className="text-sm">Clique em "Nova Campanha" para começar.</p>
              </div>
            ) : (
              <TooltipProvider>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Progresso</TableHead>
                        <TableHead className="text-center">IA</TableHead>
                        <TableHead>Período</TableHead>
                        <TableHead>Criada em</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {campaigns.map(c => {
                        const st = statusMap[c.status] || statusMap.draft;
                        const progress = getProgressPercent(c);
                        const periodStart = c.start_time || c.scheduled_at;
                        return (
                          <TableRow key={c.id}>
                            <TableCell className="font-medium max-w-[200px]">
                              <div className="truncate">{c.name}</div>
                              {c.tags && c.tags.length > 0 && (
                                <div className="flex gap-1 mt-1 flex-wrap">
                                  {c.tags.slice(0, 3).map(t => (
                                    <Badge key={t} variant="outline" className="text-[10px] px-1 py-0">{t}</Badge>
                                  ))}
                                  {c.tags.length > 3 && <span className="text-[10px] text-muted-foreground">+{c.tags.length - 3}</span>}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={st.variant}>{st.label}</Badge>
                            </TableCell>
                            <TableCell className="min-w-[150px]">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="space-y-1">
                                    <Progress value={progress} className="h-2" />
                                    <p className="text-xs text-muted-foreground">
                                      {c.sent_count}/{c.total_contacts} ({progress}%)
                                    </p>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>✅ Entregues: {c.delivered_count}</p>
                                  <p>❌ Falhas: {c.failed_count}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TableCell>
                            <TableCell className="text-center">
                              {c.prompt_base ? (
                                <Sparkles className="h-4 w-4 text-primary mx-auto" />
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {periodStart ? (
                                <div className="text-sm text-muted-foreground space-y-0.5">
                                  <div className="flex items-center gap-1">
                                    <CalendarIcon className="h-3.5 w-3.5" />
                                    {format(new Date(periodStart), 'dd/MM HH:mm', { locale: ptBR })}
                                  </div>
                                  {c.end_time && (
                                    <div className="text-xs">
                                      até {format(new Date(c.end_time), 'dd/MM HH:mm', { locale: ptBR })}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {format(new Date(c.created_at), 'dd/MM/yy HH:mm', { locale: ptBR })}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                {(c.status === 'draft' || c.status === 'paused' || c.status === 'scheduled') && (
                                  <Button variant="ghost" size="icon" onClick={() => handleEdit(c)} title="Editar campanha">
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                )}
                                {(c.status === 'draft' || c.status === 'paused') && (
                                  <Button variant="ghost" size="icon" className="text-green-600 hover:text-green-700" onClick={() => handleStartCampaign(c.id)} title="Iniciar campanha">
                                    <Play className="h-4 w-4" />
                                  </Button>
                                )}
                                {c.status === 'running' && (
                                  <Button variant="ghost" size="icon" className="text-yellow-600 hover:text-yellow-700" onClick={() => handlePauseCampaign(c.id)} title="Pausar campanha">
                                    <Pause className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDelete(c.id)} title="Excluir campanha">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </TooltipProvider>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
