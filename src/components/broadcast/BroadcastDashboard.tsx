/**
 * BroadcastDashboard — visão consolidada do Disparo em Massa, com filtro de data.
 *
 * Fica como uma aba ao lado de "Campanhas" e "Listas". Mostra, no período
 * escolhido (Hoje / Semana / Mês / Personalizado / Tudo): enviados, entregues,
 * sem confirmação, falhas e na fila — somando todas as campanhas — mais um
 * gráfico e o resumo por campanha.
 *
 * Fonte: wa_queue (1 linha por disparo). Busca uma vez e filtra por data em
 * memória (troca de período é instantânea). Somente leitura.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Send, CheckCircle2, AlertTriangle, XCircle, Clock, Inbox, RefreshCw, Loader2 } from 'lucide-react';
import type { WACampaign } from '@/components/broadcast/CampaignCard';

type Cat = 'entregue' | 'enviado' | 'falhou' | 'pendente';
type Period = 'dia' | 'semana' | 'mes' | 'custom' | 'tudo';

interface QRow {
  campaign_id: string | null;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  delivery_confirmed_at: string | null;
  created_at: string;
}

const SP_OFFSET_MS = 3 * 60 * 60 * 1000;

function categorize(r: QRow): Cat {
  if (r.status === 'failed') return 'falhou';
  if (r.status === 'sent' || r.status === 'delivered' || r.status === 'read') {
    return (r.delivered_at || r.read_at || r.delivery_confirmed_at) ? 'entregue' : 'enviado';
  }
  return 'pendente'; // pending / processing / scheduled / paused
}
// Data de referência do disparo: quando saiu (sent_at) ou, na falta, quando entrou na fila.
function refMs(r: QRow): number {
  return new Date(r.sent_at || r.created_at).getTime();
}
function startOfTodaySpMs(now: number): number {
  const sp = new Date(now - SP_OFFSET_MS);
  return Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate(), 0, 0, 0) + SP_OFFSET_MS;
}
function periodBounds(period: Period, now: number, cs: string, ce: string): { start: number | null; end: number } {
  if (period === 'dia') return { start: startOfTodaySpMs(now), end: now };
  if (period === 'semana') return { start: now - 7 * 86400000, end: now };
  if (period === 'mes') return { start: now - 30 * 86400000, end: now };
  if (period === 'custom') {
    const start = cs ? new Date(`${cs}T00:00:00.000-03:00`).getTime() : null;
    const end = ce ? new Date(`${ce}T23:59:59.999-03:00`).getTime() : now;
    return { start, end };
  }
  return { start: null, end: now }; // tudo
}

const CAT_META: Record<Cat, { label: string; color: string }> = {
  entregue: { label: 'Entregue', color: 'hsl(142, 71%, 45%)' },
  enviado: { label: 'Sem confirmação', color: 'hsl(217, 91%, 60%)' },
  falhou: { label: 'Falhou', color: 'hsl(0, 72%, 51%)' },
  pendente: { label: 'Na fila', color: 'hsl(215, 14%, 50%)' },
};
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Rascunho', cls: 'bg-muted text-muted-foreground border-border' },
  running: { label: 'Enviando', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  paused: { label: 'Pausada', cls: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30' },
  completed: { label: 'Concluída', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  completed_with_errors: { label: 'Concluída c/ erros', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  failed: { label: 'Falhou', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
};
const PERIOD_LABEL: Record<Period, string> = {
  dia: 'Hoje', semana: 'Semana', mes: 'Mês', custom: 'Personalizado', tudo: 'Tudo',
};

export function BroadcastDashboard({ campaigns, userId }: { campaigns: WACampaign[]; userId?: string | null }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<QRow[]>([]);
  const [period, setPeriod] = useState<Period>('mes');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const campaignName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of campaigns) m[c.id] = c.name;
    return m;
  }, [campaigns]);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { data } = await (supabase as any)
        .from('wa_queue')
        .select('campaign_id, status, sent_at, delivered_at, read_at, delivery_confirmed_at, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5000);
      setRows((data || []) as QRow[]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filtra por período em memória (troca de período não re-busca).
  const filtered = useMemo(() => {
    if (period === 'tudo') return rows;
    const now = Date.now();
    const { start, end } = periodBounds(period, now, customStart, customEnd);
    if (start == null && period !== 'tudo') {
      // custom sem data inicial -> não filtra início
      return rows.filter((r) => refMs(r) <= end);
    }
    return rows.filter((r) => {
      const t = refMs(r);
      return (start == null || t >= start) && t <= end;
    });
  }, [rows, period, customStart, customEnd]);

  const agg = useMemo(() => {
    const c: Record<Cat, number> = { entregue: 0, enviado: 0, falhou: 0, pendente: 0 };
    const byCampaign: Record<string, { entregue: number; enviado: number; falhou: number; pendente: number }> = {};
    for (const r of filtered) {
      const cat = categorize(r);
      c[cat]++;
      const cid = r.campaign_id || '—';
      if (!byCampaign[cid]) byCampaign[cid] = { entregue: 0, enviado: 0, falhou: 0, pendente: 0 };
      byCampaign[cid][cat]++;
    }
    const enviadosTot = c.entregue + c.enviado; // saíram de fato
    return { c, byCampaign, enviadosTot };
  }, [filtered]);

  const pieData = useMemo(
    () => (['entregue', 'enviado', 'falhou', 'pendente'] as Cat[])
      .map((k) => ({ name: CAT_META[k].label, value: agg.c[k], color: CAT_META[k].color }))
      .filter((d) => d.value > 0),
    [agg],
  );

  const campaignRows = useMemo(() => {
    return Object.entries(agg.byCampaign)
      .map(([cid, v]) => ({
        cid,
        name: campaignName[cid] || 'Sem campanha',
        status: campaigns.find((c) => c.id === cid)?.status || '',
        enviados: v.entregue + v.enviado,
        entregues: v.entregue,
        falhas: v.falhou,
        total: v.entregue + v.enviado + v.falhou + v.pendente,
      }))
      .sort((a, b) => b.total - a.total);
  }, [agg, campaignName, campaigns]);

  const kpi = (icon: any, label: string, value: number, color: string) => {
    const Icon = icon;
    return (
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className="text-2xl font-bold text-foreground mt-0.5">{loading ? '—' : value.toLocaleString('pt-BR')}</p>
            </div>
            <Icon className={`h-6 w-6 ${color}`} />
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {/* Filtro de data */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['dia', 'semana', 'mes', 'custom', 'tudo'] as Period[]).map((p) => (
            <Button
              key={p}
              variant={period === p ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setPeriod(p)}
            >
              {PERIOD_LABEL[p]}
            </Button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-1.5">
            {/* Sem min/max (datas fora do limite ficam desabilitadas no calendário e o clique não aplica);
                a outra ponta se ajusta quando as datas se cruzam. */}
            <Input type="date" value={customStart} onChange={(e) => { const v = e.target.value; if (!v) return; setCustomStart(v); if (customEnd && customEnd < v) setCustomEnd(v); }} className="h-8 text-xs w-36 [&::-webkit-calendar-picker-indicator]:invert" />
            <span className="text-xs text-muted-foreground">até</span>
            <Input type="date" value={customEnd} onChange={(e) => { const v = e.target.value; if (!v) return; setCustomEnd(v); if (customStart && customStart > v) setCustomStart(v); }} className="h-8 text-xs w-36 [&::-webkit-calendar-picker-indicator]:invert" />
          </div>
        )}
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 sm:ml-auto" onClick={fetchData} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpi(Send, 'Enviados', agg.enviadosTot, 'text-blue-400/80')}
        {kpi(CheckCircle2, 'Entregues', agg.c.entregue, 'text-emerald-400/80')}
        {kpi(AlertTriangle, 'Sem confirmação', agg.c.enviado, 'text-amber-400/80')}
        {kpi(XCircle, 'Falhas', agg.c.falhou, 'text-red-400/80')}
        {kpi(Clock, 'Na fila', agg.c.pendente, 'text-muted-foreground')}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Gráfico */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-1 pt-3">
            <CardTitle className="text-sm">Status de entrega — {PERIOD_LABEL[period]}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-56 flex items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : pieData.length > 0 ? (
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
              <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">Nenhum disparo neste período.</div>
            )}
          </CardContent>
        </Card>

        {/* Visão geral */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-1 pt-3">
            <CardTitle className="text-sm">Visão geral — {PERIOD_LABEL[period]}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground"><Send className="h-4 w-4" /> Disparos no período</span>
              <span className="font-semibold text-foreground">{agg.enviadosTot.toLocaleString('pt-BR')}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground"><Inbox className="h-4 w-4" /> Taxa de confirmação</span>
              <span className="font-semibold text-foreground">
                {agg.enviadosTot > 0 ? `${Math.round((agg.c.entregue / agg.enviadosTot) * 100)}%` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground"><XCircle className="h-4 w-4" /> Falhas no período</span>
              <span className="font-semibold text-foreground">{agg.c.falhou.toLocaleString('pt-BR')}</span>
            </div>
            <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/40">
              "Sem confirmação" não é erro — o WhatsApp pode ainda não ter devolvido o recibo de entrega.
              Só "Falhas" são envios que deram erro.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Por campanha */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader className="pb-1 pt-3">
          <CardTitle className="text-sm">Por campanha — {PERIOD_LABEL[period]}</CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          {loading ? (
            <div className="py-6 flex items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : campaignRows.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">Nenhum disparo neste período.</p>
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
                  {campaignRows.map((c) => {
                    const st = STATUS_LABEL[c.status] || { label: c.status || '—', cls: 'bg-muted text-muted-foreground border-border' };
                    return (
                      <tr key={c.cid} className="border-b border-border/20 last:border-0">
                        <td className="py-1.5 pr-2 text-foreground truncate max-w-[160px]">{c.name}</td>
                        <td className="py-1.5 px-2 text-center">{c.status ? <Badge className={`${st.cls} text-[10px]`}>{st.label}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="py-1.5 px-2 text-right text-foreground">{c.enviados}</td>
                        <td className="py-1.5 px-2 text-right text-emerald-400">{c.entregues}</td>
                        <td className="py-1.5 pl-2 text-right text-red-400">{c.falhas}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows.length >= 5000 && (
            <p className="text-[10px] text-muted-foreground text-center pt-2">Mostrando os 5000 disparos mais recentes.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
