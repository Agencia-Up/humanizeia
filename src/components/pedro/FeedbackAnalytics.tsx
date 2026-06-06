// ============================================================================
// FeedbackAnalytics — Dashboard PowerBI-like dos feedbacks dos vendedores
// ============================================================================
// Renderizado dentro do Pedro → aba Feedbacks (apenas Master).
// Mostra KPIs + 4 gráficos (motivos, prioridade, cidades, vendedores) com
// filtro de período (hoje / 7 dias / 30 dias / 90 dias / tudo).
//
// 100% client-side: recebe array de feedbacks já carregado pelo PedroSDR
// e calcula métricas localmente. Sem queries adicionais ao banco.
// ============================================================================

import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid, RadialBarChart, RadialBar,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BarChart3, MessageSquareWarning, Users, TrendingDown, Filter, AlertTriangle } from 'lucide-react';

interface Feedback {
  id: string;
  priority: string;
  city?: string | null;
  reason?: string | null;
  observations?: string | null;
  content?: string | null;
  read_at?: string | null;
  created_at: string;
  member?: { name?: string } | null;
  lead?: { lead_name?: string } | null;
}

interface FeedbackAnalyticsProps {
  feedbacks: Feedback[];
}

type Period = 'today' | '7d' | '30d' | '90d' | 'all';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: '90d', label: '90 dias' },
  { id: 'all', label: 'Tudo' },
];

// Cores fixas por qualificação (alinhadas com PRIORITY_CONFIG do PedroSDR)
// low = Inativo (vermelho), normal = Pouco qualificado (âmbar), high = Qualificado (verde)
// 'urgent' é legado (antigo "Pronto pra comprar") → conta como Qualificado.
const PRIORITY_COLORS: Record<string, string> = {
  low: '#f87171',     // red-400  → Inativo
  normal: '#fbbf24',  // amber-400 → Pouco qualificado
  high: '#34d399',    // emerald-400 → Qualificado
  urgent: '#34d399',  // emerald-400 → Qualificado (legado)
};
const PRIORITY_LABELS: Record<string, string> = {
  low: 'Inativo',
  normal: 'Pouco qualificado',
  high: 'Qualificado',
  urgent: 'Qualificado',
};

// Categorização inteligente do motivo — extrai categoria a partir do texto
function categorizeReason(reason: string): string {
  const r = (reason || '').toLowerCase();
  if (/financ|parcel|score|cred|entrada|valor|vista/.test(r)) return 'Financeiros';
  if (/troca|preço|desconto|concorr|negoc|acordo/.test(r)) return 'Negociação';
  if (/cor|versão|opcional|modelo|test drive|veículo/.test(r)) return 'Produto';
  if (/respond|sumiu|pesquis|adiar|comprou em outra/.test(r)) return 'Comportamento';
  return 'Outros';
}

const CATEGORY_COLORS: Record<string, string> = {
  'Financeiros': '#facc15',
  'Negociação': '#a78bfa',
  'Produto': '#34d399',
  'Comportamento': '#fb7185',
  'Outros': '#94a3b8',
};

const CATEGORY_ICONS: Record<string, string> = {
  'Financeiros': '💰',
  'Negociação': '🤝',
  'Produto': '🚗',
  'Comportamento': '👤',
  'Outros': '📌',
};

// Paleta de cores para barras (top vendedores e top cidades)
const BAR_GRADIENT_COLORS = [
  '#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd',
  '#818cf8', '#7c3aed', '#4f46e5',
];

function periodCutoff(period: Period): number {
  const now = Date.now();
  switch (period) {
    case 'today': return new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    case '7d': return now - 7 * 24 * 60 * 60 * 1000;
    case '30d': return now - 30 * 24 * 60 * 60 * 1000;
    case '90d': return now - 90 * 24 * 60 * 60 * 1000;
    case 'all': return 0;
  }
}

// Tooltip customizado moderno
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-sm px-3 py-2 shadow-xl">
      {label && <p className="text-[10px] text-slate-400 mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-xs font-semibold" style={{ color: p.fill || p.color || '#fff' }}>
          {p.name ? `${p.name}: ` : ''}{p.value}
        </p>
      ))}
    </div>
  );
}

// Tooltip para pie chart
function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-sm px-3 py-2 shadow-xl">
      <p className="text-[10px] text-slate-400">{item.name}</p>
      <p className="text-sm font-bold" style={{ color: item.payload.fill }}>{item.value} feedbacks</p>
    </div>
  );
}

// Legend customizado para o pie chart de qualificação
function QualifLegend({ data }: { data: Array<{ nome: string; count: number; fill: string; pct: number }> }) {
  return (
    <div className="flex flex-col gap-1.5 mt-1">
      {data.map((d) => (
        <div key={d.nome} className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: d.fill }} />
          <span className="text-[10px] text-muted-foreground flex-1 truncate">{d.nome}</span>
          <span className="text-[10px] font-semibold text-foreground">{d.count}</span>
          <span className="text-[9px] text-muted-foreground">({d.pct}%)</span>
        </div>
      ))}
    </div>
  );
}

export function FeedbackAnalytics({ feedbacks }: FeedbackAnalyticsProps) {
  const [period, setPeriod] = useState<Period>('30d');

  const metrics = useMemo(() => {
    const cutoff = periodCutoff(period);
    const filtered = feedbacks.filter(f => new Date(f.created_at).getTime() >= cutoff);

    // KPIs
    const total = filtered.length;
    const naoLidos = filtered.filter(f => !f.read_at).length;
    const vendedoresAtivos = new Set(filtered.map(f => f.member?.name).filter(Boolean)).size;

    // Distribuição por motivo (categorizado)
    const reasonsCount = new Map<string, number>();
    for (const f of filtered) {
      const reason = (f.reason || '').trim();
      if (!reason) continue;
      const cat = categorizeReason(reason);
      reasonsCount.set(cat, (reasonsCount.get(cat) || 0) + 1);
    }
    const totalWithReason = Array.from(reasonsCount.values()).reduce((s, v) => s + v, 0);
    const reasonsData = Array.from(reasonsCount.entries())
      .map(([categoria, count]) => ({
        categoria,
        label: `${CATEGORY_ICONS[categoria] || '📌'} ${categoria}`,
        count,
        fill: CATEGORY_COLORS[categoria] || '#94a3b8',
        pct: totalWithReason > 0 ? Math.round((count / totalWithReason) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
    const topReason = reasonsData[0]?.categoria || '—';

    // Top motivos específicos (não categorizados — exato)
    const specificReasonsCount = new Map<string, number>();
    for (const f of filtered) {
      const reason = (f.reason || '').trim();
      if (!reason) continue;
      specificReasonsCount.set(reason, (specificReasonsCount.get(reason) || 0) + 1);
    }
    const topSpecificReasons = Array.from(specificReasonsCount.entries())
      .map(([motivo, count]) => ({ motivo: motivo.length > 40 ? motivo.slice(0, 38) + '…' : motivo, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Distribuição por qualificação (legado 'urgent' é normalizado p/ 'high' = Qualificado)
    const priorityCount = new Map<string, number>();
    for (const f of filtered) {
      const pk = f.priority === 'urgent' ? 'high' : f.priority;
      priorityCount.set(pk, (priorityCount.get(pk) || 0) + 1);
    }
    const totalPriority = Array.from(priorityCount.values()).reduce((s, v) => s + v, 0);
    const priorityData = Array.from(priorityCount.entries())
      .map(([key, count]) => ({
        nome: PRIORITY_LABELS[key] || key,
        count,
        fill: PRIORITY_COLORS[key] || '#94a3b8',
        pct: totalPriority > 0 ? Math.round((count / totalPriority) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Top cidades
    const cityCount = new Map<string, number>();
    for (const f of filtered) {
      const c = (f.city || '').trim();
      if (!c) continue;
      cityCount.set(c, (cityCount.get(c) || 0) + 1);
    }
    const topCities = Array.from(cityCount.entries())
      .map(([cidade, count]) => ({ cidade, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // Top vendedores
    const sellerCount = new Map<string, number>();
    for (const f of filtered) {
      const name = f.member?.name || 'Sem vendedor';
      sellerCount.set(name, (sellerCount.get(name) || 0) + 1);
    }
    const topSellers = Array.from(sellerCount.entries())
      .map(([vendedor, count]) => ({
        vendedor: vendedor.length > 18 ? vendedor.slice(0, 16) + '…' : vendedor,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // Qualificados: percentual pra radial bar
    const qualifCount = priorityCount.get('high') || 0;
    const qualifPct = total > 0 ? Math.round((qualifCount / total) * 100) : 0;

    return {
      total, naoLidos, vendedoresAtivos, topReason,
      reasonsData, topSpecificReasons, priorityData, topCities, topSellers,
      qualifPct,
    };
  }, [feedbacks, period]);

  if (feedbacks.length === 0) return null;

  return (
    <Card className="border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-violet-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-400" />
              Análise de Feedbacks dos Vendedores
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Métricas e motivos de não-compra reportados pelo time
            </CardDescription>
          </div>
          {/* Filtro de período */}
          <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
            <Filter className="h-3 w-3 text-muted-foreground ml-1" />
            {PERIODS.map(p => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                  period === p.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KpiCard icon={BarChart3} label="Total no período" value={metrics.total} color="text-blue-400" bg="bg-blue-500/10 border-blue-500/20" />
          <KpiCard icon={MessageSquareWarning} label="Não lidos" value={metrics.naoLidos} color="text-orange-400" bg="bg-orange-500/10 border-orange-500/20" />
          <KpiCard icon={Users} label="Vendedores ativos" value={metrics.vendedoresAtivos} color="text-emerald-400" bg="bg-emerald-500/10 border-emerald-500/20" />
          <KpiCard icon={AlertTriangle} label="Top categoria" value={`${CATEGORY_ICONS[metrics.topReason] || '📌'} ${metrics.topReason}`} color="text-violet-400" bg="bg-violet-500/10 border-violet-500/20" small />
        </div>

        {metrics.total === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs">
            Nenhum feedback no período selecionado.
          </div>
        ) : (
          <>
            {/* Linha 1: Motivos por Categoria (Donut) + Qualificação (Donut) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Donut de Motivos */}
              <ChartCard title="Motivos por Categoria" subtitle={`${metrics.reasonsData.reduce((s, r) => s + r.count, 0)} feedbacks com motivo informado`}>
                {metrics.reasonsData.length === 0 ? (
                  <EmptyChart text="Sem motivos cadastrados" />
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie
                            data={metrics.reasonsData}
                            dataKey="count"
                            nameKey="label"
                            cx="50%"
                            cy="50%"
                            innerRadius={48}
                            outerRadius={72}
                            paddingAngle={3}
                            strokeWidth={0}
                          >
                            {metrics.reasonsData.map((entry, i) => (
                              <Cell key={i} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip content={<PieTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-col gap-1.5 pr-1 min-w-0 flex-1">
                      {metrics.reasonsData.map((d) => (
                        <div key={d.categoria} className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full shrink-0" style={{ background: d.fill }} />
                          <span className="text-[10px] text-muted-foreground flex-1 truncate">{CATEGORY_ICONS[d.categoria]} {d.categoria}</span>
                          <span className="text-[10px] font-bold text-foreground">{d.count}</span>
                          <span className="text-[9px] text-muted-foreground">({d.pct}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </ChartCard>

              {/* Donut de Qualificação */}
              <ChartCard title="Distribuição por Qualificação" subtitle="Como o vendedor classificou o lead">
                {metrics.priorityData.length === 0 ? (
                  <EmptyChart text="Sem dados de prioridade" />
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie
                            data={metrics.priorityData}
                            dataKey="count"
                            nameKey="nome"
                            cx="50%"
                            cy="50%"
                            innerRadius={48}
                            outerRadius={72}
                            paddingAngle={3}
                            strokeWidth={0}
                          >
                            {metrics.priorityData.map((entry, i) => (
                              <Cell key={i} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip content={<PieTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-col gap-1.5 pr-1 min-w-0 flex-1">
                      {metrics.priorityData.map((d) => (
                        <div key={d.nome} className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full shrink-0" style={{ background: d.fill }} />
                          <span className="text-[10px] text-muted-foreground flex-1 truncate">{d.nome}</span>
                          <span className="text-[10px] font-bold text-foreground">{d.count}</span>
                          <span className="text-[9px] text-muted-foreground">({d.pct}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </ChartCard>
            </div>

            {/* Linha 2: Top motivos específicos (BarChart horizontal premium) */}
            <ChartCard title="Top Motivos de Não-Compra" subtitle="Motivos específicos mais frequentes reportados pelos vendedores">
              {metrics.topSpecificReasons.length === 0 ? (
                <EmptyChart text="Sem motivos cadastrados" />
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(200, metrics.topSpecificReasons.length * 36)}>
                  <BarChart
                    data={metrics.topSpecificReasons}
                    layout="vertical"
                    margin={{ left: 8, right: 32, top: 4, bottom: 4 }}
                  >
                    <defs>
                      <linearGradient id="barGradientReason" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#f43f5e" />
                        <stop offset="100%" stopColor="#fb7185" stopOpacity={0.7} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.08} horizontal={false} />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={9}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="motivo"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={10}
                      width={200}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.15 }} />
                    <Bar
                      dataKey="count"
                      fill="url(#barGradientReason)"
                      radius={[0, 6, 6, 0]}
                      maxBarSize={22}
                      label={{ position: 'right', fontSize: 10, fill: 'hsl(var(--muted-foreground))', formatter: (v: number) => v }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Linha 3: Cidades + Vendedores */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Cidades */}
              <ChartCard title="Cidades dos Clientes" subtitle="Localização dos leads que não fecharam">
                {metrics.topCities.length === 0 ? (
                  <EmptyChart text="Sem cidades cadastradas" />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={metrics.topCities} margin={{ left: 4, right: 8, top: 4, bottom: 36 }}>
                      <defs>
                        <linearGradient id="barGradientCity" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#60a5fa" />
                          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.6} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.08} vertical={false} />
                      <XAxis
                        dataKey="cidade"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={9}
                        angle={-35}
                        textAnchor="end"
                        interval={0}
                        tickLine={false}
                        axisLine={false}
                        dy={4}
                      />
                      <YAxis
                        allowDecimals={false}
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={9}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.15 }} />
                      <Bar dataKey="count" fill="url(#barGradientCity)" radius={[6, 6, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>

              {/* Vendedores */}
              <ChartCard title="Feedbacks por Vendedor" subtitle="Quem reportou mais no período">
                {metrics.topSellers.length === 0 ? (
                  <EmptyChart text="Sem vendedores no período" />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={metrics.topSellers} margin={{ left: 4, right: 8, top: 4, bottom: 36 }}>
                      <defs>
                        <linearGradient id="barGradientSeller" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#a78bfa" />
                          <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.6} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.08} vertical={false} />
                      <XAxis
                        dataKey="vendedor"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={9}
                        angle={-35}
                        textAnchor="end"
                        interval={0}
                        tickLine={false}
                        axisLine={false}
                        dy={4}
                      />
                      <YAxis
                        allowDecimals={false}
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={9}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.15 }} />
                      <Bar
                        dataKey="count"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={40}
                      >
                        {metrics.topSellers.map((_, i) => (
                          <Cell key={i} fill={BAR_GRADIENT_COLORS[i % BAR_GRADIENT_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Helpers internos ──────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, color, bg, small = false }: { icon: any; label: string; value: number | string; color: string; bg: string; small?: boolean }) {
  return (
    <div className={`border rounded-xl px-3 py-2.5 flex items-center gap-2.5 ${bg}`}>
      <div className={`rounded-lg p-1.5 ${bg}`}>
        <Icon className={`h-3.5 w-3.5 ${color} shrink-0`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`${small ? 'text-xs truncate leading-tight' : 'text-xl'} font-bold text-foreground leading-none`}>{value}</p>
        <p className="text-[10px] text-muted-foreground truncate mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-background/40 border border-border/40 rounded-xl p-3.5">
      <div className="mb-3">
        <p className="text-xs font-semibold text-foreground">{title}</p>
        {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div className="h-[180px] flex items-center justify-center text-muted-foreground text-xs">
      {text}
    </div>
  );
}
