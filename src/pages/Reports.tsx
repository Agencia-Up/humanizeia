import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Clock, Send, Eye, Trash2, History, CheckCircle, XCircle, Settings2, AlertTriangle, Plug, Download, Palette } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { ReportPreview } from '@/components/reports/ReportPreview';
import { WhatsAppRecipientDialog } from '@/components/reports/WhatsAppRecipientDialog';
import { ScheduleTemplateCard } from '@/components/reports/ScheduleTemplateCard';
import { EvolutionConnectDialog } from '@/components/evolution/EvolutionConnectDialog';

const AVAILABLE_METRICS = [
  { tipo: 'spend', label: 'Gasto Total', emoji: '💰', formato: 'currency' },
  { tipo: 'purchases', label: 'Compras', emoji: '🛒', formato: 'number' },
  { tipo: 'revenue', label: 'Receita', emoji: '💵', formato: 'currency' },
  { tipo: 'cpa', label: 'CPA', emoji: '💰', formato: 'currency' },
  { tipo: 'roas', label: 'ROAS', emoji: '📈', formato: 'multiplier' },
  { tipo: 'ctr', label: 'CTR', emoji: '📊', formato: 'percent' },
  { tipo: 'cpc', label: 'CPC', emoji: '💲', formato: 'currency' },
  { tipo: 'cpm', label: 'CPM', emoji: '📉', formato: 'currency' },
  { tipo: 'reach', label: 'Alcance', emoji: '👥', formato: 'number' },
  { tipo: 'frequency', label: 'Frequência', emoji: '🔄', formato: 'multiplier' },
  { tipo: 'impressions', label: 'Impressões', emoji: '👁', formato: 'number' },
  { tipo: 'clicks', label: 'Cliques', emoji: '🖱', formato: 'number' },
  { tipo: 'campaign_breakdown', label: 'Top Campanhas', emoji: '🎯', formato: 'text' },
];

export default function Reports() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [previewMessage, setPreviewMessage] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [setupWhatsAppOpen, setSetupWhatsAppOpen] = useState(false);
  const [pendingDestinatarioIds, setPendingDestinatarioIds] = useState<string[]>([]);

  // Form state for new template
  const [formNome, setFormNome] = useState('');
  const [formDescricao, setFormDescricao] = useState('');
  const [formHeader, setFormHeader] = useState('📊 *Report Meta Ads — {{data}}*');
  const [formFooter, setFormFooter] = useState('✅ Report gerado por MIDAS AI');
  const [formMetricas, setFormMetricas] = useState(
    AVAILABLE_METRICS.filter(m => ['spend', 'purchases', 'cpa', 'roas', 'revenue'].includes(m.tipo))
  );

  // Queries
  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['report-templates', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('report_templates').select('*').order('ordem');
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const { data: historico = [], isLoading: historicoLoading } = useQuery({
    queryKey: ['historico-reports', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('historico_reports')
        .select('*, report_templates(nome)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const { data: whatsappConfig } = useQuery({
    queryKey: ['whatsapp-config', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('whatsapp_config')
        .select('id, is_active')
        .eq('user_id', user!.id)
        .eq('is_active', true)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const whatsappConfigured = !!whatsappConfig;

  // Mutations
  const createTemplate = useMutation({
    mutationFn: async () => {
      if (!formNome) throw new Error('Nome é obrigatório');
      const { error } = await supabase.from('report_templates').insert({
        user_id: user!.id,
        nome: formNome,
        descricao: formDescricao,
        header_template: formHeader,
        footer_template: formFooter,
        metricas: formMetricas,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-templates'] });
      setCreateOpen(false);
      setFormNome('');
      setFormDescricao('');
      toast.success('Template criado!');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('report_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-templates'] });
      toast.success('Template removido');
    },
  });

  const updateTemplate = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase.from('report_templates').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['report-templates'] }),
  });

  const sendManual = useMutation({
    mutationFn: async (destinatarioIds: string[]) => {
      const { data, error } = await supabase.functions.invoke('enviar-report-midas', {
        body: { action: 'send_manual', template_id: selectedTemplateId, destinatario_ids: destinatarioIds },
      });
      if (error) {
        // For FunctionsHttpError, try to extract the JSON body
        let errorMsg = error.message;
        try {
          const ctx = (error as any).context;
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            errorMsg = body?.error || errorMsg;
          }
        } catch {}
        throw new Error(errorMsg);
      }
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['historico-reports'] });
      setSendDialogOpen(false);
      toast.success(`Report enviado para ${data.results?.length || 0} destinatário(s)!`);
    },
    onError: (err: any) => {
      const msg = err.message || '';
      if (msg.includes('WhatsApp não configurado') || msg.includes('WhatsApp nao configurado')) {
        setSetupWhatsAppOpen(true);
      } else {
        toast.error(msg);
      }
    },
  });

  const handleEvolutionConnected = () => {
    if (pendingDestinatarioIds.length > 0) {
      sendManual.mutate(pendingDestinatarioIds);
    }
  };

  const handlePreview = async (templateId: string) => {
    setPreviewLoading(true);
    setSelectedTemplateId(templateId);
    try {
      const { data, error } = await supabase.functions.invoke('enviar-report-midas', {
        body: { action: 'preview', template_id: templateId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPreviewMessage(data.message);
    } catch (err: any) {
      toast.error(`Erro no preview: ${err.message}`);
      setPreviewMessage('');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleOpenSend = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setSendDialogOpen(true);
  };

  const toggleMetric = (metric: typeof AVAILABLE_METRICS[0]) => {
    setFormMetricas(prev => {
      const exists = prev.find(m => m.tipo === metric.tipo);
      if (exists) return prev.filter(m => m.tipo !== metric.tipo);
      return [...prev, metric];
    });
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl">Relatórios Automáticos</h1>
            <p className="text-muted-foreground">Crie e envie relatórios dos seus anúncios direto no WhatsApp</p>
          </div>
          <Button className="gradient-primary" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Novo Template
          </Button>
        </div>

        {/* ── Início Rápido ── */}
        {templates.length === 0 && !templatesLoading && (
          <div className="rounded-xl border border-border/50 bg-card/50 p-5 space-y-4">
            <div>
              <p className="text-sm font-semibold text-foreground mb-1">🚀 Comece com um modelo pronto</p>
              <p className="text-xs text-muted-foreground">Clique em um modelo abaixo para criar seu primeiro relatório em segundos</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  emoji: '📅',
                  label: 'Relatório Diário',
                  description: 'Resumo rápido do dia: gasto, cliques e CPC',
                  nome: 'Relatório Diário',
                  metricas: AVAILABLE_METRICS.filter(m => ['spend', 'clicks', 'cpc'].includes(m.tipo)),
                },
                {
                  emoji: '📊',
                  label: 'Relatório Semanal',
                  description: 'Visão completa da semana com compras e ROAS',
                  nome: 'Relatório Semanal',
                  metricas: AVAILABLE_METRICS.filter(m => ['spend', 'purchases', 'roas', 'cpa'].includes(m.tipo)),
                },
                {
                  emoji: '📈',
                  label: 'Relatório Mensal',
                  description: 'Análise completa do mês com todas as métricas',
                  nome: 'Relatório Mensal Completo',
                  metricas: AVAILABLE_METRICS.filter(m => ['spend', 'purchases', 'revenue', 'roas', 'cpa', 'ctr', 'campaign_breakdown'].includes(m.tipo)),
                },
              ].map((tpl) => (
                <button
                  key={tpl.label}
                  onClick={() => {
                    setFormNome(tpl.nome);
                    setFormMetricas(tpl.metricas);
                    setCreateOpen(true);
                  }}
                  className="group flex flex-col gap-2 rounded-lg border border-border/40 bg-background/50 p-4 text-left transition-all hover:border-primary/40 hover:bg-primary/5"
                >
                  <span className="text-2xl">{tpl.emoji}</span>
                  <p className="text-sm font-semibold text-foreground">{tpl.label}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{tpl.description}</p>
                  <span className="mt-1 text-xs text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">Usar este modelo →</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!whatsappConfigured && (
          <Alert variant="destructive" className="border-orange-500/50 bg-orange-500/10 text-orange-200">
            <AlertTriangle className="h-4 w-4 !text-orange-400" />
            <AlertTitle className="text-orange-300">Uazapi não conectada</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>Conecte sua Uazapi para enviar reports via WhatsApp.</span>
              <Button size="sm" variant="outline" className="ml-4 border-orange-500/50 text-orange-300 hover:bg-orange-500/20" onClick={() => setSetupWhatsAppOpen(true)}>
                <Plug className="mr-1.5 h-3.5 w-3.5" /> Conectar Uazapi
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="templates">
          <TabsList className="flex-wrap">
            <TabsTrigger value="templates"><Settings2 className="mr-1.5 h-4 w-4" /> Templates</TabsTrigger>
            <TabsTrigger value="agendamento"><Clock className="mr-1.5 h-4 w-4" /> Agendamento</TabsTrigger>
            <TabsTrigger value="pdf"><Download className="mr-1.5 h-4 w-4" /> PDF / Branding</TabsTrigger>
            <TabsTrigger value="historico"><History className="mr-1.5 h-4 w-4" /> Histórico</TabsTrigger>
          </TabsList>

          {/* ── Tab: Templates ── */}
          <TabsContent value="templates" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">Seus Templates</h2>
                {templatesLoading ? <Skeleton className="h-40 w-full" /> : templates.length === 0 ? (
                  <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                    <CardContent className="py-8 text-center text-muted-foreground">
                      Nenhum template criado. Clique em "Novo Template" para começar.
                    </CardContent>
                  </Card>
                ) : (
                  templates.map((tpl: any, index: number) => (
                    <motion.div key={tpl.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="font-medium">{tpl.nome}</h3>
                              {tpl.descricao && <p className="text-sm text-muted-foreground mt-1">{tpl.descricao}</p>}
                              <div className="mt-2 flex flex-wrap gap-1">
                                {(tpl.metricas || []).map((m: any) => (
                                  <Badge key={m.tipo} variant="secondary" className="text-xs">
                                    {m.emoji} {m.label}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handlePreview(tpl.id)}>
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleOpenSend(tpl.id)}>
                                <Send className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => deleteTemplate.mutate(tpl.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))
                )}
              </div>

              <ReportPreview message={previewMessage} isLoading={previewLoading} />
            </div>
          </TabsContent>

          {/* ── Tab: Agendamento ── */}
          <TabsContent value="agendamento" className="space-y-4">
            <h2 className="text-lg font-semibold">Agendamento de Disparos</h2>
            {templatesLoading ? <Skeleton className="h-40 w-full" /> : templates.length === 0 ? (
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardContent className="py-8 text-center text-muted-foreground">
                  Crie um template primeiro para configurar agendamentos.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {templates.map((tpl: any) => (
                  <ScheduleTemplateCard
                    key={tpl.id}
                    template={tpl}
                    onToggleSchedule={(id, ativo) => updateTemplate.mutate({ id, updates: { agendamento_ativo: ativo } })}
                    onChangeTime={(id, time) => updateTemplate.mutate({ id, updates: { horario_envio: time } })}
                    onToggleDay={(id, days) => updateTemplate.mutate({ id, updates: { dias_envio: days } })}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Tab: PDF / Branding ── */}
          <TabsContent value="pdf" className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Palette className="h-5 w-5 text-primary" />
                    Branding do PDF
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Nome da Empresa</Label>
                    <Input placeholder="Minha Agência" />
                  </div>
                  <div>
                    <Label>URL do Logo (para cabeçalho do PDF)</Label>
                    <Input placeholder="https://example.com/logo.png" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Cor Primária</Label>
                      <div className="flex gap-2 items-center mt-1">
                        <input type="color" defaultValue="#06b6d4" className="h-8 w-8 rounded cursor-pointer border-0" />
                        <Input defaultValue="#06b6d4" className="font-mono text-xs" />
                      </div>
                    </div>
                    <div>
                      <Label>Cor Secundária</Label>
                      <div className="flex gap-2 items-center mt-1">
                        <input type="color" defaultValue="#f97316" className="h-8 w-8 rounded cursor-pointer border-0" />
                        <Input defaultValue="#f97316" className="font-mono text-xs" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label>Texto de Rodapé</Label>
                    <Input placeholder="Relatório gerado por MIDAS AI" defaultValue="Relatório gerado por MIDAS AI" />
                  </div>
                  <Button className="w-full gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Salvar Branding
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Download className="h-5 w-5 text-primary" />
                    Gerar PDF Manual
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Selecione um template e gere um PDF com suas métricas atuais, pronto para download ou envio.
                  </p>
                  {templates.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">Crie um template primeiro.</p>
                  ) : (
                    <>
                      <div>
                        <Label>Template</Label>
                        <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm mt-1">
                          {templates.map((t: any) => (
                            <option key={t.id} value={t.id}>{t.nome}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="outline" className="gap-2">
                          <Eye className="h-4 w-4" />
                          Preview
                        </Button>
                        <Button className="gap-2">
                          <Download className="h-4 w-4" />
                          Baixar PDF
                        </Button>
                      </div>
                    </>
                  )}

                  <div className="pt-4 border-t border-border/50">
                    <h4 className="text-sm font-medium mb-2">Formatos de Agendamento</h4>
                    <div className="space-y-2">
                      {[
                        { label: 'Diário', desc: 'Enviado todo dia no horário configurado', badge: '📅' },
                        { label: 'Semanal', desc: 'Enviado na segunda-feira com resumo da semana', badge: '📊' },
                        { label: 'Mensal', desc: 'Enviado no 1º dia do mês com overview completo', badge: '📈' },
                      ].map(f => (
                        <div key={f.label} className="flex items-center gap-3 rounded-lg border border-border/40 p-3 bg-muted/20">
                          <span className="text-lg">{f.badge}</span>
                          <div>
                            <p className="text-sm font-medium">{f.label}</p>
                            <p className="text-xs text-muted-foreground">{f.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Tab: Histórico ── */}
          <TabsContent value="historico" className="space-y-4">
            <h2 className="text-lg font-semibold">Histórico de Envios</h2>
            {historicoLoading ? <Skeleton className="h-40 w-full" /> : historico.length === 0 ? (
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardContent className="py-8 text-center text-muted-foreground">
                  Nenhum envio realizado ainda.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {historico.map((h: any) => (
                  <Card key={h.id} className="border-border/50 bg-card/50 backdrop-blur-sm">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {h.status === 'sucesso' ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          ) : (
                            <XCircle className="h-5 w-5 text-destructive" />
                          )}
                          <div>
                            <p className="font-medium">{(h as any).report_templates?.nome || 'Template removido'}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                              <Badge variant={h.status === 'sucesso' ? 'default' : 'destructive'} className="text-xs">
                                {h.status}
                              </Badge>
                              <span>{h.canal}</span>
                              <span>{(h.detalhes as any)?.destinatario}</span>
                              <span>{new Date(h.created_at).toLocaleString('pt-BR')}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      {h.status === 'erro' && (h.detalhes as any)?.error && (
                        <p className="mt-2 text-xs text-destructive">{(h.detalhes as any).error}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* ── Create Template Dialog ── */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Novo Template de Report</DialogTitle>
              <DialogDescription>Configure as métricas e formato da mensagem</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Nome</Label>
                <Input value={formNome} onChange={e => setFormNome(e.target.value)} placeholder="Ex: Report Diário" />
              </div>
              <div>
                <Label>Descrição (opcional)</Label>
                <Input value={formDescricao} onChange={e => setFormDescricao(e.target.value)} placeholder="Ex: Resumo de métricas diárias" />
              </div>
              <div>
                <Label>Header (use {'{{data}}'} e {'{{mes}}'})</Label>
                <Textarea value={formHeader} onChange={e => setFormHeader(e.target.value)} rows={2} />
              </div>
              <div>
                <Label>Footer</Label>
                <Input value={formFooter} onChange={e => setFormFooter(e.target.value)} />
              </div>
              <div>
                <Label>Métricas</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {AVAILABLE_METRICS.map(m => (
                    <Badge
                      key={m.tipo}
                      variant={formMetricas.find(fm => fm.tipo === m.tipo) ? 'default' : 'outline'}
                      className="cursor-pointer text-xs"
                      onClick={() => toggleMetric(m)}
                    >
                      {m.emoji} {m.label}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
              <Button onClick={() => createTemplate.mutate()} disabled={createTemplate.isPending} className="gradient-primary">
                {createTemplate.isPending ? 'Criando...' : 'Criar Template'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Send Dialog ── */}
        {selectedTemplateId && (
          <WhatsAppRecipientDialog
            open={sendDialogOpen}
            onOpenChange={setSendDialogOpen}
            templateId={selectedTemplateId}
            onSend={(ids) => {
              setPendingDestinatarioIds(ids);
              sendManual.mutate(ids);
            }}
            isSending={sendManual.isPending}
          />
        )}

        {/* ── Evolution Connect Dialog ── */}
        <EvolutionConnectDialog
          open={setupWhatsAppOpen}
          onOpenChange={setSetupWhatsAppOpen}
          onConnected={handleEvolutionConnected}
        />
      </div>
    </MainLayout>
  );
}
