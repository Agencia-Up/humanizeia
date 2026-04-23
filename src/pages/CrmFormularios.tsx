import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { MainLayout } from '@/components/layout/MainLayout';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ClipboardCopy, ExternalLink, FilePlus2, Loader2, Pencil, Plus, Trash2,
  Users, Zap, Image, Type, AlignLeft, ChevronDown, CheckSquare,
  Circle, Star, Calendar, Hash, Mail, Phone, Upload, X, GripVertical,
  Eye, Settings, LayoutTemplate, MessageSquare,
} from 'lucide-react';

/* ─── Tipos ─────────────────────────────────────────────────────────────── */
type FieldType = 'text' | 'textarea' | 'email' | 'tel' | 'number' | 'date'
  | 'select' | 'radio' | 'checkbox' | 'rating';

interface FormField {
  id: string; label: string; type: FieldType;
  placeholder: string; required: boolean; enabled: boolean;
  options?: string[];
}
interface SequenceStep { id?: string; step_order: number; delay_hours: number; message_text: string; }
interface CaptureForm {
  id: string; name: string; title: string; description: string;
  primary_color: string; logo_url: string; cover_url: string; fields: FormField[];
  success_message: string; redirect_url: string; instance_id: string | null;
  is_active: boolean; submission_count: number; created_at: string;
}

/* ─── Constantes ────────────────────────────────────────────────────────── */
const FIELD_TYPES: { value: FieldType; label: string; icon: React.ComponentType<any>; desc: string }[] = [
  { value: 'text',     label: 'Texto curto',      icon: Type,        desc: 'Resposta em linha' },
  { value: 'textarea', label: 'Parágrafo',         icon: AlignLeft,   desc: 'Resposta longa' },
  { value: 'email',    label: 'E-mail',            icon: Mail,        desc: 'Endereço de e-mail' },
  { value: 'tel',      label: 'Telefone',          icon: Phone,       desc: 'Número de telefone' },
  { value: 'number',   label: 'Número',            icon: Hash,        desc: 'Valor numérico' },
  { value: 'date',     label: 'Data',              icon: Calendar,    desc: 'Seletor de data' },
  { value: 'select',   label: 'Lista suspensa',    icon: ChevronDown, desc: 'Selecionar uma opção' },
  { value: 'radio',    label: 'Múltipla escolha',  icon: Circle,      desc: 'Escolher uma opção' },
  { value: 'checkbox', label: 'Caixas de seleção', icon: CheckSquare, desc: 'Escolher várias opções' },
  { value: 'rating',   label: 'Avaliação',         icon: Star,        desc: 'Nota de 1 a 5 estrelas' },
];

const DEFAULT_FIELDS: FormField[] = [
  { id: 'name',  label: 'Nome completo', type: 'text',  placeholder: 'Seu nome completo', required: true,  enabled: true },
  { id: 'phone', label: 'WhatsApp',      type: 'tel',   placeholder: '(11) 99999-9999',   required: true,  enabled: true },
  { id: 'email', label: 'E-mail',        type: 'email', placeholder: 'seu@email.com',      required: false, enabled: true },
];

const EMPTY_FORM = {
  name: '', title: '', description: '', primary_color: '#6366f1',
  logo_url: '', cover_url: '', fields: DEFAULT_FIELDS,
  success_message: 'Obrigado! Entraremos em contato em breve.',
  redirect_url: '', instance_id: null, is_active: true,
};

/* ─── Preview mini do campo ─────────────────────────────────────────────── */
function FieldPreview({ field, color }: { field: FormField; color: string }) {
  if (!field.enabled) return null;
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-gray-700">
        {field.label}{field.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {field.type === 'textarea' && (
        <div className="w-full h-20 border-b-2 border-gray-300 bg-transparent rounded-none text-sm text-gray-400 px-0 flex items-end pb-1">Sua resposta</div>
      )}
      {['text','email','tel','number','date'].includes(field.type) && (
        <div className="w-full border-b-2 border-gray-300 text-sm text-gray-400 py-1">{field.placeholder || 'Sua resposta'}</div>
      )}
      {field.type === 'select' && (
        <div className="flex items-center justify-between border-b-2 border-gray-300 py-1 text-sm text-gray-400">
          <span>Escolher</span><ChevronDown className="h-4 w-4" />
        </div>
      )}
      {field.type === 'radio' && (
        <div className="space-y-1">
          {(field.options || ['Opção 1', 'Opção 2']).map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full border-2 border-gray-400" />
              <span className="text-sm text-gray-600">{o}</span>
            </div>
          ))}
        </div>
      )}
      {field.type === 'checkbox' && (
        <div className="space-y-1">
          {(field.options || ['Opção 1', 'Opção 2']).map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-4 h-4 rounded border-2 border-gray-400" />
              <span className="text-sm text-gray-600">{o}</span>
            </div>
          ))}
        </div>
      )}
      {field.type === 'rating' && (
        <div className="flex gap-1">{[1,2,3,4,5].map(n => <Star key={n} className="h-6 w-6 text-gray-300" />)}</div>
      )}
    </div>
  );
}

/* ─── Componente principal ──────────────────────────────────────────────── */
export default function CrmFormularios({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [forms, setForms] = useState<CaptureForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [instances, setInstances] = useState<any[]>([]);

  const [openEditor, setOpenEditor]       = useState(false);
  const [openSubmissions, setOpenSubmissions] = useState(false);
  const [openSequence, setOpenSequence]   = useState(false);
  const [editingForm, setEditingForm]     = useState<any>(EMPTY_FORM);
  const [editingId, setEditingId]         = useState<string | null>(null);
  const [saving, setSaving]               = useState(false);
  const [editorTab, setEditorTab]         = useState('design');

  const [submissions, setSubmissions]     = useState<any[]>([]);
  const [submForm, setSubmForm]           = useState<CaptureForm | null>(null);

  const [seqForm, setSeqForm]             = useState<CaptureForm | null>(null);
  const [sequence, setSequence]           = useState<any>(null);
  const [steps, setSteps]                 = useState<SequenceStep[]>([]);
  const [savingSeq, setSavingSeq]         = useState(false);

  const [uploadingLogo, setUploadingLogo]   = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [showTypeMenu, setShowTypeMenu]     = useState<string | null>(null);

  const logoRef  = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const baseUrl  = `${window.location.origin}/f`;

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

  /* ── upload de imagem ── */
  const uploadImage = async (file: File, prefix: string): Promise<string | null> => {
    try {
      const ext = file.name.split('.').pop();
      const path = `forms/${user!.id}/${prefix}_${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('public-assets').upload(path, file, { upsert: true });
      if (error) throw error;
      return supabase.storage.from('public-assets').getPublicUrl(path).data.publicUrl;
    } catch {
      return null;
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploadingLogo(true);
    const url = await uploadImage(file, 'logo');
    if (url) setEditingForm((f: any) => ({ ...f, logo_url: url }));
    else toast({ title: 'Cole a URL da logo manualmente', variant: 'destructive' });
    setUploadingLogo(false);
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploadingCover(true);
    const url = await uploadImage(file, 'cover');
    if (url) setEditingForm((f: any) => ({ ...f, cover_url: url }));
    else toast({ title: 'Cole a URL da capa manualmente', variant: 'destructive' });
    setUploadingCover(false);
  };

  /* ── salvar formulário ── */
  const handleSaveForm = async () => {
    if (!user) return;
    if (!editingForm.name.trim() || !editingForm.title.trim()) {
      toast({ title: 'Preencha nome interno e título.', variant: 'destructive' }); return;
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
      setOpenEditor(false); fetchAll();
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este formulário?')) return;
    await (supabase as any).from('capture_forms').delete().eq('id', id);
    fetchAll();
  };

  const openSubs = async (form: CaptureForm) => {
    setSubmForm(form);
    const { data } = await (supabase as any).from('capture_form_submissions').select('*').eq('form_id', form.id).order('created_at', { ascending: false });
    setSubmissions(data || []); setOpenSubmissions(true);
  };

  const openSeq = async (form: CaptureForm) => {
    setSeqForm(form);
    const { data: seq } = await (supabase as any).from('followup_sequences').select('*, steps:followup_sequence_steps(*)').eq('form_id', form.id).eq('user_id', user!.id).maybeSingle();
    if (seq) { setSequence(seq); setSteps([...seq.steps].sort((a: any, b: any) => a.step_order - b.step_order)); }
    else { setSequence(null); setSteps([{ step_order: 1, delay_hours: 0, message_text: '' }]); }
    setOpenSequence(true);
  };

  const handleSaveSequence = async () => {
    if (!user || !seqForm) return;
    if (steps.some(s => !s.message_text.trim())) { toast({ title: 'Preencha todas as mensagens.', variant: 'destructive' }); return; }
    setSavingSeq(true);
    try {
      let seqId = sequence?.id;
      if (!seqId) {
        const { data: newSeq } = await (supabase as any).from('followup_sequences').insert({ user_id: user.id, form_id: seqForm.id, name: `Sequência — ${seqForm.name}`, instance_id: seqForm.instance_id, is_active: true }).select('id').single();
        seqId = newSeq.id;
      } else {
        await (supabase as any).from('followup_sequences').update({ instance_id: seqForm.instance_id, is_active: true }).eq('id', seqId);
      }
      await (supabase as any).from('followup_sequence_steps').delete().eq('sequence_id', seqId);
      for (let i = 0; i < steps.length; i++) {
        await (supabase as any).from('followup_sequence_steps').insert({ sequence_id: seqId, user_id: user.id, step_order: i + 1, delay_hours: steps[i].delay_hours, message_text: steps[i].message_text });
      }
      toast({ title: '✅ Sequência salva!' }); setOpenSequence(false);
    } catch (e: any) { toast({ title: 'Erro', description: e.message, variant: 'destructive' }); }
    finally { setSavingSeq(false); }
  };

  /* ── helpers de campo ── */
  const updateField = (id: string, patch: Partial<FormField>) =>
    setEditingForm((f: any) => ({ ...f, fields: f.fields.map((field: FormField) => field.id === id ? { ...field, ...patch } : field) }));

  const addField = (type: FieldType) => {
    const id = `field_${Date.now()}`;
    const info = FIELD_TYPES.find(t => t.value === type)!;
    const hasOptions = ['select','radio','checkbox'].includes(type);
    setEditingForm((f: any) => ({
      ...f,
      fields: [...f.fields, { id, label: info.label, type, placeholder: '', required: false, enabled: true, options: hasOptions ? ['Opção 1', 'Opção 2'] : undefined }]
    }));
    setShowTypeMenu(null);
  };

  const removeField = (id: string) =>
    setEditingForm((f: any) => ({ ...f, fields: f.fields.filter((field: FormField) => field.id !== id) }));

  const addOption = (fieldId: string) =>
    updateField(fieldId, { options: [...(editingForm.fields.find((f: FormField) => f.id === fieldId)?.options || []), `Opção ${Date.now()}`] });

  const updateOption = (fieldId: string, idx: number, value: string) => {
    const field = editingForm.fields.find((f: FormField) => f.id === fieldId);
    if (!field) return;
    const opts = [...(field.options || [])];
    opts[idx] = value;
    updateField(fieldId, { options: opts });
  };

  const removeOption = (fieldId: string, idx: number) => {
    const field = editingForm.fields.find((f: FormField) => f.id === fieldId);
    if (!field) return;
    updateField(fieldId, { options: (field.options || []).filter((_: string, i: number) => i !== idx) });
  };

  const copyLink = (id: string) => { navigator.clipboard.writeText(`${baseUrl}/${id}`); toast({ title: '🔗 Link copiado!' }); };

  const color = editingForm.primary_color || '#6366f1';

  /* ── render ── */
  const Wrapper = embedded ? ({ children }: { children: React.ReactNode }) => <>{children}</> : MainLayout;

  if (loading) return <Wrapper><div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></Wrapper>;

  return (
    <Wrapper>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Formulários de Captura</h1>
          <p className="text-sm text-muted-foreground mt-1">Crie formulários personalizados e capture leads direto no CRM.</p>
        </div>
        <Button onClick={() => { setEditingId(null); setEditingForm(EMPTY_FORM); setEditorTab('design'); setOpenEditor(true); }} className="gap-2">
          <FilePlus2 className="h-4 w-4" /> Novo Formulário
        </Button>
      </div>

      {/* Lista */}
      {forms.length === 0 ? (
        <div className="border-2 border-dashed rounded-2xl p-16 text-center">
          <FilePlus2 className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
          <h3 className="font-semibold text-lg mb-1">Nenhum formulário criado</h3>
          <p className="text-sm text-muted-foreground">Crie seu primeiro formulário de captura de leads.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {forms.map(form => (
            <div key={form.id} className="border rounded-2xl bg-card overflow-hidden hover:border-primary/40 transition-colors group">
              {/* Capa */}
              <div className="h-24 relative flex items-center justify-center"
                style={{ background: form.cover_url ? `url(${form.cover_url}) center/cover` : `linear-gradient(135deg, ${form.primary_color}33, ${form.primary_color}88)` }}>
                {!form.cover_url && <div className="w-10 h-10 rounded-full border-2 border-white/40 flex items-center justify-center" style={{ background: form.primary_color }}>
                  {form.logo_url
                    ? <img src={form.logo_url} alt="logo" className="w-8 h-8 object-contain rounded-full" />
                    : <span className="text-white font-bold text-lg">{form.title[0]}</span>}
                </div>}
                {form.cover_url && form.logo_url && (
                  <img src={form.logo_url} alt="logo" className="absolute bottom-2 left-3 w-8 h-8 object-contain rounded-full bg-white p-0.5 shadow" />
                )}
                <span className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${form.is_active ? 'bg-green-500/90 text-white' : 'bg-gray-500/80 text-white'}`}>
                  {form.is_active ? 'Ativo' : 'Inativo'}
                </span>
              </div>

              <div className="p-4 space-y-3">
                <div>
                  <h3 className="font-bold text-base leading-tight">{form.title}</h3>
                  <p className="text-xs text-muted-foreground truncate">{form.description || form.name}</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /><strong className="text-foreground">{form.submission_count}</strong> leads</span>
                  <span className="flex items-center gap-1"><Type className="h-3.5 w-3.5" />{(form.fields || []).filter((f: FormField) => f.enabled).length} campos</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => copyLink(form.id)}><ClipboardCopy className="h-3 w-3" />Link</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => window.open(`/f/${form.id}`, '_blank')}><ExternalLink className="h-3 w-3" />Ver</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openSubs(form)}><Users className="h-3 w-3" />Leads</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-purple-500 border-purple-500/30 hover:bg-purple-500/10" onClick={() => openSeq(form)}><Zap className="h-3 w-3" />Follow-up</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setEditingId(form.id); setEditingForm({ ...EMPTY_FORM, ...form }); setEditorTab('design'); setOpenEditor(true); }}><Pencil className="h-3 w-3" />Editar</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400 hover:text-red-500 px-2" onClick={() => handleDelete(form.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          EDITOR — Dialog fullscreen
      ══════════════════════════════════════════════════════════════ */}
      <Dialog open={openEditor} onOpenChange={setOpenEditor}>
        <DialogContent className="max-w-[95vw] w-[1100px] max-h-[95vh] p-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-6 py-4 border-b border-border/40 flex-row items-center justify-between space-y-0 shrink-0">
            <DialogTitle className="text-base font-semibold">{editingId ? 'Editar Formulário' : 'Novo Formulário'}</DialogTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => window.open(`/f/preview`, '_blank')} className="h-8 gap-1.5 text-xs">
                <Eye className="h-3.5 w-3.5" /> Pré-visualizar
              </Button>
              <Button size="sm" onClick={handleSaveForm} disabled={saving} className="h-8 gap-1.5 text-xs">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {editingId ? 'Salvar' : 'Criar'}
              </Button>
            </div>
          </DialogHeader>

          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* ── Sidebar de abas ── */}
            <div className="w-14 border-r border-border/40 flex flex-col items-center py-4 gap-1 bg-muted/20 shrink-0">
              {[
                { id: 'design',   icon: LayoutTemplate, label: 'Design'    },
                { id: 'campos',   icon: AlignLeft,       label: 'Campos'    },
                { id: 'config',   icon: Settings,        label: 'Config.'   },
                { id: 'followup', icon: MessageSquare,   label: 'Follow-up' },
              ].map(tab => (
                <button key={tab.id} onClick={() => setEditorTab(tab.id)}
                  title={tab.label}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${editorTab === tab.id ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
                  <tab.icon className="h-4.5 w-4.5" />
                </button>
              ))}
            </div>

            {/* ── Área principal ── */}
            <div className="flex flex-1 min-w-0 overflow-hidden">

              {/* ── Painel esquerdo: editor ── */}
              <div className="w-[420px] border-r border-border/40 overflow-y-auto flex flex-col shrink-0">

                {/* Tab: Design */}
                {editorTab === 'design' && (
                  <div className="p-5 space-y-5">
                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Identidade Visual</h3>

                    {/* Capa */}
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">Imagem de capa</Label>
                      <div
                        className="relative h-32 rounded-xl overflow-hidden border-2 border-dashed border-border/60 cursor-pointer hover:border-primary/50 transition-colors flex items-center justify-center bg-muted/20"
                        style={editingForm.cover_url ? { backgroundImage: `url(${editingForm.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center', border: 'none' } : {}}
                        onClick={() => coverRef.current?.click()}>
                        {uploadingCover
                          ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                          : editingForm.cover_url
                            ? <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                <Upload className="h-5 w-5 text-white" /><span className="text-white text-xs font-medium">Trocar capa</span>
                              </div>
                            : <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                <Image className="h-8 w-8 opacity-40" />
                                <span className="text-xs">Clique para subir a capa</span>
                              </div>
                        }
                        {editingForm.cover_url && (
                          <button className="absolute top-2 right-2 w-6 h-6 bg-black/50 rounded-full flex items-center justify-center hover:bg-red-500/80 transition-colors"
                            onClick={e => { e.stopPropagation(); setEditingForm((f: any) => ({ ...f, cover_url: '' })); }}>
                            <X className="h-3.5 w-3.5 text-white" />
                          </button>
                        )}
                      </div>
                      <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
                      <Input placeholder="Ou cole a URL da capa..." value={editingForm.cover_url} onChange={e => setEditingForm((f: any) => ({ ...f, cover_url: e.target.value }))} className="h-8 text-xs" />
                    </div>

                    {/* Logo */}
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">Logo da empresa</Label>
                      <div className="flex items-center gap-3">
                        <div className="w-16 h-16 rounded-xl border-2 border-dashed border-border/60 flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors bg-muted/20 shrink-0 overflow-hidden"
                          onClick={() => logoRef.current?.click()}>
                          {uploadingLogo ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            : editingForm.logo_url ? <img src={editingForm.logo_url} alt="logo" className="w-full h-full object-contain p-1" />
                            : <Upload className="h-5 w-5 text-muted-foreground opacity-50" />}
                        </div>
                        <div className="flex-1 space-y-1.5">
                          <Input placeholder="URL da logo..." value={editingForm.logo_url} onChange={e => setEditingForm((f: any) => ({ ...f, logo_url: e.target.value }))} className="h-8 text-xs" />
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1 w-full" onClick={() => logoRef.current?.click()}>
                            <Upload className="h-3 w-3" /> Subir arquivo
                          </Button>
                        </div>
                      </div>
                      <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                    </div>

                    {/* Cor + Nome + Título + Descrição */}
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">Cor principal</Label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={editingForm.primary_color} onChange={e => setEditingForm((f: any) => ({ ...f, primary_color: e.target.value }))} className="h-9 w-12 rounded-lg cursor-pointer border p-0.5" />
                        <Input value={editingForm.primary_color} onChange={e => setEditingForm((f: any) => ({ ...f, primary_color: e.target.value }))} className="h-9 text-xs font-mono flex-1" />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Nome interno *</Label>
                      <Input placeholder="Ex: Formulário Site" value={editingForm.name} onChange={e => setEditingForm((f: any) => ({ ...f, name: e.target.value }))} className="h-9 text-sm" />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Título do formulário *</Label>
                      <Input placeholder="Ex: Fale com um especialista" value={editingForm.title} onChange={e => setEditingForm((f: any) => ({ ...f, title: e.target.value }))} className="h-9 text-sm" />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Subtítulo / Descrição</Label>
                      <Textarea placeholder="Breve descrição do formulário..." value={editingForm.description} onChange={e => setEditingForm((f: any) => ({ ...f, description: e.target.value }))} rows={2} className="text-sm resize-none" />
                    </div>
                  </div>
                )}

                {/* Tab: Campos */}
                {editorTab === 'campos' && (
                  <div className="p-5 space-y-3">
                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Perguntas</h3>

                    {(editingForm.fields as FormField[]).map((field, idx) => (
                      <div key={field.id} className={`border rounded-xl p-3 space-y-3 transition-all ${field.enabled ? 'bg-card border-border/60' : 'bg-muted/30 opacity-60'}`}>
                        {/* Cabeçalho do campo */}
                        <div className="flex items-center gap-2">
                          <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <Input
                              value={field.label}
                              onChange={e => updateField(field.id, { label: e.target.value })}
                              className="h-7 text-sm border-0 border-b border-border/40 rounded-none px-0 focus-visible:ring-0 font-medium bg-transparent"
                              placeholder="Pergunta..."
                            />
                          </div>
                          {/* Tipo */}
                          <div className="relative shrink-0">
                            <button
                              onClick={() => setShowTypeMenu(showTypeMenu === field.id ? null : field.id)}
                              className="flex items-center gap-1 text-[10px] text-muted-foreground border rounded-md px-2 py-1 hover:bg-accent transition-colors"
                            >
                              {(() => { const t = FIELD_TYPES.find(t => t.value === field.type); return t ? <t.icon className="h-3 w-3" /> : null; })()}
                              <span className="hidden sm:inline">{FIELD_TYPES.find(t => t.value === field.type)?.label || field.type}</span>
                              <ChevronDown className="h-3 w-3" />
                            </button>
                            {showTypeMenu === field.id && (
                              <div className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-xl shadow-lg p-1 w-52">
                                {FIELD_TYPES.map(ft => (
                                  <button key={ft.value}
                                    onClick={() => { updateField(field.id, { type: ft.value, options: ['select','radio','checkbox'].includes(ft.value) ? (field.options || ['Opção 1','Opção 2']) : undefined }); setShowTypeMenu(null); }}
                                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs hover:bg-accent transition-colors ${field.type === ft.value ? 'bg-primary/10 text-primary' : ''}`}>
                                    <ft.icon className="h-3.5 w-3.5 shrink-0" />
                                    <div><p className="font-medium">{ft.label}</p><p className="text-muted-foreground text-[10px]">{ft.desc}</p></div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          {/* Ações */}
                          <div className="flex items-center gap-1 shrink-0">
                            <Switch checked={field.enabled} onCheckedChange={v => updateField(field.id, { enabled: v })} className="scale-75" />
                            {!['name', 'email', 'phone'].includes(field.id) && (
                              <button onClick={() => removeField(field.id)} className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Placeholder (para tipos simples) */}
                        {['text','textarea','email','tel','number'].includes(field.type) && (
                          <Input value={field.placeholder} onChange={e => updateField(field.id, { placeholder: e.target.value })}
                            placeholder="Texto de ajuda (placeholder)..." className="h-7 text-xs bg-muted/30" />
                        )}

                        {/* Opções (para select/radio/checkbox) */}
                        {['select','radio','checkbox'].includes(field.type) && (
                          <div className="space-y-1.5">
                            {(field.options || []).map((opt, i) => (
                              <div key={i} className="flex items-center gap-1.5">
                                <div className="shrink-0">
                                  {field.type === 'radio' && <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
                                  {field.type === 'checkbox' && <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" />}
                                  {field.type === 'select' && <span className="text-[10px] text-muted-foreground font-mono w-4 text-center">{i+1}</span>}
                                </div>
                                <Input value={opt} onChange={e => updateOption(field.id, i, e.target.value)} className="h-7 text-xs flex-1" />
                                {(field.options || []).length > 1 && (
                                  <button onClick={() => removeOption(field.id, i)} className="text-muted-foreground hover:text-red-400 transition-colors">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                            <button onClick={() => addOption(field.id)} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                              <Plus className="h-3 w-3" /> Adicionar opção
                            </button>
                          </div>
                        )}

                        {/* Obrigatório */}
                        <div className="flex items-center gap-2 pt-1 border-t border-border/20">
                          <input type="checkbox" id={`req-${field.id}`} checked={field.required} onChange={() => updateField(field.id, { required: !field.required })} className="w-3.5 h-3.5 rounded" />
                          <label htmlFor={`req-${field.id}`} className="text-[11px] text-muted-foreground cursor-pointer select-none">Obrigatório</label>
                        </div>
                      </div>
                    ))}

                    {/* Botão adicionar */}
                    <div className="relative">
                      <button
                        onClick={() => setShowTypeMenu(showTypeMenu === '__add__' ? null : '__add__')}
                        className="w-full border-2 border-dashed rounded-xl py-3 text-sm text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors flex items-center justify-center gap-2">
                        <Plus className="h-4 w-4" /> Adicionar pergunta
                      </button>
                      {showTypeMenu === '__add__' && (
                        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border rounded-xl shadow-lg p-2 grid grid-cols-2 gap-1">
                          {FIELD_TYPES.map(ft => (
                            <button key={ft.value} onClick={() => addField(ft.value)}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs hover:bg-accent transition-colors">
                              <ft.icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span>{ft.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Tab: Configurações */}
                {editorTab === 'config' && (
                  <div className="p-5 space-y-4">
                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Configurações</h3>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Mensagem de sucesso</Label>
                      <Textarea value={editingForm.success_message} onChange={e => setEditingForm((f: any) => ({ ...f, success_message: e.target.value }))} rows={2} className="text-sm resize-none" />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">URL de redirecionamento</Label>
                      <Input placeholder="https://..." value={editingForm.redirect_url} onChange={e => setEditingForm((f: any) => ({ ...f, redirect_url: e.target.value }))} className="h-9 text-sm" />
                      <p className="text-[10px] text-muted-foreground">Após envio, redireciona para esta URL (opcional)</p>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Instância WhatsApp para follow-up</Label>
                      <select className="w-full h-9 text-sm border rounded-md px-3 bg-background" value={editingForm.instance_id || ''} onChange={e => setEditingForm((f: any) => ({ ...f, instance_id: e.target.value || null }))}>
                        <option value="">— Selecionar instância —</option>
                        {instances.map(i => <option key={i.id} value={i.id}>{i.instance_name}</option>)}
                      </select>
                    </div>

                    <div className="flex items-center gap-3 p-3 border rounded-xl bg-muted/20">
                      <Switch checked={editingForm.is_active} onCheckedChange={v => setEditingForm((f: any) => ({ ...f, is_active: v }))} />
                      <div>
                        <p className="text-sm font-medium">Formulário ativo</p>
                        <p className="text-xs text-muted-foreground">Leads só são capturados quando ativo</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab: Follow-up */}
                {editorTab === 'followup' && (
                  <div className="p-5 space-y-4">
                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Sequência de Follow-up</h3>
                    <p className="text-xs text-muted-foreground">Mensagens enviadas automaticamente via WhatsApp após o lead preencher. Use <code className="bg-muted px-1 rounded">{'{nome}'}</code> para personalizar.</p>
                    <p className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                      ⚠️ O follow-up usa a instância WhatsApp configurada na aba Configurações.
                    </p>

                    {/* Mini sequência inline */}
                    <div className="space-y-3">
                      {steps.map((step, idx) => (
                        <div key={idx} className="border rounded-xl p-3 space-y-2 bg-muted/10">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-purple-500">Mensagem {idx + 1}</span>
                            {steps.length > 1 && (
                              <button onClick={() => setSteps(s => s.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                            )}
                          </div>
                          {idx > 0 && (
                            <div className="flex items-center gap-2">
                              <Label className="text-[10px] whitespace-nowrap">Enviar após</Label>
                              <Input type="number" min={0} value={step.delay_hours} onChange={e => setSteps(s => s.map((st, i) => i === idx ? { ...st, delay_hours: Number(e.target.value) } : st))} className="h-7 text-xs w-20" />
                              <span className="text-xs text-muted-foreground">horas</span>
                            </div>
                          )}
                          <Textarea rows={3} placeholder="Olá {nome}, vi que você se cadastrou..." value={step.message_text} onChange={e => setSteps(s => s.map((st, i) => i === idx ? { ...st, message_text: e.target.value } : st))} className="text-xs resize-none" />
                        </div>
                      ))}
                      <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => setSteps(s => [...s, { step_order: s.length + 1, delay_hours: 24, message_text: '' }])}>
                        <Plus className="h-3.5 w-3.5" /> Adicionar mensagem
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Preview ao vivo ── */}
              <div className="flex-1 bg-gray-100 dark:bg-gray-900 overflow-y-auto flex items-start justify-center p-6">
                <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
                  {/* Capa */}
                  {editingForm.cover_url ? (
                    <div className="h-36 relative" style={{ backgroundImage: `url(${editingForm.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
                      {editingForm.logo_url && (
                        <div className="absolute -bottom-8 left-6 w-16 h-16 rounded-full border-4 border-white shadow-lg overflow-hidden bg-white">
                          <img src={editingForm.logo_url} alt="logo" className="w-full h-full object-contain" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="h-24 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${color}22, ${color}66)` }}>
                      {editingForm.logo_url
                        ? <img src={editingForm.logo_url} alt="logo" className="h-14 object-contain" />
                        : <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-lg" style={{ background: color }}>{editingForm.title?.[0] || '?'}</div>}
                    </div>
                  )}

                  {/* Conteúdo */}
                  <div className={`p-6 space-y-5 ${editingForm.cover_url && editingForm.logo_url ? 'pt-12' : ''}`}>
                    <div>
                      <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">{editingForm.title || 'Título do formulário'}</h2>
                      {editingForm.description && <p className="text-sm text-gray-500 mt-1">{editingForm.description}</p>}
                    </div>

                    <div className="space-y-4">
                      {(editingForm.fields as FormField[]).filter(f => f.enabled).map(field => (
                        <FieldPreview key={field.id} field={field} color={color} />
                      ))}
                    </div>

                    <button className="w-full py-3 rounded-xl text-white font-semibold text-sm shadow-md mt-2" style={{ background: color }}>
                      Enviar
                    </button>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Submissões ── */}
      <Dialog open={openSubmissions} onOpenChange={setOpenSubmissions}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Leads — {submForm?.title}</DialogTitle></DialogHeader>
          {submissions.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">Nenhum lead capturado ainda.</div>
          ) : (
            <div className="space-y-2 mt-2">
              {submissions.map(s => (
                <div key={s.id} className="flex items-start justify-between p-3 border rounded-xl bg-muted/10 gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{s.name || '—'}</p>
                    <p className="text-xs text-muted-foreground">{s.phone || ''} {s.email ? `· ${s.email}` : ''}</p>
                    {s.custom_data && Object.keys(s.custom_data).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {Object.entries(s.custom_data).map(([k, v]) => (
                          <Badge key={k} variant="outline" className="text-[10px]">{k}: {String(v)}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">{new Date(s.created_at).toLocaleString('pt-BR')}</span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Sequência (dialog legado para editar de fora) ── */}
      <Dialog open={openSequence} onOpenChange={setOpenSequence}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Follow-up WhatsApp — {seqForm?.title}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground mt-1">Use <code className="bg-muted px-1 rounded">{'{nome}'}</code> para personalizar.</p>
          <div className="space-y-3 mt-4">
            {steps.map((step, idx) => (
              <div key={idx} className="border rounded-xl p-4 space-y-3 bg-muted/10">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-500">Mensagem {idx + 1}</span>
                  {steps.length > 1 && <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400" onClick={() => setSteps(s => s.filter((_, i) => i !== idx))}><Trash2 className="h-3 w-3" /></Button>}
                </div>
                {idx > 0 && (
                  <div className="flex items-center gap-2">
                    <Label className="text-[10px]">Enviar após</Label>
                    <Input type="number" min={0} value={step.delay_hours} onChange={e => setSteps(s => s.map((st, i) => i === idx ? { ...st, delay_hours: Number(e.target.value) } : st))} className="h-8 text-xs w-24" />
                    <span className="text-xs text-muted-foreground">horas</span>
                  </div>
                )}
                <Textarea rows={3} placeholder="Sua mensagem..." value={step.message_text} onChange={e => setSteps(s => s.map((st, i) => i === idx ? { ...st, message_text: e.target.value } : st))} className="text-xs resize-none" />
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
    </Wrapper>
  );
}
