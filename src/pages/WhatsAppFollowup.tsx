import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  GitBranch, Plus, Trash2, Loader2, ChevronDown, ChevronRight,
  Clock, CheckCircle2, XCircle, Send, Pencil, RefreshCw,
  MessageSquare, Phone, Calendar,
} from 'lucide-react';

/* ── Tipos ── */
interface SequenceStep {
  id?: string;
  step_order: number;
  delay_hours: number;
  message_text: string;
}

interface Sequence {
  id: string;
  name: string;
  form_id: string;
  instance_id: string | null;
  is_active: boolean;
  created_at: string;
  form?: { title: string };
  instance?: { instance_name: string };
  steps?: SequenceStep[];
}

interface QueueItem {
  id: string;
  phone: string;
  message_content: string;
  status: 'scheduled' | 'sent' | 'failed';
  scheduled_for: string;
  sent_at: string | null;
  last_error: string | null;
  attempt_count: number;
  created_at: string;
  step?: { message_text: string };
}

const STATUS_BADGE: Record<string, { label: string; class: string }> = {
  scheduled: { label: 'Agendado',  class: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  sent:      { label: 'Enviado',   class: 'bg-green-500/15 text-green-400 border-green-500/30' },
  failed:    { label: 'Falhou',    class: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

/* ── Componente principal ── */
export default function WhatsAppFollowup({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [sequences, setSequences]   = useState<Sequence[]>([]);
  const [queue, setQueue]           = useState<QueueItem[]>([]);
  const [instances, setInstances]   = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [expanded, setExpanded]     = useState<string | null>(null);

  /* Editor de sequência */
  const [openEditor, setOpenEditor]     = useState(false);
  const [editSeq, setEditSeq]           = useState<Sequence | null>(null);
  const [steps, setSteps]               = useState<SequenceStep[]>([{ step_order: 1, delay_hours: 0, message_text: '' }]);
  const [seqName, setSeqName]           = useState('');
  const [seqInstance, setSeqInstance]   = useState('');
  const [seqActive, setSeqActive]       = useState(true);
  const [saving, setSaving]             = useState(false);

  /* Filtro fila */
  const [queueFilter, setQueueFilter]   = useState<'all' | 'scheduled' | 'sent' | 'failed'>('all');

  /* ── Fetch ── */
  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [{ data: seqs }, { data: inst }] = await Promise.all([
        (supabase as any)
          .from('followup_sequences')
          .select('*, form:capture_forms(title), instance:wa_instances(instance_name), steps:followup_sequence_steps(*)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        (supabase as any)
          .from('wa_instances')
          .select('id, instance_name')
          .eq('user_id', user.id)
          .eq('is_active', true),
      ]);
      setSequences(
        (seqs || []).map((s: any) => ({
          ...s,
          steps: [...(s.steps || [])].sort((a: any, b: any) => a.step_order - b.step_order),
        }))
      );
      setInstances(inst || []);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchQueue = useCallback(async (filter: typeof queueFilter = 'all') => {
    if (!user) return;
    setLoadingQueue(true);
    try {
      let q = (supabase as any)
        .from('followup_queue')
        .select('*, step:followup_sequence_steps(message_text)')
        .eq('user_id', user.id)
        .order('scheduled_for', { ascending: false })
        .limit(100);
      if (filter !== 'all') q = q.eq('status', filter);
      const { data } = await q;
      setQueue(data || []);
    } finally {
      setLoadingQueue(false);
    }
  }, [user]);

  useEffect(() => { fetchAll(); fetchQueue(); }, [fetchAll, fetchQueue]);

  /* ── Abrir editor ── */
  const openNew = () => {
    setEditSeq(null);
    setSeqName('');
    setSeqInstance('');
    setSeqActive(true);
    setSteps([{ step_order: 1, delay_hours: 0, message_text: '' }]);
    setOpenEditor(true);
  };

  const openEdit = (seq: Sequence) => {
    setEditSeq(seq);
    setSeqName(seq.name);
    setSeqInstance(seq.instance_id || '');
    setSeqActive(seq.is_active);
    setSteps(
      seq.steps && seq.steps.length > 0
        ? seq.steps
        : [{ step_order: 1, delay_hours: 0, message_text: '' }]
    );
    setOpenEditor(true);
  };

  /* ── Salvar sequência ── */
  const handleSave = async () => {
    if (!user || !seqName.trim()) {
      toast({ title: 'Informe o nome da sequência.', variant: 'destructive' }); return;
    }
    if (steps.some(s => !s.message_text.trim())) {
      toast({ title: 'Preencha o texto de todas as mensagens.', variant: 'destructive' }); return;
    }
    setSaving(true);
    try {
      let seqId = editSeq?.id;
      if (!seqId) {
        const { data: newSeq, error } = await (supabase as any)
          .from('followup_sequences')
          .insert({ user_id: user.id, name: seqName, instance_id: seqInstance || null, is_active: seqActive })
          .select('id').single();
        if (error) throw error;
        seqId = newSeq.id;
      } else {
        const { error } = await (supabase as any)
          .from('followup_sequences')
          .update({ name: seqName, instance_id: seqInstance || null, is_active: seqActive })
          .eq('id', seqId);
        if (error) throw error;
      }
      // Re-cria os steps
      await (supabase as any).from('followup_sequence_steps').delete().eq('sequence_id', seqId);
      for (let i = 0; i < steps.length; i++) {
        await (supabase as any).from('followup_sequence_steps').insert({
          sequence_id: seqId, user_id: user.id, step_order: i + 1,
          delay_hours: steps[i].delay_hours, message_text: steps[i].message_text,
        });
      }
      toast({ title: '✅ Sequência salva!' });
      setOpenEditor(false);
      fetchAll();
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  /* ── Deletar sequência ── */
  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta sequência e todos os seus passos?')) return;
    await (supabase as any).from('followup_sequence_steps').delete().eq('sequence_id', id);
    await (supabase as any).from('followup_sequences').delete().eq('id', id);
    toast({ title: 'Sequência excluída.' });
    fetchAll();
  };

  /* ── Toggle ativo/inativo ── */
  const toggleActive = async (seq: Sequence) => {
    await (supabase as any)
      .from('followup_sequences')
      .update({ is_active: !seq.is_active })
      .eq('id', seq.id);
    fetchAll();
  };

  /* ── Retentar item da fila ── */
  const retryItem = async (id: string) => {
    await (supabase as any)
      .from('followup_queue')
      .update({ status: 'scheduled', attempt_count: 0, last_error: null, scheduled_for: new Date().toISOString() })
      .eq('id', id);
    toast({ title: 'Item reagendado para agora.' });
    fetchQueue(queueFilter);
  };

  /* ── Contadores da fila ── */
  const queueCounts = {
    all:       queue.length,
    scheduled: queue.filter(q => q.status === 'scheduled').length,
    sent:      queue.filter(q => q.status === 'sent').length,
    failed:    queue.filter(q => q.status === 'failed').length,
  };

  const filteredQueue = queueFilter === 'all' ? queue : queue.filter(q => q.status === queueFilter);

  /* ── Render ── */
  const mainContent = (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitBranch className="h-6 w-6 text-purple-400" />
            Funil de Follow-up
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sequências automáticas de WhatsApp disparadas após preenchimento de formulário.
          </p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" /> Nova Sequência
        </Button>
      </div>

      <Tabs defaultValue="sequences">
        <TabsList>
          <TabsTrigger value="sequences" className="gap-2">
            <GitBranch className="h-4 w-4" /> Sequências
            <Badge variant="outline" className="ml-1 text-[10px]">{sequences.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="queue" className="gap-2" onClick={() => fetchQueue(queueFilter)}>
            <Clock className="h-4 w-4" /> Fila de Envio
            {queueCounts.scheduled > 0 && (
              <Badge className="ml-1 text-[10px] bg-blue-500">{queueCounts.scheduled}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Tab: Sequências ── */}
        <TabsContent value="sequences" className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : sequences.length === 0 ? (
            <div className="border-2 border-dashed rounded-2xl p-16 text-center">
              <GitBranch className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
              <h3 className="font-semibold text-lg mb-1">Nenhuma sequência criada</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Crie uma sequência e vincule-a a um formulário para disparar follow-ups automáticos.
              </p>
              <Button onClick={openNew} variant="outline" className="gap-2">
                <Plus className="h-4 w-4" /> Nova Sequência
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {sequences.map(seq => (
                <div key={seq.id} className="border rounded-2xl bg-card overflow-hidden">
                  {/* Cabeçalho da sequência */}
                  <div className="flex items-center gap-3 p-4">
                    <button
                      onClick={() => setExpanded(expanded === seq.id ? null : seq.id)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {expanded === seq.id
                        ? <ChevronDown className="h-4 w-4" />
                        : <ChevronRight className="h-4 w-4" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{seq.name}</span>
                        {seq.form?.title && (
                          <Badge variant="outline" className="text-[10px]">
                            📋 {seq.form.title}
                          </Badge>
                        )}
                        {seq.instance?.instance_name && (
                          <Badge variant="outline" className="text-[10px] text-green-500 border-green-500/30">
                            📱 {seq.instance.instance_name}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(seq.steps || []).length} mensagem{(seq.steps || []).length !== 1 ? 's' : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={seq.is_active}
                        onCheckedChange={() => toggleActive(seq)}
                      />
                      <span className="text-xs text-muted-foreground w-14">
                        {seq.is_active ? 'Ativa' : 'Inativa'}
                      </span>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openEdit(seq)}>
                        <Pencil className="h-3 w-3" /> Editar
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-500" onClick={() => handleDelete(seq.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Passos expandidos */}
                  {expanded === seq.id && (seq.steps || []).length > 0 && (
                    <div className="border-t px-4 py-3 bg-muted/20 space-y-2">
                      {(seq.steps || []).map((step, i) => (
                        <div key={i} className="flex items-start gap-3">
                          <div className="flex flex-col items-center shrink-0">
                            <div className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-400 flex items-center justify-center text-[10px] font-bold">
                              {i + 1}
                            </div>
                            {i < (seq.steps || []).length - 1 && (
                              <div className="w-px h-4 bg-border mt-1" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0 pb-2">
                            {i > 0 && (
                              <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                                <Clock className="h-2.5 w-2.5" />
                                Aguardar {step.delay_hours}h após mensagem anterior
                              </p>
                            )}
                            {i === 0 && (
                              <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                                <Send className="h-2.5 w-2.5" />
                                Enviar imediatamente após preenchimento
                              </p>
                            )}
                            <p className="text-xs bg-background border rounded-lg px-3 py-2 leading-relaxed whitespace-pre-wrap">
                              {step.message_text}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Tab: Fila de Envio ── */}
        <TabsContent value="queue" className="mt-4 space-y-4">
          {/* Filtros */}
          <div className="flex items-center gap-2 flex-wrap">
            {(['all', 'scheduled', 'sent', 'failed'] as const).map(f => (
              <button
                key={f}
                onClick={() => { setQueueFilter(f); fetchQueue(f); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  queueFilter === f
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent text-muted-foreground border-border hover:border-primary/40'
                }`}
              >
                {f === 'all' && `Todos (${queueCounts.all})`}
                {f === 'scheduled' && `Agendados (${queueCounts.scheduled})`}
                {f === 'sent' && `Enviados (${queueCounts.sent})`}
                {f === 'failed' && `Falhos (${queueCounts.failed})`}
              </button>
            ))}
            <Button size="sm" variant="ghost" className="h-7 gap-1 ml-auto" onClick={() => fetchQueue(queueFilter)}>
              <RefreshCw className="h-3.5 w-3.5" /> Atualizar
            </Button>
          </div>

          {loadingQueue ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredQueue.length === 0 ? (
            <div className="border-2 border-dashed rounded-2xl p-12 text-center">
              <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-sm text-muted-foreground">Nenhuma mensagem na fila.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredQueue.map(item => (
                <div key={item.id} className="border rounded-xl p-3.5 bg-card flex items-start gap-3">
                  {/* Status icon */}
                  <div className="shrink-0 mt-0.5">
                    {item.status === 'sent'      && <CheckCircle2 className="h-4 w-4 text-green-400" />}
                    {item.status === 'scheduled' && <Clock className="h-4 w-4 text-blue-400" />}
                    {item.status === 'failed'    && <XCircle className="h-4 w-4 text-red-400" />}
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="flex items-center gap-1 text-xs font-semibold">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        {item.phone}
                      </span>
                      <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE[item.status]?.class}`}>
                        {STATUS_BADGE[item.status]?.label}
                      </Badge>
                      {item.attempt_count > 1 && (
                        <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/30">
                          {item.attempt_count} tentativas
                        </Badge>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {item.message_content}
                    </p>

                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-2.5 w-2.5" />
                        {item.status === 'sent' && item.sent_at
                          ? `Enviado em ${new Date(item.sent_at).toLocaleString('pt-BR')}`
                          : `Agendado para ${new Date(item.scheduled_for).toLocaleString('pt-BR')}`}
                      </span>
                      {item.last_error && (
                        <span className="text-red-400">Erro: {item.last_error}</span>
                      )}
                    </div>
                  </div>

                  {/* Ação: Retentar se falhou */}
                  {item.status === 'failed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 shrink-0 text-amber-500 border-amber-500/30 hover:bg-amber-500/10"
                      onClick={() => retryItem(item.id)}
                    >
                      <RefreshCw className="h-3 w-3" /> Tentar
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Dialog Editor de Sequência ── */}
      <Dialog open={openEditor} onOpenChange={() => {}}>
        <DialogContent
          className="max-w-2xl max-h-[90vh] overflow-y-auto"
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-purple-400" />
              {editSeq ? 'Editar Sequência' : 'Nova Sequência de Follow-up'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            {/* Nome */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Nome da sequência</Label>
              <Input
                placeholder="Ex: Follow-up Lead Quente"
                value={seqName}
                onChange={e => setSeqName(e.target.value)}
                className="h-9 text-sm"
              />
            </div>

            {/* Instância */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Instância WhatsApp para envio</Label>
              <div className="relative">
                <select
                  value={seqInstance}
                  onChange={e => setSeqInstance(e.target.value)}
                  className="w-full h-9 text-sm border rounded-md px-3 bg-background appearance-none cursor-pointer"
                >
                  <option value="">Selecionar instância...</option>
                  {instances.map(inst => (
                    <option key={inst.id} value={inst.id}>{inst.instance_name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
              <p className="text-[10px] text-muted-foreground">
                O número que vai enviar as mensagens automaticamente.
              </p>
            </div>

            {/* Ativa */}
            <div className="flex items-center gap-3">
              <Switch checked={seqActive} onCheckedChange={setSeqActive} />
              <Label className="text-sm cursor-pointer">Sequência ativa</Label>
            </div>

            {/* Mensagens */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" /> Mensagens
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Use <code className="bg-muted px-1 rounded">{'{nome}'}</code> para personalizar com o nome do lead.
                A 1ª mensagem é enviada imediatamente após o preenchimento.
              </p>

              {steps.map((step, idx) => (
                <div key={idx} className="border rounded-xl p-3.5 space-y-2.5 bg-muted/10">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-500">
                      Mensagem {idx + 1}
                    </span>
                    {steps.length > 1 && (
                      <button
                        onClick={() => setSteps(s => s.filter((_, i) => i !== idx))}
                        className="text-red-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {idx > 0 && (
                    <div className="flex items-center gap-2">
                      <Label className="text-[11px] whitespace-nowrap">Enviar após</Label>
                      <Input
                        type="number"
                        min={0}
                        value={step.delay_hours}
                        onChange={e => setSteps(s => s.map((st, i) => i === idx ? { ...st, delay_hours: Number(e.target.value) } : st))}
                        className="h-7 text-xs w-20"
                      />
                      <span className="text-xs text-muted-foreground">horas da mensagem anterior</span>
                    </div>
                  )}
                  {idx === 0 && (
                    <p className="text-[10px] text-blue-400 flex items-center gap-1">
                      <Send className="h-2.5 w-2.5" /> Enviada imediatamente após preenchimento
                    </p>
                  )}

                  <Textarea
                    rows={3}
                    placeholder={`Olá {nome}, obrigado por se cadastrar...`}
                    value={step.message_text}
                    onChange={e => setSteps(s => s.map((st, i) => i === idx ? { ...st, message_text: e.target.value } : st))}
                    className="text-sm resize-none"
                  />
                </div>
              ))}

              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => setSteps(s => [...s, { step_order: s.length + 1, delay_hours: 24, message_text: '' }])}
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar mensagem
              </Button>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 border-t mt-4">
            <Button
              variant="ghost"
              onClick={() => { if (confirm('Fechar sem salvar?')) setOpenEditor(false); }}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2 min-w-28">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? 'Salvando...' : '✅ Salvar Sequência'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  if (loading && sequences.length === 0) {
    const spinner = (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
    return embedded ? spinner : <MainLayout>{spinner}</MainLayout>;
  }

  return embedded ? mainContent : <MainLayout>{mainContent}</MainLayout>;
}
