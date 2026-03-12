import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  Contact, Search, Trash2, Loader2, Plus, FolderOpen, Users, Phone, Tag,
  Edit, Eye, ArrowLeft, MoreHorizontal, MapPin, MessageCircle,
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
}

const sourceLabels: Record<string, { label: string; icon: typeof Phone }> = {
  manual: { label: 'Manual', icon: Phone },
  whatsapp_group: { label: 'Grupo WhatsApp', icon: MessageCircle },
  google_maps: { label: 'Google Maps', icon: MapPin },
  import: { label: 'Importação', icon: FolderOpen },
};

export default function WhatsAppContacts() {
  const { user } = useAuth();
  const { toast } = useToast();
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

  // Form state
  const [formListName, setFormListName] = useState('');
  const [formListDesc, setFormListDesc] = useState('');
  const [bulkPhones, setBulkPhones] = useState('');
  const [targetListId, setTargetListId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editingList, setEditingList] = useState<ContactList | null>(null);

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

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  useEffect(() => {
    if (selectedList) fetchContacts(selectedList.id);
    else setContacts([]);
  }, [selectedList, fetchContacts]);

  // --- CRUD ---
  const createList = async () => {
    if (!user || !formListName.trim()) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('wa_contact_lists').insert({
        user_id: user.id,
        name: formListName.trim(),
        description: formListDesc.trim() || null,
        source: 'manual',
      });
      if (error) throw error;
      toast({ title: 'Lista criada!' });
      setShowNewList(false);
      setFormListName('');
      setFormListDesc('');
      fetchLists();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const updateList = async () => {
    if (!editingList || !formListName.trim()) return;
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('wa_contact_lists')
        .update({ name: formListName.trim(), description: formListDesc.trim() || null } as any)
        .eq('id', editingList.id);
      if (error) throw error;
      toast({ title: 'Lista atualizada!' });
      setShowEditList(false);
      setEditingList(null);
      fetchLists();
      if (selectedList?.id === editingList.id) {
        setSelectedList(prev => prev ? { ...prev, name: formListName.trim(), description: formListDesc.trim() || null } : null);
      }
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const deleteList = async () => {
    if (!editingList) return;
    setIsSaving(true);
    try {
      // Delete contacts first
      await supabase.from('wa_contacts').delete().eq('list_id', editingList.id);
      const { error } = await supabase.from('wa_contact_lists').delete().eq('id', editingList.id);
      if (error) throw error;
      toast({ title: 'Lista excluída' });
      setShowDeleteList(false);
      setEditingList(null);
      if (selectedList?.id === editingList.id) setSelectedList(null);
      fetchLists();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const addBulkContacts = async () => {
    if (!user || !targetListId || !bulkPhones.trim()) return;
    setIsSaving(true);
    try {
      const phones = bulkPhones
        .split(/[\n,;]+/)
        .map(p => p.replace(/\D/g, '').trim())
        .filter(p => p.length >= 10);

      if (phones.length === 0) {
        toast({ title: 'Nenhum número válido encontrado', variant: 'destructive' });
        setIsSaving(false);
        return;
      }

      // Deduplicate
      const unique = [...new Set(phones)];

      const rows = unique.map(phone => ({
        user_id: user.id,
        list_id: targetListId,
        phone,
        source: 'manual' as const,
      }));

      const { error } = await supabase.from('wa_contacts').insert(rows);
      if (error) throw error;

      // Recount
      const { count } = await supabase
        .from('wa_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('list_id', targetListId);

      await supabase
        .from('wa_contact_lists')
        .update({ contact_count: count || 0 } as any)
        .eq('id', targetListId);

      toast({ title: `${unique.length} contatos adicionados!` });
      setShowAddContacts(false);
      setBulkPhones('');
      if (selectedList?.id === targetListId) fetchContacts(targetListId);
      fetchLists();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
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
        // Recount
        const { count } = await supabase
          .from('wa_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('list_id', selectedList.id);
        await supabase
          .from('wa_contact_lists')
          .update({ contact_count: count || 0 } as any)
          .eq('id', selectedList.id);
        fetchLists();
      }
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const openEditDialog = (list: ContactList) => {
    setEditingList(list);
    setFormListName(list.name);
    setFormListDesc(list.description || '');
    setShowEditList(true);
  };

  const openDeleteDialog = (list: ContactList) => {
    setEditingList(list);
    setShowDeleteList(true);
  };

  const filteredContacts = contacts.filter(c =>
    !search || c.phone?.includes(search) || c.name?.toLowerCase().includes(search.toLowerCase()) || c.group_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <MainLayout>
      <div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Contact className="h-6 w-6 text-primary" />
              {selectedList ? (
                <button onClick={() => setSelectedList(null)} className="flex items-center gap-2 hover:text-primary transition-colors">
                  <ArrowLeft className="h-5 w-5" />
                  {selectedList.name}
                </button>
              ) : (
                'Listas de Contatos'
              )}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {selectedList
                ? `${filteredContacts.length} contatos • Origem: ${sourceLabels[selectedList.source]?.label || selectedList.source}`
                : `${lists.length} lista(s) • Organize seus leads para campanhas`
              }
            </p>
          </div>
          <div className="flex gap-2">
            {selectedList ? (
              <>
                <Button variant="outline" size="sm" onClick={() => { setTargetListId(selectedList.id); setShowAddContacts(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar Contatos
                </Button>
                {selectedContacts.length > 0 && (
                  <Button variant="destructive" size="sm" onClick={deleteSelectedContacts}>
                    <Trash2 className="h-4 w-4 mr-1" /> Remover ({selectedContacts.length})
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setShowAddContacts(true)}>
                  <Phone className="h-4 w-4 mr-1.5" /> Importar Contatos
                </Button>
                <Button onClick={() => { setFormListName(''); setFormListDesc(''); setShowNewList(true); }}>
                  <Plus className="h-4 w-4 mr-1.5" /> Nova Lista
                </Button>
              </>
            )}
          </div>
        </div>

        {/* View: Lists or Contacts */}
        {!selectedList ? (
          <>
            {/* Lists Grid */}
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : lists.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
                  <FolderOpen className="h-12 w-12 text-muted-foreground opacity-40" />
                  <p className="text-muted-foreground">Nenhuma lista criada ainda</p>
                  <p className="text-sm text-muted-foreground">Crie uma lista para começar a organizar seus leads</p>
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
                    <Card
                      key={list.id}
                      className="group hover:border-primary/50 transition-all cursor-pointer"
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div
                            className="flex items-center gap-3 flex-1 min-w-0"
                            onClick={() => setSelectedList(list)}
                          >
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                              <FolderOpen className="h-5 w-5 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium truncate">{list.name}</p>
                              {list.description && (
                                <p className="text-xs text-muted-foreground truncate">{list.description}</p>
                              )}
                            </div>
                          </div>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setSelectedList(list)}>
                                <Eye className="h-4 w-4 mr-2" /> Ver Contatos
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEditDialog(list)}>
                                <Edit className="h-4 w-4 mr-2" /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => openDeleteDialog(list)}>
                                <Trash2 className="h-4 w-4 mr-2" /> Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        <div className="flex items-center justify-between mt-3" onClick={() => setSelectedList(list)}>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs gap-1">
                              <SrcIcon className="h-3 w-3" />
                              {src.label}
                            </Badge>
                          </div>
                          <Badge variant="secondary" className="gap-1">
                            <Users className="h-3 w-3" />
                            {list.contact_count}
                          </Badge>
                        </div>

                        <p className="text-[11px] text-muted-foreground mt-2" onClick={() => setSelectedList(list)}>
                          Criada em {format(new Date(list.created_at), "dd/MM/yyyy", { locale: ptBR })}
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          /* Contacts Table */
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <CardTitle className="text-lg">Contatos da Lista</CardTitle>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por telefone, nome..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {contacts.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p>Nenhum contato nesta lista</p>
                  <Button
                    size="sm"
                    className="mt-3"
                    onClick={() => { setTargetListId(selectedList.id); setShowAddContacts(true); }}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Adicionar Contatos
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={selectedContacts.length === filteredContacts.length && filteredContacts.length > 0}
                            onCheckedChange={() => {
                              setSelectedContacts(
                                selectedContacts.length === filteredContacts.length
                                  ? []
                                  : filteredContacts.map(c => c.id)
                              );
                            }}
                          />
                        </TableHead>
                        <TableHead>Telefone</TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Grupo</TableHead>
                        <TableHead>Origem</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Adicionado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredContacts.map(contact => (
                        <TableRow key={contact.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedContacts.includes(contact.id)}
                              onCheckedChange={() => {
                                setSelectedContacts(prev =>
                                  prev.includes(contact.id)
                                    ? prev.filter(c => c !== contact.id)
                                    : [...prev, contact.id]
                                );
                              }}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-sm">{contact.phone}</TableCell>
                          <TableCell>{contact.name || '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{contact.group_name || '—'}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{sourceLabels[contact.source]?.label || contact.source}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={contact.is_valid ? 'secondary' : 'destructive'} className="text-xs">
                              {contact.is_valid ? 'Válido' : 'Inválido'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {format(new Date(contact.created_at), 'dd/MM/yy', { locale: ptBR })}
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredContacts.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                            Nenhum resultado para "{search}"
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* New List Dialog */}
      <Dialog open={showNewList} onOpenChange={setShowNewList}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Lista de Contatos</DialogTitle>
            <DialogDescription>Crie uma lista para organizar seus leads</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da lista *</Label>
              <Input value={formListName} onChange={e => setFormListName(e.target.value)} placeholder="Ex: Leads Quentes" maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Input value={formListDesc} onChange={e => setFormListDesc(e.target.value)} placeholder="Descrição da lista" maxLength={500} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewList(false)}>Cancelar</Button>
            <Button onClick={createList} disabled={isSaving || !formListName.trim()}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Criar Lista
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit List Dialog */}
      <Dialog open={showEditList} onOpenChange={setShowEditList}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Lista</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da lista *</Label>
              <Input value={formListName} onChange={e => setFormListName(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Input value={formListDesc} onChange={e => setFormListDesc(e.target.value)} maxLength={500} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditList(false)}>Cancelar</Button>
            <Button onClick={updateList} disabled={isSaving || !formListName.trim()}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Edit className="h-4 w-4 mr-2" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete List Confirmation */}
      <Dialog open={showDeleteList} onOpenChange={setShowDeleteList}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir Lista</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir a lista "{editingList?.name}"?
              Todos os {editingList?.contact_count || 0} contatos serão removidos permanentemente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteList(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={deleteList} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Excluir Lista
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Contacts Dialog */}
      <Dialog open={showAddContacts} onOpenChange={setShowAddContacts}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar Contatos</DialogTitle>
            <DialogDescription>Cole números de telefone (um por linha ou separados por vírgula)</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Lista destino *</Label>
              <Select value={targetListId} onValueChange={setTargetListId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma lista" />
                </SelectTrigger>
                <SelectContent>
                  {lists.map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.name} ({l.contact_count})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Números de telefone</Label>
              <Textarea
                value={bulkPhones}
                onChange={e => setBulkPhones(e.target.value)}
                placeholder={"5511999998888\n5521988887777\n5531977776666"}
                rows={6}
                maxLength={50000}
              />
              <p className="text-xs text-muted-foreground">
                Formato: DDD + número (ex: 5511999998888). Duplicatas serão removidas automaticamente.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddContacts(false)}>Cancelar</Button>
            <Button onClick={addBulkContacts} disabled={isSaving || !targetListId || !bulkPhones.trim()}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Phone className="h-4 w-4 mr-2" />}
              Importar Contatos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
