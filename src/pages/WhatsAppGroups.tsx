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
  Users, Search, Download, Loader2, RefreshCw, WifiOff, CheckCircle, UserPlus, Plus,
} from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface WhatsAppGroup {
  id: string;
  subject: string;
  size: number;
  owner: string;
  creation: number;
}

interface ContactList {
  id: string;
  name: string;
  contact_count: number;
}

export default function WhatsAppGroups() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [hasInstance, setHasInstance] = useState<boolean | null>(null);

  // List selection
  const [showExtractDialog, setShowExtractDialog] = useState(false);
  const [lists, setLists] = useState<ContactList[]>([]);
  const [listMode, setListMode] = useState<'new' | 'existing'>('new');
  const [newListName, setNewListName] = useState('');
  const [targetListId, setTargetListId] = useState('');

  useEffect(() => {
    checkInstance();
  }, [user]);

  const checkInstance = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('wa_instances')
      .select('id, is_active')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();
    setHasInstance(!!data);
  };

  const fetchLists = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('wa_contact_lists')
      .select('id, name, contact_count')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setLists((data as ContactList[]) || []);
  }, [user]);

  const fetchGroups = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('wa-extract-groups', {
        body: { user_id: user.id },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao buscar grupos');
      setGroups(data.groups || []);
      toast({ title: `${data.groups?.length || 0} grupos encontrados` });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const openExtractDialog = () => {
    fetchLists();
    setNewListName(`Grupos extraídos - ${new Date().toLocaleDateString('pt-BR')}`);
    setListMode('new');
    setTargetListId('');
    setShowExtractDialog(true);
  };

  const extractContacts = async () => {
    if (!user || selectedGroups.length === 0) return;
    setIsExtracting(true);
    try {
      // If using existing list, pass list_id; if new, create it first
      let listId = listMode === 'existing' ? targetListId : undefined;

      if (listMode === 'new' && newListName.trim()) {
        const { data: newList, error: listErr } = await supabase
          .from('wa_contact_lists')
          .insert({
            user_id: user.id,
            name: newListName.trim(),
            source: 'group_extract',
            contact_count: 0,
          })
          .select('id')
          .single();
        if (listErr) throw listErr;
        listId = newList.id;
      }

      const selectedGroupData = groups.filter(g => selectedGroups.includes(g.id));
      const { data, error } = await supabase.functions.invoke('wa-extract-groups', {
        body: {
          user_id: user.id,
          action: 'extract_contacts',
          group_ids: selectedGroups,
          groups: selectedGroupData,
          list_id: listId,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao extrair contatos');
      toast({
        title: 'Contatos extraídos!',
        description: `${data.total_contacts || 0} contatos salvos de ${selectedGroups.length} grupo(s)`,
      });
      setSelectedGroups([]);
      setShowExtractDialog(false);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsExtracting(false);
    }
  };

  const toggleGroup = (id: string) => {
    setSelectedGroups(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedGroups.length === filteredGroups.length) {
      setSelectedGroups([]);
    } else {
      setSelectedGroups(filteredGroups.map(g => g.id));
    }
  };

  const filteredGroups = groups.filter(g =>
    g.subject.toLowerCase().includes(search.toLowerCase())
  );

  if (hasInstance === false) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <WifiOff className="h-16 w-16 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Nenhuma instância WhatsApp conectada</h2>
          <p className="text-muted-foreground text-center max-w-md">
            Para extrair grupos, você precisa primeiro conectar uma instância WhatsApp em
            <strong> Configurações → WhatsApp</strong>.
          </p>
          <Button variant="outline" onClick={() => window.location.href = '/settings'}>
            Ir para Configurações
          </Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl flex items-center gap-2">
              <Users className="h-7 w-7 text-green-500" />
              Extrator de Grupos
            </h1>
            <p className="text-muted-foreground">
              Extraia contatos dos seus grupos de WhatsApp
            </p>
          </div>
          <Button onClick={fetchGroups} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Buscar Grupos
          </Button>
        </div>

        {groups.length > 0 && (
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-lg">
                    {groups.length} grupo(s) encontrado(s)
                  </CardTitle>
                  <CardDescription>
                    Selecione os grupos para extrair os contatos
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar grupo..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="pl-9 w-64"
                    />
                  </div>
                  {selectedGroups.length > 0 && (
                    <Button onClick={openExtractDialog}>
                      <Download className="h-4 w-4 mr-2" />
                      Extrair ({selectedGroups.length})
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
                        checked={selectedGroups.length === filteredGroups.length && filteredGroups.length > 0}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead>Nome do Grupo</TableHead>
                    <TableHead className="text-center">Membros</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGroups.map(group => (
                    <TableRow key={group.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedGroups.includes(group.id)}
                          onCheckedChange={() => toggleGroup(group.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{group.subject}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">
                          <UserPlus className="h-3 w-3 mr-1" />
                          {group.size}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className="bg-green-500/20 text-green-500 border-green-500/30">
                          <CheckCircle className="h-3 w-3 mr-1" /> Ativo
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {groups.length === 0 && !isLoading && (
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
              <Users className="h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground text-center">
                Clique em <strong>"Buscar Grupos"</strong> para listar os grupos do WhatsApp conectado.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Extract Dialog - Choose target list */}
      <Dialog open={showExtractDialog} onOpenChange={setShowExtractDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5 text-primary" />
              Extrair Contatos
            </DialogTitle>
            <DialogDescription>
              Extrair contatos de {selectedGroups.length} grupo(s) selecionado(s). Escolha onde salvar os leads.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Salvar em</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={listMode === 'new' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setListMode('new')}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Nova Lista
                </Button>
                <Button
                  type="button"
                  variant={listMode === 'existing' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setListMode('existing')}
                  disabled={lists.length === 0}
                >
                  Lista Existente
                </Button>
              </div>
            </div>

            {listMode === 'new' ? (
              <div className="space-y-2">
                <Label>Nome da nova lista</Label>
                <Input
                  value={newListName}
                  onChange={e => setNewListName(e.target.value)}
                  placeholder="Ex: Grupos extraídos"
                  maxLength={100}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Selecione a lista</Label>
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
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExtractDialog(false)}>Cancelar</Button>
            <Button
              onClick={extractContacts}
              disabled={
                isExtracting ||
                (listMode === 'new' && !newListName.trim()) ||
                (listMode === 'existing' && !targetListId)
              }
            >
              {isExtracting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {isExtracting ? 'Extraindo...' : 'Extrair Contatos'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
