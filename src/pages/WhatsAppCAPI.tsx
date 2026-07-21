import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWhatsAppCAPITrack, useWhatsAppCAPIFunnel, useWhatsAppCAPIStats, useCAPISendStatus } from '@/hooks/useWhatsAppCAPI';
import { useMetaPixels } from '@/hooks/useCAPI';
import { Activity, ArrowRight, DollarSign, Send, Target, TrendingUp, Users, Zap } from 'lucide-react';
import { format } from 'date-fns';

const STAGE_CONFIG: Record<string, { label: string; color: string; icon: any; event: string }> = {
  lead: { label: 'Lead', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: Users, event: 'Lead' },
  qualified: { label: 'Qualificado', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: Target, event: 'CompleteRegistration' },
  checkout: { label: 'Proposta', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30', icon: Send, event: 'InitiateCheckout' },
  purchase: { label: 'Venda', color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: DollarSign, event: 'Purchase' },
};

export default function WhatsAppCAPI() {
  const { pixels } = useMetaPixels();
  const track = useWhatsAppCAPITrack();
  const { data: funnelEvents, isLoading } = useWhatsAppCAPIFunnel();
  const { data: stats } = useWhatsAppCAPIStats();
  const { data: sendStatus } = useCAPISendStatus();

  const [phone, setPhone] = useState('');
  const [stage, setStage] = useState<string>('lead');
  const [value, setValue] = useState('');

  const hasActivePixel = pixels.some((p: any) => p.is_active);

  const handleTrack = () => {
    if (!phone) return;
    track.mutate({
      phone,
      funnel_stage: stage as any,
      ...(value && { value: Number(value) }),
    });
    setPhone('');
    setValue('');
  };

  const stages = ['lead', 'qualified', 'checkout', 'purchase'];

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            Rastreamento de Conversões (CAPI)
          </h1>
          <p className="text-muted-foreground mt-1">
            Avise o Meta quando um lead avançar no funil — melhora automaticamente seus anúncios
          </p>
        </div>

        {/* Status REAL do envio ao Meta (eventos automaticos de qualidade do lead) */}
        {(() => {
          const total = sendStatus?.total7d ?? 0;
          const ok = total > 0;
          const LABELS: Record<string, { label: string; cls: string }> = {
            LeadQualificado: { label: 'Lead qualificado', cls: 'text-emerald-500 dark:text-emerald-400' },
            LeadPoucoQualificado: { label: 'Lead pouco qualificado', cls: 'text-yellow-500 dark:text-yellow-400' },
            LeadRuim: { label: 'Lead ruim', cls: 'text-red-500 dark:text-red-400' },
            Purchase: { label: 'Venda', cls: 'text-emerald-500 dark:text-emerald-400' },
          };
          return (
            <Card className={ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-yellow-500/30 bg-yellow-500/5'}>
              <CardContent className="pt-5 space-y-3">
                <div className="flex items-start gap-2.5">
                  <span className="text-xl leading-none mt-0.5">{ok ? '✅' : '⏳'}</span>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">
                      {ok ? 'Conectado e enviando pro Meta' : 'Aguardando os primeiros eventos'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ok
                        ? `Nos últimos 7 dias, ${total} evento${total === 1 ? '' : 's'} de qualidade ${total === 1 ? 'foi enviado' : 'foram enviados'} e confirmados pelo Meta${sendStatus?.ultimo ? ` — último em ${format(new Date(sendStatus.ultimo), 'dd/MM HH:mm')}` : ''}.`
                        : 'Assim que a IA classificar seus leads, os eventos aparecem aqui e vão pro Meta automaticamente.'}
                    </p>
                  </div>
                </div>
                {ok && (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(sendStatus?.porEvento || {}).map(([ev, n]) => {
                      const m = LABELS[ev] || { label: ev, cls: 'text-muted-foreground' };
                      return (
                        <span key={ev} className="rounded-full border border-border/50 bg-background/60 px-2.5 py-1 text-xs">
                          <span className={`font-semibold ${m.cls}`}>{n as number}</span>{' '}
                          <span className="text-muted-foreground">{m.label}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border/40 pt-2">
                  💡 A IA classifica a qualidade de cada lead e avisa o Meta sozinha. O algoritmo usa isso pra <span className="font-medium text-foreground">buscar mais gente parecida com seus melhores leads</span> — você não precisa fazer nada.
                </p>
              </CardContent>
            </Card>
          );
        })()}

        {/* Onboarding card */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 flex gap-3">
          <span className="text-2xl shrink-0">📡</span>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Como isso funciona?</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Toda vez que um lead avança no seu funil de WhatsApp, você pode avisar o Meta Ads. Com isso, o algoritmo aprende quais pessoas têm mais chances de comprar e melhora automaticamente a entrega dos seus anúncios.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              {[
                { emoji: '👤', label: 'Lead', desc: 'Alguém entrou em contato' },
                { emoji: '🎯', label: 'Qualificado', desc: 'Mostrou interesse real' },
                { emoji: '💬', label: 'Proposta', desc: 'Recebeu uma oferta' },
                { emoji: '💰', label: 'Venda', desc: 'Comprou seu produto' },
              ].map(s => (
                <div key={s.label} className="rounded-lg border border-border/40 bg-background/50 p-2.5 text-center">
                  <p className="text-base">{s.emoji}</p>
                  <p className="text-xs font-semibold text-foreground mt-0.5">{s.label}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Status */}
        {!hasActivePixel && (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardContent className="pt-6">
              <p className="text-sm text-destructive">
                ⚠️ Nenhum pixel ativo encontrado. Configure um pixel em{' '}
                <a href="/meta-pixels" className="underline font-medium">Meta Pixels</a> primeiro.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Funnel Visualization */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stages.map((s, i) => {
            const cfg = STAGE_CONFIG[s];
            const Icon = cfg.icon;
            const count = stats?.[s]?.count || 0;
            const val = stats?.[s]?.value || 0;
            const prevCount = i > 0 ? (stats?.[stages[i - 1]]?.count || 0) : 0;
            const convRate = i > 0 && prevCount > 0 ? ((count / prevCount) * 100).toFixed(1) : null;

            return (
              <Card key={s} className="border-border/50 bg-card/50 backdrop-blur-sm relative overflow-hidden">
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${cfg.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-medium text-muted-foreground">{cfg.label}</span>
                  </div>
                  <p className="text-2xl font-bold">{count}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {val > 0 && (
                      <span className="text-xs text-green-400">
                        R$ {val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    )}
                    {convRate && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {convRate}% conv
                      </Badge>
                    )}
                  </div>
                </CardContent>
                {i < stages.length - 1 && (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10 hidden md:block">
                    <ArrowRight className="h-4 w-4 text-muted-foreground/40" />
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        <Tabs defaultValue="events" className="space-y-4">
          <TabsList>
            <TabsTrigger value="events">Eventos Enviados</TabsTrigger>
            <TabsTrigger value="manual">Envio Manual</TabsTrigger>
          </TabsList>

          <TabsContent value="events">
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Histórico de Eventos CAPI
                </CardTitle>
                <CardDescription>Eventos do funil enviados ao Meta Conversions API</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead>Estágio</TableHead>
                      <TableHead>Evento Meta</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          Carregando...
                        </TableCell>
                      </TableRow>
                    ) : !funnelEvents?.length ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          Nenhum evento registrado ainda
                        </TableCell>
                      </TableRow>
                    ) : (
                      funnelEvents.map((evt: any) => {
                        const cfg = STAGE_CONFIG[evt.funnel_stage] || STAGE_CONFIG.lead;
                        return (
                          <TableRow key={evt.id}>
                            <TableCell className="text-xs">
                              {format(new Date(evt.created_at), 'dd/MM HH:mm')}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {evt.phone?.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3') || evt.phone}
                            </TableCell>
                            <TableCell>
                              <Badge className={cfg.color}>{cfg.label}</Badge>
                            </TableCell>
                            <TableCell className="text-xs">{evt.event_name}</TableCell>
                            <TableCell>
                              {evt.value ? `R$ ${Number(evt.value).toFixed(2)}` : '-'}
                            </TableCell>
                            <TableCell>
                              <Badge variant={evt.event_sent ? 'default' : 'secondary'}>
                                {evt.event_sent ? '✓ Enviado' : 'Pendente'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="manual">
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Registrar Evento Manual
                </CardTitle>
                <CardDescription>
                  Avance um contato no funil manualmente (ex: marcar venda)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Telefone</Label>
                    <Input
                      placeholder="5511999999999"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Estágio do Funil</Label>
                    <Select value={stage} onValueChange={setStage}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lead">Lead</SelectItem>
                        <SelectItem value="qualified">Qualificado</SelectItem>
                        <SelectItem value="checkout">Proposta/Checkout</SelectItem>
                        <SelectItem value="purchase">Venda/Purchase</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Valor (R$)</Label>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </div>
                </div>
                <Button
                  onClick={handleTrack}
                  disabled={!phone || track.isPending || !hasActivePixel}
                >
                  <Send className="h-4 w-4 mr-2" />
                  {track.isPending ? 'Enviando...' : 'Enviar Evento ao Meta'}
                </Button>

                {/* Flow diagram */}
                <div className="mt-6 p-4 rounded-lg bg-muted/30 border border-border/30">
                  <p className="text-xs font-medium text-muted-foreground mb-3">FLUXO AUTOMÁTICO</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge className={STAGE_CONFIG.lead.color}>📱 Lead WhatsApp</Badge>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <Badge className={STAGE_CONFIG.qualified.color}>🎯 IA Qualifica</Badge>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <Badge className={STAGE_CONFIG.checkout.color}>📋 Proposta</Badge>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <Badge className={STAGE_CONFIG.purchase.color}>💰 Venda</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Lead e Qualificação são automáticos via IA. Proposta e Venda podem ser manuais ou via integração.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
