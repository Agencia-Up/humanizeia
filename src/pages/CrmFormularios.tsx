import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
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
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import {
  ClipboardCopy, ExternalLink, FilePlus2, Loader2, Pencil, Plus, Trash2,
  Users, Zap, Image, Type, AlignLeft, ChevronDown, CheckSquare,
  Circle, Star, Calendar, Hash, Mail, Phone, Upload, X, GripVertical,
  Eye, Settings, LayoutTemplate, MessageSquare, QrCode, Download, Printer,
  FileDown, ChevronRight, ChevronUp, Kanban,
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
  contact_list_id: string | null;
  agent_id?: string | null; pedro_opener_template?: string | null;
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
  redirect_url: '', instance_id: null, contact_list_id: null,
  agent_id: null, pedro_opener_template: '',
  is_active: true,
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

/* ─── Rascunho localStorage ─────────────────────────────────────────────── */
const DRAFT_KEY = 'crm_formularios_editor_draft';

/* ─── Componente principal ──────────────────────────────────────────────── */
export default function CrmFormularios({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { isSeller, seller, loading: sellerLoading } = useSellerProfile(user?.id);
  const effectiveUserId = useMemo(() => {
    if (sellerLoading) return null;
    if (isSeller && seller?.user_id) return seller.user_id;
    return user?.id || null;
  }, [sellerLoading, isSeller, seller, user]);
  const { toast } = useToast();

  // Vendedor NUNCA vê formulários do master (regra: vendedor só vê leads que ele atendeu)
  // O bloqueio precisa vir DEPOIS de todos os hooks pra não quebrar Rules of Hooks
  const blockSellerAccess = !sellerLoading && isSeller && !embedded;

  const [forms, setForms] = useState<CaptureForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [instances, setInstances] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);

  const [openEditor, setOpenEditor]       = useState(false);
  const [openSubmissions, setOpenSubmissions] = useState(false);
  const [openSequence, setOpenSequence]   = useState(false);
  const [editingForm, setEditingForm]     = useState<any>(EMPTY_FORM);
  const [editingId, setEditingId]         = useState<string | null>(null);
  const [saving, setSaving]               = useState(false);
  const [editorTab, setEditorTab]         = useState('design');

  const [submissions, setSubmissions]     = useState<any[]>([]);
  const [submForm, setSubmForm]           = useState<CaptureForm | null>(null);
  const [submExpanded, setSubmExpanded]   = useState<string | null>(null);
  const [syncingCrm, setSyncingCrm]       = useState(false);

  const [seqForm, setSeqForm]             = useState<CaptureForm | null>(null);
  const [sequence, setSequence]           = useState<any>(null);
  const [steps, setSteps]                 = useState<SequenceStep[]>([]);
  const [savingSeq, setSavingSeq]         = useState(false);

  const [uploadingLogo, setUploadingLogo]   = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [showTypeMenu, setShowTypeMenu]     = useState<string | null>(null);

  const [contactLists, setContactLists]   = useState<any[]>([]);
  const [newListName, setNewListName]     = useState('');

  const [qrForm, setQrForm]     = useState<CaptureForm | null>(null);
  const [openQr, setOpenQr]     = useState(false);
  const [creatingList, setCreatingList]   = useState(false);

  const logoRef  = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  // Restaura rascunho do localStorage ao abrir o componente
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft && draft.editingForm) {
        setEditingForm(draft.editingForm);
        setEditingId(draft.editingId || null);
        setEditorTab(draft.editorTab || 'design');
        setSteps(draft.steps || [{ step_order: 1, delay_hours: 0, message_text: '' }]);
        setOpenEditor(true);
      }
    } catch (_) { /* ignora erros de parse */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Salva rascunho no localStorage sempre que o editor tiver dados
  useEffect(() => {
    if (!openEditor) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ editingForm, editingId, editorTab, steps }));
    } catch (_) { /* ignora */ }
  }, [openEditor, editingForm, editingId, editorTab, steps]);
  const baseUrl  = `${window.location.origin}/f`;

  /* ── fetch ── */
  const fetchAll = useCallback(async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    try {
      const [{ data: f, error: fErr }, { data: i, error: iErr }, { data: cl, error: clErr }, { data: ag, error: agErr }] = await Promise.all([
        (supabase as any).from('capture_forms').select('*').eq('user_id', effectiveUserId).order('created_at', { ascending: false }),
        (supabase as any).from('wa_instances').select('id, instance_name').eq('user_id', effectiveUserId).eq('is_active', true),
        (supabase as any).from('wa_contact_lists').select('id, name, contact_count').eq('user_id', effectiveUserId).order('name'),
        (supabase as any).from('wa_ai_agents').select('id, name, is_active').eq('user_id', effectiveUserId).eq('is_active', true).order('created_at', { ascending: false }),
      ]);
      if (fErr) console.error('fetchAll forms error:', fErr.message);
      if (iErr) console.error('fetchAll instances error:', iErr.message);
      if (clErr) console.error('fetchAll contact lists error:', clErr.message);
      if (agErr) console.error('fetchAll agents error:', agErr.message);
      setForms(f || []);
      setInstances(i || []);
      setContactLists(cl || []);
      setAgents(ag || []);
    } catch (err: any) {
      console.error('fetchAll error:', err?.message || err);
    } finally {
      setLoading(false);
    }
  }, [effectiveUserId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* ── upload de imagem ── */
  const uploadImage = async (file: File, prefix: string): Promise<string | null> => {
    try {
      const ext = file.name.split('.').pop();
      const path = `forms/${effectiveUserId!}/${prefix}_${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('creatives').upload(path, file, { upsert: true });
      if (error) throw error;
      return supabase.storage.from('creatives').getPublicUrl(path).data.publicUrl;
    } catch (err: any) {
      console.error('Upload error:', err?.message || err);
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

  /* ── abrir editor (carrega sequência se existir) ── */
  const handleOpenEditor = async (form?: CaptureForm) => {
    if (form) {
      setEditingId(form.id);
      setEditingForm({ ...EMPTY_FORM, ...form });
      // Carrega sequência de follow-up do banco
      const { data: seq } = await (supabase as any)
        .from('followup_sequences')
        .select('*, steps:followup_sequence_steps(*)')
        .eq('form_id', form.id)
        .eq('user_id', effectiveUserId!)
        .maybeSingle();
      if (seq) {
        setSequence(seq);
        setSteps([...seq.steps].sort((a: any, b: any) => a.step_order - b.step_order));
      } else {
        setSequence(null);
        setSteps([{ step_order: 1, delay_hours: 0, message_text: '' }]);
      }
    } else {
      setEditingId(null);
      setEditingForm(EMPTY_FORM);
      setSequence(null);
      setSteps([{ step_order: 1, delay_hours: 0, message_text: '' }]);
    }
    setEditorTab('design');
    setOpenEditor(true);
  };

  /* ── salvar formulário (inclui sequência de follow-up) ── */
  const handleSaveForm = async () => {
    if (!effectiveUserId) return;
    if (!editingForm.name.trim() || !editingForm.title.trim()) {
      toast({ title: 'Preencha nome interno e título.', variant: 'destructive' }); return;
    }
    setSaving(true);
    try {
      const payload = { ...editingForm, user_id: effectiveUserId };
      let formId = editingId;
      if (editingId) {
        const { error } = await (supabase as any).from('capture_forms').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { data: newForm, error } = await (supabase as any).from('capture_forms').insert(payload).select('id').single();
        if (error) throw error;
        formId = newForm.id;
      }

      // Salva sequência de follow-up se houver mensagens preenchidas
      const filledSteps = steps.filter(s => s.message_text.trim());
      if (filledSteps.length > 0 && formId) {
        let seqId = sequence?.id;
        if (!seqId) {
          const { data: newSeq, error: seqErr } = await (supabase as any)
            .from('followup_sequences')
            .insert({ user_id: effectiveUserId, form_id: formId, name: `Sequência — ${editingForm.name}`, instance_id: editingForm.instance_id || null, is_active: true })
            .select('id').single();
          if (seqErr) console.error('Erro ao criar sequência:', seqErr.message);
          else seqId = newSeq?.id;
        } else {
          await (supabase as any).from('followup_sequences')
            .update({ instance_id: editingForm.instance_id || null, is_active: true })
            .eq('id', seqId);
        }
        if (seqId) {
          await (supabase as any).from('followup_sequence_steps').delete().eq('sequence_id', seqId);
          for (let i = 0; i < filledSteps.length; i++) {
            await (supabase as any).from('followup_sequence_steps').insert({
              sequence_id: seqId, user_id: effectiveUserId, step_order: i + 1,
              delay_hours: filledSteps[i].delay_hours, message_text: filledSteps[i].message_text,
            });
          }
        }
      }

      toast({ title: editingId ? '✅ Formulário atualizado!' : '✅ Formulário criado!' });
      localStorage.removeItem(DRAFT_KEY);
      setOpenEditor(false); fetchAll();
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este formulário?')) return;
    const { error } = await (supabase as any).from('capture_forms').delete().eq('id', id);
    if (error) {
      toast({ title: 'Erro ao excluir', description: error.message, variant: 'destructive' });
      return;
    }
    fetchAll();
  };

  /* ── criar lista de contatos inline ── */
  const handleCreateList = async () => {
    if (!effectiveUserId || !newListName.trim()) return;
    setCreatingList(true);
    try {
      const { data, error } = await (supabase as any)
        .from('wa_contact_lists')
        .insert({ user_id: effectiveUserId, name: newListName.trim(), source: 'form' })
        .select('id, name, contact_count')
        .single();
      if (error) throw error;
      setContactLists(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setEditingForm((f: any) => ({ ...f, contact_list_id: data.id }));
      setNewListName('');
      toast({ title: `✅ Lista "${data.name}" criada e selecionada!` });
    } catch (err: any) {
      toast({ title: 'Erro ao criar lista', description: err.message, variant: 'destructive' });
    } finally {
      setCreatingList(false);
    }
  };

  const openSubs = async (form: CaptureForm) => {
    setSubmForm(form);
    const { data } = await (supabase as any).from('capture_form_submissions').select('*').eq('form_id', form.id).order('created_at', { ascending: false });
    setSubmissions(data || []); setOpenSubmissions(true);
  };

  const syncSubmissionsToCRM = async () => {
    if (!effectiveUserId || !submForm || submissions.length === 0) return;
    setSyncingCrm(true);
    try {
      // 1. Garante que o pipeline existe
      let { data: stage } = await (supabase as any)
        .from('crm_pipeline_stages')
        .select('id')
        .eq('user_id', effectiveUserId)
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!stage) {
        const defaults = [
          { user_id: effectiveUserId, name: 'Novo Lead',   color: '#6366f1', position: 0, is_default: true },
          { user_id: effectiveUserId, name: 'Qualificado', color: '#f59e0b', position: 1, is_default: false },
          { user_id: effectiveUserId, name: 'Proposta',    color: '#3b82f6', position: 2, is_default: false },
          { user_id: effectiveUserId, name: 'Negociação',  color: '#8b5cf6', position: 3, is_default: false },
          { user_id: effectiveUserId, name: 'Venda concluída', color: '#10b981', position: 4, is_default: false },
          { user_id: effectiveUserId, name: 'Carro não disponível', color: '#f43f5e', position: 5, is_default: false },
          { user_id: effectiveUserId, name: 'Porta',       color: '#14b8a6', position: 6, is_default: false },
        ];
        await supabase.from('crm_pipeline_stages' as any).insert(defaults);
        const { data: newStage } = await (supabase as any)
          .from('crm_pipeline_stages')
          .select('id')
          .eq('user_id', effectiveUserId)
          .order('position', { ascending: true })
          .limit(1)
          .maybeSingle();
        stage = newStage;
      }

      if (!stage) throw new Error('Não foi possível criar o pipeline');

      // 2. Busca leads já existentes de formulários (para evitar duplicatas)
      const { data: existingLeads } = await (supabase as any)
        .from('crm_leads')
        .select('custom_fields')
        .eq('user_id', effectiveUserId)
        .like('source', 'form:%');

      const existingSubmissionIds = new Set(
        (existingLeads || []).map((l: any) => l.custom_fields?.submission_id).filter(Boolean)
      );

      // 3. Insere leads que ainda não estão no CRM
      const toInsert = submissions
        .filter(s => !existingSubmissionIds.has(s.id))
        .map((s, i) => ({
          user_id: effectiveUserId!,
          stage_id: stage.id,
          name: s.name || 'Lead sem nome',
          email: s.email || null,
          phone: s.phone || null,
          source: `form:${submForm!.name}`,
          position: i,
          custom_fields: { ...(s.custom_data || {}), submission_id: s.id },
        }));

      if (toInsert.length === 0) {
        toast({ title: '✅ Todos os leads já estão no CRM!' });
        return;
      }

      const { error } = await supabase.from('crm_leads' as any).insert(toInsert);
      if (error) throw error;

      toast({ title: `✅ ${toInsert.length} lead${toInsert.length > 1 ? 's' : ''} enviado${toInsert.length > 1 ? 's' : ''} para o CRM!` });
    } catch (e: any) {
      toast({ title: 'Erro ao sincronizar', description: e.message, variant: 'destructive' });
    } finally {
      setSyncingCrm(false);
    }
  };

  const openSeq = async (form: CaptureForm) => {
    setSeqForm(form);
    const { data: seq } = await (supabase as any).from('followup_sequences').select('*, steps:followup_sequence_steps(*)').eq('form_id', form.id).eq('user_id', effectiveUserId!).maybeSingle();
    if (seq) { setSequence(seq); setSteps([...seq.steps].sort((a: any, b: any) => a.step_order - b.step_order)); }
    else { setSequence(null); setSteps([{ step_order: 1, delay_hours: 0, message_text: '' }]); }
    setOpenSequence(true);
  };

  const handleSaveSequence = async () => {
    if (!effectiveUserId || !seqForm) return;
    if (steps.some(s => !s.message_text.trim())) { toast({ title: 'Preencha todas as mensagens.', variant: 'destructive' }); return; }
    setSavingSeq(true);
    try {
      let seqId = sequence?.id;
      if (!seqId) {
        const { data: newSeq } = await (supabase as any).from('followup_sequences').insert({ user_id: effectiveUserId, form_id: seqForm.id, name: `Sequência — ${seqForm.name}`, instance_id: seqForm.instance_id, is_active: true }).select('id').single();
        seqId = newSeq.id;
      } else {
        await (supabase as any).from('followup_sequences').update({ instance_id: seqForm.instance_id, is_active: true }).eq('id', seqId);
      }
      await (supabase as any).from('followup_sequence_steps').delete().eq('sequence_id', seqId);
      for (let i = 0; i < steps.length; i++) {
        await (supabase as any).from('followup_sequence_steps').insert({ sequence_id: seqId, user_id: effectiveUserId, step_order: i + 1, delay_hours: steps[i].delay_hours, message_text: steps[i].message_text });
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

  const downloadQrPng = (form: CaptureForm) => {
    const canvas = document.getElementById(`qr-canvas-${form.id}`) as HTMLCanvasElement;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `qrcode-${form.name.replace(/\s+/g, '-').toLowerCase()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const printQr = (form: CaptureForm) => {
    const url = `${baseUrl}/${form.id}`;
    const color = form.primary_color || '#6366f1';
    const win = window.open('', '_blank', 'width=600,height=700');
    if (!win) return;
    const canvas = document.getElementById(`qr-canvas-${form.id}`) as HTMLCanvasElement;
    const dataUrl = canvas?.toDataURL('image/png') || '';
    win.document.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <title>QR Code — ${form.title}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 32px; }
          .card { text-align: center; max-width: 360px; width: 100%; }
          .badge { display: inline-block; background: ${color}22; color: ${color}; border: 1.5px solid ${color}55; border-radius: 99px; padding: 4px 14px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 20px; }
          .qr { display: block; margin: 0 auto 20px; border: 3px solid #f1f1f1; border-radius: 16px; padding: 12px; }
          h1 { font-size: 22px; font-weight: 800; color: #111; margin-bottom: 6px; }
          p  { font-size: 13px; color: #666; margin-bottom: 20px; }
          .url { font-size: 11px; color: #aaa; word-break: break-all; border-top: 1px dashed #e5e5e5; padding-top: 16px; margin-top: 8px; }
          @media print { body { min-height: unset; } }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="badge">Formulário</div>
          <img class="qr" src="${dataUrl}" width="220" height="220" alt="QR Code" />
          <h1>${form.title}</h1>
          ${form.description ? `<p>${form.description}</p>` : ''}
          <div class="url">${url}</div>
        </div>
        <script>window.onload = () => { window.print(); }<\/script>
      </body>
      </html>
    `);
    win.document.close();
  };

  const color = editingForm.primary_color || '#6366f1';

  /* ── render ── */

  // Vendedor não tem acesso aos formulários (master-only feature)
  if (blockSellerAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  if (loading) {
    const spinner = <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
    return embedded ? spinner : <MainLayout>{spinner}</MainLayout>;
  }

  const mainContent = (
      <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Formulários de Captura</h1>
          <p className="text-sm text-muted-foreground mt-1">Crie formulários personalizados e capture leads direto no CRM.</p>
        </div>
        <Button onClick={() => handleOpenEditor()} className="gap-2">
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
                {form.contact_list_id && (() => {
                  const list = contactLists.find(l => l.id === form.contact_list_id);
                  return list ? (
                    <div className="flex items-center gap-1 text-[10px] text-purple-500 bg-purple-500/10 border border-purple-500/20 rounded-full px-2 py-0.5 w-fit">
                      <Users className="h-2.5 w-2.5" />
                      <span className="truncate max-w-[160px]">{list.name}</span>
                    </div>
                  ) : null;
                })()}
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => copyLink(form.id)}><ClipboardCopy className="h-3 w-3" />Link</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => window.open(`/f/${form.id}`, '_blank')}><ExternalLink className="h-3 w-3" />Ver</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-indigo-500 border-indigo-500/30 hover:bg-indigo-500/10" onClick={() => { setQrForm(form); setOpenQr(true); }}><QrCode className="h-3 w-3" />QR Code</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openSubs(form)}><Users className="h-3 w-3" />Leads</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-purple-500 border-purple-500/30 hover:bg-purple-500/10" onClick={() => openSeq(form)}><Zap className="h-3 w-3" />Follow-up</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleOpenEditor(form)}><Pencil className="h-3 w-3" />Editar</Button>
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
      <Dialog open={openEditor} onOpenChange={() => {}}>
        <DialogContent
          className="max-w-[95vw] w-[1100px] max-h-[95vh] p-0 overflow-hidden flex flex-col"
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <DialogHeader className="px-6 py-4 border-b border-border/40 flex-row items-center justify-between space-y-0 shrink-0">
            <DialogTitle className="text-base font-semibold">{editingId ? 'Editar Formulário' : 'Novo Formulário'}</DialogTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => window.open(`/f/preview`, '_blank')} className="h-8 gap-1.5 text-xs">
                <Eye className="h-3.5 w-3.5" /> Pré-visualizar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { if (confirm('Fechar sem salvar? Alterações não salvas serão perdidas.')) { localStorage.removeItem(DRAFT_KEY); setOpenEditor(false); } }}
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5 mr-1" /> Fechar
              </Button>
              <Button size="sm" onClick={handleSaveForm} disabled={saving} className="h-8 gap-1.5 text-xs">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {editingId ? 'Salvar alterações' : 'Criar formulário'}
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

                    {/* ── Quem atende este formulário ── */}
                    <div className="space-y-2 p-3 border rounded-xl bg-muted/10">
                      <Label className="text-xs font-semibold">Quem atende este formulário?</Label>
                      <select
                        className="w-full h-9 text-sm border rounded-md px-3 bg-background"
                        value={editingForm.agent_id ? 'pedro' : 'marcos'}
                        onChange={e => setEditingForm((f: any) => ({
                          ...f,
                          agent_id: e.target.value === 'pedro' ? (f.agent_id || agents[0]?.id || null) : null,
                        }))}
                      >
                        <option value="marcos">Marcos — CRM + follow-up (mensagens prontas)</option>
                        <option value="pedro">Pedro — IA qualifica e transfere o lead</option>
                      </select>

                      {editingForm.agent_id && (
                        <div className="space-y-2 pt-1">
                          {agents.length === 0 ? (
                            <p className="text-[11px] text-amber-600 dark:text-amber-400">
                              Nenhum agente Pedro ativo. Crie/ative um agente antes de usar o atendimento por IA.
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              <Label className="text-xs font-semibold">Agente Pedro</Label>
                              <select
                                className="w-full h-9 text-sm border rounded-md px-3 bg-background"
                                value={editingForm.agent_id || ''}
                                onChange={e => setEditingForm((f: any) => ({ ...f, agent_id: e.target.value || null }))}
                              >
                                {agents.map(a => <option key={a.id} value={a.id}>{a.name || 'Pedro'}</option>)}
                              </select>
                            </div>
                          )}

                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Mensagem de abertura</Label>
                            <Textarea
                              value={editingForm.pedro_opener_template || ''}
                              onChange={e => setEditingForm((f: any) => ({ ...f, pedro_opener_template: e.target.value }))}
                              rows={2}
                              className="text-sm resize-none"
                              placeholder="Oi {nome}! Recebemos seu cadastro aqui. Posso te ajudar?"
                            />
                            <p className="text-[10px] text-muted-foreground leading-relaxed">
                              O Pedro envia essa mensagem pelo WhatsApp assim que o lead se cadastra. Use <code>{'{nome}'}</code> para o primeiro nome. Quando o lead responder, a IA assume e qualifica. A instância usada é a selecionada em "Instância WhatsApp" abaixo (ou a do agente).
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

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

                    {/* ── Lista de contatos ── */}
                    <div className="space-y-2 p-3 border rounded-xl bg-muted/10">
                      <div className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-purple-500" />
                        <Label className="text-xs font-semibold text-purple-600 dark:text-purple-400">Lista de contatos para salvar leads</Label>
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        Cada lead que preencher o formulário será adicionado automaticamente à lista. Use essa lista depois nos disparos em massa ou no funil de follow-up.
                      </p>
                      <select
                        className="w-full h-9 text-sm border rounded-md px-3 bg-background"
                        value={editingForm.contact_list_id || ''}
                        onChange={e => setEditingForm((f: any) => ({ ...f, contact_list_id: e.target.value || null }))}
                      >
                        <option value="">— Nenhuma lista —</option>
                        {contactLists.map(l => (
                          <option key={l.id} value={l.id}>
                            {l.name} ({l.contact_count ?? 0} contatos)
                          </option>
                        ))}
                      </select>
                      {/* Criar nova lista inline */}
                      <div className="flex items-center gap-2 pt-0.5">
                        <Input
                          placeholder="Criar nova lista..."
                          value={newListName}
                          onChange={e => setNewListName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateList(); } }}
                          className="h-8 text-xs flex-1"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs gap-1 shrink-0 border-purple-500/40 text-purple-600 hover:bg-purple-500/10"
                          onClick={handleCreateList}
                          disabled={!newListName.trim() || creatingList}
                        >
                          {creatingList ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                          Criar lista
                        </Button>
                      </div>
                      {editingForm.contact_list_id && (
                        <div className="flex items-center gap-1.5 text-[10px] text-green-600 dark:text-green-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                          Leads serão salvos automaticamente na lista selecionada
                        </div>
                      )}
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
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] flex flex-col p-0 overflow-hidden">
          {/* Header */}
          <DialogHeader className="px-6 py-4 border-b border-border/40 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-purple-500" />
                  Leads capturados — {submForm?.title}
                </DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {submissions.length} {submissions.length === 1 ? 'resposta' : 'respostas'} recebidas
                </p>
              </div>
              {submissions.length > 0 && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs h-8 text-purple-500 border-purple-500/30 hover:bg-purple-500/10"
                    onClick={syncSubmissionsToCRM}
                    disabled={syncingCrm}
                  >
                    {syncingCrm ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Kanban className="h-3.5 w-3.5" />}
                    Enviar para CRM
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs h-8"
                    onClick={() => {
                      if (!submForm || submissions.length === 0) return;
                      const customKeys = Array.from(new Set(submissions.flatMap(s => Object.keys(s.custom_data || {}))));
                      const headers = ['Nome', 'WhatsApp', 'E-mail', ...customKeys, 'Data'];
                      const rows = submissions.map(s => [
                        s.name || '',
                        s.phone || '',
                        s.email || '',
                        ...customKeys.map(k => String(s.custom_data?.[k] ?? '')),
                        new Date(s.created_at).toLocaleString('pt-BR'),
                      ]);
                      const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
                      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
                      const link = document.createElement('a');
                      link.href = URL.createObjectURL(blob);
                      link.download = `leads-${submForm.name.replace(/\s+/g,'-').toLowerCase()}.csv`;
                      link.click();
                    }}
                  >
                    <FileDown className="h-3.5 w-3.5" /> Exportar CSV
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>

          {/* Conteúdo */}
          <div className="flex-1 overflow-auto p-4 space-y-2">
            {submissions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Users className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">Nenhum lead capturado ainda</p>
                <p className="text-xs text-muted-foreground mt-1">Compartilhe o formulário para começar a receber respostas</p>
              </div>
            ) : (() => {
              // Monta colunas dinâmicas com base em custom_data de todas as submissões
              const customKeys = Array.from(new Set(submissions.flatMap(s => Object.keys(s.custom_data || {}))));
              return (
                <div className="space-y-2">
                  {submissions.map((s, idx) => {
                    const isExpanded = submExpanded === s.id;
                    const hasCustom = customKeys.length > 0;
                    return (
                      <div key={s.id} className="border rounded-xl overflow-hidden bg-card hover:border-primary/30 transition-colors">
                        {/* Linha principal */}
                        <div
                          className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
                          onClick={() => setSubmExpanded(isExpanded ? null : s.id)}
                        >
                          {/* Número */}
                          <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
                            {idx + 1}
                          </span>

                          {/* Info principal */}
                          <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4">
                            <div className="min-w-0">
                              <p className="font-semibold text-sm truncate">{s.name || '—'}</p>
                              <p className="text-[10px] text-muted-foreground">Nome</p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm truncate">{s.phone || '—'}</p>
                              <p className="text-[10px] text-muted-foreground">WhatsApp</p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm truncate">{s.email || '—'}</p>
                              <p className="text-[10px] text-muted-foreground">E-mail</p>
                            </div>
                          </div>

                          {/* Data + expand */}
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-muted-foreground hidden sm:block">
                              {new Date(s.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })}
                            </span>
                            {hasCustom && (
                              <span className="text-muted-foreground">
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Respostas expandidas */}
                        {isExpanded && hasCustom && (
                          <div className="border-t border-border/40 bg-muted/5 px-4 py-3">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Respostas do formulário</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {customKeys.map(k => (
                                <div key={k} className="space-y-0.5">
                                  <p className="text-[10px] text-muted-foreground leading-tight">{k}</p>
                                  <p className="text-sm font-medium bg-muted/40 rounded-lg px-3 py-1.5 min-h-[32px] flex items-center">
                                    {String(s.custom_data?.[k] ?? '—')}
                                  </p>
                                </div>
                              ))}
                            </div>
                            {/* UTM se houver */}
                            {(s.utm_source || s.utm_campaign) && (
                              <div className="flex gap-2 mt-3 flex-wrap">
                                {s.utm_source && <Badge variant="outline" className="text-[10px] gap-1">📡 {s.utm_source}</Badge>}
                                {s.utm_campaign && <Badge variant="outline" className="text-[10px] gap-1">🎯 {s.utm_campaign}</Badge>}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
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

      {/* ── QR Code ── */}
      <Dialog open={openQr} onOpenChange={setOpenQr}>
        <DialogContent className="max-w-sm w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-indigo-500" />
              QR Code — {qrForm?.title}
            </DialogTitle>
          </DialogHeader>

          {qrForm && (() => {
            const url = `${baseUrl}/${qrForm.id}`;
            const qrColor = qrForm.primary_color || '#6366f1';
            return (
              <div className="flex flex-col items-center gap-5 pt-2">
                {/* QR visível (SVG) */}
                <div className="p-4 rounded-2xl border-2 border-border/50 bg-white shadow-inner">
                  <QRCodeSVG
                    value={url}
                    size={220}
                    fgColor={qrColor}
                    bgColor="#ffffff"
                    level="H"
                    includeMargin={false}
                  />
                </div>

                {/* Canvas oculto para download/impressão */}
                <QRCodeCanvas
                  id={`qr-canvas-${qrForm.id}`}
                  value={url}
                  size={600}
                  fgColor={qrColor}
                  bgColor="#ffffff"
                  level="H"
                  includeMargin={true}
                  style={{ display: 'none' }}
                />

                <div className="text-center space-y-1 w-full">
                  <p className="font-semibold text-sm text-foreground">{qrForm.title}</p>
                  <p className="text-[11px] text-muted-foreground break-all">{url}</p>
                </div>

                <div className="flex gap-2 w-full">
                  <Button
                    variant="outline"
                    className="flex-1 gap-2 h-10"
                    onClick={() => downloadQrPng(qrForm)}
                  >
                    <Download className="h-4 w-4" /> Baixar PNG
                  </Button>
                  <Button
                    className="flex-1 gap-2 h-10"
                    style={{ background: qrColor }}
                    onClick={() => printQr(qrForm)}
                  >
                    <Printer className="h-4 w-4" /> Imprimir
                  </Button>
                </div>

                <p className="text-[10px] text-muted-foreground text-center">
                  Aponte a câmera do celular para o QR Code para abrir o formulário
                </p>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      </div>
  );

  if (embedded) return <div className="h-full overflow-y-auto">{mainContent}</div>;
  return <MainLayout>{mainContent}</MainLayout>;
}
