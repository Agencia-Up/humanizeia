import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  Contact, Search, Trash2, Loader2, Plus, FolderOpen, Users, Phone, Tag,
  Edit, Eye, ArrowLeft, MoreHorizontal, MapPin, MessageCircle, Globe,
  Download, RefreshCw, UserPlus, CheckCircle, WifiOff, Upload,
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
  const { toast } = useToast();
  const [mainTab, setMainTab] = useState('lists');

  // === Contact Lists state ===
  const [lists, setLists] = useState<ContactList[]>([]);
  const [contacts, setContacts] = useState<WAContact[]>([]);
  const [selectedList, setSelectedList] = useState<ContactList | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);

  // Dialogs
  const [showNewList, setShowNewList] = useState(false);
  const [showEditList, setShowEditList] = useState(false);
  const [showAddContacts, setShowAddContacts] = useState(false);
  const [showDeleteList, setShowDeleteList] = useState(false);
  const [showFileImport, setShowFileImport] = useState(false);
  const [showGoogleMaps, setShowGoogleMaps] = useState(false);

  // Form state
  const [formListName, setFormListName] = useState('');
  const [formListDesc, setFormListDesc] = useState('');
  const [bulkPhones, setBulkPhones] = useState('');
  const [targetListId, setTargetListId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editingList, setEditingList] = useState<ContactList | null>(null);

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
    if (!user) return;
    (async () => {
      const { count } = await supabase
        .from('wa_instances')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('provider', 'evolution');
      setHasInstance((count ?? 0) > 0);
    })();
  }, [user]);

  // ============= Contact Lists Logic =============
  const fetchLists = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('wa_contact_lists')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setLists((data as ContactList[]) || []);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [user, toast]);

  const fetchContacts = useCallback(async (listId: string) => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('wa_contacts')
        .select('*')
        .eq('user_id', user.id)
        .eq('list_id', listId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setContacts((data as WAContact[]) || []);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  }, [user, toast]);

  useEffect(() => { fetchLists(); }, [fetchLists]);
  useEffect(() => {
    if (selectedList) fetchContacts(selectedList.id);
    else setContacts([]);
  }, [selectedList, fetchContacts]);

  const createList = async () => {
    if (!user || !formListName.trim()) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('wa_contact_lists').insert({
        user_id: user.id, name: formListName.trim(), description: formListDesc.trim() || null, source: 'manual',
      });
      if (error) throw error;
      toast({ title: 'Lista criada!' });
      setShowNewList(false); setFormListName(''); setFormListDesc('');
      fetchLists();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
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
    if (!user || !targetListId || !bulkPhones.trim()) return;
    setIsSaving(true);
    try {
      const phones = bulkPhones.split(/[\n,;]+/).map(p => p.replace(/\D/g, '').trim()).filter(p => p.length >= 10);
      if (phones.length === 0) { toast({ title: 'Nenhum número válido encontrado', variant: 'destructive' }); setIsSaving(false); return; }
      const unique = [...new Set(phones)];
      const rows = unique.map(phone => ({ user_id: user.id, list_id: targetListId, phone, source: 'manual' as const }));
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

  const extractGoogleMaps = async () => {
    if (!user || !mapsQuery.trim()) return;
    setIsExtractingMaps(true);
    try {
      const payload: any = { user_id: user.id, search_query: mapsQuery.trim() };
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
    if (!user) return;
    setIsLoadingOwn(true);
    try {
      console.log('[WhatsAppContacts] Fetching groups for user:', user.id);
      const { data, error } = await supabase.functions.invoke('wa-extract-groups', { body: { user_id: user.id } });
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
    if (!user || !searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('wa-extract-groups', {
        body: { user_id: user.id, action: 'search_groups', query: searchQuery.trim() },
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
    if (!user || currentSelectedGroups.length === 0) return;
    setIsExtracting(true);
    try {
      let listId = extractListMode === 'existing' ? extractTargetListId : undefined;
      if (extractListMode === 'new' && extractNewListName.trim()) {
        const { data: newList, error: listErr } = await supabase
          .from('wa_contact_lists')
          .insert({ user_id: user.id, name: extractNewListName.trim(), source: 'group_extract', contact_count: 0 })
          .select('id').single();
        if (listErr) throw listErr;
        listId = newList.id;
      }
      const selectedGroupData = currentGroups.filter(g => currentSelectedGroups.includes(g.id));
      const { data, error } = await supabase.functions.invoke('wa-extract-groups', {
        body: { user_id: user.id, action: 'extract_contacts', group_ids: currentSelectedGroups, groups: selectedGroupData, list_id: listId },
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
                    {selectedContacts.length > 0 && (
                      <Button variant="destructive" size="sm" onClick={deleteSelectedContacts}>
                        <Trash2 className="h-4 w-4 mr-1" /> Remover ({selectedContacts.length})
                      </Button>
                    )}
                  </>
                ) : (
                  <>
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
            ) : (
              <Card>
                <CardHeader>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <CardTitle className="text-lg">{selectedList.name}</CardTitle>
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input placeholder="Buscar por telefone, nome..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {contacts.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
                      <p>Nenhum contato nesta lista</p>
                      <Button size="sm" className="mt-3" onClick={() => { setTargetListId(selectedList.id); setShowAddContacts(true); }}>
                        <Plus className="h-4 w-4 mr-1" /> Adicionar Contatos
                      </Button>
                    </div>
                  ) : (() => {
                    // Campos dinâmicos do formulário presentes no metadata dos contatos
                    const SKIP_META = new Set(['form_id', 'form_name', 'email', 'submission_id']);
                    const formKeys = Array.from(
                      new Set(
                        filteredContacts.flatMap(c =>
                          Object.keys(c.metadata || {}).filter(k => !SKIP_META.has(k))
                        )
                      )
                    );
                    const hasFormFields = formKeys.length > 0;
                    const totalCols = 8 + formKeys.length;

                    return (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10">
                                <Checkbox
                                  checked={selectedContacts.length === filteredContacts.length && filteredContacts.length > 0}
                                  onCheckedChange={() => setSelectedContacts(selectedContacts.length === filteredContacts.length ? [] : filteredContacts.map(c => c.id))}
                                />
                              </TableHead>
                              <TableHead>Telefone</TableHead>
                              <TableHead>Nome</TableHead>
                              {/* Colunas dinâmicas do formulário */}
                              {formKeys.map(k => (
                                <TableHead key={k} className="min-w-[140px] max-w-[200px]">
                                  <span className="truncate block text-xs leading-tight" title={k}>{k}</span>
                                </TableHead>
                              ))}
                              <TableHead>Origem</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Adicionado</TableHead>
                              <TableHead className="w-10"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredContacts.map(contact => (
                              <TableRow key={contact.id}>
                                <TableCell>
                                  <Checkbox checked={selectedContacts.includes(contact.id)} onCheckedChange={() => setSelectedContacts(prev => prev.includes(contact.id) ? prev.filter(c => c !== contact.id) : [...prev, contact.id])} />
                                </TableCell>
                                <TableCell className="font-mono text-sm">{contact.phone}</TableCell>
                                <TableCell>
                                  <div>
                                    <p className="font-medium text-sm">{contact.name || '—'}</p>
                                    {contact.metadata?.email && (
                                      <p className="text-[10px] text-muted-foreground">{contact.metadata.email}</p>
                                    )}
                                  </div>
                                </TableCell>
                                {/* Células dinâmicas */}
                                {formKeys.map(k => (
                                  <TableCell key={k} className="max-w-[200px]">
                                    <span
                                      className="text-sm block truncate"
                                      title={String(contact.metadata?.[k] ?? '')}
                                    >
                                      {contact.metadata?.[k] != null && contact.metadata[k] !== ''
                                        ? String(contact.metadata[k])
                                        : <span className="text-muted-foreground/40">—</span>
                                      }
                                    </span>
                                  </TableCell>
                                ))}
                                <TableCell>
                                  <Badge variant="outline" className="text-xs">
                                    {contact.source === 'form' ? 'form' : (sourceLabels[contact.source]?.label || contact.source)}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge variant={contact.is_valid ? 'secondary' : 'destructive'} className="text-xs">
                                    {contact.is_valid ? 'Válido' : 'Inválido'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {format(new Date(contact.created_at), 'dd/MM/yy', { locale: ptBR })}
                                </TableCell>
                                <TableCell>
                                  <button
                                    onClick={() => deleteContact(contact.id)}
                                    className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                    title="Remover contato"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </TableCell>
                              </TableRow>
                            ))}
                            {filteredContacts.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={totalCols} className="text-center py-8 text-muted-foreground">
                                  Nenhum resultado para "{search}"
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}
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
        userId={user?.id || ''}
        lists={lists.map(l => ({ id: l.id, name: l.name }))}
        onSuccess={fetchLists}
      />
    </>
  );

  return embedded ? content : <MainLayout>{content}</MainLayout>;
}
