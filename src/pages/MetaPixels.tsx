import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useMetaPixels, useCAPIEvents, useCAPISend } from '@/hooks/useCAPI';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2, Send, Activity, Radio, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function MetaPixels() {
  const { pixels, isLoading, addPixel, togglePixel, deletePixel } = useMetaPixels();
  const [selectedPixelId, setSelectedPixelId] = useState<string | undefined>();
  const { data: events } = useCAPIEvents(selectedPixelId);
  const { sendEvents } = useCAPISend();

  const [newPixel, setNewPixel] = useState({ pixel_id: '', pixel_name: '', domain: '' });
  const [addOpen, setAddOpen] = useState(false);

  // Test event form
  const [testEvent, setTestEvent] = useState({ event_name: 'Purchase', event_source_url: '', value: '' });
  const [testOpen, setTestOpen] = useState(false);
  const [testPixelId, setTestPixelId] = useState('');

  const handleAddPixel = () => {
    if (!newPixel.pixel_id || !newPixel.pixel_name) {
      toast.error('Preencha ID e nome do pixel');
      return;
    }
    addPixel.mutate(newPixel, {
      onSuccess: () => {
        setNewPixel({ pixel_id: '', pixel_name: '', domain: '' });
        setAddOpen(false);
      },
    });
  };

  const handleSendTestEvent = async () => {
    if (!testPixelId) return;
    try {
      await sendEvents(testPixelId, [
        {
          event_name: testEvent.event_name,
          event_source_url: testEvent.event_source_url || undefined,
          action_source: 'website',
          custom_data: testEvent.value ? { value: parseFloat(testEvent.value), currency: 'BRL' } : {},
        },
      ]);
      toast.success('Evento de teste enviado com sucesso!');
      setTestOpen(false);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Meta Pixels & CAPI</h1>
            <p className="text-muted-foreground">Gerencie seus pixels e envie eventos via Conversions API</p>
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> Adicionar Pixel</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo Pixel</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Pixel ID</Label>
                  <Input placeholder="Ex: 123456789" value={newPixel.pixel_id} onChange={(e) => setNewPixel({ ...newPixel, pixel_id: e.target.value })} />
                </div>
                <div>
                  <Label>Nome</Label>
                  <Input placeholder="Pixel Principal" value={newPixel.pixel_name} onChange={(e) => setNewPixel({ ...newPixel, pixel_name: e.target.value })} />
                </div>
                <div>
                  <Label>Domínio (opcional)</Label>
                  <Input placeholder="seusite.com.br" value={newPixel.domain} onChange={(e) => setNewPixel({ ...newPixel, domain: e.target.value })} />
                </div>
                <Button onClick={handleAddPixel} disabled={addPixel.isPending} className="w-full">
                  {addPixel.isPending ? 'Salvando...' : 'Adicionar Pixel'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="pixels">
          <TabsList>
            <TabsTrigger value="pixels"><Radio className="mr-2 h-4 w-4" />Pixels</TabsTrigger>
            <TabsTrigger value="events"><Activity className="mr-2 h-4 w-4" />Eventos CAPI</TabsTrigger>
          </TabsList>

          <TabsContent value="pixels" className="space-y-4">
            {isLoading ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">Carregando pixels...</CardContent></Card>
            ) : pixels.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">Nenhum pixel cadastrado. Clique em "Adicionar Pixel" para começar.</CardContent></Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {pixels.map((pixel: any) => (
                  <Card key={pixel.id}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <div>
                        <CardTitle className="text-base">{pixel.pixel_name}</CardTitle>
                        <CardDescription className="font-mono text-xs">{pixel.pixel_id}</CardDescription>
                      </div>
                      <Switch checked={pixel.is_active} onCheckedChange={(checked) => togglePixel.mutate({ id: pixel.id, is_active: checked })} />
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {pixel.domain && <Badge variant="outline">{pixel.domain}</Badge>}
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Eventos hoje</span>
                        <span className="font-medium">{pixel.events_today || 0}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total de eventos</span>
                        <span className="font-medium">{pixel.events_total || 0}</span>
                      </div>
                      {pixel.last_event_at && (
                        <p className="text-xs text-muted-foreground">
                          Último evento: {format(new Date(pixel.last_event_at), 'dd/MM HH:mm')}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => { setTestPixelId(pixel.id); setTestOpen(true); }}>
                          <Send className="mr-1 h-3 w-3" /> Testar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setSelectedPixelId(pixel.id)}>
                          <Eye className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => deletePixel.mutate(pixel.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="events">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Histórico de Eventos CAPI</CardTitle>
                <div className="flex gap-2">
                  <Select value={selectedPixelId || 'all'} onValueChange={(v) => setSelectedPixelId(v === 'all' ? undefined : v)}>
                    <SelectTrigger className="w-[200px]"><SelectValue placeholder="Todos os pixels" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os pixels</SelectItem>
                      {pixels.map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>{p.pixel_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Evento</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>URL</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(events || []).map((evt: any) => (
                      <TableRow key={evt.id}>
                        <TableCell className="font-medium">{evt.event_name}</TableCell>
                        <TableCell>
                          <Badge variant={evt.status === 'sent' ? 'default' : evt.status === 'failed' ? 'destructive' : 'secondary'}>
                            {evt.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs">{evt.event_source_url || '—'}</TableCell>
                        <TableCell className="text-xs">{format(new Date(evt.created_at), 'dd/MM HH:mm:ss')}</TableCell>
                      </TableRow>
                    ))}
                    {(!events || events.length === 0) && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nenhum evento registrado</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Test Event Dialog */}
        <Dialog open={testOpen} onOpenChange={setTestOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Enviar Evento de Teste</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Tipo de Evento</Label>
                <Select value={testEvent.event_name} onValueChange={(v) => setTestEvent({ ...testEvent, event_name: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Purchase">Purchase</SelectItem>
                    <SelectItem value="AddToCart">AddToCart</SelectItem>
                    <SelectItem value="InitiateCheckout">InitiateCheckout</SelectItem>
                    <SelectItem value="Lead">Lead</SelectItem>
                    <SelectItem value="ViewContent">ViewContent</SelectItem>
                    <SelectItem value="CompleteRegistration">CompleteRegistration</SelectItem>
                    <SelectItem value="PageView">PageView</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>URL de Origem (opcional)</Label>
                <Input placeholder="https://seusite.com.br/checkout" value={testEvent.event_source_url} onChange={(e) => setTestEvent({ ...testEvent, event_source_url: e.target.value })} />
              </div>
              <div>
                <Label>Valor (opcional)</Label>
                <Input type="number" placeholder="99.90" value={testEvent.value} onChange={(e) => setTestEvent({ ...testEvent, value: e.target.value })} />
              </div>
              <Button onClick={handleSendTestEvent} className="w-full">
                <Send className="mr-2 h-4 w-4" /> Enviar Evento
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
