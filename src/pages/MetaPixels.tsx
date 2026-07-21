import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useMetaPixels, useCAPIEvents, useCAPISend } from '@/hooks/useCAPI';
import { useCAPISendStatus } from '@/hooks/useWhatsAppCAPI';
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
import { Plus, Trash2, Send, Activity, Radio, Eye, CheckCircle2, Clock, Zap, Info } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

// Nomes técnicos dos eventos -> rótulo amigável pro dono da loja.
const EVENT_LABELS: Record<string, string> = {
  LeadQualificado: 'Lead bom',
  LeadPoucoQualificado: 'Lead médio',
  LeadRuim: 'Lead ruim',
  Purchase: 'Venda',
  Lead: 'Lead',
  CompleteRegistration: 'Qualificação',
  InitiateCheckout: 'Proposta',
};
const labelEvento = (e: string) => EVENT_LABELS[e] || e;

// NOTA (11/07): os acessos a addPixel/updatePixel/togglePixel/deletePixel usam `?.`
// DE PROPOSITO. Em 11/07 a pagina inteira deu tela-branca (`updatePixel.isPending`
// -> Cannot read properties of undefined) porque o hook useMetaPixels criava o
// `updatePixel` mas NAO o incluia no return (corrigido no useCAPI.ts). O opcional
// e a rede de seguranca: se uma mutacao vier undefined, a feature degrada em vez
// de derrubar a rota inteira. NAO remover os `?.`.
export default function MetaPixels() {
  const { pixels, isLoading, addPixel, updatePixel, togglePixel, deletePixel } = useMetaPixels();
  const { data: status } = useCAPISendStatus();
  const [selectedPixelId, setSelectedPixelId] = useState<string | undefined>();
  const { data: events } = useCAPIEvents(selectedPixelId);
  const { sendEvents } = useCAPISend();

  const [newPixel, setNewPixel] = useState({ pixel_id: '', pixel_name: '', domain: '', access_token: '' });
  const [addOpen, setAddOpen] = useState(false);

  // Editar a chave da API de Conversões de um pixel já cadastrado
  const [tokenEdit, setTokenEdit] = useState<{ id: string; nome: string } | null>(null);
  const [tokenValue, setTokenValue] = useState('');

  // Test event form
  const [testEvent, setTestEvent] = useState({ event_name: 'Purchase', event_source_url: '', value: '' });
  const [testOpen, setTestOpen] = useState(false);
  const [testPixelId, setTestPixelId] = useState('');

  // Estado geral do rastreamento (pro cartão de status no topo).
  const hasPixel = pixels.length > 0;
  const pixelSemChave = pixels.some((p: any) => p.is_active && !p.access_token_encrypted);
  const enviados7d = status?.total7d || 0;
  const enviando = enviados7d > 0;
  const ultimoEnvio = status?.ultimo ?? null;
  const porEvento = status?.porEvento ?? {};

  const handleAddPixel = () => {
    const pid = newPixel.pixel_id.trim();
    if (!/^\d{6,}$/.test(pid)) {
      toast.error('O Pixel ID deve ser só números (ex: 123456789012345). Copie do Gerenciador de Eventos da Meta.');
      return;
    }
    if (!newPixel.pixel_name.trim()) {
      toast.error('Dê um nome pro pixel (ex: Loja Principal).');
      return;
    }
    const tok = newPixel.access_token.trim();
    if (tok && (tok.length < 20 || !tok.startsWith('EAA'))) {
      toast.error('O token da API de Conversões parece incompleto. Cole o token inteiro (começa com "EAA...").');
      return;
    }
    addPixel?.mutate({ ...newPixel, pixel_id: pid }, {
      onSuccess: () => {
        setNewPixel({ pixel_id: '', pixel_name: '', domain: '', access_token: '' });
        setAddOpen(false);
      },
    });
  };

  const handleSaveToken = () => {
    if (!tokenEdit) return;
    const tok = tokenValue.trim();
    if (tok.length < 20 || !tok.startsWith('EAA')) {
      toast.error('Esse token parece incompleto. Cole o token inteiro da API de Conversões (começa com "EAA...").');
      return;
    }
    updatePixel?.mutate({ id: tokenEdit.id, access_token: tok }, {
      onSuccess: () => { setTokenEdit(null); setTokenValue(''); },
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
          // external_id garante ao menos 1 parâmetro de cliente — sem isso o Meta
          // rejeita com 400 ("requires at least one user_data parameter").
          user_data: { external_id: ['teste-logos-' + Date.now()] },
          custom_data: testEvent.value ? { value: parseFloat(testEvent.value), currency: 'BRL' } : {},
        },
      ]);
      toast.success('Evento de teste enviado! Confira em ~1 min no Gerenciador de Eventos da Meta.');
      setTestOpen(false);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Rastreamento de Conversões · Meta Ads</h1>
            <p className="text-muted-foreground">
              Envie automaticamente seus leads e vendas pro Meta, pra ele otimizar seus anúncios e achar mais clientes bons.
            </p>
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="shrink-0"><Plus className="mr-2 h-4 w-4" /> Conectar Pixel</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Conectar seu Pixel do Meta</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Pixel ID</Label>
                  <Input placeholder="Ex: 123456789012345" value={newPixel.pixel_id} onChange={(e) => setNewPixel({ ...newPixel, pixel_id: e.target.value })} />
                  <p className="mt-1 text-[11px] text-muted-foreground">Só números. Está no Gerenciador de Eventos, embaixo do nome do seu Pixel.</p>
                </div>
                <div>
                  <Label>Nome (pra você identificar)</Label>
                  <Input placeholder="Ex: Loja Principal" value={newPixel.pixel_name} onChange={(e) => setNewPixel({ ...newPixel, pixel_name: e.target.value })} />
                </div>
                <div>
                  <Label>Token da API de Conversões</Label>
                  <Input type="password" placeholder="EAA..." value={newPixel.access_token} onChange={(e) => setNewPixel({ ...newPixel, access_token: e.target.value })} />
                  <div className="mt-2 rounded-md border border-border/50 bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">Onde pegar o token:</span><br />
                    1. Abra o <span className="font-medium">Gerenciador de Eventos</span> da Meta.<br />
                    2. Clique no seu Pixel → aba <span className="font-medium">Configurações</span>.<br />
                    3. Role até <span className="font-medium">API de Conversões</span> → <span className="font-medium">Gerar token de acesso</span>.<br />
                    4. Copie e cole aqui. É esse token que envia as conversões pro Facebook.
                  </div>
                </div>
                <Button onClick={handleAddPixel} disabled={addPixel?.isPending} className="w-full">
                  {addPixel?.isPending ? 'Salvando...' : 'Conectar Pixel'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* CARTÃO DE STATUS — "está enviando?" na cara do cliente */}
        {!isLoading && (
          <Card className={
            !hasPixel ? 'border-border/60'
              : enviando ? 'border-emerald-500/40 bg-emerald-500/5'
              : 'border-amber-500/40 bg-amber-500/5'
          }>
            <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                {!hasPixel ? <Radio className="mt-0.5 h-6 w-6 text-muted-foreground" />
                  : enviando ? <CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-500" />
                  : <Clock className="mt-0.5 h-6 w-6 text-amber-500" />}
                <div>
                  <p className="font-semibold text-foreground">
                    {!hasPixel ? 'Conecte seu Pixel pra começar'
                      : enviando ? 'Conectado e enviando conversões pro Meta'
                      : pixelSemChave ? 'Pixel conectado, mas falta a chave da API de Conversões'
                      : 'Pixel conectado — aguardando as primeiras conversões'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {!hasPixel ? 'Clique em "Conectar Pixel" no canto superior direito.'
                      : enviando ? `${enviados7d} conversões enviadas nos últimos 7 dias${ultimoEnvio ? ` · última ${format(new Date(ultimoEnvio), 'dd/MM HH:mm')}` : ''}.`
                      : pixelSemChave ? 'Adicione a chave no card do pixel abaixo pra ativar o envio.'
                      : 'Assim que a IA classificar um lead ou registrar uma venda, aparece aqui.'}
                  </p>
                </div>
              </div>
              {enviando && Object.keys(porEvento).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(porEvento).map(([ev, n]) => (
                    <Badge key={ev} variant="outline" className="border-emerald-500/30 text-xs">
                      {labelEvento(ev)}: {n as number}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* COMO FUNCIONA — deixa claro o que é automático */}
        <Card className="bg-muted/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Info className="h-4 w-4 text-primary" /> Como funciona (leva 1 minuto)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">1</div>
              <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Você conecta</span> seu Pixel do Meta uma única vez (aqui em cima).</p>
            </div>
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">2</div>
              <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">A IA envia sozinha</span> a qualidade de cada lead (bom/médio/ruim) e as vendas. Você não faz mais nada.</p>
            </div>
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">3</div>
              <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">O Meta otimiza</span> seus anúncios pra trazer mais gente parecida com seus melhores leads.</p>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="pixels">
          <TabsList>
            <TabsTrigger value="pixels"><Radio className="mr-2 h-4 w-4" />Meu Pixel</TabsTrigger>
            <TabsTrigger value="events"><Activity className="mr-2 h-4 w-4" />Conversões enviadas</TabsTrigger>
          </TabsList>

          <TabsContent value="pixels" className="space-y-4">
            {isLoading ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">Carregando...</CardContent></Card>
            ) : pixels.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10"><Zap className="h-6 w-6 text-primary" /></div>
                  <div>
                    <p className="font-medium text-foreground">Nenhum pixel conectado ainda</p>
                    <p className="text-sm text-muted-foreground">Conecte seu Pixel do Meta pra começar a mandar leads e vendas.</p>
                  </div>
                  <Button onClick={() => setAddOpen(true)}><Plus className="mr-2 h-4 w-4" /> Conectar Pixel</Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {pixels.map((pixel: any) => (
                  <Card key={pixel.id}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <div>
                        <CardTitle className="text-base">{pixel.pixel_name}</CardTitle>
                        <CardDescription className="font-mono text-xs">{pixel.pixel_id}</CardDescription>
                      </div>
                      <Switch checked={pixel.is_active} onCheckedChange={(checked) => togglePixel?.mutate({ id: pixel.id, is_active: checked })} />
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {pixel.domain && <Badge variant="outline">{pixel.domain}</Badge>}
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Conversões hoje</span>
                        <span className="font-medium">{pixel.events_today || 0}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total</span>
                        <span className="font-medium">{pixel.events_total || 0}</span>
                      </div>
                      {pixel.last_event_at && (
                        <p className="text-xs text-muted-foreground">
                          Última: {format(new Date(pixel.last_event_at), 'dd/MM HH:mm')}
                        </p>
                      )}
                      <div className="flex items-center justify-between border-t border-border/40 pt-2 text-sm">
                        <span className="text-muted-foreground">Chave de envio (API)</span>
                        {pixel.access_token_encrypted
                          ? <Badge className="bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">Conectada</Badge>
                          : <Badge variant="outline" className="border-amber-500/40 text-amber-500">Falta a chave</Badge>}
                      </div>
                      <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => { setTokenEdit({ id: pixel.id, nome: pixel.pixel_name }); setTokenValue(''); }}>
                        {pixel.access_token_encrypted ? 'Trocar chave' : 'Adicionar chave'}
                      </Button>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => { setTestPixelId(pixel.id); setTestOpen(true); }}>
                          <Send className="mr-1 h-3 w-3" /> Testar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setSelectedPixelId(pixel.id)}>
                          <Eye className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => deletePixel?.mutate(pixel.id)}>
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
                <CardTitle className="text-lg">Conversões enviadas ao Meta</CardTitle>
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
                      <TableHead>Conversão</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(events || []).map((evt: any) => (
                      <TableRow key={evt.id}>
                        <TableCell className="font-medium">{labelEvento(evt.event_name)}</TableCell>
                        <TableCell>
                          <Badge variant={evt.status === 'sent' ? 'default' : evt.status === 'failed' ? 'destructive' : 'secondary'}>
                            {evt.status === 'sent' ? 'Enviada' : evt.status === 'failed' ? 'Falhou' : 'Na fila'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{format(new Date(evt.created_at), 'dd/MM HH:mm:ss')}</TableCell>
                      </TableRow>
                    ))}
                    {(!events || events.length === 0) && (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Nenhuma conversão ainda</TableCell></TableRow>
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
            <DialogHeader><DialogTitle>Enviar evento de teste</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Manda uma conversão de teste pro Meta pra confirmar que a chave está funcionando. Aparece no Gerenciador de Eventos em ~1 min.</p>
              <div>
                <Label>Tipo</Label>
                <Select value={testEvent.event_name} onValueChange={(v) => setTestEvent({ ...testEvent, event_name: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Purchase">Venda (Purchase)</SelectItem>
                    <SelectItem value="Lead">Lead</SelectItem>
                    <SelectItem value="InitiateCheckout">Proposta (InitiateCheckout)</SelectItem>
                    <SelectItem value="CompleteRegistration">Qualificação (CompleteRegistration)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Valor (opcional)</Label>
                <Input type="number" placeholder="99.90" value={testEvent.value} onChange={(e) => setTestEvent({ ...testEvent, value: e.target.value })} />
              </div>
              <Button onClick={handleSendTestEvent} className="w-full">
                <Send className="mr-2 h-4 w-4" /> Enviar teste
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Editar/adicionar a chave da API de Conversões de um pixel */}
        <Dialog open={!!tokenEdit} onOpenChange={(o) => { if (!o) { setTokenEdit(null); setTokenValue(''); } }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Chave da API de Conversões — {tokenEdit?.nome}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Token da API de Conversões</Label>
                <Input type="password" placeholder="EAA..." value={tokenValue} onChange={(e) => setTokenValue(e.target.value)} />
                <div className="mt-2 rounded-md border border-border/50 bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  Gerenciador de Eventos → seu Pixel → <span className="font-medium">Configurações</span> → <span className="font-medium">API de Conversões</span> → <span className="font-medium">Gerar token de acesso</span>. Cole aqui.
                </div>
              </div>
              <Button onClick={handleSaveToken} disabled={updatePixel?.isPending || !tokenValue.trim()} className="w-full">
                {updatePixel?.isPending ? 'Salvando...' : 'Salvar chave'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
