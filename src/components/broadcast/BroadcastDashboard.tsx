/**
 * BroadcastDashboard — visão consolidada do Disparo em Massa.
 *
 * Fica como uma aba ao lado de "Campanhas" e "Listas", pra monitorar tudo junto:
 * total enviado, entregue (confirmado), sem confirmação, falhas e na fila —
 * somando todas as campanhas — mais um gráfico e o resumo por campanha.
 *
 * Usa os contadores que já vêm em wa_campaigns (sent_count / delivered_count /
 * failed_count / total_contacts). Somente leitura.
 */
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Send, CheckCircle2, AlertTriangle, XCircle, Clock, MessageCircle, Users, Inbox } from 'lucide-react';
import type { WACampaign } from '@/components/broadcast/CampaignCard';

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Rascunho', cls: 'bg-muted text-muted-foreground border-border' },
  running: { label: 'Enviando', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  paused: { label: 'Pausada', cls: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30' },
  completed: { label: 'Concluída', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  completed_with_errors: { label: 'Concluída c/ erros', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  failed: { label: 'Falhou', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

export function BroadcastDashboard({ campaigns }: { campaigns: WACampaign[] }) {
  const agg = useMemo(() => {
    let alvo = 0, enviados = 0, entregues = 0, falhas = 0;
    for (const c of campaigns) {
      alvo += c.total_contacts || 0;
      enviados += c.sent_count || 0;
      entregues += c.delivered_count || 0;
      falhas += c.failed_count || 0;
    }
    const semConf = Math.max(0, enviados - entregues);
    const naFila = Math.max(0, alvo - enviados - falhas);
    return { alvo, enviados, entregues, falhas, semConf, naFila };
  }, [campaigns]);

  const pieData = useMemo(
    () => [
      { name: 'Entregue', value: agg.entregues, color: 'hsl(142, 71%, 45%)' },
      { name: 'Sem confirmação', value: agg.semConf, color: 'hsl(217, 91%, 60%)' },
      { name: 'Falhou', value: agg.falhas, color: 'hsl(0, 72%, 51%)' },
      { name: 'Na fila', value: agg.naFila, color: 'hsl(215, 14%, 50%)' },
    ].filter((d) => d.value > 0),
    [agg],
  );

  const hasData = campaigns.length > 0;

  const kpi = (icon: any, label: string, value: number, color: string) => {
    const Icon = icon;
    return (
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className="text-2xl font-bold text-foreground mt-0.5">{value.toLocaleString('pt-BR')}</p>
            </div>
            <Icon className={`h-6 w-6 ${color}`} />
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {/* KPIs de entrega */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpi(Send, 'Enviados', agg.enviados, 'text-blue-400/80')}
        {kpi(CheckCircle2, 'Entregues', agg.entregues, 'text-emerald-400/80')}
        {kpi(AlertTriangle, 'Sem confirmação', agg.semConf, 'text-amber-400/80')}
        {kpi(XCircle, 'Falhas', agg.falhas, 'text-red-400/80')}
        {kpi(Clock, 'Na fila', agg.naFila, 'text-muted-foreground')}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Gráfico de status de entrega */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-1 pt-3">
            <CardTitle className="text-sm">Status de entrega (todas as campanhas)</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={78} paddingAngle={2}>
                      {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                      formatter={(v: any, n: any) => [`${Number(v).toLocaleString('pt-BR')} contato(s)`, n]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-3 -mt-2">
                  {pieData.map((d) => (
                    <span key={d.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} /> {d.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
                Nenhum disparo ainda.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Visão geral */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-1 pt-3">
            <CardTitle className="text-sm">Visão geral</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground"><MessageCircle className="h-4 w-4" /> Campanhas</span>
              <span className="font-semibold text-foreground">{campaigns.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground"><Users className="h-4 w-4" /> Contatos no alvo</span>
              <span className="font-semibold text-foreground">{agg.alvo.toLocaleString('pt-BR')}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground"><Inbox className="h-4 w-4" /> Taxa de confirmação</span>
              <span className="font-semibold text-foreground">
                {agg.enviados > 0 ? `${Math.round((agg.entregues / agg.enviados) * 100)}%` : '—'}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/40">
              "Sem confirmação" não é erro — o WhatsApp pode ainda não ter devolvido o recibo de entrega.
              Só "Falhas" são envios que deram erro.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Resumo por campanha */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader className="pb-1 pt-3">
          <CardTitle className="text-sm">Por campanha</CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          {!hasData ? (
            <p className="text-center text-sm text-muted-foreground py-6">Nenhuma campanha ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/40">
                    <th className="text-left font-medium py-1.5 pr-2">Campanha</th>
                    <th className="text-center font-medium py-1.5 px-2">Status</th>
                    <th className="text-right font-medium py-1.5 px-2">Enviados</th>
                    <th className="text-right font-medium py-1.5 px-2">Entregues</th>
                    <th className="text-right font-medium py-1.5 pl-2">Falhas</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => {
                    const st = STATUS_LABEL[c.status] || { label: c.status, cls: 'bg-muted text-muted-foreground border-border' };
                    return (
                      <tr key={c.id} className="border-b border-border/20 last:border-0">
                        <td className="py-1.5 pr-2 text-foreground truncate max-w-[160px]">{c.name}</td>
                        <td className="py-1.5 px-2 text-center">
                          <Badge className={`${st.cls} text-[10px]`}>{st.label}</Badge>
                        </td>
                        <td className="py-1.5 px-2 text-right text-foreground">{c.sent_count}/{c.total_contacts}</td>
                        <td className="py-1.5 px-2 text-right text-emerald-400">{c.delivered_count}</td>
                        <td className="py-1.5 pl-2 text-right text-red-400">{c.failed_count}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
