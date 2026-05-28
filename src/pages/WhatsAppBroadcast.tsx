import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
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

interface ListContact {
  id: string;
  phone: string;
  name: string | null;
  metadata: Record<string, unknown> | null;
  is_valid: boolean | null;
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

const isGeneratedAITemplate = (value?: string | null) => /^\[IA\]\s*/i.test((value || '').trim());

export default function WhatsAppBroadcast({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { isSeller, seller, visibleFeatures, loading: sellerLoading } = useSellerProfile(user?.id);
  const { toast } = useToast();
  const blockSellerAccess = !sellerLoading && isSeller && !visibleFeatures.marcos_disparo && !embedded;

  const effectiveUserId = useMemo(() => {
    if (sellerLoading) return null;
    if (isSeller && seller?.user_id) return seller.user_id;
    return user?.id || null;
  }, [sellerLoading, isSeller, seller, user]);

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
  const [aiLoading, setAiLoading] = useState(false);
  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [editingList, setEditingList] = useState<ContactList | null>(null);
  const [listEditorName, setListEditorName] = useState('');
  const [listContacts, setListContacts] = useState<ListContact[]>([]);
  const [originalContactIds, setOriginalContactIds] = useState<string[]>([]);
  const [loadingListContacts, setLoadingListContacts] = useState(false);
  const [savingListContacts, setSavingListContacts] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  // Fase 6 Feature C: lista vinda do CRM Pedro (sessionStorage)
  const [prefilledPedro, setPrefilledPedro] = useState<{ phones: string[]; label: string } | null>(null);
  // Bug 28/05/2026: lista RICA vinda do CRM Marcos com name+phone+origem +
  // checkbox individual pra remover antes de criar a campanha.
  type MarcosContact = { id: string; name: string; phone: string; origem: string };
  const [prefilledMarcos, setPrefilledMarcos] = useState<{ contacts: MarcosContact[]; label: string } | null>(null);
  // IDs dos contatos Marcos que o usuario removeu manualmente da lista importada
  const [marcosRemoved, setMarcosRemoved] = useState<Set<string>>(new Set());
  const [creatingMarcosList, setCreatingMarcosList] = useState(false);
  useEffect(() => {
    try {
      const rawMarcos = sessionStorage.getItem('marcos_campaign_contacts');
      if (rawMarcos) {
        const data = JSON.parse(rawMarcos);
        if (Array.isArray(data?.contacts) && data.contacts.length > 0) {
          setPrefilledMarcos({ contacts: data.contacts, label: data.label || 'Lista do CRM Marcos' });
        }
        sessionStorage.removeItem('marcos_campaign_contacts');
        return; // se veio do Marcos, ignora banner Pedro pra nao confundir
      }
      const raw = sessionStorage.getItem('pedro_campaign_phones');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data?.phones) && data.phones.length > 0) {
        setPrefilledPedro({ phones: data.phones, label: data.label || 'Lista do CRM' });
      }
      sessionStorage.removeItem('pedro_campaign_phones');
    } catch {
      // ignora — banner é opcional
    }
  }, []);

  // Funcao que: cria uma wa_contact_list + insere os contatos selecionados
  // como wa_contacts dessa list. Apos sucesso, abre o editor de lista pra
  // usuario revisar e (futuramente) marcar como destinataria da campanha.
  const handleCreateListFromMarcos = async () => {
    if (!prefilledMarcos || !effectiveUserId) return;
    const visibleContacts = prefilledMarcos.contacts.filter(c => !marcosRemoved.has(c.id));
    if (visibleContacts.length === 0) {
      toast({ title: 'Nenhum contato selecionado pra criar a lista', variant: 'destructive' });
      return;
    }
    setCreatingMarcosList(true);
    try {
      const ts = new Date();
      const listName = `Marcos CRM ${ts.toLocaleDateString('pt-BR')} ${ts.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      // Fix 28/05/2026: seller_member_id eh OBRIGATORIO no INSERT quando seller
      // cria a lista, senao ela fica "invisivel" pra ele depois (fetchData
      // filtra listsQuery.eq('seller_member_id', seller!.id) quando seller logado).
      // Master inserindo: seller_member_id=null (= lista da equipe toda).
      const sellerMemberId = isSeller && seller?.id ? seller.id : null;
      const { data: listRow, error: listErr } = await (supabase as any)
        .from('wa_contact_lists')
        .insert({
          user_id: effectiveUserId,
          name: listName,
          contact_count: visibleContacts.length,
          seller_member_id: sellerMemberId,
          source: 'marcos_crm',
        })
        .select('id')
        .single();
      if (listErr) throw listErr;
      if (!listRow?.id) throw new Error('Lista nao foi criada (RLS bloqueou silenciosamente?)');
      const contactRows = visibleContacts.map(c => ({
        user_id: effectiveUserId,
        list_id: listRow.id,
        phone: c.phone,
        name: c.name,
        source: 'marcos_crm',
        is_valid: true,
        metadata: { origem: c.origem, lead_id: c.id },
      }));
      const { error: contactsErr } = await (supabase as any)
        .from('wa_contacts')
        .insert(contactRows);
      if (contactsErr) throw contactsErr;
      toast({
        title: '✅ Lista criada',
        description: `${visibleContacts.length} contato(s) em "${listName}". Crie sua campanha selecionando essa lista.`,
      });
      setPrefilledMarcos(null);
      setMarcosRemoved(new Set());
      // Recarrega listas pra aparecer na UI imediatamente
      fetchData(true);
    } catch (err: any) {
      toast({
        title: 'Erro ao criar lista',
        description: err?.message || 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setCreatingMarcosList(false);
    }
  };

  const legacyClaudeConfig = useMemo(() => ({ creativity: 0.8, variations: 3 }), []);
  const { sendSingleMessage } = useClaudeChat({
    context: 'copywriter',
    config: legacyClaudeConfig,
  });

  const fetchData = useCallback(async (silent = false) => {
    if (!effectiveUserId) return;
    if (!silent) setIsLoading(true);
    try {
      // Modelo: master vê TUDO (instâncias + listas + campanhas da conta).
      // Vendedor vê apenas o que tem seller_member_id = seller.id.
      const isolateBySeller = isSeller && seller?.id;

      // Disparo: vendedor só usa instâncias DELE; master só usa as PRÓPRIAS dele
      // (NÃO pode disparar usando instância de vendedor — supervisor visualiza,
      // mas não opera com número alheio).
      let instancesQuery = (supabase as any)
        .from('wa_instances')
        .select('id, friendly_name, phone_number, is_active, health_score, provider, status, seller_member_id')
        .eq('user_id', effectiveUserId)
        .eq('is_active', true);
      if (isolateBySeller) {
        instancesQuery = instancesQuery.eq('seller_member_id', seller!.id);
      } else {
        instancesQuery = instancesQuery.is('seller_member_id', null);
      }

      let campaignsQuery = (supabase as any)
        .from('wa_campaigns')
        .select('*')
        .eq('user_id', effectiveUserId)
        .order('created_at', { ascending: false });
      if (isolateBySeller) campaignsQuery = campaignsQuery.eq('seller_member_id', seller!.id);

      let listsQuery = (supabase as any)
        .from('wa_contact_lists')
        .select('id, name, contact_count, source, created_at')
        .eq('user_id', effectiveUserId)
        .order('created_at', { ascending: false });
      if (isolateBySeller) listsQuery = listsQuery.eq('seller_member_id', seller!.id);

      const [campaignsRes, listsRes, instancesRes] = await Promise.all([
        campaignsQuery,
        listsQuery,
        instancesQuery,
      ]);

      if (campaignsRes.error) throw campaignsRes.error;
      if (listsRes.error) throw listsRes.error;
      if (instancesRes.error) throw instancesRes.error;
      setCampaigns((campaignsRes.data as unknown as WACampaign[]) || []);
      setLists((listsRes.data as ContactList[]) || []);
      setInstances((instancesRes.data as WAInstance[]) || []);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [effectiveUserId, isSeller, seller?.id, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh running campaigns
  // Ref para fetchData evita recriar o interval a cada ciclo de polling
  const fetchDataRef = useRef(fetchData);
  useEffect(() => { fetchDataRef.current = fetchData; }, [fetchData]);

  const hasRunningCampaign = campaigns.some(c => c.status === 'running');
  useEffect(() => {
    if (!hasRunningCampaign) return;
    const interval = setInterval(() => fetchDataRef.current(true), 10000);
    return () => clearInterval(interval);
  }, [hasRunningCampaign]);

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
      const trimmedPrompt = data.prompt_base.trim();
      const trimmedTemplate = data.message_template.trim();
      const normalizedTemplate = trimmedPrompt && isGeneratedAITemplate(trimmedTemplate)
        ? ''
        : trimmedTemplate;

      const payload = {
        campaign_id: editingCampaign?.id || null,
        name: data.name.trim(),
        message_template: normalizedTemplate,
        prompt_base: trimmedPrompt || null,
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
        // Modelo: vendedor cria campanha → fica isolada por seller_member_id
        seller_member_id: (isSeller && seller?.id) ? seller.id : null,
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

  const handleGeneratePreviewLegacy = async (prompt: string, variationLevel = 'medium') => {
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

  const handleGeneratePreview = async (prompt: string, variationLevel = 'medium') => {
    if (!prompt.trim()) {
      toast({ title: 'Escreva o prompt base antes de gerar previa', variant: 'destructive' });
      return;
    }

    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('preview-wa-variations', {
        body: {
          prompt: prompt.trim(),
          variation_level: variationLevel,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const variations = Array.isArray(data?.variations)
        ? data.variations.map((v: unknown) => String(v).trim()).filter(Boolean)
        : [];

      setAiVariations(variations);
      setPreviewOpen(true);
    } catch (err: any) {
      toast({
        title: 'Erro ao gerar variacoes',
        description: err?.message || 'Nao foi possivel gerar a previa agora.',
        variant: 'destructive',
      });
    } finally {
      setAiLoading(false);
    }
  };

  const handleEdit = (campaign: any) => {
    const promptBase = campaign.prompt_base || '';
    const messageTemplate = promptBase && isGeneratedAITemplate(campaign.message_template)
      ? ''
      : campaign.message_template || '';

    setEditingCampaign({
      id: campaign.id,
      name: campaign.name,
      prompt_base: promptBase,
      message_template: messageTemplate,
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
      reply_auto_tag: campaign.reply_auto_tag || '',
      reply_auto_message: campaign.reply_auto_message || '',
    });
    setDialogOpen(true);
  };

  const deleteList = async () => {
    if (!deleteListId) return;
    setIsDeletingList(true);
    try {
      const { error: e1 } = await supabase.from('wa_contacts').delete().eq('list_id', deleteListId);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('wa_contact_lists').delete().eq('id', deleteListId);
      if (e2) throw e2;
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

  const handleRenameList = async (listId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      toast({ title: 'Nome não pode ficar vazio', variant: 'destructive' });
      return;
    }
    try {
      const { error } = await supabase
        .from('wa_contact_lists')
        .update({ name: trimmed })
        .eq('id', listId);
      if (error) throw error;
      toast({ title: '✅ Lista renomeada!' });
      setRenamingListId(null);
      fetchData();
    } catch (err: any) {
      toast({ title: 'Erro ao renomear', description: err.message, variant: 'destructive' });
    }
  };

  const normalizePhone = (raw: string): string => {
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '55' + digits.slice(1);
    if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
    return digits;
  };

  const validatePhone = (phone: string): boolean => /^55\d{10,11}$/.test(phone);

  const closeListEditor = () => {
    setEditingList(null);
    setListEditorName('');
    setListContacts([]);
    setOriginalContactIds([]);
    setNewContactName('');
    setNewContactPhone('');
  };

  const openListEditor = async (list: ContactList) => {
    setEditingList(list);
    setListEditorName(list.name);
    setListContacts([]);
    setOriginalContactIds([]);
    setNewContactName('');
    setNewContactPhone('');
    setLoadingListContacts(true);
    try {
      const { data, error } = await (supabase as any)
        .from('wa_contacts')
        .select('id, phone, name, metadata, is_valid')
        .eq('list_id', list.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const contacts = (data || []) as ListContact[];
      setListContacts(contacts);
      setOriginalContactIds(contacts.map(c => c.id));
    } catch (err: any) {
      toast({
        title: 'Erro ao abrir lista',
        description: err?.message || 'Nao foi possivel carregar os contatos.',
        variant: 'destructive',
      });
      closeListEditor();
    } finally {
      setLoadingListContacts(false);
    }
  };

  const updateListContact = (id: string, patch: Partial<ListContact>) => {
    setListContacts(prev => prev.map(contact => (
      contact.id === id ? { ...contact, ...patch } : contact
    )));
  };

  const removeListContact = (id: string) => {
    setListContacts(prev => prev.filter(contact => contact.id !== id));
  };

  const addListContact = () => {
    const phone = normalizePhone(newContactPhone);
    const name = newContactName.trim() || null;

    if (!validatePhone(phone)) {
      toast({ title: 'Telefone invalido', description: 'Use DDD + numero ou o formato 55...', variant: 'destructive' });
      return;
    }

    if (listContacts.some(contact => normalizePhone(contact.phone) === phone)) {
      toast({ title: 'Contato duplicado', description: 'Esse telefone ja esta na lista.', variant: 'destructive' });
      return;
    }

    setListContacts(prev => [
      ...prev,
      {
        id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        phone,
        name,
        metadata: null,
        is_valid: true,
      },
    ]);
    setNewContactName('');
    setNewContactPhone('');
  };

  const saveListEditor = async () => {
    if (!editingList || !effectiveUserId) return;
    const name = listEditorName.trim();
    if (!name) {
      toast({ title: 'Nome da lista obrigatorio', variant: 'destructive' });
      return;
    }

    const normalizedContacts = listContacts
      .map(contact => ({
        ...contact,
        phone: normalizePhone(contact.phone),
        name: contact.name?.trim() || null,
      }))
      .filter(contact => contact.phone);

    const seen = new Set<string>();
    for (const contact of normalizedContacts) {
      if (!validatePhone(contact.phone)) {
        toast({
          title: 'Telefone invalido',
          description: `Corrija o telefone ${contact.phone || '(vazio)'} antes de salvar.`,
          variant: 'destructive',
        });
        return;
      }
      if (seen.has(contact.phone)) {
        toast({
          title: 'Contato duplicado',
          description: `O telefone ${contact.phone} aparece mais de uma vez.`,
          variant: 'destructive',
        });
        return;
      }
      seen.add(contact.phone);
    }

    setSavingListContacts(true);
    try {
      const currentExistingIds = normalizedContacts
        .filter(contact => !contact.id.startsWith('new-'))
        .map(contact => contact.id);
      const idsToDelete = originalContactIds.filter(id => !currentExistingIds.includes(id));

      if (idsToDelete.length > 0) {
        const { error } = await (supabase as any)
          .from('wa_contacts')
          .delete()
          .in('id', idsToDelete);
        if (error) throw error;
      }

      const existingRows = normalizedContacts
        .filter(contact => !contact.id.startsWith('new-'))
        .map(contact => ({
          id: contact.id,
          user_id: effectiveUserId,
          list_id: editingList.id,
          phone: contact.phone,
          name: contact.name,
          is_valid: true,
          metadata: contact.metadata || null,
        }));

      if (existingRows.length > 0) {
        const { error } = await (supabase as any)
          .from('wa_contacts')
          .upsert(existingRows, { onConflict: 'id' });
        if (error) throw error;
      }

      const newRows = normalizedContacts
        .filter(contact => contact.id.startsWith('new-'))
        .map(contact => ({
          user_id: effectiveUserId,
          list_id: editingList.id,
          phone: contact.phone,
          name: contact.name,
          source: 'manual',
          is_valid: true,
          metadata: contact.metadata || null,
        }));

      if (newRows.length > 0) {
        const { error } = await (supabase as any)
          .from('wa_contacts')
          .insert(newRows);
        if (error) throw error;
      }

      const { error: listErr } = await (supabase as any)
        .from('wa_contact_lists')
        .update({
          name,
          contact_count: normalizedContacts.length,
        })
        .eq('id', editingList.id);
      if (listErr) throw listErr;

      toast({ title: 'Lista atualizada', description: `${normalizedContacts.length} contato(s) salvos.` });
      closeListEditor();
      fetchData();
    } catch (err: any) {
      toast({
        title: 'Erro ao salvar lista',
        description: err?.message || 'Nao foi possivel salvar os contatos.',
        variant: 'destructive',
      });
    } finally {
      setSavingListContacts(false);
    }
  };

  const mainContent = (
    <div className={embedded ? 'space-y-6 p-4 md:p-6' : 'space-y-6'}>
        {/* Bug 28/05/2026: Lista importada do CRM do Marcos (substitui banner laranja pra esse fluxo) */}
        {prefilledMarcos && (
          <div className="rounded-lg border-2 border-emerald-500/40 bg-emerald-500/5 p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
                  📋 Lista importada do CRM do Marcos
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {prefilledMarcos.contacts.length - marcosRemoved.size} contato(s) selecionado(s)
                  {marcosRemoved.size > 0 && (
                    <span className="text-orange-400 ml-1">
                      ({marcosRemoved.size} removido{marcosRemoved.size > 1 ? 's' : ''})
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setPrefilledMarcos(null); setMarcosRemoved(new Set()); }}
                className="text-muted-foreground hover:text-foreground text-lg leading-none"
                title="Cancelar import e voltar ao fluxo normal"
              >×</button>
            </div>
            <div className="bg-background/40 border border-border/40 rounded max-h-60 overflow-y-auto">
              {prefilledMarcos.contacts.map(c => {
                const removed = marcosRemoved.has(c.id);
                return (
                  <label
                    key={c.id}
                    className={`flex items-center gap-3 px-3 py-2 border-b border-border/30 last:border-0 cursor-pointer hover:bg-background/60 ${removed ? 'opacity-50' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={!removed}
                      onChange={() => {
                        setMarcosRemoved(prev => {
                          const next = new Set(prev);
                          if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                          return next;
                        });
                      }}
                      className="h-4 w-4 accent-emerald-500"
                    />
                    <div className="flex-1 min-w-0 grid grid-cols-3 gap-2 text-xs">
                      <span className="font-medium truncate">{c.name}</span>
                      <span className="text-muted-foreground tabular-nums">{c.phone}</span>
                      <span className="text-emerald-400 truncate">{c.origem}</span>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center justify-end gap-2 mt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setPrefilledMarcos(null); setMarcosRemoved(new Set()); }}
                disabled={creatingMarcosList}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleCreateListFromMarcos}
                disabled={creatingMarcosList || (prefilledMarcos.contacts.length - marcosRemoved.size) === 0}
                className="bg-emerald-500 hover:bg-emerald-600 text-white"
              >
                {creatingMarcosList
                  ? 'Criando...'
                  : `Criar lista com ${prefilledMarcos.contacts.length - marcosRemoved.size} contato(s)`}
              </Button>
            </div>
          </div>
        )}
        {/* Fase 6 Feature C: banner quando vem do Pedro CRM */}
        {prefilledPedro && (
          <div className="rounded-lg border-2 border-orange-500/40 bg-orange-500/5 p-3 flex items-start gap-2">
            <div className="text-xl">📢</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-orange-300">{prefilledPedro.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {prefilledPedro.phones.length} contato(s) vieram do CRM do Pedro. Crie uma lista nova e cole os números abaixo:
              </p>
              <details className="mt-2">
                <summary className="text-[11px] cursor-pointer text-orange-400 hover:text-orange-300">
                  Ver / copiar {prefilledPedro.phones.length} telefone(s)
                </summary>
                <textarea
                  readOnly
                  value={prefilledPedro.phones.join('\n')}
                  className="mt-2 w-full h-24 text-[11px] font-mono bg-background/50 border border-border/40 rounded p-2"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  onClick={() => {
                    try {
                      navigator.clipboard.writeText(prefilledPedro.phones.join('\n'));
                      toast({ title: '✅ Telefones copiados' });
                    } catch {
                      toast({ title: 'Selecione manualmente', variant: 'destructive' });
                    }
                  }}
                  className="text-[11px] mt-1 text-orange-400 hover:text-orange-300 underline"
                >
                  Copiar todos
                </button>
              </details>
            </div>
            <button
              type="button"
              onClick={() => setPrefilledPedro(null)}
              className="text-muted-foreground hover:text-foreground text-lg leading-none"
              title="Fechar banner"
            >×</button>
          </div>
        )}
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl flex items-center gap-2">
              <Send className="h-7 w-7 text-primary" />
              Disparo em Massa
            </h1>
            <p className="text-muted-foreground">
              Envie mensagens para centenas de contatos de forma segura e humanizada
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

        {/* Feature glossary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { emoji: '⏱️', title: 'Delay entre mensagens', desc: 'Pausa aleatória entre envios — imita comportamento humano e evita bloqueio do WhatsApp' },
            { emoji: '🔄', title: 'Rodízio de números', desc: 'Distribui os disparos entre vários chips para não sobrecarregar um número só' },
            { emoji: '🔥', title: 'Aquecimento', desc: 'Começa enviando poucas mensagens e vai aumentando gradualmente — reduz risco de ban' },
          ].map(f => (
            <div key={f.title} className="rounded-lg border border-border/40 bg-card/40 p-3 flex gap-3">
              <span className="text-xl shrink-0">{f.emoji}</span>
              <div>
                <p className="text-xs font-semibold text-foreground">{f.title}</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Mini Tutorial: Boas Práticas Anti-Bloqueio */}
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">🛡️</span>
              <h3 className="text-sm font-bold text-amber-300">Boas Práticas para Não Tomar Bloqueio</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div className="flex gap-2 items-start">
                <span className="text-amber-400 shrink-0 mt-0.5">1.</span>
                <p><strong className="text-foreground">Delay mínimo de 30s:</strong> Configure pelo menos 30-60s entre mensagens. Envios rápidos demais acionam o anti-spam do WhatsApp.</p>
              </div>
              <div className="flex gap-2 items-start">
                <span className="text-amber-400 shrink-0 mt-0.5">2.</span>
                <p><strong className="text-foreground">Máximo 200/dia por número:</strong> Não ultrapasse 200 mensagens por número por dia. Use rodízio se precisar enviar mais.</p>
              </div>
              <div className="flex gap-2 items-start">
                <span className="text-amber-400 shrink-0 mt-0.5">3.</span>
                <p><strong className="text-foreground">Ative o aquecimento:</strong> Números novos devem começar com 20-50 envios/dia e ir aumentando gradualmente ao longo de 7 dias.</p>
              </div>
              <div className="flex gap-2 items-start">
                <span className="text-amber-400 shrink-0 mt-0.5">4.</span>
                <p><strong className="text-foreground">Varie as mensagens:</strong> Use o prompt IA com nível Moderado ou Criativo. Mensagens iguais são detectadas como spam.</p>
              </div>
              <div className="flex gap-2 items-start">
                <span className="text-amber-400 shrink-0 mt-0.5">5.</span>
                <p><strong className="text-foreground">Horário comercial:</strong> Envie entre 8h-18h. Disparos de madrugada aumentam denúncias e bloqueios.</p>
              </div>
              <div className="flex gap-2 items-start">
                <span className="text-amber-400 shrink-0 mt-0.5">6.</span>
                <p><strong className="text-foreground">Evite links encurtados:</strong> Links do bit.ly, t.me e similares são filtrados pelo WhatsApp. Use links diretos.</p>
              </div>
              <div className="flex gap-2 items-start">
                <span className="text-amber-400 shrink-0 mt-0.5">7.</span>
                <p><strong className="text-foreground">Limpe sua lista:</strong> Remova números inválidos e contatos que não interagem. Alta taxa de erro = bloqueio.</p>
              </div>
              <div className="flex gap-2 items-start">
                <span className="text-amber-400 shrink-0 mt-0.5">8.</span>
                <p><strong className="text-foreground">Use opt-out:</strong> Ative os botões de opt-out para dar opção ao contato. Isso reduz denúncias drasticamente.</p>
              </div>
            </div>
          </CardContent>
        </Card>

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
                          {renamingListId === list.id ? (
                            <div className="flex items-center gap-1">
                              <Input
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                className="h-7 text-sm w-48"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleRenameList(list.id);
                                  if (e.key === 'Escape') setRenamingListId(null);
                                }}
                              />
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-green-500" onClick={() => handleRenameList(list.id)}>
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRenamingListId(null)}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <p className="font-medium">{list.name}</p>
                          )}
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="secondary" className="text-[10px]">{list.contact_count} contatos</Badge>
                            <span>•</span>
                            <span>{list.source === 'csv_upload' ? 'CSV' : list.source}</span>
                            <span>•</span>
                            <span>{new Date(list.created_at).toLocaleDateString('pt-BR')}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-primary"
                          onClick={() => openListEditor(list)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteListId(list.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
  );

  const modals = (
    <>
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

      {/* Contact List Editor */}
      <Dialog open={!!editingList} onOpenChange={(open) => { if (!open) closeListEditor(); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <List className="h-5 w-5 text-primary" />
              Editar lista de contatos
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 overflow-hidden flex-1 min-h-0">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome da lista</label>
              <Input
                value={listEditorName}
                onChange={(e) => setListEditorName(e.target.value)}
                placeholder="Nome da lista"
                maxLength={100}
              />
            </div>

            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Adicionar contato</p>
                <Badge variant="secondary">{listContacts.length} contato(s)</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
                <Input
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                  placeholder="Nome"
                />
                <Input
                  value={newContactPhone}
                  onChange={(e) => setNewContactPhone(e.target.value)}
                  placeholder="Telefone WhatsApp"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addListContact();
                  }}
                />
                <Button onClick={addListContact} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Adicionar
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-border/60 overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_44px] gap-2 px-3 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground">
                <span>Nome</span>
                <span>Telefone</span>
                <span />
              </div>
              <div className="max-h-[42vh] overflow-y-auto p-2 space-y-2">
                {loadingListContacts ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Carregando contatos...
                  </div>
                ) : listContacts.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    Nenhum contato nesta lista ainda.
                  </div>
                ) : (
                  listContacts.map((contact) => (
                    <div key={contact.id} className="grid grid-cols-[1fr_1fr_44px] gap-2">
                      <Input
                        value={contact.name || ''}
                        onChange={(e) => updateListContact(contact.id, { name: e.target.value })}
                        placeholder="Sem nome"
                        className="h-9"
                      />
                      <Input
                        value={contact.phone}
                        onChange={(e) => updateListContact(contact.id, { phone: e.target.value })}
                        placeholder="5599999999999"
                        className="h-9"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground hover:text-destructive"
                        onClick={() => removeListContact(contact.id)}
                        title="Remover contato"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeListEditor} disabled={savingListContacts}>
              Cancelar
            </Button>
            <Button onClick={saveListEditor} disabled={savingListContacts || loadingListContacts}>
              {savingListContacts ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
              Salvar lista
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV Upload Dialog */}
      {user && (
        <CSVUploadDialog
          open={showUpload}
          onOpenChange={setShowUpload}
          userId={effectiveUserId || ''}
          sellerMemberId={(isSeller && seller?.id) ? seller.id : null}
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
    </>
  );

  // Bloqueia vendedor sem permissão marcos_disparo (acesso direto via URL)
  if (blockSellerAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  if (embedded) {
    return <div className="h-full overflow-y-auto">{mainContent}{modals}</div>;
  }
  return (
    <MainLayout>
      {mainContent}
      {modals}
    </MainLayout>
  );
}
