import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  Activity, Users, ThumbsUp, AlertTriangle, Clock, TrendingUp, TrendingDown,
  CheckCircle2, MessageCircle, Phone, Bot, ChevronRight, Star, RefreshCw,
  Download, Zap, Target, Shield, Smile, Frown, Meh,
} from 'lucide-react';

// ─── Configurações de Status ──────────────────────────────────────────────────

const STATUS_CFG = {
  online:    { dot: 'bg-emerald-500', badge: 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400', label: 'Online' },
  atendendo: { dot: 'bg-blue-500 animate-pulse', badge: 'bg-blue-500/15 border-blue-500/25 text-blue-400', label: 'Em Atendimento' },
  pausa:     { dot: 'bg-amber-500', badge: 'bg-amber-500/15 border-amber-500/25 text-amber-400', label: 'Em Pausa' },
  offline:   { dot: 'bg-muted-foreground/30', badge: 'bg-muted/30 border-border/30 text-muted-foreground', label: 'Offline' },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function csatCfg(s: number) {
  if (s >= 4.5) return { color: 'text-emerald-400', bar: 'bg-emerald-500', bg: 'bg-emerald-500/10', label: 'Excelente' };
  if (s >= 4.0) return { color: 'text-blue-400',    bar: 'bg-blue-500',    bg: 'bg-blue-500/10',    label: 'Bom' };
  if (s >= 3.5) return { color: 'text-amber-400',   bar: 'bg-amber-500',   bg: 'bg-amber-500/10',   label: 'Regular' };
  return              { color: 'text-red-400',      bar: 'bg-red-500',     bg: 'bg-red-500/10',     label: 'Crítico' };
}
function tmaCfg(t: number) {
  if (t < 5)  return { color: 'text-emerald-400', label: 'Rápido' };
  if (t < 7)  return { color: 'text-blue-400',    label: 'Normal' };
  if (t < 10) return { color: 'text-amber-400',   label: 'Lento' };
  return            { color: 'text-red-400',      label: 'Crítico' };
}
function heatCls(v: number, mx: number) {
  const r = v / mx;
  if (r >= 0.85) return 'bg-indigo-500 text-white';
  if (r >= 0.65) return 'bg-indigo-500/70 text-white';
  if (r >= 0.45) return 'bg-indigo-500/45 text-foreground';
  if (r >= 0.25) return 'bg-indigo-500/25 text-muted-foreground';
  return 'bg-indigo-500/10 text-muted-foreground/60';
}
function flowCls(c: number) {
  if (c >= 85) return { ring: 'border-emerald-500/30 bg-emerald-500/5', badge: 'bg-emerald-500/15 text-emerald-400', icon: CheckCircle2, iconColor: 'text-emerald-400' };
  if (c >= 70) return { ring: 'border-blue-500/30 bg-blue-500/5',       badge: 'bg-blue-500/15 text-blue-400',       icon: Target,        iconColor: 'text-blue-400' };
  return             { ring: 'border-red-500/30 bg-red-500/5',           badge: 'bg-red-500/15 text-red-400',         icon: AlertTriangle,  iconColor: 'text-red-400' };
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const AGENTS = [
  { id: '1', name: 'Ana Silva',      status: 'online',    atendimentos: 47, tma: 4.2, fcr: 87, csat: 4.8, queue: 3  },
  { id: '2', name: 'Beatriz Costa',  status: 'pausa',     atendimentos: 28, tma: 3.9, fcr: 92, csat: 4.9, queue: 0  },
  { id: '3', name: 'Fernanda Lima',  status: 'online',    atendimentos: 39, tma: 5.1, fcr: 79, csat: 4.4, queue: 2  },
  { id: '4', name: 'Carlos Melo',    status: 'atendendo', atendimentos: 31, tma: 6.8, fcr: 71, csat: 4.1, queue: 1  },
  { id: '5', name: 'Diego Pereira',  status: 'offline',   atendimentos: 22, tma: 8.1, fcr: 65, csat: 3.7, queue: 0  },
] as const;

const FLOWS = [
  { id: '1', name: 'Suporte Técnico',       type: 'suporte',     completion: 88, abandonment: 12, avgTime: 12.1, volume: 89  },
  { id: '2', name: 'Cobrança e Renovação',  type: 'financeiro',  completion: 82, abandonment: 18, avgTime: 6.7,  volume: 67  },
  { id: '3', name: 'Vendas Ativas',         type: 'vendas',      completion: 73, abandonment: 27, avgTime: 8.4,  volume: 142 },
  { id: '4', name: 'Onboarding Cliente',    type: 'onboarding',  completion: 61, abandonment: 39, avgTime: 22.5, volume: 34  },
];

const TREND_DATA = [
  { day: 'Seg', atendimentos: 298, resolvidos: 241 },
  { day: 'Ter', atendimentos: 321, resolvidos: 268 },
  { day: 'Qua', atendimentos: 289, resolvidos: 243 },
  { day: 'Qui', atendimentos: 356, resolvidos: 297 },
  { day: 'Sex', atendimentos: 412, resolvidos: 348 },
  { day: 'Sáb', atendimentos: 187, resolvidos: 162 },
  { day: 'Dom', atendimentos: 347, resolvidos: 289 },
];

const CHANNEL_DATA = [
  { name: 'WhatsApp', value: 236, color: '#22c55e' },
  { name: 'Chatbot',  value: 76,  color: '#6366f1' },
  { name: 'Telefone', value: 35,  color: '#f59e0b' },
];

const CSAT_CHART = [
  { name: 'Beatriz', csat: 4.9, fill: '#22c55e' },
  { name: 'Ana',     csat: 4.8, fill: '#22c55e' },
  { name: 'Fernanda',csat: 4.4, fill: '#6366f1' },
  { name: 'Carlos',  csat: 4.1, fill: '#f59e0b' },
  { name: 'Diego',   csat: 3.7, fill: '#ef4444' },
];

const HEATMAP_HOURS = ['8h','9h','10h','11h','12h','13h','14h','15h','16h','17h','18h'];
const HEATMAP_DAYS  = ['Seg','Ter','Qua','Qui','Sex'];
const HEATMAP_DATA  = [
  [12, 31, 48, 42, 24, 18, 38, 52, 44, 29, 14],
  [9,  28, 44, 38, 21, 16, 35, 49, 41, 27, 12],
  [11, 34, 51, 46, 26, 20, 41, 56, 47, 32, 16],
  [14, 38, 55, 49, 28, 22, 44, 61, 52, 36, 18],
  [16, 41, 58, 52, 31, 25, 47, 65, 55, 38, 20],
];
const HEATMAP_MAX = 65;

const TOPICS = [
  { label: 'Dúvida sobre produto', count: 89 },
  { label: 'Problema técnico',     count: 67 },
  { label: 'Elogio',               count: 45 },
  { label: 'Pagamento',            count: 34 },
  { label: 'Cancelamento',         count: 23 },
  { label: 'Reembolso',            count: 18 },
  { label: 'Upgrade de plano',     count: 14 },
  { label: 'Onboarding',           count: 11 },
];

const POSITIVE_COMMENTS = [
  '"Atendimento super rápido e resolutivo! Valeu muito." — Cliente #1842',
  '"Beatriz me ajudou muito, problema resolvido em minutos." — Cliente #2031',
  '"Melhor suporte que já tive, parabéns à equipe!" — Cliente #1769',
];

const CORRECTIONS = [
  { agent: 'Diego Pereira',     issue: 'TMA 8.1 min (acima da meta de 6 min)',       action: 'Recomendar treinamento em resolução rápida' },
  { agent: 'Fluxo Onboarding',  issue: '39% de abandono — acima do limite de 20%',  action: 'Revisar etapa 3 do fluxo (mais de 22 min)' },
  { agent: 'Carlos Melo',       issue: 'FCR 71% — abaixo da meta de 80%',            action: 'Sessão de shadowing com Ana Silva' },
];

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function SupportDashboard() {
  const [viewMode, setViewMode] = useState<'simplified' | 'expert'>('simplified');
  const [period,   setPeriod]   = useState('hoje');
  const [channel,  setChannel]  = useState('todos');

  const totalAtendimentos = AGENTS.reduce((s, a) => s + a.atendimentos, 0); // 167
  const csatMedio = (AGENTS.reduce((s, a) => s + a.csat * a.atendimentos, 0) / totalAtendimentos).toFixed(1);
  const onlineCount = AGENTS.filter(a => a.status === 'online' || a.status === 'atendendo').length;
  const alertCount  = FLOWS.filter(f => f.completion < 70).length + AGENTS.filter(a => a.csat < 4.0).length;

  const bestAgent  = [...AGENTS].sort((a, b) => b.csat - a.csat)[0];
  const worstAgent = [...AGENTS].sort((a, b) => a.csat - b.csat)[0];
  const bestFlow   = [...FLOWS].sort((a, b) => b.completion - a.completion)[0];
  const worstFlow  = [...FLOWS].sort((a, b) => a.completion - b.completion)[0];

  const tooltipStyle = {
    contentStyle: { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 },
    labelStyle: { color: 'hsl(var(--foreground))' },
  };

  return (
    <MainLayout>
      <div className="space-y-5">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card p-5 sm:p-6">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-purple-500/5 to-transparent" />
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-indigo-500/6 blur-3xl" />

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="relative shrink-0">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/20 to-purple-600/20 shadow-lg shadow-indigo-500/10">
                  <Activity className="h-6 w-6 text-indigo-400" />
                </div>
                <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-background bg-emerald-500">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                </span>
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Performance 360°</h1>
                  <Badge variant="outline" className="gap-1 border-indigo-500/30 text-[10px] text-indigo-400">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
                    Ao Vivo
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground sm:text-sm">Suporte & Atendimento — Visão Completa da Operação</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Período (ambos os modos) */}
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="h-9 w-36 rounded-xl text-xs bg-muted/30 border-border/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hoje">Hoje</SelectItem>
                  <SelectItem value="ontem">Ontem</SelectItem>
                  <SelectItem value="semana">Última Semana</SelectItem>
                  <SelectItem value="mes">Último Mês</SelectItem>
                </SelectContent>
              </Select>

              {/* Mode switcher */}
              <div className="flex h-9 overflow-hidden rounded-xl border border-border/60 bg-muted/30 text-xs">
                <button onClick={() => setViewMode('simplified')}
                  className={`h-full px-3.5 font-medium transition-all ${viewMode === 'simplified' ? 'bg-indigo-500 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
                  📊 Simplificado
                </button>
                <button onClick={() => setViewMode('expert')}
                  className={`h-full px-3.5 font-medium transition-all ${viewMode === 'expert' ? 'bg-indigo-500 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
                  ⚙️ Especialista
                </button>
              </div>

              <Button variant="ghost" size="sm" className="h-9 gap-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground">
                <RefreshCw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Atualizar</span>
              </Button>
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            MODO SIMPLIFICADO
        ══════════════════════════════════════════════════════════════════════ */}
        {viewMode === 'simplified' && (
          <div className="space-y-5">

            {/* KPIs principais */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {/* Total Atendimentos */}
              <Card className="border-border/60">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Total de Atendimentos</p>
                      <p className="mt-1 text-3xl font-bold text-foreground">{totalAtendimentos}</p>
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-400">
                        <TrendingUp className="h-3 w-3" /> +12% vs ontem
                      </p>
                    </div>
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                      <Users className="h-5 w-5 text-indigo-400" />
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* CSAT Médio */}
              <Card className={`border-${parseFloat(csatMedio) >= 4.5 ? 'emerald' : parseFloat(csatMedio) >= 4.0 ? 'blue' : 'amber'}-500/25`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Satisfação Geral (CSAT)</p>
                      <p className={`mt-1 text-3xl font-bold ${csatCfg(parseFloat(csatMedio)).color}`}>{csatMedio}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">de 5.0 — {csatCfg(parseFloat(csatMedio)).label}</p>
                    </div>
                    <span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${csatCfg(parseFloat(csatMedio)).bg} border-current/20`}>
                      <ThumbsUp className={`h-5 w-5 ${csatCfg(parseFloat(csatMedio)).color}`} />
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Agentes Online */}
              <Card className="border-border/60">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Agentes Online</p>
                      <p className="mt-1 text-3xl font-bold text-foreground">{onlineCount}<span className="text-lg text-muted-foreground">/{AGENTS.length}</span></p>
                      <div className="mt-1.5 flex gap-1">
                        {AGENTS.map(a => (
                          <span key={a.id} className={`h-2 w-2 rounded-full ${STATUS_CFG[a.status].dot}`} title={a.name} />
                        ))}
                      </div>
                    </div>
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                      <Zap className="h-5 w-5 text-emerald-400" />
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Alertas */}
              <Card className={`border-${alertCount > 0 ? 'red-500/30' : 'emerald-500/30'}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Alertas Críticos</p>
                      <p className={`mt-1 text-3xl font-bold ${alertCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{alertCount}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{alertCount > 0 ? 'Requerem atenção' : 'Tudo sob controle'}</p>
                    </div>
                    <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${alertCount > 0 ? 'bg-red-500/10 border border-red-500/20' : 'bg-emerald-500/10 border border-emerald-500/20'}`}>
                      {alertCount > 0
                        ? <AlertTriangle className="h-5 w-5 text-red-400" />
                        : <CheckCircle2 className="h-5 w-5 text-emerald-400" />}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Agentes Agora */}
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                Equipe Agora
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {AGENTS.map(agent => {
                  const cfg = STATUS_CFG[agent.status];
                  const cc  = csatCfg(agent.csat);
                  return (
                    <Card key={agent.id} className="border-border/50 transition-shadow hover:shadow-sm">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 text-xs font-bold text-indigo-300">
                              {agent.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                            </div>
                            <span className="text-xs font-semibold text-foreground leading-tight">{agent.name.split(' ')[0]}</span>
                          </div>
                          <Badge variant="outline" className={`text-[9px] border ${cfg.badge}`}>
                            <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-1 text-center">
                          <div>
                            <p className="text-[10px] text-muted-foreground">Atend.</p>
                            <p className="text-sm font-bold text-foreground">{agent.atendimentos}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground">TMA</p>
                            <p className={`text-sm font-bold ${tmaCfg(agent.tma).color}`}>{agent.tma}m</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground">CSAT</p>
                            <p className={`text-sm font-bold ${cc.color}`}>{agent.csat}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* Destaques + Pontos de Atenção */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

              {/* 🏆 Destaques */}
              <div className="space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Star className="h-4 w-4 text-amber-400 fill-amber-400" /> Destaques Positivos
                </h2>

                {/* Melhor Agente */}
                <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-transparent">
                  <CardContent className="p-4 flex items-start gap-3">
                    <span className="text-2xl mt-0.5">🥇</span>
                    <div className="flex-1">
                      <p className="text-xs text-emerald-400 font-semibold uppercase tracking-wider">Melhor Agente</p>
                      <p className="text-sm font-bold text-foreground mt-0.5">{bestAgent.name}</p>
                      <div className="flex gap-3 mt-1.5 flex-wrap">
                        <span className="text-[11px] text-muted-foreground">CSAT <span className="font-bold text-emerald-400">{bestAgent.csat}</span></span>
                        <span className="text-[11px] text-muted-foreground">FCR <span className="font-bold text-emerald-400">{bestAgent.fcr}%</span></span>
                        <span className="text-[11px] text-muted-foreground">TMA <span className="font-bold text-emerald-400">{bestAgent.tma}m</span></span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Melhor Fluxo */}
                <Card className="border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-transparent">
                  <CardContent className="p-4 flex items-start gap-3">
                    <span className="text-2xl mt-0.5">🔁</span>
                    <div className="flex-1">
                      <p className="text-xs text-blue-400 font-semibold uppercase tracking-wider">Fluxo Mais Eficiente</p>
                      <p className="text-sm font-bold text-foreground mt-0.5">{bestFlow.name}</p>
                      <div className="flex gap-3 mt-1.5">
                        <span className="text-[11px] text-muted-foreground">Conclusão <span className="font-bold text-blue-400">{bestFlow.completion}%</span></span>
                        <span className="text-[11px] text-muted-foreground">Volume <span className="font-bold text-blue-400">{bestFlow.volume} atend.</span></span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Comentário positivo */}
                <Card className="border-border/40 bg-card/50">
                  <CardContent className="p-4 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Smile className="h-3.5 w-3.5 text-emerald-400" /> Clientes Satisfeitos
                    </p>
                    <p className="text-sm text-foreground italic leading-relaxed">{POSITIVE_COMMENTS[0]}</p>
                  </CardContent>
                </Card>
              </div>

              {/* ⚠️ Pontos de Atenção */}
              <div className="space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <AlertTriangle className="h-4 w-4 text-amber-400" /> Pontos de Melhoria
                </h2>
                {CORRECTIONS.map((c, i) => (
                  <Card key={i} className="border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-foreground">{c.agent}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{c.issue}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2 rounded-lg bg-muted/30 px-3 py-2">
                        <ChevronRight className="h-3.5 w-3.5 text-indigo-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground">{c.action}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            MODO ESPECIALISTA
        ══════════════════════════════════════════════════════════════════════ */}
        {viewMode === 'expert' && (
          <div className="space-y-5">

            {/* Filtros avançados */}
            <Card className="border-border/60">
              <CardContent className="p-4 flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filtros:</span>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger className="h-8 w-36 rounded-lg text-xs"><SelectValue placeholder="Canal" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os canais</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="chatbot">Chatbot</SelectItem>
                    <SelectItem value="telefone">Telefone</SelectItem>
                  </SelectContent>
                </Select>
                <Select defaultValue="todos">
                  <SelectTrigger className="h-8 w-36 rounded-lg text-xs"><SelectValue placeholder="Agente" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os agentes</SelectItem>
                    {AGENTS.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select defaultValue="todos">
                  <SelectTrigger className="h-8 w-40 rounded-lg text-xs"><SelectValue placeholder="Fluxo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os fluxos</SelectItem>
                    {FLOWS.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs ml-auto rounded-lg">
                  <Download className="h-3.5 w-3.5" />Exportar
                </Button>
              </CardContent>
            </Card>

            {/* Métricas resumidas */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: 'Atendimentos',  value: `${totalAtendimentos}`,  icon: Users,       color: 'text-indigo-400' },
                { label: 'CSAT Médio',    value: `${csatMedio}/5`,        icon: ThumbsUp,    color: 'text-emerald-400' },
                { label: 'Online/Total',  value: `${onlineCount}/${AGENTS.length}`, icon: Zap, color: 'text-blue-400' },
                { label: 'TMA Geral',     value: '5.2 min',               icon: Clock,       color: 'text-amber-400' },
                { label: 'FCR Geral',     value: '79%',                   icon: Target,      color: 'text-purple-400' },
                { label: 'Alertas',       value: `${alertCount}`,         icon: AlertTriangle, color: alertCount > 0 ? 'text-red-400' : 'text-emerald-400' },
              ].map(m => (
                <Card key={m.label} className="border-border/50">
                  <CardContent className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{m.label}</p>
                      <m.icon className={`h-3.5 w-3.5 ${m.color}`} />
                    </div>
                    <p className={`text-lg font-bold ${m.color}`}>{m.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Tendência + Canais */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              {/* Gráfico de Tendência — 7 dias */}
              <Card className="border-border/60 lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-indigo-400" />
                    Tendência — Últimos 7 Dias
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={TREND_DATA} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                      <Tooltip {...tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="atendimentos" name="Atendimentos" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="resolvidos"   name="Resolvidos"   stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 2" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Canais */}
              <Card className="border-border/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-indigo-400" />
                    Distribuição por Canal
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-3">
                  <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie data={CHANNEL_DATA} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={3} dataKey="value">
                        {CHANNEL_DATA.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip {...tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="w-full space-y-1.5">
                    {CHANNEL_DATA.map(c => (
                      <div key={c.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                          <span className="text-muted-foreground">{c.name}</span>
                        </div>
                        <span className="font-semibold text-foreground">{Math.round(c.value / CHANNEL_DATA.reduce((s,x) => s + x.value, 0) * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* CSAT por Agente */}
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ThumbsUp className="h-4 w-4 text-indigo-400" />
                  CSAT por Agente
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={CSAT_CHART} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis domain={[3, 5]} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip {...tooltipStyle} formatter={(v: any) => [`${v}/5`, 'CSAT']} />
                    <Bar dataKey="csat" radius={[4, 4, 0, 0]}>
                      {CSAT_CHART.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Tabela de Agentes */}
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4 text-indigo-400" />
                  Métricas Detalhadas por Agente
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/50 bg-muted/20">
                        {['Agente','Status','Atend.','TMA','FCR','CSAT','Fila'].map(h => (
                          <th key={h} className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {AGENTS.map((a, i) => {
                        const sc = csatCfg(a.csat);
                        const tc = tmaCfg(a.tma);
                        const cfg = STATUS_CFG[a.status];
                        return (
                          <tr key={a.id} className={`border-b border-border/30 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? '' : 'bg-muted/10'}`}>
                            <td className="px-4 py-3 font-medium text-foreground">{a.name}</td>
                            <td className="px-4 py-3">
                              <Badge variant="outline" className={`text-[9px] border ${cfg.badge}`}>
                                <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${cfg.dot}`} />{cfg.label}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 font-mono font-semibold text-foreground">{a.atendimentos}</td>
                            <td className={`px-4 py-3 font-mono font-semibold ${tc.color}`}>{a.tma}m <span className="text-[9px] opacity-70">({tc.label})</span></td>
                            <td className={`px-4 py-3 font-mono font-semibold ${a.fcr >= 80 ? 'text-emerald-400' : a.fcr >= 70 ? 'text-amber-400' : 'text-red-400'}`}>{a.fcr}%</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className={`font-mono font-bold ${sc.color}`}>{a.csat}</span>
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted/50">
                                  <div className={`h-full rounded-full ${sc.bar}`} style={{ width: `${(a.csat / 5) * 100}%` }} />
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 font-mono text-foreground">{a.queue}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Fluxos */}
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Zap className="h-4 w-4 text-indigo-400" />
                Performance dos Fluxos de Atendimento
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {FLOWS.map(f => {
                  const fc = flowCls(f.completion);
                  const Icon = fc.icon;
                  return (
                    <Card key={f.id} className={`border ${fc.ring}`}>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-foreground leading-snug">{f.name}</p>
                          <Icon className={`h-4 w-4 shrink-0 ${fc.iconColor}`} />
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Conclusão</span>
                            <span className={`font-bold ${fc.iconColor}`}>{f.completion}%</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
                            <div className={`h-full rounded-full ${f.completion >= 85 ? 'bg-emerald-500' : f.completion >= 70 ? 'bg-blue-500' : 'bg-red-500'}`} style={{ width: `${f.completion}%` }} />
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-1 text-center text-[10px]">
                          <div>
                            <p className="text-muted-foreground">Volume</p>
                            <p className="font-semibold text-foreground">{f.volume}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Abandono</p>
                            <p className={`font-semibold ${f.abandonment > 25 ? 'text-red-400' : 'text-muted-foreground'}`}>{f.abandonment}%</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">T. Médio</p>
                            <p className="font-semibold text-foreground">{f.avgTime}m</p>
                          </div>
                        </div>
                        <Badge variant="outline" className={`w-full justify-center text-[9px] ${fc.badge}`}>
                          {f.type.charAt(0).toUpperCase() + f.type.slice(1)}
                        </Badge>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* Mapa de Calor + Sentimento */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">

              {/* Mapa de Calor — Volume por Hora */}
              <Card className="border-border/60 lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="h-4 w-4 text-indigo-400" />
                    Volume por Hora (Mapa de Calor)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <div className="min-w-[480px]">
                      {/* Header horas */}
                      <div className="mb-1 grid pl-8" style={{ gridTemplateColumns: `repeat(${HEATMAP_HOURS.length}, 1fr)` }}>
                        {HEATMAP_HOURS.map(h => (
                          <span key={h} className="text-center text-[9px] text-muted-foreground">{h}</span>
                        ))}
                      </div>
                      {/* Linhas dias */}
                      {HEATMAP_DATA.map((row, di) => (
                        <div key={di} className="mb-1 flex items-center gap-1">
                          <span className="w-7 shrink-0 text-[10px] font-medium text-muted-foreground">{HEATMAP_DAYS[di]}</span>
                          <div className="flex flex-1 gap-0.5">
                            {row.map((val, hi) => (
                              <div key={hi} title={`${HEATMAP_DAYS[di]} ${HEATMAP_HOURS[hi]}: ${val} atend.`}
                                className={`h-7 flex-1 rounded-sm flex items-center justify-center text-[9px] font-medium cursor-default transition-all hover:scale-105 ${heatCls(val, HEATMAP_MAX)}`}>
                                {val}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {/* Legenda */}
                      <div className="mt-2 flex items-center gap-1.5 pl-8">
                        <span className="text-[9px] text-muted-foreground">Menos</span>
                        {['bg-indigo-500/10','bg-indigo-500/25','bg-indigo-500/45','bg-indigo-500/70','bg-indigo-500'].map((c,i) => (
                          <div key={i} className={`h-3.5 w-6 rounded-sm ${c}`} />
                        ))}
                        <span className="text-[9px] text-muted-foreground">Mais</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Sentimento + Tópicos */}
              <Card className="border-border/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Meh className="h-4 w-4 text-indigo-400" />
                    Sentimento & Tópicos
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Sentimento */}
                  <div className="space-y-2">
                    {[
                      { icon: Smile, label: 'Positivo', pct: 64, color: 'bg-emerald-500', text: 'text-emerald-400' },
                      { icon: Meh,   label: 'Neutro',   pct: 24, color: 'bg-blue-500',    text: 'text-blue-400' },
                      { icon: Frown, label: 'Negativo', pct: 12, color: 'bg-red-500',      text: 'text-red-400' },
                    ].map(s => (
                      <div key={s.label} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <s.icon className={`h-3.5 w-3.5 ${s.text}`} />
                            <span className="text-muted-foreground">{s.label}</span>
                          </div>
                          <span className={`font-bold ${s.text}`}>{s.pct}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
                          <div className={`h-full rounded-full ${s.color}`} style={{ width: `${s.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-border/30 pt-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Principais Tópicos</p>
                    <div className="flex flex-wrap gap-1.5">
                      {TOPICS.map(t => (
                        <Badge key={t.label} variant="outline" className="text-[10px] gap-1">
                          {t.label}
                          <span className="font-bold text-indigo-400">{t.count}</span>
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

          </div>
        )}
      </div>
    </MainLayout>
  );
}
