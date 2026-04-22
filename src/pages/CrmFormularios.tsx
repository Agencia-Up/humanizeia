import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs';
import {
  ClipboardCopy, ExternalLink, FilePlus2, Loader2, Pencil, Plus,
  Trash2, Users, Zap, GripVertical, CheckCircle2,
} from 'lucide-react';

/* ── tipos ── */
interface FormField { id: string; label: string; type: string; placeholder: string; required: boolean; enabled: boolean; }
interface SequenceStep { id?: string; step_order: number; delay_hours: number; message_text: string; }
interface CaptureForm {
  id: string; name: string; title: string; description: string;
  primary_color: string; logo_url: string; fields: FormField[];
  success_message: string; redirect_url: string; instance_id: string | null;
  is_active: boolean; submission_count: number; created_at: string;
}

const DEFAULT_FIELDS: FormField[] = [
  { id: 'name',  label: 'Nome',     type: 'text',  placeholder: 'Seu nome completo', required: true,  enabled: true },
  { id: 'phone', label: 'WhatsApp', type: 'tel',   placeholder: '(11) 99999-9999',   required: true,  enabled: true },
  { id: 'email', label: 'E-mail',   type: 'email', placeholder: 'seu@email.com',      required: false, enabled: true },
];

const EMPTY_FORM = {
  name: '', title: '', description: '', primary_color: '#1565C0',
  logo_url: '', fields: DEFAULT_FIELDS, success_message: 'Obrigado! Entraremos em contato em breve.',
  redirect_url: '', instance_id: null, is_active: true,
};

export default function CrmFormularios() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [forms, setForms] = useState<CaptureForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [instances, setInstances] = useState<any[]>([]);

  /* dialogs */
  const [openEditor, setOpenEditor] = useState(false);
  const [openSubmissions, setOpenSubmissions] = useState(false);
  const [openSequence, setOpenSequence] = useState(false);
  const [editingForm, setEditingForm] = useState<any>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* submissions */
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [submForm, setSubmForm] = useState<CaptureForm | null>(null);

  /* sequence */
  const [seqForm, setSeqForm] = useState<CaptureForm | null>(null);
  const [sequence, setSequence] = useState<any>(null);
  const [steps, setSteps] = useState<SequenceStep[]>([]);
  const [savingSeq, setSavingSeq] = useState(false);

  /* custom field */
  const [newFieldLabel, setNewFieldLabel] = useState('');

  const baseUrl = `${window.location.origin}/f`;

  /* ── fetch ── */
  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: f }, { data: i }] = await Promise.all([
      (supabase as any).from('capture_forms').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      (supabase as any).from('wa_instances').select('id, instance_name').eq('user_id', user.id).eq('is_active', true),
    ]);
    setForms(f || []);
    setInstances(i || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* ── salvar formulário ── */
  const handleSaveForm = async () => {
    if (!user) return;
    if (!editingForm.name.trim() || !editingForm.title.trim()) {
      toast({ title: 'Preencha nome interno e título do formulário.', variant: 'destructive' }); return;
    }
    setSaving(true);
    try {
      const payload = { ...editingForm, user_id: user.id };
      if (editingId) {
        await (supabase as any).from('capture_forms').update(payload).eq('id', editingId);
        toast({ title: '✅ Formulário atualizado!' });
      } else {
        await (supabase as any).from('capture_forms').insert(payload);
        toast({ title: '✅ Formulário criado!' });
      }
      setOpenEditor(false);
      fetchAll();
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  /* ── deletar ── */
  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este formulário e todas as suas submissões?')) return;
    await (supabase as any).from('capture_forms').delete().eq('id', id);
    toast({ title: 'Formulário excluído' });
    fetchAll();
  };

  /* ── abrir submissões ── */
  const openSubs = async (form: CaptureForm) => {
    setSubmForm(form);
    const { data } = await (supabase as any).from('capture_form_submissions').select('*').eq('form_id', form.id).order('created_at', { ascending: false });
    setSubmissions(data || []);
    setOpenSubmissions(true);
  };

  /* ── abrir sequência ── */
  const openSeq = async (form: CaptureForm) => {
    setSeqForm(form);
    const { data: seq } = await (supabase as any).from('followup_sequences').select('*, steps:followup_sequence_steps(*)').eq('form_id', form.id).eq('user_id', user!.id).maybeSingle();
    if (seq) {
      setSequence(seq);
      setSteps([...seq.steps].sort((a: any, b: any) => a.step_order - b.step_order));
    } else {
      setSequence(null);
      setSteps([{ step_order: 1, delay_hours: 0, message_text: '' }]);
    }
    setOpenSequence(true);
  };

  /* ── salvar sequência ── */
  const handleSaveSequence = async () => {
    if (!user || !seqForm) return;
    if (steps.some(s => !s.message_text.trim())) {
      toast({ title: 'Preencha o texto de todas as mensagens.', variant: 'destructive' }); return;
    }
    setSavingSeq(true);
    try {
      let seqId = sequence?.id;
      if (!seqId) {
        const { data: newSeq } = await (supabase as any).from('followup_sequences').insert({
          user_id: user.id, form_id: seqForm.id,
          name: `Sequência — ${seqForm.name}`,
          instance_id: seqForm.instance_id,
          is_active: true,
        }).select('id').single();
        seqId = newSeq.id;
      } else {
        await (supabase as any).from('followup_sequences').update({ instance_id: seqForm.instance_id, is_active: true }).eq('id', seqId);
      }
      // Apaga steps antigos e recria
      await (supabase as any).from('followup_sequence_steps').delete().eq('sequence_id', seqId);
      for (let i = 0; i < steps.length; i++) {
        await (supabase as any).from('followup_sequence_steps').insert({
          sequence_id: seqId, user_id: user.id,
          step_order: i + 1, delay_hours: steps[i].delay_hours,
          message_text: steps[i].message_text,
        });
      }
      toast({ title: '✅ Sequência de follow-up salva!' });
      setOpenSequence(false);
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    } finally { setSavingSeq(false); }
  };

  /* ── helpers de campo ── */
  const toggleField = (id: string) => setEditingForm((f: any) => ({ ...f, fields: f.fields.map((field: FormField) => field.id === id ? { ...field, enabled: !field.enabled } : field) }));
  const toggleRequired = (id: string) => setEditingForm((f: any) => ({ ...f, fields: f.fields.map((field: FormField) => field.id === id ? { ...field, required: !field.required } : field) }));
  const addCustomField = () => {
    if (!newFieldLabel.trim()) return;
    const id = `custom_${Date.now()}`;
    setEditingForm((f: any) => ({ ...f, fields: [...f.fields, { id, label: newFieldLabel.trim(), type: 'text', placeholder: '', required: false, enabled: true }] }));
    setNewFieldLabel('');
  };
  const removeCustomField = (id: string) => setEditingForm((f: any) => ({ ...f, fields: f.fields.filter((field: FormField) => field.id !== id) }));

  /* ── copiar link ── */
  const copyLink = (id: string) => {
    navigator.clipboard.writeText(`${baseUrl}/${id}`);
    toast({ title: '🔗 Link copiado!' });
  };

  /* ── render ── */
  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Formulários de Captura</h1>
          <p className="text-sm text-muted-foreground mt-1">Crie formulários personalizados e capture leads direto no CRM.</p>
        </div>
        <Button onClick={() => { setEditingId(null); setEditingForm(EMPTY_FORM); setOpenEditor(true); }} className="gap-2">
          <FilePlus2 className="h-4 w-4" /> Novo Formulário
        </Button>
      </div>

      {/* Lista de formulários */}
      {forms.length === 0 ? (
        <div className="border-2 border-dashed rounded-2xl p-16 text-center">
          <FilePlus2 className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
          <h3 className="font-semibold text-lg mb-1">Nenhum formulário criado</h3>
          <p className="text-sm text-muted-foreground">Crie seu primeiro formulário de captura de leads.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {forms.map(form => (
            <div key={form.id} className="border rounded-2xl bg-card p-5 space-y-4 hover:border-primary/40 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-10 rounded-full shrink-0" style={{ background: form.primary_color }} />
                  <div>
                    <h3 className="font-bold text-base">{form.title}</h3>
                    <p className="text-xs text-muted-foreground">{form.name}</p>
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${form.is_active ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground'}`}>
                  {form.is_active ? 'Ativo' : 'Inativo'}
                </span>
              </div>

              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  <strong className="text-foreground">{form.submission_count}</strong> leads
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {(form.fields || []).filter((f: FormField) => f.enabled).length} campos
                </span>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => copyLink(form.id)}>
                  <ClipboardCopy className="h-3 w-3" /> Copiar link
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => window.open(`/f/${form.id}`, '_blank')}>
                  <ExternalLink className="h-3 w-3" /> Visualizar
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => openSubs(form)}>
                  <Users className="h-3 w-3" /> Leads ({form.submission_count})
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 text-purple-500 border-purple-500/30 hover:bg-purple-500/10" onClick={() => openSeq(form)}>
                  <Zap className="h-3 w-3" /> Follow-up
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => { setEditingId(form.id); setEditingForm(form); setOpenEditor(true); }}>
                  <Pencil className="h-3 w-3" /> Editar
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-red-400 hover:text-red-500" onClick={() => handleDelete(form.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Dialog: Editor de Formulário ── */}
      <Dialog open={openEditor} onOpenChange={setOpenEditor}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Formulário' : 'Novo Formulário'}</DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="geral" className="mt-2">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="geral">Geral</TabsTrigger>
              <TabsTrigger value="campos">Campos</TabsTrigger>
            </TabsList>

            {/* Aba Geral */}
            <TabsContent value="geral" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Nome interno *</Label>
                  <Input placeholder="Ex: Formulário Site" value={editingForm.name} onChange={e => setEditingForm((f: any) => ({ ...f, name: e.target.value }))} className="h-8 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Cor principal</Label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={editingForm.primary_color} onChange={e => setEditingForm((f: any) => ({ ...f, primary_color: e.target.value }))} className="h-8 w-10 rounded cursor-pointer border" />
                    <Input value={editingForm.primary_color} onChange={e => setEditingForm((f: any) => ({ ...f, primary_color: e.target.value }))} className="h-8 text-xs font-mono flex-1" />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Título do formulário *</Label>
                <Input placeholder="Ex: Fale com um especialista" value={editingForm.title} onChange={e => setEditingForm((f: any) => ({ ...f, title: e.target.value }))} className="h-8 text-xs" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Subtítulo / Descrição</Label>
                <Input placeholder="Ex: Preencha e entraremos em contato" value={editingForm.description} onChange={e => setEditingForm((f: any) => ({ ...f, description: e.target.value }))} className="h-8 text-xs" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">URL do Logo (opcional)</Label>
                <Input placeholder="https://..." value={editingForm.logo_url} onChange={e => setEditingForm((f: any) => ({ ...f, logo_url: e.target.value }))} className="h-8 text-xs" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Mensagem de sucesso</Label>
                <Input value={editingForm.success_message} onChange={e => setEditingForm((f: any) => ({ ...f, success_message: e.target.value }))} className="h-8 text-xs" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">URL de redirecionamento após envio (opcional)</Label>
                <Input placeholder="https://..." value={editingForm.redirect_url} onChange={e => setEditingForm((f: any) => ({ ...f, redirect_url: e.target.value }))} className="h-8 text-xs" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Instância WhatsApp para follow-up</Label>
                <select className="w-full h-8 text-xs border rounded-md px-2 bg-background" value={editingForm.instance_id || ''} onChange={e => setEditingForm((f: any) => ({ ...f, instance_id: e.target.value || null }))}>
                  <option value="">— Selecionar instância —</option>
                  {instances.map(i => <option key={i.id} value={i.id}>{i.instance_name}</option>)}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <Switch checked={editingForm.is_active} onCheckedChange={v => setEditingForm((f: any) => ({ ...f, is_active: v }))} />
                <Label className="text-xs">Formulário ativo</Label>
              </div>
            </TabsContent>

            {/* Aba Campos */}
            <TabsContent value="campos" className="space-y-4 pt-4">
              <p className="text-xs text-muted-foreground">Ative/desative os campos e marque quais são obrigatórios.</p>
              <div className="space-y-2">
                {(editingForm.fields as FormField[]).map((field) => (
                  <div key={field.id} className="flex items-center gap-3 p-3 border rounded-lg bg-muted/20">
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{field.label}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{field.type}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                        <input type="checkbox" checked={field.required} onChange={() => toggleRequired(field.id)} className="w-3 h-3" />
                        Obrigatório
                      </label>
                      <Switch checked={field.enabled} onCheckedChange={() => toggleField(field.id)} className="scale-75" />
                      {!['name', 'email', 'phone'].includes(field.id) && (
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400" onClick={() => removeCustomField(field.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Adicionar campo customizado */}
              <div className="flex items-center gap-2 pt-2 border-t">
                <Input placeholder="Nome do campo customizado..." value={newFieldLabel} onChange={e => setNewFieldLabel(e.target.value)} className="h-8 text-xs flex-1" onKeyDown={e => e.key === 'Enter' && addCustomField()} />
                <Button size="sm" className="h-8 gap-1.5 shrink-0" onClick={addCustomField}>
                  <Plus className="h-3.5 w-3.5" /> Adicionar
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setOpenEditor(false)}>Cancelar</Button>
            <Button onClick={handleSaveForm} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingId ? 'Salvar alterações' : 'Criar formulário'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Submissões ── */}
      <Dialog open={openSubmissions} onOpenChange={setOpenSubmissions}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Leads — {submForm?.title}</DialogTitle>
          </DialogHeader>
          {submissions.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">Nenhum lead capturado ainda.</div>
          ) : (
            <div className="space-y-2 mt-2">
              {submissions.map(s => (
                <div key={s.id} className="flex items-start justify-between p-3 border rounded-lg bg-muted/10 gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{s.name || '—'}</p>
                    <p className="text-xs text-muted-foreground">{s.phone || ''} {s.email ? `· ${s.email}` : ''}</p>
                    {s.custom_data && Object.keys(s.custom_data).length > 0 && (
                      <p className="text-[10px] text-muted-foreground mt-1">{Object.entries(s.custom_data).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">{new Date(s.created_at).toLocaleString('pt-BR')}</span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Sequência de Follow-up ── */}
      <Dialog open={openSequence} onOpenChange={setOpenSequence}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Follow-up WhatsApp — {seqForm?.title}</DialogTitle>
          </DialogHeader>

          <div className="mt-2 space-y-1.5">
            <p className="text-xs text-muted-foreground">Configure a sequência de mensagens enviadas automaticamente após o lead preencher o formulário. Use <code className="bg-muted px-1 rounded">{'{nome}'}</code> para personalizar.</p>
          </div>

          <div className="space-y-3 mt-4">
            {steps.map((step, idx) => (
              <div key={idx} className="border rounded-xl p-4 space-y-3 bg-muted/10">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-500">Mensagem {idx + 1}</span>
                  {steps.length > 1 && (
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400" onClick={() => setSteps(s => s.filter((_, i) => i !== idx))}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="space-y-1 flex-1">
                    <Label className="text-[10px]">{idx === 0 ? 'Envio imediato após submissão' : 'Atraso (horas após mensagem anterior)'}</Label>
                    {idx > 0 && (
                      <Input type="number" min={0} value={step.delay_hours} onChange={e => setSteps(s => s.map((st, i) => i === idx ? { ...st, delay_hours: Number(e.target.value) } : st))} className="h-8 text-xs w-28" />
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Mensagem</Label>
                  <Textarea rows={3} placeholder="Ex: Olá {nome}, vi que você se cadastrou! Posso te ajudar?" value={step.message_text} onChange={e => setSteps(s => s.map((st, i) => i === idx ? { ...st, message_text: e.target.value } : st))} className="text-xs resize-none" />
                </div>
              </div>
            ))}

            <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => setSteps(s => [...s, { step_order: s.length + 1, delay_hours: 24, message_text: '' }])}>
              <Plus className="h-3.5 w-3.5" /> Adicionar mensagem
            </Button>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setOpenSequence(false)}>Cancelar</Button>
            <Button onClick={handleSaveSequence} disabled={savingSeq} className="bg-purple-600 hover:bg-purple-700">
              {savingSeq ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
              Salvar sequência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
