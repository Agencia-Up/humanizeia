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
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, CartesianGrid,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BarChart3, MessageSquareWarning, Users, TrendingDown, Filter } from 'lucide-react';

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
  low: '🔴 Inativo',
  normal: '🟡 Pouco qualificado',
  high: '🟢 Qualificado',
  urgent: '🟢 Qualificado',
};

// Categorização inteligente do motivo — extrai categoria a partir do texto
function categorizeReason(reason: string): string {
  const r = (reason || '').toLowerCase();
  if (/financ|parcel|score|cred|entrada|valor|vista/.test(r)) return '💰 Financeiros';
  if (/troca|preço|desconto|concorr|negoc|acordo/.test(r)) return '🤝 Negociação';
  if (/cor|versão|opcional|modelo|test drive|veículo/.test(r)) return '🚗 Produto';
  if (/respond|sumiu|pesquis|adiar|comprou em outra/.test(r)) return '👤 Comportamento';
  return '📌 Outros';
}

const CATEGORY_COLORS: Record<string, string> = {
  '💰 Financeiros': '#facc15',     // yellow-400
  '🤝 Negociação': '#a78bfa',      // violet-400
  '🚗 Produto': '#34d399',         // emerald-400
  '👤 Comportamento': '#fb7185',   // rose-400
  '📌 Outros': '#94a3b8',          // slate-400
};

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
    const reasonsData = Array.from(reasonsCount.entries())
      .map(([categoria, count]) => ({ categoria, count, fill: CATEGORY_COLORS[categoria] || '#94a3b8' }))
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

    // Distribuição por qualificação (legado 'urgent' é normalizado p/ 'high' = Qualificado,
    // pra não criar uma fatia "Qualificado" duplicada no gráfico)
    const priorityCount = new Map<string, number>();
    for (const f of filtered) {
      const pk = f.priority === 'urgent' ? 'high' : f.priority;
      priorityCount.set(pk, (priorityCount.get(pk) || 0) + 1);
    }
    const priorityData = Array.from(priorityCount.entries())
      .map(([key, count]) => ({
        nome: PRIORITY_LABELS[key] || key,
        count,
        fill: PRIORITY_COLORS[key] || '#94a3b8',
      }));

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

    return {
      total, naoLidos, vendedoresAtivos, topReason,
      reasonsData, topSpecificReasons, priorityData, topCities, topSellers,
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
          <KpiCard icon={BarChart3} label="Total no período" value={metrics.total} color="text-blue-400" />
          <KpiCard icon={MessageSquareWarning} label="Não lidos" value={metrics.naoLidos} color="text-orange-400" />
          <KpiCard icon={Users} label="Vendedores ativos" value={metrics.vendedoresAtivos} color="text-emerald-400" />
          <KpiCard icon={TrendingDown} label="Top motivo (categoria)" value={metrics.topReason} color="text-violet-400" small />
        </div>

        {metrics.total === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs">
            Nenhum feedback no período selecionado.
          </div>
        ) : (
          <>
            {/* Linha 1: Motivos categorizados (PieChart) + Prioridade (PieChart) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ChartCard title="Motivos por Categoria" subtitle={`${metrics.reasonsData.reduce((s, r) => s + r.count, 0)} feedbacks com motivo informado`}>
                {metrics.reasonsData.length === 0 ? (
                  <EmptyChart text="Sem motivos cadastrados" />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={metrics.reasonsData}
                        dataKey="count"
                        nameKey="categoria"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        label={(e: any) => `${e.count}`}
                        labelLine={false}
                      >
                        {metrics.reasonsData.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>

              <ChartCard title="Distribuição por Qualificação" subtitle="Como o vendedor classificou o lead">
                {metrics.priorityData.length === 0 ? (
                  <EmptyChart text="Sem dados de prioridade" />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={metrics.priorityData}
                        dataKey="count"
                        nameKey="nome"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        label={(e: any) => `${e.count}`}
                        labelLine={false}
                      >
                        {metrics.priorityData.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            </div>

            {/* Linha 2: Top motivos específicos (BarChart horizontal) */}
            <ChartCard title="Top Motivos de Não-Compra (específicos)" subtitle="Detalhamento individual — o que mais aparece">
              {metrics.topSpecificReasons.length === 0 ? (
                <EmptyChart text="Sem motivos cadastrados" />
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(180, metrics.topSpecificReasons.length * 32)}>
                  <BarChart data={metrics.topSpecificReasons} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis type="number" allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={10} />
                    <YAxis type="category" dataKey="motivo" stroke="hsl(var(--muted-foreground))" fontSize={10} width={220} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                    />
                    <Bar dataKey="count" fill="#fb7185" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Linha 3: Cidades + Vendedores */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ChartCard title="Cidades dos Clientes" subtitle="Onde estão os leads que não fecharam">
                {metrics.topCities.length === 0 ? (
                  <EmptyChart text="Sem cidades cadastradas" />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={metrics.topCities} margin={{ left: 4, right: 8, top: 4, bottom: 28 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="cidade" stroke="hsl(var(--muted-foreground))" fontSize={10} angle={-30} textAnchor="end" interval={0} />
                      <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={10} />
                      <Tooltip
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                      />
                      <Bar dataKey="count" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>

              <ChartCard title="Feedbacks por Vendedor" subtitle="Quem reportou mais no período">
                {metrics.topSellers.length === 0 ? (
                  <EmptyChart text="Sem vendedores no período" />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={metrics.topSellers} margin={{ left: 4, right: 8, top: 4, bottom: 28 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="vendedor" stroke="hsl(var(--muted-foreground))" fontSize={10} angle={-30} textAnchor="end" interval={0} />
                      <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={10} />
                      <Tooltip
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                      />
                      <Bar dataKey="count" fill="#34d399" radius={[4, 4, 0, 0]} />
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

function KpiCard({ icon: Icon, label, value, color, small = false }: { icon: any; label: string; value: number | string; color: string; small?: boolean }) {
  return (
    <div className="bg-background/50 border border-border/40 rounded-lg px-3 py-2 flex items-center gap-2">
      <Icon className={`h-4 w-4 ${color} shrink-0`} />
      <div className="min-w-0 flex-1">
        <p className={`${small ? 'text-xs truncate' : 'text-lg'} font-bold text-foreground leading-tight`}>{value}</p>
        <p className="text-[10px] text-muted-foreground truncate">{label}</p>
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-background/30 border border-border/40 rounded-lg p-3">
      <div className="mb-2">
        <p className="text-xs font-medium text-foreground">{title}</p>
        {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
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
