// ============================================================================
// FeedbackAnalytics — aba Feedbacks (Master)
// ----------------------------------------------------------------------------
// Filtros: VENDEDOR (todos / cada um) + PERÍODO (hoje / ontem / 7 / 30 / personalizado).
// Tudo abaixo obedece os dois filtros. Mostra: KPIs, comparação VENDEDOR x IA (concordância),
// gráficos agregados, e a LISTA dos feedbacks completos (texto inteiro, expansível) de cada um.
// "Feedback da IA" = status_crm do lead (o qualidade_lead da IA está zerado no banco).
// 100% client-side: recebe os feedbacks já carregados pelo PedroSDR.
// ============================================================================

import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BarChart3, MessageSquareWarning, Users, Filter, ChevronDown, Bot, UserCheck, Scale } from 'lucide-react';

interface Feedback {
  id: string;
  lead_id?: string | null;
  member_id?: string | null;
  priority: string;
  city?: string | null;
  reason?: string | null;
  observations?: string | null;
  content?: string | null;
  read_at?: string | null;
  created_at: string;
  member?: { name?: string } | null;
  lead?: { lead_name?: string } | null;
  ia_status_crm?: string | null;
}

interface FeedbackAnalyticsProps {
  feedbacks: Feedback[];
  // Lista COMPLETA de vendedores (do time) pro dropdown — senão só aparecem os que já deram feedback.
  sellers?: Array<{ id: string; name: string; memberIds: string[] }>;
  // No painel do VENDEDOR esconde o filtro de vendedor (ele só vê os dele).
  hideSellerFilter?: boolean;
}

type Period = 'today' | 'yesterday' | '7d' | '30d' | 'all' | 'custom';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Hoje' },
  { id: 'yesterday', label: 'Ontem' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'all', label: 'Tudo' },
  { id: 'custom', label: 'Personalizado' },
];

// low = Inativo (vermelho), normal = Pouco qualificado (âmbar), high/urgent = Qualificado (verde).
const PRIORITY_COLORS: Record<string, string> = { low: '#f87171', normal: '#fbbf24', high: '#34d399', urgent: '#34d399' };
const PRIORITY_LABELS: Record<string, string> = { low: 'Inativo', normal: 'Pouco qualificado', high: 'Qualificado', urgent: 'Qualificado' };

// ─── Comparação VENDEDOR x IA: ambos viram o mesmo "balde" de qualidade ──────
type Bucket = 'qualificado' | 'pouco' | 'inativo';
const BUCKET_LABEL: Record<Bucket, string> = { qualificado: 'Qualificado', pouco: 'Pouco qualificado', inativo: 'Inativo' };
const BUCKET_COLOR: Record<Bucket, string> = { qualificado: '#34d399', pouco: '#fbbf24', inativo: '#f87171' };

function sellerBucket(priority: string): Bucket | null {
  const p = priority === 'urgent' ? 'high' : priority;
  if (p === 'high') return 'qualificado';
  if (p === 'normal') return 'pouco';
  if (p === 'low') return 'inativo';
  return null;
}
function iaBucket(status?: string | null): Bucket | null {
  const s = (status || '').toLowerCase();
  if (['qualificado', 'negociacao', 'agendamento', 'fechado'].includes(s)) return 'qualificado';
  if (['pouco_qualificado', 'em_atendimento', 'carro_nao_disponivel'].includes(s)) return 'pouco';
  if (['inativo', 'perdido'].includes(s)) return 'inativo';
  return null;
}

function categorizeReason(reason: string): string {
  const r = (reason || '').toLowerCase();
  if (/financ|parcel|score|cred|entrada|valor|vista/.test(r)) return 'Financeiros';
  if (/troca|preço|desconto|concorr|negoc|acordo/.test(r)) return 'Negociação';
  if (/cor|versão|opcional|modelo|test drive|veículo/.test(r)) return 'Produto';
  if (/respond|sumiu|pesquis|adiar|comprou em outra/.test(r)) return 'Comportamento';
  return 'Outros';
}
const CATEGORY_COLORS: Record<string, string> = { 'Financeiros': '#facc15', 'Negociação': '#a78bfa', 'Produto': '#34d399', 'Comportamento': '#fb7185', 'Outros': '#94a3b8' };
const CATEGORY_ICONS: Record<string, string> = { 'Financeiros': '💰', 'Negociação': '🤝', 'Produto': '🚗', 'Comportamento': '👤', 'Outros': '📌' };
const BAR_GRADIENT_COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#818cf8', '#7c3aed', '#4f46e5'];

function periodRange(period: Period, since: string, until: string): { since: number; until: number } {
  const now = Date.now();
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  switch (period) {
    case 'today': return { since: startOfToday, until: now };
    case 'yesterday': return { since: startOfToday - 86400000, until: startOfToday - 1 };
    case '7d': return { since: now - 7 * 86400000, until: now };
    case '30d': return { since: now - 30 * 86400000, until: now };
    case 'custom': return {
      since: since ? new Date(`${since}T00:00:00`).getTime() : 0,
      until: until ? new Date(`${until}T23:59:59`).getTime() : now,
    };
    case 'all': default: return { since: 0, until: now };
  }
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-sm px-3 py-2 shadow-xl">
      {label && <p className="text-[10px] text-slate-400 mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-xs font-semibold" style={{ color: p.fill || p.color || '#fff' }}>{p.name ? `${p.name}: ` : ''}{p.value}</p>
      ))}
    </div>
  );
}
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

function fmtDate(s: string): string {
  try { return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return s; }
}

export function FeedbackAnalytics({ feedbacks, sellers, hideSellerFilter }: FeedbackAnalyticsProps) {
  const [period, setPeriod] = useState<Period>('30d');
  const [customSince, setCustomSince] = useState('');
  const [customUntil, setCustomUntil] = useState('');
  const [seller, setSeller] = useState<string>('all'); // member_id ou 'all'
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExp = (id: string) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Vendedores do dropdown: o time COMPLETO (prop sellers) — senão deriva dos feedbacks (fallback).
  const sellerOptions = useMemo(() => {
    if (sellers && sellers.length) return sellers.map((s) => ({ id: s.id, name: s.name })).sort((a, b) => a.name.localeCompare(b.name));
    const m = new Map<string, string>();
    for (const f of feedbacks) if (f.member_id) m.set(f.member_id, f.member?.name || 'Sem nome');
    return Array.from(m.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [feedbacks, sellers]);

  // ids de membro do vendedor selecionado (mesmo vendedor pode ter vários member_id na matriz de agentes).
  const selectedMemberIds = useMemo<string[] | null>(() => {
    if (seller === 'all') return null;
    if (sellers && sellers.length) return sellers.find((s) => s.id === seller)?.memberIds || [seller];
    return [seller];
  }, [seller, sellers]);

  // Recorte por PERÍODO + VENDEDOR (governa tudo abaixo).
  const filtered = useMemo(() => {
    const { since, until } = periodRange(period, customSince, customUntil);
    return feedbacks
      .filter((f) => {
        const t = new Date(f.created_at).getTime();
        if (t < since || t > until) return false;
        if (selectedMemberIds && !selectedMemberIds.includes(f.member_id || '')) return false;
        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [feedbacks, period, customSince, customUntil, selectedMemberIds]);

  const metrics = useMemo(() => {
    const total = filtered.length;
    const naoLidos = filtered.filter((f) => !f.read_at).length;
    const vendedoresAtivos = new Set(filtered.map((f) => f.member_id).filter(Boolean)).size;

    // Motivos por categoria
    const reasonsCount = new Map<string, number>();
    for (const f of filtered) { const r = (f.reason || '').trim(); if (!r) continue; const c = categorizeReason(r); reasonsCount.set(c, (reasonsCount.get(c) || 0) + 1); }
    const totalWithReason = Array.from(reasonsCount.values()).reduce((s, v) => s + v, 0);
    const reasonsData = Array.from(reasonsCount.entries()).map(([categoria, count]) => ({ categoria, count, fill: CATEGORY_COLORS[categoria] || '#94a3b8', pct: totalWithReason > 0 ? Math.round((count / totalWithReason) * 100) : 0 })).sort((a, b) => b.count - a.count);
    const topReason = reasonsData[0]?.categoria || '—';

    // Top motivos específicos
    const specificReasonsCount = new Map<string, number>();
    for (const f of filtered) { const r = (f.reason || '').trim(); if (!r) continue; specificReasonsCount.set(r, (specificReasonsCount.get(r) || 0) + 1); }
    const topSpecificReasons = Array.from(specificReasonsCount.entries()).map(([motivo, count]) => ({ motivo: motivo.length > 40 ? motivo.slice(0, 38) + '…' : motivo, count })).sort((a, b) => b.count - a.count).slice(0, 8);

    // Qualificação do VENDEDOR
    const priorityCount = new Map<string, number>();
    for (const f of filtered) { const pk = f.priority === 'urgent' ? 'high' : f.priority; priorityCount.set(pk, (priorityCount.get(pk) || 0) + 1); }
    const totalPriority = Array.from(priorityCount.values()).reduce((s, v) => s + v, 0);
    const priorityData = Array.from(priorityCount.entries()).map(([key, count]) => ({ nome: PRIORITY_LABELS[key] || key, count, fill: PRIORITY_COLORS[key] || '#94a3b8', pct: totalPriority > 0 ? Math.round((count / totalPriority) * 100) : 0 })).sort((a, b) => b.count - a.count);

    // Top cidades
    const cityCount = new Map<string, number>();
    for (const f of filtered) { const c = (f.city || '').trim(); if (!c) continue; cityCount.set(c, (cityCount.get(c) || 0) + 1); }
    const topCities = Array.from(cityCount.entries()).map(([cidade, count]) => ({ cidade, count })).sort((a, b) => b.count - a.count).slice(0, 6);

    // ─── COMPARAÇÃO VENDEDOR x IA ──────────────────────────────────────────
    let comparaveis = 0, concordam = 0;
    const perSeller = new Map<string, { nome: string; total: number; comparaveis: number; concordam: number }>();
    for (const f of filtered) {
      const sb = sellerBucket(f.priority);
      const ib = iaBucket(f.ia_status_crm);
      const key = f.member_id || 'sem';
      if (!perSeller.has(key)) perSeller.set(key, { nome: f.member?.name || 'Sem vendedor', total: 0, comparaveis: 0, concordam: 0 });
      const ps = perSeller.get(key)!; ps.total++;
      if (sb && ib) { comparaveis++; ps.comparaveis++; if (sb === ib) { concordam++; ps.concordam++; } }
    }
    const concordanciaPct = comparaveis > 0 ? Math.round((concordam / comparaveis) * 100) : null;
    const sellersCompare = Array.from(perSeller.values())
      .map((s) => ({ ...s, pct: s.comparaveis > 0 ? Math.round((s.concordam / s.comparaveis) * 100) : null }))
      .sort((a, b) => b.total - a.total);

    return { total, naoLidos, vendedoresAtivos, topReason, reasonsData, topSpecificReasons, priorityData, topCities, comparaveis, concordanciaPct, sellersCompare };
  }, [filtered]);

  if (feedbacks.length === 0) return null;

  return (
    <Card className="border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-violet-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4 text-blue-400" /> Análise de Feedbacks dos Vendedores</CardTitle>
            <CardDescription className="text-xs mt-1">Feedback completo de cada vendedor, comparado com a classificação da IA — filtre por vendedor e período</CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Filtro de VENDEDOR (escondido no painel do próprio vendedor) */}
            {!hideSellerFilter && (
              <select value={seller} onChange={(e) => setSeller(e.target.value)}
                className="h-8 rounded-lg border border-border/60 bg-background/70 px-2.5 text-[11px] font-medium text-foreground">
                <option value="all">Todos os vendedores</option>
                {sellerOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            {/* Filtro de PERÍODO */}
            <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
              <Filter className="h-3 w-3 text-muted-foreground ml-1" />
              {PERIODS.map((p) => (
                <button key={p.id} onClick={() => setPeriod(p.id)}
                  className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${period === p.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{p.label}</button>
              ))}
            </div>
          </div>
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-2 flex-wrap text-[11px] mt-2">
            <span className="text-muted-foreground">De</span>
            <input type="date" value={customSince} max={customUntil || undefined} onChange={(e) => setCustomSince(e.target.value)} className="h-7 rounded-md border bg-background px-2 text-[11px]" />
            <span className="text-muted-foreground">até</span>
            <input type="date" value={customUntil} min={customSince || undefined} onChange={(e) => setCustomUntil(e.target.value)} className="h-7 rounded-md border bg-background px-2 text-[11px]" />
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KpiCard icon={BarChart3} label="Feedbacks no período" value={metrics.total} color="text-blue-400" bg="bg-blue-500/10 border-blue-500/20" />
          <KpiCard icon={MessageSquareWarning} label="Não lidos" value={metrics.naoLidos} color="text-orange-400" bg="bg-orange-500/10 border-orange-500/20" />
          <KpiCard icon={Users} label="Vendedores" value={metrics.vendedoresAtivos} color="text-emerald-400" bg="bg-emerald-500/10 border-emerald-500/20" />
          <KpiCard icon={Scale} label="Concordância com a IA" value={metrics.concordanciaPct == null ? '—' : `${metrics.concordanciaPct}%`} color="text-violet-400" bg="bg-violet-500/10 border-violet-500/20" small />
        </div>

        {metrics.total === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs">Nenhum feedback no período / vendedor selecionado.</div>
        ) : (
          <>
            {/* ─── VENDEDOR x IA: concordância por vendedor ───────────────── */}
            <ChartCard title="Vendedor × IA — concordância" subtitle="Quanto a classificação do vendedor bate com a da IA (status do lead). Compara só onde os dois classificaram.">
              {metrics.comparaveis === 0 ? (
                <EmptyChart text="Sem leads classificados pelos dois ainda" />
              ) : (
                <div className="space-y-2">
                  {metrics.sellersCompare.filter((s) => s.comparaveis > 0).map((s) => (
                    <div key={s.nome} className="flex items-center gap-3">
                      <span className="text-xs text-foreground w-28 truncate" title={s.nome}>{s.nome}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted/40 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${s.pct ?? 0}%`, background: (s.pct ?? 0) >= 70 ? '#34d399' : (s.pct ?? 0) >= 40 ? '#fbbf24' : '#f87171' }} />
                      </div>
                      <span className="text-xs font-semibold tabular-nums w-10 text-right">{s.pct ?? 0}%</span>
                      <span className="text-[10px] text-muted-foreground w-16 text-right">{s.concordam}/{s.comparaveis}</span>
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>

            {/* Linha: Motivos por categoria + Qualificação (vendedor) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ChartCard title="Motivos por Categoria" subtitle={`${metrics.reasonsData.reduce((s, r) => s + r.count, 0)} feedbacks com motivo informado`}>
                {metrics.reasonsData.length === 0 ? <EmptyChart text="Sem motivos cadastrados" /> : (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <ResponsiveContainer width="100%" height={170}>
                        <PieChart>
                          <Pie data={metrics.reasonsData} dataKey="count" nameKey="categoria" cx="50%" cy="50%" innerRadius={46} outerRadius={70} paddingAngle={3} strokeWidth={0}>
                            {metrics.reasonsData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
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

              <ChartCard title="Classificação do Vendedor" subtitle="Como o vendedor classificou os leads">
                {metrics.priorityData.length === 0 ? <EmptyChart text="Sem dados" /> : (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <ResponsiveContainer width="100%" height={170}>
                        <PieChart>
                          <Pie data={metrics.priorityData} dataKey="count" nameKey="nome" cx="50%" cy="50%" innerRadius={46} outerRadius={70} paddingAngle={3} strokeWidth={0}>
                            {metrics.priorityData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
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

            {/* Top motivos específicos */}
            <ChartCard title="Top Motivos de Não-Compra" subtitle="Motivos específicos mais frequentes">
              {metrics.topSpecificReasons.length === 0 ? <EmptyChart text="Sem motivos cadastrados" /> : (
                <ResponsiveContainer width="100%" height={Math.max(180, metrics.topSpecificReasons.length * 34)}>
                  <BarChart data={metrics.topSpecificReasons} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
                    <defs>
                      <linearGradient id="barGradientReason" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#f43f5e" /><stop offset="100%" stopColor="#fb7185" stopOpacity={0.7} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.08} horizontal={false} />
                    <XAxis type="number" allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={9} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="motivo" stroke="hsl(var(--muted-foreground))" fontSize={10} width={200} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.15 }} />
                    <Bar dataKey="count" fill="url(#barGradientReason)" radius={[0, 6, 6, 0]} maxBarSize={22} label={{ position: 'right', fontSize: 10, fill: 'hsl(var(--muted-foreground))', formatter: (v: number) => v }} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* ─── LISTA DOS FEEDBACKS COMPLETOS ──────────────────────────── */}
            <ChartCard title={`Feedbacks completos (${filtered.length})`} subtitle="Cada feedback do vendedor — clique pra ver o texto inteiro e a classificação da IA ao lado">
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {filtered.map((f) => {
                  const sb = sellerBucket(f.priority);
                  const ib = iaBucket(f.ia_status_crm);
                  const aberto = expanded.has(f.id);
                  const divergem = sb && ib && sb !== ib;
                  return (
                    <div key={f.id} className={`rounded-xl border ${divergem ? 'border-amber-500/40 bg-amber-500/5' : 'border-border/40 bg-background/40'}`}>
                      <button onClick={() => toggleExp(f.id)} className="w-full text-left px-3 py-2.5 flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-foreground truncate">{f.member?.name || 'Sem vendedor'}</span>
                            <span className="text-[10px] text-muted-foreground">·</span>
                            <span className="text-[11px] text-muted-foreground truncate">{f.lead?.lead_name || 'Lead'}</span>
                            {!f.read_at && <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 font-medium">não lido</span>}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${sb ? BUCKET_COLOR[sb] : '#94a3b8'}22`, color: sb ? BUCKET_COLOR[sb] : '#94a3b8' }}><UserCheck className="h-2.5 w-2.5" /> Vendedor: {sb ? BUCKET_LABEL[sb] : '—'}</span>
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${ib ? BUCKET_COLOR[ib] : '#94a3b8'}22`, color: ib ? BUCKET_COLOR[ib] : '#94a3b8' }}><Bot className="h-2.5 w-2.5" /> IA: {ib ? BUCKET_LABEL[ib] : '—'}</span>
                            {divergem && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium">divergência</span>}
                          </div>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">{fmtDate(f.created_at)}</span>
                        <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`} />
                      </button>
                      {aberto && (
                        <div className="px-3 pb-3 pt-1 border-t border-border/40 space-y-2 text-xs">
                          {f.city && <p><span className="text-muted-foreground">Cidade: </span><span className="text-foreground">{f.city}</span></p>}
                          {f.reason && <p><span className="text-muted-foreground">Motivo: </span><span className="text-foreground">{f.reason}</span></p>}
                          {f.observations && <p><span className="text-muted-foreground">Observações: </span><span className="text-foreground whitespace-pre-wrap">{f.observations}</span></p>}
                          {f.content && <div className="rounded-lg bg-muted/30 p-2.5"><p className="text-[10px] text-muted-foreground mb-1">Feedback completo:</p><p className="text-foreground whitespace-pre-wrap">{f.content}</p></div>}
                          {!f.reason && !f.observations && !f.content && <p className="text-muted-foreground italic">Sem texto no feedback.</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ChartCard>
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
      <div className={`rounded-lg p-1.5 ${bg}`}><Icon className={`h-3.5 w-3.5 ${color} shrink-0`} /></div>
      <div className="min-w-0 flex-1">
        <p className={`${small ? 'text-sm truncate leading-tight' : 'text-xl'} font-bold text-foreground leading-none`}>{value}</p>
        <p className="text-[10px] text-muted-foreground truncate mt-0.5">{label}</p>
      </div>
    </div>
  );
}
function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-background/40 border border-border/40 rounded-xl p-3.5">
      <div className="mb-3"><p className="text-xs font-semibold text-foreground">{title}</p>{subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}</div>
      {children}
    </div>
  );
}
function EmptyChart({ text }: { text: string }) {
  return <div className="h-[120px] flex items-center justify-center text-muted-foreground text-xs">{text}</div>;
}
