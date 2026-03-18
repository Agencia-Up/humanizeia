import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useCAPI, MetaPixelRecord } from '@/hooks/useCAPI';
import { useToast } from '@/hooks/use-toast';
import { Plus, Radio, Send, RefreshCw, Eye, Trash2, Activity, BarChart3 } from 'lucide-react';
import { format } from 'date-fns';

export default function MetaPixels() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { getPixels, getEvents, getBatches, sendAllPending, isSending } = useCAPI();
  const [pixels, setPixels] = useState<MetaPixelRecord[]>([]);
  const [selectedPixel, setSelectedPixel] = useState<MetaPixelRecord | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newPixel, setNewPixel] = useState({ pixel_id: '', pixel_name: '', domain: '', access_token: '' });

  const loadPixels = async () => {
    setLoading(true);
    try {
      const data = await getPixels();
      setPixels(data);
      if (data.length > 0 && !selectedPixel) {
        setSelectedPixel(data[0]);
      }
    } catch {
      // handled by hook
    } finally {
      setLoading(false);
    }
  };

  const loadPixelData = async (pixel: MetaPixelRecord) => {
    try {
      const [evts, bts] = await Promise.all([
        getEvents(pixel.id),
        getBatches(pixel.id),
      ]);
      setEvents(evts);
      setBatches(bts);
    } catch {
      // handled
    }
  };

  useEffect(() => {
    if (user) loadPixels();
  }, [user]);

  useEffect(() => {
    if (selectedPixel) loadPixelData(selectedPixel);
  }, [selectedPixel]);

  const handleAddPixel = async () => {
    if (!user || !newPixel.pixel_id || !newPixel.pixel_name) return;
    try {
      const { error } = await supabase.from('meta_pixels').insert({
        user_id: user.id,
        pixel_id: newPixel.pixel_id,
        pixel_name: newPixel.pixel_name,
        domain: newPixel.domain || null,
        access_token_encrypted: newPixel.access_token || null,
        is_active: true,
      });
      if (error) throw error;
      toast({ title: 'Pixel adicionado!', description: `${newPixel.pixel_name} foi cadastrado.` });
      setShowAddDialog(false);
      setNewPixel({ pixel_id: '', pixel_name: '', domain: '', access_token: '' });
      loadPixels();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const handleDeletePixel = async (id: string) => {
    try {
      const { error } = await supabase.from('meta_pixels').delete().eq('id', id);
      if (error) throw error;
      toast({ title: 'Pixel removido' });
      if (selectedPixel?.id === id) setSelectedPixel(null);
      loadPixels();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const handleSendPending = async () => {
    if (!selectedPixel) return;
    await sendAllPending(selectedPixel.id);
    loadPixelData(selectedPixel);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'sent': case 'completed': return 'default';
      case 'pending': return 'secondary';
      case 'failed': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl">Meta Pixels & CAPI</h1>
            <p className="text-muted-foreground">
              Gerencie seus pixels e envios de eventos via Conversions API
            </p>
          </div>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> Adicionar Pixel</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adicionar Pixel Meta</DialogTitle>
                <DialogDescription>Cadastre um novo pixel para rastrear eventos via CAPI.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div><Label>Pixel ID</Label><Input placeholder="123456789" value={newPixel.pixel_id} onChange={e => setNewPixel(p => ({ ...p, pixel_id: e.target.value }))} /></div>
                <div><Label>Nome</Label><Input placeholder="Meu Pixel" value={newPixel.pixel_name} onChange={e => setNewPixel(p => ({ ...p, pixel_name: e.target.value }))} /></div>
                <div><Label>Domínio (opcional)</Label><Input placeholder="meusite.com" value={newPixel.domain} onChange={e => setNewPixel(p => ({ ...p, domain: e.target.value }))} /></div>
                <div><Label>Access Token CAPI</Label><Input type="password" placeholder="EAAxxxxxxx..." value={newPixel.access_token} onChange={e => setNewPixel(p => ({ ...p, access_token: e.target.value }))} /></div>
                <Button onClick={handleAddPixel} className="w-full">Salvar Pixel</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Pixel Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pixels.map(pixel => (
            <Card
              key={pixel.id}
              className={`cursor-pointer transition-all ${selectedPixel?.id === pixel.id ? 'ring-2 ring-primary' : 'hover:shadow-md'}`}
              onClick={() => setSelectedPixel(pixel)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{pixel.pixel_name}</CardTitle>
                  <Badge variant={pixel.is_active ? 'default' : 'secondary'}>
                    {pixel.is_active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </div>
                <CardDescription className="font-mono text-xs">{pixel.pixel_id}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Eventos: {pixel.events_total || 0}</span>
                  <Button variant="ghost" size="icon" onClick={e => { e.stopPropagation(); handleDeletePixel(pixel.id); }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                {pixel.last_event_at && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Último evento: {format(new Date(pixel.last_event_at), 'dd/MM HH:mm')}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
          {!loading && pixels.length === 0 && (
            <Card className="col-span-full p-8 text-center">
              <Radio className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">Nenhum pixel cadastrado. Adicione seu primeiro pixel.</p>
            </Card>
          )}
        </div>

        {/* Selected Pixel Details */}
        {selectedPixel && (
          <Tabs defaultValue="events" className="space-y-4">
            <div className="flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="events" className="gap-2"><Activity className="h-4 w-4" />Eventos</TabsTrigger>
                <TabsTrigger value="batches" className="gap-2"><BarChart3 className="h-4 w-4" />Lotes</TabsTrigger>
              </TabsList>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => loadPixelData(selectedPixel)}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Atualizar
                </Button>
                <Button size="sm" onClick={handleSendPending} disabled={isSending}>
                  <Send className="mr-2 h-4 w-4" /> Enviar Pendentes
                </Button>
              </div>
            </div>

            <TabsContent value="events">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Evento</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Data</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {events.map(evt => (
                        <TableRow key={evt.id}>
                          <TableCell className="font-medium">{evt.event_name}</TableCell>
                          <TableCell><Badge variant={statusColor(evt.status)}>{evt.status}</Badge></TableCell>
                          <TableCell>{evt.value ? `${evt.currency || 'BRL'} ${evt.value}` : '-'}</TableCell>
                          <TableCell className="text-xs">{evt.action_source}</TableCell>
                          <TableCell className="text-xs">{format(new Date(evt.created_at), 'dd/MM HH:mm')}</TableCell>
                        </TableRow>
                      ))}
                      {events.length === 0 && (
                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nenhum evento registrado</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="batches">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead>Enviados</TableHead>
                        <TableHead>Falhas</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Data</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {batches.map(batch => (
                        <TableRow key={batch.id}>
                          <TableCell><Badge variant={statusColor(batch.status)}>{batch.status}</Badge></TableCell>
                          <TableCell className="text-green-600">{batch.events_sent}</TableCell>
                          <TableCell className="text-destructive">{batch.events_failed}</TableCell>
                          <TableCell>{batch.batch_size}</TableCell>
                          <TableCell className="text-xs">{format(new Date(batch.created_at), 'dd/MM HH:mm')}</TableCell>
                        </TableRow>
                      ))}
                      {batches.length === 0 && (
                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nenhum lote enviado</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </MainLayout>
  );
}
