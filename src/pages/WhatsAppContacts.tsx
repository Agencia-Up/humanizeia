import { useState, useEffect, useCallback, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { useToast } from '@/hooks/use-toast';
import {
  Contact, Search, Trash2, Loader2, Plus, FolderOpen, Users, Phone, Tag,
  Edit, Eye, ArrowLeft, MoreHorizontal, MapPin, MessageCircle, Globe,
  Download, RefreshCw, UserPlus, CheckCircle, WifiOff, Upload,
  CheckCheck, Clock, AlertCircle, MessageSquare,
} from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { FileImportDialog } from '@/components/whatsapp/FileImportDialog';

interface ContactList {
  id: string;
  name: string;
  description: string | null;
  source: string;
  contact_count: number;
  tags: string[];
  created_at: string;
  updated_at: string;
  auto_sync_pedro_leads?: boolean;
}

interface WAContact {
  id: string;
  phone: string;
  name: string | null;
  group_name: string | null;
  source: string;
  tags: string[];
  is_valid: boolean;
  list_id: string | null;
  created_at: string;
  metadata?: Record<string, any>;
}

interface WhatsAppGroup {
  id: string;
  subject: string;
  size: number;
  owner: string;
  creation: number;
  instance_name?: string;
}

const sourceLabels: Record<string, { label: string; icon: typeof Phone }> = {
  manual: { label: 'Manual', icon: Phone },
  whatsapp_group: { label: 'Grupo WhatsApp', icon: MessageCircle },
  group_extract: { label: 'Grupo WhatsApp', icon: MessageCircle },
  google_maps: { label: 'Google Maps', icon: MapPin },
  import: { label: 'Importação', icon: FolderOpen },
};

// ============= Group Table Component =============
function GroupTable({
  groups, selectedGroups, toggleGroup, toggleAll, search, setSearch, onExtract,
}: {
  groups: WhatsAppGroup[]; selectedGroups: string[]; toggleGroup: (id: string) => void;
  toggleAll: () => void; search: string; setSearch: (v: string) => void; onExtract: () => void;
}) {
  const filtered = groups.filter(g => g.subject.toLowerCase().includes(search.toLowerCase()));
  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-lg">{groups.length} grupo(s) encontrado(s)</CardTitle>
            <CardDescription>Selecione os grupos para extrair os contatos</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Filtrar grupo..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 w-64" />
            </div>
            {selectedGroups.length > 0 && (
              <Button onClick={onExtract}>
                <Download className="h-4 w-4 mr-2" /> Extrair ({selectedGroups.length})
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox checked={selectedGroups.length === filtered.length && filtered.length > 0} onCheckedChange={toggleAll} />
              </TableHead>
              <TableHead>Nome do Grupo</TableHead>
              <TableHead className="text-center">Membros</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(group => (
              <TableRow key={group.id}>
                <TableCell><Checkbox checked={selectedGroups.includes(group.id)} onCheckedChange={() => toggleGroup(group.id)} /></TableCell>
                <TableCell className="font-medium">{group.subject}</TableCell>
                <TableCell className="text-center">
                  <Badge variant="secondary"><UserPlus className="h-3 w-3 mr-1" />{group.size}</Badge>
                </TableCell>
                <TableCell>
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                    <CheckCircle className="h-3 w-3 mr-1" /> Ativo
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function WhatsAppContacts({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { isSeller, seller, visibleFeatures, loading: sellerLoading } = useSellerProfile(user?.id);
  const { toast } = useToast();
  const blockSellerAccess = !sellerLoading && isSeller && !visibleFeatures.marcos_contatos && !embedded;

  const effectiveUserId = useMemo(() => {
    if (sellerLoading) return null;
    if (isSeller && seller?.user_id) return seller.user_id;
    return user?.id || null;
  }, [sellerLoading, isSeller, seller, user]);

  const [mainTab, setMainTab] = useState('lists');

  // === Contact Lists state ===
  const [lists, setLists] = useState<ContactList[]>([]);
  const [contacts, setContacts] = useState<WAContact[]>([]);
  const [selectedList, setSelectedList] = useState<ContactList | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  // followup status por telefone: { [phone]: { status, sent_at } }
  const [followupStatus, setFollowupStatus] = useState<Record<string, { status: string; sent_at: string | null }>>({});

  // Dialogs
  const [showNewList, setShowNewList] = useState(false);
  const [showEditList, setShowEditList] = useState(false);
  const [showAddContacts, setShowAddContacts] = useState(false);
  const [showDeleteList, setShowDeleteList] = useState(false);
  const [showFileImport, setShowFileImport] = useState(false);
  const [showGoogleMaps, setShowGoogleMaps] = useState(false);
  const [showPedroImport, setShowPedroImport] = useState(false);

  // Form state
  const [formListName, setFormListName] = useState('');
  const [formListDesc, setFormListDesc] = useState('');
  const [bulkPhones, setBulkPhones] = useState('');
  const [targetListId, setTargetListId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editingList, setEditingList] = useState<ContactList | null>(null);

  // Pedro import form state
  const [pedroListName, setPedroListName] = useState('');
  const [pedroAutoSync, setPedroAutoSync] = useState(true);
  const [pedroLeadCount, setPedroLeadCount] = useState<number | null>(null);

  // Google Maps state
  const [mapsQuery, setMapsQuery] = useState('');
  const [mapsTargetListId, setMapsTargetListId] = useState('');
  const [mapsNewListName, setMapsNewListName] = useState('');
  const [isExtractingMaps, setIsExtractingMaps] = useState(false);
  const [mapsListMode, setMapsListMode] = useState<'existing' | 'new'>('new');

  // === Own Groups state ===
  const [ownGroups, setOwnGroups] = useState<WhatsAppGroup[]>([]);
  const [isLoadingOwn, setIsLoadingOwn] = useState(false);
  const [searchOwn, setSearchOwn] = useState('');
  const [selectedOwn, setSelectedOwn] = useState<string[]>([]);

  // === External Groups state ===
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WhatsAppGroup[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedSearch, setSelectedSearch] = useState<string[]>([]);

  // === Extract dialog state ===
  const [showExtractDialog, setShowExtractDialog] = useState(false);
  const [extractListMode, setExtractListMode] = useState<'new' | 'existing'>('new');
  const [extractNewListName, setExtractNewListName] = useState('');
  const [extractTargetListId, setExtractTargetListId] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractSource, setExtractSource] = useState<'own' | 'search'>('own');

  // === Instance check ===
  const [hasInstance, setHasInstance] = useState<boolean | null>(null);

  useEffect(() => {
    if (!effectiveUserId) return;
    (async () => {
      const { count } = await supabase
        .from('wa_instances')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', effectiveUserId)
        .eq('provider', 'evolution');
      setHasInstance((count ?? 0) > 0);
    })();
  }, [effectiveUserId]);

  // ============= Contact Lists Logic =============
  const fetchLists = useCallback(async () => {
    if (!effectiveUserId) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('wa_contact_lists')
        .select('*')
        .eq('user_id', effectiveUserId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setLists((data as ContactList[]) || []);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [effectiveUserId, toast]);

  const fetchContacts = useCallback(async (listId: string) => {
    if (!effectiveUserId) return;
    try {
      const { data, error } = await supabase
        .from('wa_contacts')
        .select('*')
        .eq('user_id', effectiveUserId)
        .eq('list_id', listId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const contacts = (data as WAContact[]) || [];
      setContacts(contacts);

      // Busca status de followup para os telefones da lista
      if (contacts.length > 0) {
        const phones = contacts.map(c => c.phone);
        const { data: fq } = await (supabase as any)
          .from('followup_queue')
          .select('phone, status, sent_at')
          .in('phone', phones)
          .eq('user_id', effectiveUserId)
          .order('created_at', { ascending: false });
        // Pega o status mais recente por telefone
        const map: Record<string, { status: string; sent_at: string | null }> = {};
        for (const row of (fq || [])) {
          if (!map[row.phone]) map[row.phone] = { status: row.status, sent_at: row.sent_at };
        }
        setFollowupStatus(map);
      } else {
        setFollowupStatus({});
      }
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  }, [effectiveUserId, toast]);

  useEffect(() => { fetchLists(); }, [fetchLists]);
  useEffect(() => {
    if (selectedList) fetchContacts(selectedList.id);
    else setContacts([]);
  }, [selectedList, fetchContacts]);

  const createList = async () => {
    if (!effectiveUserId || !formListName.trim()) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('wa_contact_lists').insert({
        user_id: effectiveUserId, name: formListName.trim(), description: formListDesc.trim() || null, source: 'manual',
      });
      if (error) throw error;
      toast({ title: 'Lista criada!' });
      setShowNewList(false); setFormListName(''); setFormListDesc('');
      fetchLists();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally { setIsSaving(false); }
  };

  // ===== Importação de leads do Pedro =====
  // Vendedor: só vê leads que ELE atendeu (assigned_to_id = seller.id)
  // Master: vê todos os leads do Pedro da conta
  const openPedroImportDialog = async () => {
    if (!effectiveUserId) return;
    const sellerLabel = isSeller && seller?.name ? ` (${seller.name})` : '';
    setPedroListName(`Leads do Pedro${sellerLabel} - ${format(new Date(), 'dd/MM/yyyy')}`);
    setPedroAutoSync(true);
    setShowPedroImport(true);
    // Conta leads do Pedro disponíveis para importar
    try {
      let q = (supabase as any)
        .from('ai_crm_leads')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', effectiveUserId);
      if (isSeller && seller?.id) {
        q = q.eq('assigned_to_id', seller.id);
      }
      const { count } = await q;
      setPedroLeadCount(count || 0);
    } catch {
      setPedroLeadCount(0);
    }
  };

  const createListFromPedro = async () => {
    if (!effectiveUserId || !pedroListName.trim()) return;
    setIsSaving(true);
    try {
      // 1. Cria a lista — se vendedor, vincula a ele via seller_member_id
      const { data: list, error: listErr } = await (supabase as any)
        .from('wa_contact_lists')
        .insert({
          user_id: effectiveUserId,
          name: pedroListName.trim(),
          description: pedroAutoSync ? 'Lista sincronizada automaticamente com leads do Pedro' : 'Importada dos leads do Pedro',
          source: 'pedro_import',
          auto_sync_pedro_leads: pedroAutoSync,
          seller_member_id: (isSeller && seller?.id) ? seller.id : null,
        } as any)
        .select('id')
        .single();
      if (listErr) throw listErr;

      // 2. Busca leads do Pedro — vendedor: só os atribuídos a ele
      let leadsQuery = (supabase as any)
        .from('ai_crm_leads')
        .select('remote_jid, lead_name')
        .eq('user_id', effectiveUserId);
      if (isSeller && seller?.id) {
        leadsQuery = leadsQuery.eq('assigned_to_id', seller.id);
      }
      const { data: leads, error: leadsErr } = await leadsQuery;
      if (leadsErr) throw leadsErr;

      // 3. Converte para contatos (deduplicando por phone)
      const seen = new Set<string>();
      const rows = (leads || [])
        .map((l: any) => {
          const phone = String(l.remote_jid || '').split('@')[0].replace(/\D/g, '');
          if (!phone || phone.length < 10 || seen.has(phone)) return null;
          seen.add(phone);
          return {
            user_id: effectiveUserId,
            list_id: (list as any).id,
            phone,
            name: l.lead_name || null,
            source: 'pedro_import',
          };
        })
        .filter(Boolean);

      // 4. Insere em lote (Supabase suporta até ~1000 por insert)
      if (rows.length > 0) {
        const { error: insErr } = await (supabase as any).from('wa_contacts').insert(rows);
        if (insErr) throw insErr;
        await (supabase as any).from('wa_contact_lists')
          .update({ contact_count: rows.length })
          .eq('id', (list as any).id);
      }

      toast({
        title: `✅ Lista criada com ${rows.length} contato(s)!`,
        description: pedroAutoSync ? 'Novos leads do Pedro serão adicionados automaticamente.' : 'Apenas os leads atuais foram importados.',
      });
      setShowPedroImport(false);
      setPedroListName('');
      setPedroLeadCount(null);
      fetchLists();
    } catch (err: any) {
      toast({ title: 'Erro ao importar', description: err.message, variant: 'destructive' });
    } finally { setIsSaving(false); }
  };

  const updateList = async () => {
    if (!editingList || !formListName.trim()) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('wa_contact_lists')
        .update({ name: formListName.trim(), description: formListDesc.trim() || null } as any)
        .eq('id', editingList.id);
      if (error) throw error;
      toast({ title: 'Lista atualizada!' });
      setShowEditList(false); setEditingList(null); fetchLists();
      if (selectedList?.id === editingList.id)
        setSelectedList(prev => prev ? { ...prev, name: formListName.trim(), description: formListDesc.trim() || null } : null);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally { setIsSaving(false); }
  };

  const deleteList = async () => {
    if (!editingList) return;
    setIsSaving(true);
    try {
      await supabase.from('wa_contacts').delete().eq('list_id', editingList.id);
      const { error } = await supabase.from('wa_contact_lists').delete().eq('id', editingList.id);
      if (error) throw error;
      toast({ title: 'Lista excluída' });
      setShowDeleteList(false); setEditingList(null);
      if (selectedList?.id === editingList.id) setSelectedList(null);
      fetchLists();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally { setIsSaving(false); }
  };

  const addBulkContacts = async () => {
    if (!effectiveUserId || !targetListId || !bulkPhones.trim()) return;
    setIsSaving(true);
    try {
      const phones = bulkPhones.split(/[\n,;]+/).map(p => p.replace(/\D/g, '').trim()).filter(p => p.length >= 10);
      if (phones.length === 0) { toast({ title: 'Nenhum número válido encontrado', variant: 'destructive' }); setIsSaving(false); return; }
      const unique = [...new Set(phones)];
      const rows = unique.map(phone => ({ user_id: effectiveUserId, list_id: targetListId, phone, source: 'manual' as const }));
      const { error } = await supabase.from('wa_contacts').insert(rows);
      if (error) throw error;
      const { count } = await supabase.from('wa_contacts').select('id', { count: 'exact', head: true }).eq('list_id', targetListId);
      await supabase.from('wa_contact_lists').update({ contact_count: count || 0 } as any).eq('id', targetListId);
      toast({ title: `${unique.length} contatos adicionados!` });
      setShowAddContacts(false); setBulkPhones('');
      if (selectedList?.id === targetListId) fetchContacts(targetListId);
      fetchLists();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally { setIsSaving(false); }
  };

  const deleteSelectedContacts = async () => {
    if (selectedContacts.length === 0) return;
    try {
      const { error } = await supabase.from('wa_contacts').delete().in('id', selectedContacts);
      if (error) throw error;
      toast({ title: `${selectedContacts.length} contatos removidos` });
      setSelectedContacts([]);
      if (selectedList) {
        fetchContacts(selectedList.id);
        const { count } = await supabase.from('wa_contacts').select('id', { count: 'exact', head: true }).eq('list_id', selectedList.id);
        await supabase.from('wa_contact_lists').update({ contact_count: count || 0 } as any).eq('id', selectedList.id);
        fetchLists();
      }
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const deleteContact = async (contactId: string) => {
    if (!confirm('Remover este contato da lista?')) return;
    try {
      const { error } = await supabase.from('wa_contacts').delete().eq('id', contactId);
      if (error) throw error;
      toast({ title: 'Contato removido.' });
      if (selectedList) {
        fetchContacts(selectedList.id);
        const { count } = await supabase.from('wa_contacts').select('id', { count: 'exact', head: true }).eq('list_id', selectedList.id);
        await supabase.from('wa_contact_lists').update({ contact_count: count || 0 } as any).eq('id', selectedList.id);
        fetchLists();
      }
    } catch (err: any) {
      toast({ title: 'Erro ao remover', description: err.message, variant: 'destructive' });
    }
  };

  // ─── Exportar contatos como CSV ──────────────────────────────────────────
  const buildAndDownloadCSV = (rows: WAContact[], listName: string, statusMap: Record<string, { status: string; sent_at: string | null }>) => {
    const SKIP_META = new Set(['form_id', 'form_name', 'submission_id']);
    const formKeys = Array.from(new Set(
      rows.flatMap(c => Object.keys(c.metadata || {}).filter(k => !SKIP_META.has(k)))
    ));

    const headers = ['Nome', 'Telefone', 'Email', ...formKeys, 'Status WA', 'Data Cadastro', 'Origem'];

    const escape = (val: string) =>
      val.includes(',') || val.includes('"') || val.includes('\n')
        ? `"${val.replace(/"/g, '""')}"`
        : val;

    const csvRows = rows.map(c => {
      const wa = statusMap[c.phone];
      const waLabel = !wa ? '' : wa.status === 'sent' ? 'Enviada' : wa.status === 'scheduled' ? 'Pendente' : 'Falha';
      return [
        c.name || '',
        c.phone,
        c.metadata?.email || '',
        ...formKeys.map(k => (c.metadata?.[k] == null ? '' : String(c.metadata[k]))),
        waLabel,
        format(new Date(c.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }),
        sourceLabels[c.source]?.label || c.source || '',
      ].map(v => escape(String(v))).join(',');
    });

    const csv = '﻿' + [headers.map(escape).join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${listName.replace(/[^a-zA-Z0-9_\- ]/g, '')}_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /** Exporta os contatos atualmente visíveis (ou apenas os selecionados) */
  const exportContacts = () => {
    const toExport = selectedContacts.length > 0
      ? filteredContacts.filter(c => selectedContacts.includes(c.id))
      : filteredContacts;

    if (toExport.length === 0) {
      toast({ title: 'Nenhum contato para exportar', variant: 'destructive' });
      return;
    }
    buildAndDownloadCSV(toExport, selectedList?.name || 'contatos', followupStatus);
    toast({ title: `✅ ${toExport.length} contato(s) exportado(s) com sucesso!` });
  };

  /** Exporta uma lista diretamente do card (sem precisar entrar nela) */
  const exportListDirect = async (list: ContactList) => {
    if (!effectiveUserId) return;
    try {
      const { data } = await supabase.from('wa_contacts').select('*').eq('user_id', effectiveUserId).eq('list_id', list.id).order('created_at', { ascending: false });
      const rows = (data as WAContact[]) || [];
      if (rows.length === 0) { toast({ title: 'Lista sem contatos para exportar', variant: 'destructive' }); return; }

      // Busca followup status para esses contatos
      const phones = rows.map(c => c.phone);
      const { data: fq } = await (supabase as any).from('followup_queue').select('phone, status, sent_at').in('phone', phones).eq('user_id', effectiveUserId).order('created_at', { ascending: false });
      const statusMap: Record<string, { status: string; sent_at: string | null }> = {};
      for (const row of (fq || [])) {
        if (!statusMap[row.phone]) statusMap[row.phone] = { status: row.status, sent_at: row.sent_at };
      }

      buildAndDownloadCSV(rows, list.name, statusMap);
      toast({ title: `✅ ${rows.length} contato(s) exportado(s) com sucesso!` });
    } catch (err: any) {
      toast({ title: 'Erro ao exportar', description: err.message, variant: 'destructive' });
    }
  };

  const extractGoogleMaps = async () => {
    if (!effectiveUserId || !mapsQuery.trim()) return;
    setIsExtractingMaps(true);
    try {
      const payload: any = { user_id: effectiveUserId, search_query: mapsQuery.trim() };
      if (mapsListMode === 'existing' && mapsTargetListId) payload.list_id = mapsTargetListId;
      else if (mapsListMode === 'new' && mapsNewListName.trim()) payload.list_name = mapsNewListName.trim();
      const { data, error } = await supabase.functions.invoke('extract-google-maps-leads', { body: payload });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro na extração');
      toast({ title: 'Extração concluída!', description: `${data.total_leads || 0} leads extraídos do Google Maps` });
      setShowGoogleMaps(false); setMapsQuery(''); setMapsNewListName(''); fetchLists();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally { setIsExtractingMaps(false); }
  };

  // ============= Group Extraction Logic =============
  const fetchOwnGroups = async () => {
    if (!effectiveUserId) return;
    setIsLoadingOwn(true);
    try {
      console.log('[WhatsAppContacts] Fetching groups for user:', effectiveUserId);
      const { data, error } = await supabase.functions.invoke('wa-extract-groups', { body: { user_id: effectiveUserId } });
      console.log('[WhatsAppContacts] Response:', JSON.stringify(data), 'Error:', error);
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao buscar grupos');
      const groups = data.groups || [];
      setOwnGroups(groups);
      toast({ title: `${groups.length} grupo(s) encontrado(s)` });
    } catch (err: any) {
      console.error('[WhatsAppContacts] Error:', err);
      toast({ title: 'Erro ao buscar grupos', description: err.message, variant: 'destructive' });
    } finally { setIsLoadingOwn(false); }
  };

  const searchGroupsByNiche = async () => {
    if (!effectiveUserId || !searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('wa-extract-groups', {
        body: { user_id: effectiveUserId, action: 'search_groups', query: searchQuery.trim() },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao pesquisar grupos');
      setSearchResults(data.groups || []);
      toast({ title: `${data.groups?.length || 0} grupos encontrados para "${searchQuery}"` });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally { setIsSearching(false); }
  };

  const openExtractDialog = (source: 'own' | 'search') => {
    setExtractSource(source);
    fetchLists();
    const label = source === 'own' ? 'Meus Grupos' : `Pesquisa: ${searchQuery}`;
    setExtractNewListName(`${label} - ${new Date().toLocaleDateString('pt-BR')}`);
    setExtractListMode('new'); setExtractTargetListId('');
    setShowExtractDialog(true);
  };

  const currentSelectedGroups = extractSource === 'own' ? selectedOwn : selectedSearch;
  const currentGroups = extractSource === 'own' ? ownGroups : searchResults;

  const extractGroupContacts = async () => {
    if (!effectiveUserId || currentSelectedGroups.length === 0) return;
    setIsExtracting(true);
    try {
      let listId = extractListMode === 'existing' ? extractTargetListId : undefined;
      if (extractListMode === 'new' && extractNewListName.trim()) {
        const { data: newList, error: listErr } = await supabase
          .from('wa_contact_lists')
          .insert({ user_id: effectiveUserId, name: extractNewListName.trim(), source: 'group_extract', contact_count: 0 })
          .select('id').single();
        if (listErr) throw listErr;
        listId = newList.id;
      }
      const selectedGroupData = currentGroups.filter(g => currentSelectedGroups.includes(g.id));
      const { data, error } = await supabase.functions.invoke('wa-extract-groups', {
        body: { user_id: effectiveUserId, action: 'extract_contacts', group_ids: currentSelectedGroups, groups: selectedGroupData, list_id: listId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao extrair contatos');
      toast({ title: 'Contatos extraídos!', description: `${data.total_contacts || 0} contatos salvos de ${currentSelectedGroups.length} grupo(s)` });
      if (extractSource === 'own') setSelectedOwn([]); else setSelectedSearch([]);
      setShowExtractDialog(false); fetchLists();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally { setIsExtracting(false); }
  };

  const toggleGroup = (id: string, type: 'own' | 'search') => {
    const setter = type === 'own' ? setSelectedOwn : setSelectedSearch;
    setter(prev => prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]);
  };

  const toggleAllGroups = (type: 'own' | 'search') => {
    const setter = type === 'own' ? setSelectedOwn : setSelectedSearch;
    const groups = type === 'own'
      ? ownGroups.filter(g => g.subject.toLowerCase().includes(searchOwn.toLowerCase()))
      : searchResults.filter(g => g.subject.toLowerCase().includes(searchFilter.toLowerCase()));
    const selected = type === 'own' ? selectedOwn : selectedSearch;
    if (selected.length === groups.length) setter([]); else setter(groups.map(g => g.id));
  };

  const openEditDialog = (list: ContactList) => {
    setEditingList(list); setFormListName(list.name); setFormListDesc(list.description || ''); setShowEditList(true);
  };
  const openDeleteDialog = (list: ContactList) => { setEditingList(list); setShowDeleteList(true); };

  const filteredContacts = contacts.filter(c =>
    !search || c.phone?.includes(search) || c.name?.toLowerCase().includes(search.toLowerCase()) || c.group_name?.toLowerCase().includes(search.toLowerCase())
  );

  const needsInstance = mainTab === 'groups' || mainTab === 'external';

  const content = (
    <><div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold lg:text-3xl flex items-center gap-2">
            <Contact className="h-7 w-7 text-primary" />
            Extrator de Contatos
          </h1>
          <p className="text-muted-foreground mt-1">
            Extraia e gerencie contatos de diversas fontes para suas campanhas
          </p>
        </div>

        <Tabs value={mainTab} onValueChange={setMainTab}>
          <TabsList className="grid w-full max-w-2xl grid-cols-4">
            <TabsTrigger value="lists" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <FolderOpen className="h-4 w-4" /> Listas
            </TabsTrigger>
            <TabsTrigger value="groups" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <Users className="h-4 w-4" /> Meus Grupos
            </TabsTrigger>
            <TabsTrigger value="external" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <Globe className="h-4 w-4" /> Grupos Externos
            </TabsTrigger>
            <TabsTrigger value="gmb" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <MapPin className="h-4 w-4" /> Google Maps
            </TabsTrigger>
          </TabsList>

          {/* ============ TAB: Listas de Contatos ============ */}
          <TabsContent value="lists" className="mt-4 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                {selectedList
                  ? `${filteredContacts.length} contatos • Origem: ${sourceLabels[selectedList.source]?.label || selectedList.source}`
                  : `${lists.length} lista(s) • Organize seus leads para campanhas`
                }
              </p>
              <div className="flex gap-2 flex-wrap">
                {selectedList ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setSelectedList(null)}>
                      <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setTargetListId(selectedList.id); setShowAddContacts(true); }}>
                      <Plus className="h-4 w-4 mr-1" /> Adicionar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={exportContacts}
                      className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                      title={selectedContacts.length > 0 ? `Exportar ${selectedContacts.length} selecionados` : 'Exportar toda a lista como CSV'}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      {selectedContacts.length > 0 ? `Exportar (${selectedContacts.length})` : 'Exportar CSV'}
                    </Button>
                    {selectedContacts.length > 0 && (
                      <Button variant="destructive" size="sm" onClick={deleteSelectedContacts}>
                        <Trash2 className="h-4 w-4 mr-1" /> Remover ({selectedContacts.length})
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      onClick={openPedroImportDialog}
                      className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
                    >
                      <MessageSquare className="h-4 w-4 mr-1.5" /> Importar do Pedro
                    </Button>
                    <Button variant="outline" onClick={() => setShowFileImport(true)}>
                      <Upload className="h-4 w-4 mr-1.5" /> Importar Arquivo
                    </Button>
                    <Button onClick={() => { setFormListName(''); setFormListDesc(''); setShowNewList(true); }}>
                      <Plus className="h-4 w-4 mr-1.5" /> Nova Lista
                    </Button>
                  </>
                )}
              </div>
            </div>

            {!selectedList ? (
              isLoading ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : lists.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
                    <FolderOpen className="h-12 w-12 text-muted-foreground opacity-40" />
                    <p className="text-muted-foreground">Nenhuma lista criada ainda</p>
                    <p className="text-sm text-muted-foreground">Extraia contatos das outras abas ou crie uma lista manual</p>
                    <Button onClick={() => { setFormListName(''); setFormListDesc(''); setShowNewList(true); }}>
                      <Plus className="h-4 w-4 mr-2" /> Criar Primeira Lista
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {lists.map(list => {
                    const src = sourceLabels[list.source] || sourceLabels.manual;
                    const SrcIcon = src.icon;
                    return (
                      <Card key={list.id} className="group hover:border-primary/50 transition-all cursor-pointer">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3 flex-1 min-w-0" onClick={() => setSelectedList(list)}>
                              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                                <FolderOpen className="h-5 w-5 text-primary" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium truncate">{list.name}</p>
                                {list.description && <p className="text-xs text-muted-foreground truncate">{list.description}</p>}
                              </div>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setSelectedList(list)}><Eye className="h-4 w-4 mr-2" /> Ver Contatos</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => exportListDirect(list)} className="text-emerald-400 focus:text-emerald-300"><Download className="h-4 w-4 mr-2" /> Exportar CSV</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openEditDialog(list)}><Edit className="h-4 w-4 mr-2" /> Editar</DropdownMenuItem>
                                <DropdownMenuItem className="text-destructive" onClick={() => openDeleteDialog(list)}><Trash2 className="h-4 w-4 mr-2" /> Excluir</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <div className="flex items-center justify-between mt-3" onClick={() => setSelectedList(list)}>
                            <Badge variant="outline" className="text-xs gap-1"><SrcIcon className="h-3 w-3" />{src.label}</Badge>
                            <Badge variant="secondary" className="gap-1"><Users className="h-3 w-3" />{list.contact_count}</Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-2" onClick={() => setSelectedList(list)}>
                            Criada em {format(new Date(list.created_at), "dd/MM/yyyy", { locale: ptBR })}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )
            ) : (() => {
              const SKIP_META = new Set(['form_id', 'form_name', 'email', 'submission_id']);
              const formKeys = Array.from(new Set(
                filteredContacts.flatMap(c => Object.keys(c.metadata || {}).filter(k => !SKIP_META.has(k)))
              ));
              const hasForm = formKeys.length > 0;

              // Contadores de status WA
              const waSent = contacts.filter(c => followupStatus[c.phone]?.status === 'sent').length;
              const waPending = contacts.filter(c => followupStatus[c.phone]?.status === 'scheduled').length;
              const waFailed = contacts.filter(c => followupStatus[c.phone]?.status === 'failed').length;
              const waNoInfo = contacts.length - waSent - waPending - waFailed;

              return (
              <div className="space-y-3">
                {/* Header da lista */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">{selectedList.name}</h2>
                    <p className="text-xs text-muted-foreground">{contacts.length} contatos</p>
                  </div>
                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Buscar por telefone, nome..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
                  </div>
                </div>

                {/* Painel de status WhatsApp */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
                    <CheckCheck className="h-4 w-4 text-emerald-500 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground leading-none mb-0.5">Confirmação enviada</p>
                      <p className="text-lg font-bold text-emerald-500 leading-none">{waSent}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                    <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground leading-none mb-0.5">Aguardando envio</p>
                      <p className="text-lg font-bold text-amber-500 leading-none">{waPending}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                    <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground leading-none mb-0.5">Falha no envio</p>
                      <p className="text-lg font-bold text-red-500 leading-none">{waFailed}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-muted/40 border border-border/40 rounded-xl px-3 py-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground leading-none mb-0.5">Sem informação</p>
                      <p className="text-lg font-bold text-muted-foreground leading-none">{waNoInfo}</p>
                    </div>
                  </div>
                </div>

                {/* Tabela */}
                {contacts.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground border rounded-2xl">
                    <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p>Nenhum contato nesta lista</p>
                    <Button size="sm" className="mt-3" onClick={() => { setTargetListId(selectedList.id); setShowAddContacts(true); }}>
                      <Plus className="h-4 w-4 mr-1" /> Adicionar Contatos
                    </Button>
                  </div>
                ) : (
                  <div className="border rounded-2xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableHead className="w-10 pl-4">
                              <Checkbox
                                checked={selectedContacts.length === filteredContacts.length && filteredContacts.length > 0}
                                onCheckedChange={() => setSelectedContacts(selectedContacts.length === filteredContacts.length ? [] : filteredContacts.map(c => c.id))}
                              />
                            </TableHead>
                            <TableHead className="font-semibold text-xs uppercase tracking-wide">Contato</TableHead>
                            <TableHead className="font-semibold text-xs uppercase tracking-wide w-28 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <MessageSquare className="h-3 w-3 text-green-500" />
                                Confirm. WA
                              </div>
                            </TableHead>
                            {formKeys.map(k => (
                              <TableHead key={k} className="font-semibold text-xs uppercase tracking-wide min-w-[130px]">
                                <span className="truncate block max-w-[160px]" title={k}>{k}</span>
                              </TableHead>
                            ))}
                            <TableHead className="font-semibold text-xs uppercase tracking-wide">Cadastro</TableHead>
                            <TableHead className="w-10 pr-4"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredContacts.map(contact => {
                            const wa = followupStatus[contact.phone];
                            return (
                              <TableRow key={contact.id} className="hover:bg-muted/10 group">
                                <TableCell className="pl-4">
                                  <Checkbox
                                    checked={selectedContacts.includes(contact.id)}
                                    onCheckedChange={() => setSelectedContacts(prev =>
                                      prev.includes(contact.id) ? prev.filter(c => c !== contact.id) : [...prev, contact.id]
                                    )}
                                  />
                                </TableCell>

                                {/* Contato */}
                                <TableCell>
                                  <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                                      <span className="text-xs font-bold text-primary">
                                        {(contact.name || contact.phone)[0].toUpperCase()}
                                      </span>
                                    </div>
                                    <div className="min-w-0">
                                      <p className="font-semibold text-sm leading-tight truncate">{contact.name || '—'}</p>
                                      <p className="text-xs text-muted-foreground font-mono leading-tight">{contact.phone}</p>
                                      {contact.metadata?.email && (
                                        <p className="text-[10px] text-muted-foreground/70 leading-tight truncate">{contact.metadata.email}</p>
                                      )}
                                    </div>
                                  </div>
                                </TableCell>

                                {/* Status WA */}
                                <TableCell className="text-center">
                                  {!wa ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/50 bg-muted/30 rounded-full px-2 py-0.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                                      Sem info
                                    </span>
                                  ) : wa.status === 'sent' ? (
                                    <div className="inline-flex flex-col items-center gap-0.5">
                                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
                                        <CheckCheck className="h-3 w-3" /> Enviada
                                      </span>
                                      {wa.sent_at && (
                                        <span className="text-[9px] text-muted-foreground">
                                          {format(new Date(wa.sent_at), 'dd/MM HH:mm', { locale: ptBR })}
                                        </span>
                                      )}
                                    </div>
                                  ) : wa.status === 'scheduled' ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
                                      <Clock className="h-3 w-3" /> Pendente
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-500 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5">
                                      <AlertCircle className="h-3 w-3" /> Falha
                                    </span>
                                  )}
                                </TableCell>

                                {/* Respostas do formulário */}
                                {formKeys.map(k => {
                                  const val = contact.metadata?.[k];
                                  const isEmpty = val == null || val === '';
                                  return (
                                    <TableCell key={k}>
                                      {isEmpty ? (
                                        <span className="text-muted-foreground/30 text-sm">—</span>
                                      ) : (
                                        <span
                                          className="inline-block max-w-[160px] truncate text-sm bg-muted/30 rounded-lg px-2 py-0.5"
                                          title={String(val)}
                                        >
                                          {String(val)}
                                        </span>
                                      )}
                                    </TableCell>
                                  );
                                })}

                                {/* Data */}
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                  {format(new Date(contact.created_at), "dd/MM/yy", { locale: ptBR })}
                                </TableCell>

                                {/* Ações */}
                                <TableCell className="pr-4">
                                  <button
                                    onClick={() => deleteContact(contact.id)}
                                    className="p-1.5 rounded-md text-muted-foreground/40 hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                                    title="Remover contato"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          {filteredContacts.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={5 + formKeys.length} className="text-center py-8 text-muted-foreground">
                                Nenhum resultado para "{search}"
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </div>
              );
            })()}
          </TabsContent>

          {/* ============ TAB: Meus Grupos ============ */}
          <TabsContent value="groups" className="mt-4 space-y-4">
            {hasInstance === false ? (
              <Card><CardContent className="flex flex-col items-center justify-center gap-4 py-16">
                <WifiOff className="h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground text-center max-w-md">
                  Para extrair grupos, conecte uma instância WhatsApp em <strong>Configurações → WhatsApp</strong>.
                </p>
                <Button variant="outline" onClick={() => window.location.href = '/settings'}>Ir para Configurações</Button>
              </CardContent></Card>
            ) : (
              <>
                <div className="flex justify-between items-center">
                  <p className="text-sm text-muted-foreground">Extraia membros dos seus grupos e comunidades WhatsApp</p>
                  <Button onClick={fetchOwnGroups} disabled={isLoadingOwn}>
                    {isLoadingOwn ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Buscar Meus Grupos
                  </Button>
                </div>
                {ownGroups.length > 0 && (
                  <GroupTable
                    groups={ownGroups} selectedGroups={selectedOwn}
                    toggleGroup={id => toggleGroup(id, 'own')} toggleAll={() => toggleAllGroups('own')}
                    search={searchOwn} setSearch={setSearchOwn} onExtract={() => openExtractDialog('own')}
                  />
                )}
                {ownGroups.length === 0 && !isLoadingOwn && (
                  <Card><CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                    <Users className="h-12 w-12 text-muted-foreground opacity-40" />
                    <p className="text-muted-foreground text-center">Clique em <strong>"Buscar Meus Grupos"</strong> para listar os grupos das suas instâncias.</p>
                  </CardContent></Card>
                )}
              </>
            )}
          </TabsContent>

          {/* ============ TAB: Grupos Externos ============ */}
          <TabsContent value="external" className="mt-4 space-y-4">
            {hasInstance === false ? (
              <Card><CardContent className="flex flex-col items-center justify-center gap-4 py-16">
                <WifiOff className="h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground text-center max-w-md">
                  Para pesquisar grupos, conecte uma instância WhatsApp em <strong>Configurações → WhatsApp</strong>.
                </p>
                <Button variant="outline" onClick={() => window.location.href = '/settings'}>Ir para Configurações</Button>
              </CardContent></Card>
            ) : (
              <>
                <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Globe className="h-5 w-5 text-primary" /> Pesquisar Grupos por Nicho
                    </CardTitle>
                    <CardDescription>Digite o nicho ou tema para encontrar grupos públicos e extrair os contatos</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Ex: marketing digital, emagrecimento, criptomoedas..."
                          value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && searchGroupsByNiche()} className="pl-9"
                        />
                      </div>
                      <Button onClick={searchGroupsByNiche} disabled={isSearching || !searchQuery.trim()}>
                        {isSearching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                        Pesquisar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                {searchResults.length > 0 && (
                  <GroupTable
                    groups={searchResults} selectedGroups={selectedSearch}
                    toggleGroup={id => toggleGroup(id, 'search')} toggleAll={() => toggleAllGroups('search')}
                    search={searchFilter} setSearch={setSearchFilter} onExtract={() => openExtractDialog('search')}
                  />
                )}
                {searchResults.length === 0 && !isSearching && searchQuery && (
                  <Card><CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                    <Search className="h-10 w-10 text-muted-foreground" />
                    <p className="text-muted-foreground text-center">Nenhum grupo encontrado. Tente outro termo.</p>
                  </CardContent></Card>
                )}
              </>
            )}
          </TabsContent>

          {/* ============ TAB: Google Maps ============ */}
          <TabsContent value="gmb" className="mt-4 space-y-4">
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-primary" /> Extrair Leads do Google Maps
                </CardTitle>
                <CardDescription>Busque empresas e extraia telefones, endereços e avaliações automaticamente</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Termo de busca *</Label>
                  <Input value={mapsQuery} onChange={e => setMapsQuery(e.target.value)} placeholder="Ex: Clínicas Odontológicas em São Paulo" maxLength={200} />
                  <p className="text-xs text-muted-foreground">Use termos específicos com localização para melhores resultados</p>
                </div>
                <div className="space-y-2">
                  <Label>Salvar em</Label>
                  <div className="flex gap-2">
                    <Button type="button" variant={mapsListMode === 'new' ? 'default' : 'outline'} size="sm" onClick={() => setMapsListMode('new')}>Nova Lista</Button>
                    <Button type="button" variant={mapsListMode === 'existing' ? 'default' : 'outline'} size="sm" onClick={() => setMapsListMode('existing')} disabled={lists.length === 0}>Lista Existente</Button>
                  </div>
                </div>
                {mapsListMode === 'new' ? (
                  <div className="space-y-2">
                    <Label>Nome da nova lista</Label>
                    <Input value={mapsNewListName} onChange={e => setMapsNewListName(e.target.value)} placeholder="Ex: Clínicas SP" maxLength={100} />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Selecione a lista</Label>
                    <Select value={mapsTargetListId} onValueChange={setMapsTargetListId}>
                      <SelectTrigger><SelectValue placeholder="Selecione uma lista" /></SelectTrigger>
                      <SelectContent>{lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.contact_count})</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <Button
                  onClick={extractGoogleMaps} className="w-full"
                  disabled={isExtractingMaps || !mapsQuery.trim() || (mapsListMode === 'existing' && !mapsTargetListId)}
                >
                  {isExtractingMaps ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Globe className="h-4 w-4 mr-2" />}
                  {isExtractingMaps ? 'Extraindo...' : 'Extrair Leads'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      {/* ============ DIALOGS ============ */}

      {/* Importar do Pedro */}
      <Dialog open={showPedroImport} onOpenChange={setShowPedroImport}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-500/20 to-teal-500/20 border border-blue-500/30 flex items-center justify-center">
                <MessageSquare className="h-4 w-4 text-blue-400" />
              </div>
              Importar Leads do Pedro
            </DialogTitle>
            <DialogDescription>
              {isSeller
                ? 'Cria uma lista com APENAS os leads que VOCÊ atendeu no Pedro. Útil para disparar follow-ups e campanhas para seus próprios leads.'
                : 'Cria uma lista de contatos com os leads que o Pedro qualificou no atendimento. Você pode usar essa lista em campanhas e fluxos de mensagens automáticas.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Contador de leads disponíveis */}
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 flex items-center gap-3">
              <Users className="h-5 w-5 text-blue-400 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {pedroLeadCount === null ? '...' : pedroLeadCount} {pedroLeadCount === 1 ? 'lead disponível' : 'leads disponíveis'}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {isSeller ? 'Apenas leads atribuídos a você' : 'Todos os leads atualmente no CRM do Pedro'}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Nome da lista</Label>
              <Input
                value={pedroListName}
                onChange={e => setPedroListName(e.target.value)}
                placeholder="Ex: Leads do Pedro - Maio"
                maxLength={100}
              />
            </div>

            {/* Toggle auto-sync */}
            <div className="rounded-lg border border-border/50 bg-muted/30 p-3 flex items-start gap-3">
              <Checkbox
                id="auto-sync"
                checked={pedroAutoSync}
                onCheckedChange={(v) => setPedroAutoSync(v === true)}
                className="mt-0.5"
              />
              <div className="flex-1 cursor-pointer" onClick={() => setPedroAutoSync(!pedroAutoSync)}>
                <Label htmlFor="auto-sync" className="text-sm font-semibold cursor-pointer">
                  Sincronizar automaticamente novos leads
                </Label>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                  {isSeller
                    ? 'Quando o Pedro qualificar um novo lead E atribuir a você, ele entra automaticamente nesta lista. Útil para disparar fluxos de follow-up.'
                    : 'Quando o Pedro qualificar um novo lead, ele entra automaticamente nesta lista. Útil para disparar fluxos de follow-up automaticamente.'}
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPedroImport(false)}>Cancelar</Button>
            <Button
              onClick={createListFromPedro}
              disabled={isSaving || !pedroListName.trim() || pedroLeadCount === null}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              {pedroLeadCount === 0 && pedroAutoSync ? 'Criar Lista Vazia (auto-sync)' : `Importar ${pedroLeadCount ?? 0} contato(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New List */}
      <Dialog open={showNewList} onOpenChange={setShowNewList}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova Lista de Contatos</DialogTitle><DialogDescription>Crie uma lista para organizar seus leads</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Nome da lista *</Label><Input value={formListName} onChange={e => setFormListName(e.target.value)} placeholder="Ex: Leads Quentes" maxLength={100} /></div>
            <div className="space-y-2"><Label>Descrição (opcional)</Label><Input value={formListDesc} onChange={e => setFormListDesc(e.target.value)} placeholder="Descrição da lista" maxLength={500} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewList(false)}>Cancelar</Button>
            <Button onClick={createList} disabled={isSaving || !formListName.trim()}>{isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}Criar Lista</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit List */}
      <Dialog open={showEditList} onOpenChange={setShowEditList}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Lista</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Nome *</Label><Input value={formListName} onChange={e => setFormListName(e.target.value)} maxLength={100} /></div>
            <div className="space-y-2"><Label>Descrição</Label><Input value={formListDesc} onChange={e => setFormListDesc(e.target.value)} maxLength={500} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditList(false)}>Cancelar</Button>
            <Button onClick={updateList} disabled={isSaving || !formListName.trim()}>{isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Edit className="h-4 w-4 mr-2" />}Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete List */}
      <Dialog open={showDeleteList} onOpenChange={setShowDeleteList}>
        <DialogContent>
          <DialogHeader><DialogTitle>Excluir Lista</DialogTitle><DialogDescription>Tem certeza que deseja excluir "{editingList?.name}"? {editingList?.contact_count || 0} contatos serão removidos.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteList(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={deleteList} disabled={isSaving}>{isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}Excluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Contacts */}
      <Dialog open={showAddContacts} onOpenChange={setShowAddContacts}>
        <DialogContent>
          <DialogHeader><DialogTitle>Importar Contatos</DialogTitle><DialogDescription>Cole números de telefone (um por linha ou separados por vírgula)</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Lista destino *</Label>
              <Select value={targetListId} onValueChange={setTargetListId}>
                <SelectTrigger><SelectValue placeholder="Selecione uma lista" /></SelectTrigger>
                <SelectContent>{lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.contact_count})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Números de telefone</Label>
              <Textarea value={bulkPhones} onChange={e => setBulkPhones(e.target.value)} placeholder={"5511999998888\n5521988887777"} rows={6} maxLength={50000} />
              <p className="text-xs text-muted-foreground">Formato: DDD + número. Duplicatas removidas automaticamente.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddContacts(false)}>Cancelar</Button>
            <Button onClick={addBulkContacts} disabled={isSaving || !targetListId || !bulkPhones.trim()}>{isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Phone className="h-4 w-4 mr-2" />}Importar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extract Group Contacts */}
      <Dialog open={showExtractDialog} onOpenChange={setShowExtractDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Download className="h-5 w-5 text-primary" /> Extrair Contatos</DialogTitle>
            <DialogDescription>Extrair contatos de {currentSelectedGroups.length} grupo(s). Escolha onde salvar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Salvar em</Label>
              <div className="flex gap-2">
                <Button type="button" variant={extractListMode === 'new' ? 'default' : 'outline'} size="sm" onClick={() => setExtractListMode('new')}><Plus className="h-3.5 w-3.5 mr-1" /> Nova Lista</Button>
                <Button type="button" variant={extractListMode === 'existing' ? 'default' : 'outline'} size="sm" onClick={() => setExtractListMode('existing')} disabled={lists.length === 0}>Lista Existente</Button>
              </div>
            </div>
            {extractListMode === 'new' ? (
              <div className="space-y-2"><Label>Nome da nova lista</Label><Input value={extractNewListName} onChange={e => setExtractNewListName(e.target.value)} placeholder="Ex: Grupos extraídos" maxLength={100} /></div>
            ) : (
              <div className="space-y-2">
                <Label>Selecione a lista</Label>
                <Select value={extractTargetListId} onValueChange={setExtractTargetListId}>
                  <SelectTrigger><SelectValue placeholder="Selecione uma lista" /></SelectTrigger>
                  <SelectContent>{lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.contact_count})</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExtractDialog(false)}>Cancelar</Button>
            <Button onClick={extractGroupContacts} disabled={isExtracting || (extractListMode === 'new' && !extractNewListName.trim()) || (extractListMode === 'existing' && !extractTargetListId)}>
              {isExtracting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              {isExtracting ? 'Extraindo...' : 'Extrair Contatos'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File Import Dialog */}
      <FileImportDialog
        open={showFileImport}
        onOpenChange={setShowFileImport}
        userId={effectiveUserId || ''}
        lists={lists.map(l => ({ id: l.id, name: l.name }))}
        onSuccess={fetchLists}
      />
    </>
  );

  // Bloqueia vendedor sem permissão marcos_contatos (acesso direto via URL)
  if (blockSellerAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  return embedded ? (
    <div className="h-full overflow-y-auto">{content}</div>
  ) : (
    <MainLayout>{content}</MainLayout>
  );
}
