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
  Contact,
  Search,
  Trash2,
  Loader2,
  Plus,
  FolderOpen,
  Users,
  Phone,
  Tag,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ContactList {
  id: string;
  name: string;
  description: string | null;
  source: string;
  contact_count: number;
  created_at: string;
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
}

export default function WhatsAppContacts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [lists, setLists] = useState<ContactList[]>([]);
  const [contacts, setContacts] = useState<WAContact[]>([]);
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [showNewList, setShowNewList] = useState(false);
  const [showAddContacts, setShowAddContacts] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDesc, setNewListDesc] = useState('');
  const [bulkPhones, setBulkPhones] = useState('');
  const [targetListId, setTargetListId] = useState('');
  const [isSaving, setIsSaving] = useState(false);

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
    if (selectedList) fetchContacts(selectedList);
    else setContacts([]);
  }, [selectedList, fetchContacts]);

  const createList = async () => {
    if (!user || !newListName.trim()) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('wa_contact_lists').insert({
        user_id: user.id,
        name: newListName.trim(),
        description: newListDesc.trim() || null,
        source: 'manual',
      });
      if (error) throw error;
      toast({ title: 'Lista criada!' });
      setShowNewList(false);
      setNewListName('');
      setNewListDesc('');
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
        return;
      }

      const rows = phones.map(phone => ({
        user_id: user.id,
        list_id: targetListId,
        phone,
        source: 'manual' as const,
      }));

      const { error } = await supabase.from('wa_contacts').insert(rows);
      if (error) throw error;

      // Update contact count
      await supabase
        .from('wa_contact_lists')
        .update({ contact_count: contacts.length + phones.length })
        .eq('id', targetListId);

      toast({ title: `${phones.length} contatos adicionados!` });
      setShowAddContacts(false);
      setBulkPhones('');
      if (selectedList === targetListId) fetchContacts(targetListId);
      fetchLists();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (selectedContacts.length === 0) return;
    try {
      const { error } = await supabase
        .from('wa_contacts')
        .delete()
        .in('id', selectedContacts);
      if (error) throw error;
      toast({ title: `${selectedContacts.length} contatos removidos` });
      setSelectedContacts([]);
      if (selectedList) fetchContacts(selectedList);
      fetchLists();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const filteredContacts = contacts.filter(c =>
    (c.phone?.includes(search) || c.name?.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl flex items-center gap-2">
              <Contact className="h-7 w-7 text-blue-500" />
              Extrator de Contatos
            </h1>
            <p className="text-muted-foreground">
              Gerencie suas listas e contatos do WhatsApp
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowAddContacts(true)}>
              <Phone className="h-4 w-4 mr-2" /> Adicionar Contatos
            </Button>
            <Button onClick={() => setShowNewList(true)}>
              <Plus className="h-4 w-4 mr-2" /> Nova Lista
            </Button>
          </div>
        </div>

        {/* Lists Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {lists.map(list => (
            <Card
              key={list.id}
              className={`border-border/50 bg-card/50 backdrop-blur-sm cursor-pointer transition-all hover:border-primary/50 ${
                selectedList === list.id ? 'border-primary ring-1 ring-primary/30' : ''
              }`}
              onClick={() => setSelectedList(list.id === selectedList ? null : list.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/20">
                      <FolderOpen className="h-5 w-5 text-blue-500" />
                    </div>
                    <div>
                      <p className="font-medium">{list.name}</p>
                      {list.description && (
                        <p className="text-xs text-muted-foreground">{list.description}</p>
                      )}
                    </div>
                  </div>
                  <Badge variant="secondary">
                    <Users className="h-3 w-3 mr-1" />
                    {list.contact_count}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <Badge variant="outline" className="text-xs">
                    <Tag className="h-3 w-3 mr-1" />
                    {list.source}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}

          {lists.length === 0 && !isLoading && (
            <Card className="col-span-full border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                <FolderOpen className="h-10 w-10 text-muted-foreground" />
                <p className="text-muted-foreground">Nenhuma lista criada ainda</p>
                <Button size="sm" onClick={() => setShowNewList(true)}>
                  <Plus className="h-4 w-4 mr-2" /> Criar primeira lista
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Contacts Table */}
        {selectedList && (
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">
                  Contatos ({filteredContacts.length})
                </CardTitle>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="pl-9 w-56"
                    />
                  </div>
                  {selectedContacts.length > 0 && (
                    <Button variant="destructive" size="sm" onClick={deleteSelected}>
                      <Trash2 className="h-4 w-4 mr-1" /> Remover ({selectedContacts.length})
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
                      <Checkbox
                        checked={selectedContacts.length === filteredContacts.length && filteredContacts.length > 0}
                        onCheckedChange={() => {
                          if (selectedContacts.length === filteredContacts.length) {
                            setSelectedContacts([]);
                          } else {
                            setSelectedContacts(filteredContacts.map(c => c.id));
                          }
                        }}
                      />
                    </TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Grupo</TableHead>
                    <TableHead>Origem</TableHead>
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
                      <TableCell>{contact.name || '-'}</TableCell>
                      <TableCell>{contact.group_name || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{contact.source}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredContacts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        Nenhum contato nesta lista
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* New List Dialog */}
      <Dialog open={showNewList} onOpenChange={setShowNewList}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Lista de Contatos</DialogTitle>
            <DialogDescription>Crie uma lista para organizar seus contatos</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da lista</Label>
              <Input value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="Ex: Leads Quentes" />
            </div>
            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Input value={newListDesc} onChange={e => setNewListDesc(e.target.value)} placeholder="Descrição da lista" />
            </div>
            <Button onClick={createList} disabled={isSaving || !newListName.trim()} className="w-full">
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Criar Lista
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Contacts Dialog */}
      <Dialog open={showAddContacts} onOpenChange={setShowAddContacts}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar Contatos</DialogTitle>
            <DialogDescription>Cole números de telefone (um por linha ou separados por vírgula)</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Lista destino</Label>
              <Select value={targetListId} onValueChange={setTargetListId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma lista" />
                </SelectTrigger>
                <SelectContent>
                  {lists.map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Números de telefone</Label>
              <Textarea
                value={bulkPhones}
                onChange={e => setBulkPhones(e.target.value)}
                placeholder="5511999998888&#10;5521988887777&#10;5531977776666"
                rows={6}
              />
              <p className="text-xs text-muted-foreground">
                Formato: DDD + número (ex: 5511999998888)
              </p>
            </div>
            <Button onClick={addBulkContacts} disabled={isSaving || !targetListId || !bulkPhones.trim()} className="w-full">
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Phone className="h-4 w-4 mr-2" />}
              Adicionar Contatos
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
