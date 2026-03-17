import { useState } from 'react';
import MainLayout from '@/components/layout/MainLayout';
import { useMetaAudiences } from '@/hooks/useMetaAudiences';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Users, Copy, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function MetaAudiences() {
  const { audiences, isLoading, createCustomAudience, createLookalikeAudience, deleteAudience, fetchRemoteAudiences } = useMetaAudiences();

  const [customOpen, setCustomOpen] = useState(false);
  const [lookalikeOpen, setLookalikeOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [customForm, setCustomForm] = useState({ name: '', description: '', subtype: 'CUSTOM' });
  const [lookalikeForm, setLookalikeForm] = useState({ name: '', origin_audience_id: '', target_countries: ['BR'], ratio: 0.01 });

  const handleCreateCustom = () => {
    if (!customForm.name) { toast.error('Nome é obrigatório'); return; }
    createCustomAudience.mutate(customForm, {
      onSuccess: () => { setCustomOpen(false); setCustomForm({ name: '', description: '', subtype: 'CUSTOM' }); },
    });
  };

  const handleCreateLookalike = () => {
    if (!lookalikeForm.name || !lookalikeForm.origin_audience_id) {
      toast.error('Nome e público de origem são obrigatórios');
      return;
    }
    createLookalikeAudience.mutate(lookalikeForm, {
      onSuccess: () => { setLookalikeOpen(false); setLookalikeForm({ name: '', origin_audience_id: '', target_countries: ['BR'], ratio: 0.01 }); },
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const remote = await fetchRemoteAudiences();
      toast.success(`${remote.length} públicos encontrados no Meta Ads`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const customAudiences = audiences.filter((a: any) => a.audience_type !== 'lookalike');
  const lookalikeAudiences = audiences.filter((a: any) => a.audience_type === 'lookalike');

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Públicos Meta Ads</h1>
            <p className="text-muted-foreground">Crie e gerencie públicos personalizados e lookalike</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> Sincronizar
            </Button>
            <Dialog open={customOpen} onOpenChange={setCustomOpen}>
              <DialogTrigger asChild>
                <Button variant="outline"><Users className="mr-2 h-4 w-4" /> Público Custom</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Criar Público Personalizado</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div><Label>Nome</Label><Input placeholder="Compradores últimos 30 dias" value={customForm.name} onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })} /></div>
                  <div><Label>Descrição</Label><Input placeholder="Descrição do público" value={customForm.description} onChange={(e) => setCustomForm({ ...customForm, description: e.target.value })} /></div>
                  <div>
                    <Label>Tipo</Label>
                    <Select value={customForm.subtype} onValueChange={(v) => setCustomForm({ ...customForm, subtype: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CUSTOM">Lista de clientes</SelectItem>
                        <SelectItem value="WEBSITE">Visitantes do site</SelectItem>
                        <SelectItem value="ENGAGEMENT">Engajamento</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleCreateCustom} disabled={createCustomAudience.isPending} className="w-full">
                    {createCustomAudience.isPending ? 'Criando...' : 'Criar Público'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={lookalikeOpen} onOpenChange={setLookalikeOpen}>
              <DialogTrigger asChild>
                <Button><Copy className="mr-2 h-4 w-4" /> Lookalike</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Criar Público Lookalike</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div><Label>Nome</Label><Input placeholder="LAL 1% Compradores" value={lookalikeForm.name} onChange={(e) => setLookalikeForm({ ...lookalikeForm, name: e.target.value })} /></div>
                  <div>
                    <Label>Público de Origem</Label>
                    <Select value={lookalikeForm.origin_audience_id} onValueChange={(v) => setLookalikeForm({ ...lookalikeForm, origin_audience_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>
                        {audiences.filter((a: any) => a.external_id).map((a: any) => (
                          <SelectItem key={a.id} value={a.external_id}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Tamanho do Lookalike: {Math.round(lookalikeForm.ratio * 100)}%</Label>
                    <Slider min={1} max={20} step={1} value={[lookalikeForm.ratio * 100]} onValueChange={([v]) => setLookalikeForm({ ...lookalikeForm, ratio: v / 100 })} className="mt-2" />
                    <p className="text-xs text-muted-foreground mt-1">1% = mais semelhante | 20% = maior alcance</p>
                  </div>
                  <Button onClick={handleCreateLookalike} disabled={createLookalikeAudience.isPending} className="w-full">
                    {createLookalikeAudience.isPending ? 'Criando...' : 'Criar Lookalike'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Tabs defaultValue="custom">
          <TabsList>
            <TabsTrigger value="custom"><Users className="mr-2 h-4 w-4" />Personalizados ({customAudiences.length})</TabsTrigger>
            <TabsTrigger value="lookalike"><Copy className="mr-2 h-4 w-4" />Lookalike ({lookalikeAudiences.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="custom">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Plataforma</TableHead>
                      <TableHead>Tamanho</TableHead>
                      <TableHead>Criado em</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customAudiences.map((a: any) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell><Badge variant="outline">{a.audience_type || 'custom'}</Badge></TableCell>
                        <TableCell><Badge>{a.platform || 'meta'}</Badge></TableCell>
                        <TableCell>{a.size_estimate?.toLocaleString() || '—'}</TableCell>
                        <TableCell className="text-xs">{format(new Date(a.created_at), 'dd/MM/yyyy')}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => deleteAudience.mutate({ id: a.id, externalId: a.external_id })}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {customAudiences.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum público personalizado criado</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="lookalike">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Origem</TableHead>
                      <TableHead>Tamanho</TableHead>
                      <TableHead>País</TableHead>
                      <TableHead>Criado em</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lookalikeAudiences.map((a: any) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell className="text-xs">{(a.targeting_config as any)?.origin_audience_id || '—'}</TableCell>
                        <TableCell>{a.size_estimate?.toLocaleString() || '—'}</TableCell>
                        <TableCell>{((a.targeting_config as any)?.countries || []).join(', ') || 'BR'}</TableCell>
                        <TableCell className="text-xs">{format(new Date(a.created_at), 'dd/MM/yyyy')}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => deleteAudience.mutate({ id: a.id, externalId: a.external_id })}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {lookalikeAudiences.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum público lookalike criado</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
