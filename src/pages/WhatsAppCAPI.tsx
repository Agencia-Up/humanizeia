import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useWhatsAppCAPI, FunnelEvent, FunnelStats } from '@/hooks/useWhatsAppCAPI';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, TrendingUp, Users, ShoppingCart, DollarSign, Send, Radio, ArrowDown } from 'lucide-react';
import { format } from 'date-fns';

export default function WhatsAppCAPI() {
  const { toast } = useToast();
  const { getFunnelEvents, getFunnelStats, trackStage, isTracking } = useWhatsAppCAPI();
  const [events, setEvents] = useState<FunnelEvent[]>([]);
  const [stats, setStats] = useState<FunnelStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showManualDialog, setShowManualDialog] = useState(false);
  const [manualEvent, setManualEvent] = useState({ phone: '', event_name: 'Purchase', value: '' });

  const loadData = async () => {
    setLoading(true);
    try {
      const [evts, sts] = await Promise.all([getFunnelEvents(), getFunnelStats()]);
      setEvents(evts);
      setStats(sts);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleManualEvent = async () => {
    if (!manualEvent.phone) return;
    const stageMap: Record<string, string> = {
      Lead: 'lead', LeadQualified: 'qualified', InitiateCheckout: 'checkout', Purchase: 'purchase',
    };
    await trackStage({
      phone: manualEvent.phone.replace(/\D/g, ''),
      event_name: manualEvent.event_name,
      funnel_stage: stageMap[manualEvent.event_name] || 'lead',
      value: manualEvent.value ? parseFloat(manualEvent.value) : undefined,
    });
    setShowManualDialog(false);
    setManualEvent({ phone: '', event_name: 'Purchase', value: '' });
    loadData();
  };

  const statusBadge = (sent: boolean) => (
    <Badge variant={sent ? 'default' : 'secondary'}>{sent ? 'Enviado' : 'Pendente'}</Badge>
  );

  const eventColor = (name: string) => {
    switch (name) {
      case 'Lead': return 'bg-blue-500/10 text-blue-700 border-blue-200';
      case 'LeadQualified': return 'bg-amber-500/10 text-amber-700 border-amber-200';
      case 'InitiateCheckout': return 'bg-purple-500/10 text-purple-700 border-purple-200';
      case 'Purchase': return 'bg-emerald-500/10 text-emerald-700 border-emerald-200';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl">WhatsApp → CAPI</h1>
            <p className="text-muted-foreground">
              Funil de conversões do WhatsApp enviadas automaticamente ao Meta
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" /> Atualizar
            </Button>
            <Dialog open={showManualDialog} onOpenChange={setShowManualDialog}>
              <DialogTrigger asChild>
                <Button size="sm"><Send className="mr-2 h-4 w-4" /> Registrar Evento</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Registrar Evento Manual</DialogTitle>
                  <DialogDescription>Envie um evento de funil manualmente para o Meta CAPI.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Telefone</Label>
                    <Input placeholder="5511999999999" value={manualEvent.phone} onChange={e => setManualEvent(p => ({ ...p, phone: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Evento</Label>
                    <Select value={manualEvent.event_name} onValueChange={v => setManualEvent(p => ({ ...p, event_name: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Lead">Lead</SelectItem>
                        <SelectItem value="LeadQualified">Lead Qualificado</SelectItem>
                        <SelectItem value="InitiateCheckout">Início de Checkout</SelectItem>
                        <SelectItem value="Purchase">Compra</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Valor (R$) - opcional</Label>
                    <Input type="number" placeholder="197.00" value={manualEvent.value} onChange={e => setManualEvent(p => ({ ...p, value: e.target.value }))} />
                  </div>
                  <Button onClick={handleManualEvent} disabled={isTracking} className="w-full">
                    {isTracking ? 'Enviando...' : 'Enviar Evento'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Funnel Stats */}
        {stats && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-blue-500/10 p-2"><Users className="h-5 w-5 text-blue-600" /></div>
                  <div>
                    <p className="text-sm text-muted-foreground">Leads</p>
                    <p className="text-2xl font-bold">{stats.total_leads}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-amber-500/10 p-2"><TrendingUp className="h-5 w-5 text-amber-600" /></div>
                  <div>
                    <p className="text-sm text-muted-foreground">Qualificados</p>
                    <p className="text-2xl font-bold">{stats.total_qualified}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-purple-500/10 p-2"><ShoppingCart className="h-5 w-5 text-purple-600" /></div>
                  <div>
                    <p className="text-sm text-muted-foreground">Checkout</p>
                    <p className="text-2xl font-bold">{stats.total_checkout}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-emerald-500/10 p-2"><DollarSign className="h-5 w-5 text-emerald-600" /></div>
                  <div>
                    <p className="text-sm text-muted-foreground">Vendas</p>
                    <p className="text-2xl font-bold">{stats.total_purchase}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-emerald-500/10 p-2"><DollarSign className="h-5 w-5 text-emerald-600" /></div>
                  <div>
                    <p className="text-sm text-muted-foreground">Receita</p>
                    <p className="text-2xl font-bold">R$ {stats.total_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Funnel Visual */}
        {stats && stats.total_leads > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Funil de Conversão</CardTitle>
              <CardDescription>Visualização do funil WhatsApp → Meta CAPI</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center gap-2">
                {[
                  { label: 'Lead', count: stats.total_leads, color: 'bg-blue-500' },
                  { label: 'Qualificado', count: stats.total_qualified, color: 'bg-amber-500' },
                  { label: 'Checkout', count: stats.total_checkout, color: 'bg-purple-500' },
                  { label: 'Compra', count: stats.total_purchase, color: 'bg-emerald-500' },
                ].map((stage, i, arr) => {
                  const widthPct = stats.total_leads > 0 ? Math.max(20, (stage.count / stats.total_leads) * 100) : 20;
                  const prevCount = i > 0 ? arr[i - 1].count : stage.count;
                  const convRate = prevCount > 0 ? ((stage.count / prevCount) * 100).toFixed(1) : '0';
                  return (
                    <div key={stage.label} className="w-full flex flex-col items-center gap-1">
                      {i > 0 && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <ArrowDown className="h-3 w-3" /> {convRate}%
                        </div>
                      )}
                      <div className={`${stage.color} rounded-lg py-3 text-center text-white font-medium transition-all`} style={{ width: `${widthPct}%`, minWidth: 120 }}>
                        {stage.label}: {stage.count}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Events sent indicator */}
        {stats && (
          <div className="flex gap-4 text-sm">
            <Badge variant="default" className="gap-1"><Radio className="h-3 w-3" /> {stats.events_sent} enviados ao Meta</Badge>
            {stats.events_pending > 0 && (
              <Badge variant="secondary" className="gap-1">{stats.events_pending} pendentes</Badge>
            )}
          </div>
        )}

        {/* Events Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico de Eventos</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Evento</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Estágio</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>UTM</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map(evt => (
                  <TableRow key={evt.id}>
                    <TableCell>
                      <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${eventColor(evt.event_name)}`}>
                        {evt.event_name}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{evt.phone}</TableCell>
                    <TableCell className="text-sm">{evt.funnel_stage}</TableCell>
                    <TableCell>{evt.value ? `R$ ${Number(evt.value).toFixed(2)}` : '-'}</TableCell>
                    <TableCell>{statusBadge(evt.event_sent)}</TableCell>
                    <TableCell className="text-xs">
                      {evt.utm_source && <span className="text-muted-foreground">{evt.utm_source}</span>}
                      {evt.utm_campaign && <span className="text-muted-foreground ml-1">/ {evt.utm_campaign}</span>}
                      {evt.fbclid && !evt.utm_source && <span className="text-muted-foreground">fbclid ✓</span>}
                      {!evt.utm_source && !evt.fbclid && '-'}
                    </TableCell>
                    <TableCell className="text-xs">{format(new Date(evt.created_at), 'dd/MM HH:mm')}</TableCell>
                  </TableRow>
                ))}
                {events.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Nenhum evento de funil registrado. Os eventos são criados automaticamente quando leads chegam via WhatsApp.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
