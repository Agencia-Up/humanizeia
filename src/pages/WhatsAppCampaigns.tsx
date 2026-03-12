import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import {
  Plus, Loader2, Play, Pause, Trash2, Eye, Sparkles, Send,
  Clock, MessageCircle, RotateCcw, Megaphone,
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
  min_delay_seconds: number;
  max_delay_seconds: number;
  rotation_messages_per_instance: number;
  total_contacts: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  created_at: string;
}

interface ContactList {
  id: string;
  name: string;
  contact_count: number;
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
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [aiVariations, setAiVariations] = useState<string[]>([]);

  // Form state
  const [formName, setFormName] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [formTemplate, setFormTemplate] = useState('');
  const [formSelectedLists, setFormSelectedLists] = useState<string[]>([]);
  const [formDelayMin, setFormDelayMin] = useState(5);
  const [formDelayMax, setFormDelayMax] = useState(15);
  const [formRotation, setFormRotation] = useState(10);
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

  useEffect(() => {
    fetchCampaigns();
    fetchLists();
  }, [fetchCampaigns, fetchLists]);

  const resetForm = () => {
    setFormName('');
    setFormPrompt('');
    setFormTemplate('');
    setFormSelectedLists([]);
    setFormDelayMin(5);
    setFormDelayMax(15);
    setFormRotation(10);
  };

  const handleCreate = async () => {
    if (!user) return;
    if (!formName.trim()) {
      toast({ title: 'Nome obrigatório', variant: 'destructive' });
      return;
    }
    if (!formTemplate.trim() && !formPrompt.trim()) {
      toast({ title: 'Informe a mensagem base ou o prompt para IA', variant: 'destructive' });
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('wa_campaigns').insert({
      user_id: user.id,
      name: formName.trim(),
      message_template: formTemplate.trim() || `[IA] ${formPrompt.trim().slice(0, 100)}`,
      prompt_base: formPrompt.trim() || null,
      list_ids: formSelectedLists,
      min_delay_seconds: formDelayMin,
      max_delay_seconds: formDelayMax,
      rotation_messages_per_instance: formRotation,
      status: 'draft',
    } as any);

    setSaving(false);
    if (error) {
      toast({ title: 'Erro ao criar campanha', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Campanha criada com sucesso!' });
      resetForm();
      setDialogOpen(false);
      fetchCampaigns();
    }
  };

  const handleGeneratePreview = async () => {
    if (!formPrompt.trim()) {
      toast({ title: 'Escreva o prompt base antes de gerar prévia', variant: 'destructive' });
      return;
    }
    try {
      const response = await sendSingleMessage(
        `Gere exatamente 3 variações de mensagem de WhatsApp com base nesta intenção: "${formPrompt}". 
Cada variação deve ser humanizada, pessoal e diferente das outras. 
Use emojis com moderação. Separe cada variação com "---".
Não numere as variações. Não inclua explicações adicionais.`
      );
      const variations = response.split('---').map(v => v.trim()).filter(Boolean);
      setAiVariations(variations);
      setPreviewOpen(true);
    } catch {
      toast({ title: 'Erro ao gerar variações', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('wa_campaigns').delete().eq('id', id);
    if (!error) {
      setCampaigns(prev => prev.filter(c => c.id !== id));
      toast({ title: 'Campanha excluída' });
    }
  };

  const toggleList = (listId: string) => {
    setFormSelectedLists(prev =>
      prev.includes(listId) ? prev.filter(id => id !== listId) : [...prev, listId]
    );
  };

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

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" onClick={() => { resetForm(); setDialogOpen(true); }}>
                <Plus className="h-4 w-4" /> Nova Campanha
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Criar Nova Campanha</DialogTitle>
              </DialogHeader>

              <div className="space-y-5 py-2">
                {/* Nome */}
                <div className="space-y-2">
                  <Label htmlFor="campaign-name">Nome da Campanha *</Label>
                  <Input
                    id="campaign-name"
                    placeholder="Ex: Black Friday 2026"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    maxLength={100}
                  />
                </div>

                {/* Listas de Contatos */}
                <div className="space-y-2">
                  <Label>Listas de Contatos</Label>
                  {contactLists.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma lista encontrada. Crie listas na página de Contatos.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto border rounded-md p-3">
                      {contactLists.map(list => (
                        <label key={list.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded p-1.5">
                          <Checkbox
                            checked={formSelectedLists.includes(list.id)}
                            onCheckedChange={() => toggleList(list.id)}
                          />
                          <span className="truncate">{list.name}</span>
                          <Badge variant="secondary" className="ml-auto text-xs">{list.contact_count}</Badge>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Prompt base IA */}
                <div className="space-y-2">
                  <Label htmlFor="prompt-base" className="flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Prompt Base para IA
                  </Label>
                  <Textarea
                    id="prompt-base"
                    placeholder="Descreva a intenção da mensagem. Ex: Oferecer 30% de desconto no plano anual para leads que demonstraram interesse..."
                    value={formPrompt}
                    onChange={e => setFormPrompt(e.target.value)}
                    rows={3}
                    maxLength={2000}
                  />
                  <p className="text-xs text-muted-foreground">
                    A IA gerará variações únicas para cada envio com base neste prompt.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={handleGeneratePreview}
                    disabled={aiLoading || !formPrompt.trim()}
                  >
                    {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                    Pré-visualizar Variações
                  </Button>
                </div>

                {/* Mensagem template (fallback) */}
                <div className="space-y-2">
                  <Label htmlFor="message-template">Mensagem Fixa (opcional se usar IA)</Label>
                  <Textarea
                    id="message-template"
                    placeholder="Mensagem fixa caso não queira usar variações de IA..."
                    value={formTemplate}
                    onChange={e => setFormTemplate(e.target.value)}
                    rows={3}
                    maxLength={4000}
                  />
                </div>

                {/* Delay */}
                <div className="space-y-3">
                  <Label className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    Delay entre mensagens
                  </Label>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <span className="text-xs text-muted-foreground">Mínimo: {formDelayMin}s</span>
                      <Slider
                        value={[formDelayMin]}
                        onValueChange={([v]) => { setFormDelayMin(v); if (v > formDelayMax) setFormDelayMax(v); }}
                        min={1}
                        max={120}
                        step={1}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-xs text-muted-foreground">Máximo: {formDelayMax}s</span>
                      <Slider
                        value={[formDelayMax]}
                        onValueChange={([v]) => { setFormDelayMax(v); if (v < formDelayMin) setFormDelayMin(v); }}
                        min={1}
                        max={120}
                        step={1}
                      />
                    </div>
                  </div>
                </div>

                {/* Rodízio */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <RotateCcw className="h-4 w-4 text-muted-foreground" />
                    Rodízio de Instâncias
                  </Label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min={1}
                      max={500}
                      value={formRotation}
                      onChange={e => setFormRotation(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">mensagens por instância antes de trocar</span>
                  </div>
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                <Button onClick={handleCreate} disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Criar Campanha
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* AI Variations Preview Dialog */}
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
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-center">Contatos</TableHead>
                      <TableHead className="text-center">Enviados</TableHead>
                      <TableHead className="text-center">IA</TableHead>
                      <TableHead>Criada em</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map(c => {
                      const st = statusMap[c.status] || statusMap.draft;
                      return (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium max-w-[200px] truncate">{c.name}</TableCell>
                          <TableCell>
                            <Badge variant={st.variant}>{st.label}</Badge>
                          </TableCell>
                          <TableCell className="text-center">{c.total_contacts}</TableCell>
                          <TableCell className="text-center">
                            {c.sent_count}/{c.total_contacts}
                          </TableCell>
                          <TableCell className="text-center">
                            {c.prompt_base ? (
                              <Sparkles className="h-4 w-4 text-primary mx-auto" />
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(c.created_at), 'dd/MM/yy HH:mm', { locale: ptBR })}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleDelete(c.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
