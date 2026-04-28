import { useState, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  BarChart3, TrendingUp, TrendingDown, Minus, Calendar, Sparkles, LinkIcon,
  Brain, AlertTriangle, LineChart, Copy, Check, Loader2, FileText
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { useMetaInsights } from '@/hooks/useMetaInsights';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import { useMetaCampaigns } from '@/hooks/useMetaCampaigns';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { toast } from 'sonner';

// ── helpers ──────────────────────────────────────────────
const DATE_RANGES: Record<string, { label: string; days: number }> = {
  last_7d: { label: '7 dias', days: 7 },
  last_14d: { label: '14 dias', days: 14 },
  last_30d: { label: '30 dias', days: 30 },
};

function previousRange(days: number) {
  const end = new Date();
  end.setDate(end.getDate() - days);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return {
    since: start.toISOString().slice(0, 10),
    until: end.toISOString().slice(0, 10),
  };
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmtMoney = (v: number) => `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
const getAction = (actions: any[], type: string) => {
  if (!actions) return 0;
  return Number(actions.find((a: any) => a.action_type === type)?.value || 0);
};

const lowerIsBetter = new Set(['cpc', 'cpm']);

// ── component ────────────────────────────────────────────
export default function Analytics() {
  const [dateRange, setDateRange] = useState('last_30d');
  const [activeTab, setActiveTab] = useState('overview');
  const [viewMode, setViewMode] = useState<'simplified' | 'expert'>('simplified');
  const [aiDiagnostic, setAiDiagnostic] = useState('');
  const [aiAnomalies, setAiAnomalies] = useState('');
  const [aiTrends, setAiTrends] = useState('');
  const [manualData, setManualData] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const navigate = useNavigate();
  const { connectedAccount, isLoading: isLoadingConn } = useMetaConnection();
  const isConnected = !!connectedAccount;
  const days = DATE_RANGES[dateRange]?.days ?? 30;

  // ── data hooks ─────────────────────────────────────────
  const { data: accountData, isLoading: loadingAccount, error: errAccount } = useMetaInsights({
    accountId: connectedAccount?.account_id,
    datePreset: dateRange,
    fields: 'spend,impressions,clicks,ctr,cpc,cpm,actions,action_values,reach,frequency',
    enabled: isConnected,
  });

  const { data: prevAccountData } = useMetaInsights({
    accountId: connectedAccount?.account_id,
    timeRange: previousRange(days),
    fields: 'spend,impressions,clicks,ctr,cpc,cpm,reach,frequency',
    enabled: isConnected,
  });

  const { data: dailyData, isLoading: loadingDaily } = useMetaInsights({
    accountId: connectedAccount?.account_id,
    datePreset: dateRange,
    timeIncrement: '1',
    fields: 'spend,impressions,clicks,ctr,cpc,actions,action_values',
    enabled: isConnected,
  });

  const { data: campaignInsights, isLoading: loadingCampaigns, error: errCampaigns } = useMetaInsights({
    accountId: connectedAccount?.account_id,
    datePreset: dateRange,
    level: 'campaign',
    fields: 'campaign_name,campaign_id,spend,impressions,clicks,ctr,cpc,cpm,reach,actions,action_values',
    enabled: isConnected,
  });

  const { error: errCampaignsList } = useMetaCampaigns({ enabled: isConnected });

  // ── token expired detection ────────────────────────────
  const tokenExpired = [errAccount, errCampaigns, errCampaignsList].some(
    (e) => e && ((e as any)?.message?.includes('token') || (e as any)?.message?.includes('OAuthException'))
  );

  // ── AI hooks ───────────────────────────────────────────
  const diagnosticChat = useClaudeChat({
    context: 'insights',
    onDelta: (d) => setAiDiagnostic((prev) => prev + d),
  });
  const anomalyChat = useClaudeChat({
    context: 'insights',
    onDelta: (d) => setAiAnomalies((prev) => prev + d),
  });
  const trendsChat = useClaudeChat({
    context: 'insights',
    onDelta: (d) => setAiTrends((prev) => prev + d),
  });

  // ── parsed data ────────────────────────────────────────
  const raw = accountData?.data?.[0] || accountData?.[0];
  const prevRaw = prevAccountData?.data?.[0] || prevAccountData?.[0];

  const spend = Number(raw?.spend || 0);
  const impressions = Number(raw?.impressions || 0);
  const clicks = Number(raw?.clicks || 0);
  const ctr = Number(raw?.ctr || 0);
  const cpc = Number(raw?.cpc || 0);
  const cpm = Number(raw?.cpm || 0);
  const reach = Number(raw?.reach || 0);

  const calcChange = (curr: number, prev: number) => {
    if (!prev) return 0;
    return Math.round(((curr - prev) / prev) * 100);
  };

  const kpis = [
    { id: 'spend', label: 'Gasto Total', value: fmtMoney(spend), change: calcChange(spend, Number(prevRaw?.spend || 0)) },
    { id: 'impressions', label: 'Impressões', value: fmt(impressions), change: calcChange(impressions, Number(prevRaw?.impressions || 0)) },
    { id: 'clicks', label: 'Cliques', value: fmt(clicks), change: calcChange(clicks, Number(prevRaw?.clicks || 0)) },
    { id: 'ctr', label: 'CTR', value: `${ctr.toFixed(2)}%`, change: calcChange(ctr, Number(prevRaw?.ctr || 0)) },
    { id: 'cpc', label: 'CPC', value: fmtMoney(cpc), change: calcChange(cpc, Number(prevRaw?.cpc || 0)) },
    { id: 'cpm', label: 'CPM', value: fmtMoney(cpm), change: calcChange(cpm, Number(prevRaw?.cpm || 0)) },
    { id: 'reach', label: 'Alcance', value: fmt(reach), change: calcChange(reach, Number(prevRaw?.reach || 0)) },
  ];

  // ── chart data ─────────────────────────────────────────
  const dailyArr: any[] = Array.isArray(dailyData) ? dailyData
    : Array.isArray((dailyData as any)?.data) ? (dailyData as any).data
    : [];
  const chartData = dailyArr.map((d: any) => ({
    date: d.date_start || d.date_stop,
    gasto: Number(d.spend || 0),
    cliques: Number(d.clicks || 0),
    ctr: Number(d.ctr || 0),
    cpc: Number(d.cpc || 0),
    conversoes: getAction(d.actions, 'purchase'),
  }));

  // ── campaign rows ──────────────────────────────────────
  const campaignArr: any[] = Array.isArray(campaignInsights) ? campaignInsights
    : Array.isArray((campaignInsights as any)?.data) ? (campaignInsights as any).data
    : [];
  const campaignRows = campaignArr.map((c: any) => ({
    name: c.campaign_name || c.campaign_id,
    spend: Number(c.spend || 0),
    impressions: Number(c.impressions || 0),
    clicks: Number(c.clicks || 0),
    ctr: Number(c.ctr || 0),
    cpc: Number(c.cpc || 0),
    reach: Number(c.reach || 0),
  }));

  const getRank = (ctrVal: number) => {
    if (ctrVal >= 2) return { label: 'Ótimo', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
    if (ctrVal >= 1) return { label: 'Bom', color: 'bg-sky-500/20 text-sky-400 border-sky-500/30' };
    return { label: 'Baixo', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
  };

  // ── AI helpers ─────────────────────────────────────────
  const buildContext = () => {
    if (manualData.trim()) return manualData;
    return JSON.stringify({
      periodo: DATE_RANGES[dateRange]?.label,
      metricas_gerais: { spend, impressions, clicks, ctr, cpc, cpm, reach },
      campanhas: campaignRows.slice(0, 20),
      dados_diarios: chartData.slice(-14),
    });
  };

  const handleDiagnostic = useCallback(() => {
    setAiDiagnostic('');
    setAiAnomalies('');
    setAiTrends('');
    diagnosticChat.sendSingleMessage(
      `Você é um analista sênior de mídia paga. Analise estes dados de performance do Meta Ads e gere um diagnóstico completo em Markdown com: 1) Resumo executivo do período 2) Pontos fortes 3) Pontos fracos 4) Campanhas que precisam de atenção 5) Recomendações de otimização. Dados:\n\n${buildContext()}`
    );
  }, [diagnosticChat, manualData, spend, campaignRows, chartData, dateRange]);

  const handleAnomalies = useCallback(() => {
    setAiDiagnostic('');
    setAiAnomalies('');
    setAiTrends('');
    anomalyChat.sendSingleMessage(
      `Você é um analista de dados especialista em detecção de anomalias. Analise os dados diários abaixo e identifique: 1) Picos ou quedas anormais de spend/CTR/CPC 2) Dias com performance fora do padrão 3) Possível fadiga criativa 4) Padrões de dia da semana. Responda em Markdown formatado. Dados:\n\n${buildContext()}`
    );
  }, [anomalyChat, manualData, chartData, dateRange]);

  const handleTrends = useCallback(() => {
    setAiDiagnostic('');
    setAiAnomalies('');
    setAiTrends('');
    trendsChat.sendSingleMessage(
      `Você é um estrategista de mídia paga. Com base no histórico diário abaixo, projete: 1) Tendência de gasto para as próximas 2 semanas 2) Expectativa de CTR e CPC 3) Sugestões proativas de otimização 4) Riscos a monitorar. Responda em Markdown formatado. Dados:\n\n${buildContext()}`
    );
  }, [trendsChat, manualData, chartData, dateRange]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success('Copiado!');
    setTimeout(() => setCopiedField(null), 2000);
  };

  // ── disconnected state ─────────────────────────────────
  if (!isConnected && !isLoadingConn) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <LinkIcon className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Conecte seu Meta Ads</h2>
          <p className="text-muted-foreground text-center max-w-md">Para ver dados de analytics reais, conecte sua conta nas configurações.</p>
          <Button onClick={() => navigate('/settings')} className="gradient-primary">Ir para Configurações</Button>
        </div>
      </MainLayout>
    );
  }

  // ── render ─────────────────────────────────────────────
  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl">Analytics</h1>
            <p className="text-muted-foreground">Veja como suas campanhas estão performando</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Toggle Simplificado / Especialista */}
            <div className="flex h-9 overflow-hidden rounded-xl border border-border/60 bg-muted/30 text-xs">
              <button
                onClick={() => setViewMode('simplified')}
                className={`h-full px-3.5 font-medium transition-all ${viewMode === 'simplified' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                📊 Simplificado
              </button>
              <button
                onClick={() => setViewMode('expert')}
                className={`h-full px-3.5 font-medium transition-all ${viewMode === 'expert' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                ⚙️ Especialista
              </button>
            </div>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-36"><Calendar className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(DATE_RANGES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── MODO SIMPLIFICADO ── */}
        {viewMode === 'simplified' && (
          <div className="space-y-6">
            {/* 3 KPIs principais com interpretação */}
            <div className="grid gap-4 sm:grid-cols-3">
              {loadingAccount ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)
              ) : (
                [
                  {
                    emoji: '💰',
                    label: 'Quanto você investiu',
                    value: kpis.find(k => k.id === 'spend')?.value || '—',
                    change: kpis.find(k => k.id === 'spend')?.change || 0,
                    hint: spend > 0 ? 'Total gasto no período selecionado' : 'Conecte o Meta Ads para ver',
                    invert: false,
                  },
                  {
                    emoji: '👆',
                    label: 'Pessoas que clicaram',
                    value: kpis.find(k => k.id === 'clicks')?.value || '—',
                    change: kpis.find(k => k.id === 'clicks')?.change || 0,
                    hint: ctr >= 1.5 ? '✅ CTR acima de 1.5% — bom engajamento' : ctr >= 0.8 ? '⚠️ CTR entre 0.8–1.5% — pode melhorar' : ctr > 0 ? '🔴 CTR abaixo de 0.8% — criativos precisam de atenção' : 'Conecte o Meta Ads para ver',
                    invert: false,
                  },
                  {
                    emoji: '💵',
                    label: 'Custo por clique',
                    value: kpis.find(k => k.id === 'cpc')?.value || '—',
                    change: kpis.find(k => k.id === 'cpc')?.change || 0,
                    hint: cpc > 0 && cpc <= 1.5 ? '✅ CPC baixo — ótima eficiência' : cpc > 1.5 && cpc <= 3 ? '⚠️ CPC médio — monitorar' : cpc > 3 ? '🔴 CPC alto — otimize seu público' : 'Conecte o Meta Ads para ver',
                    invert: true,
                  },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-border/50 bg-card/60 p-5 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{item.emoji}</span>
                      <p className="text-xs text-muted-foreground font-medium">{item.label}</p>
                    </div>
                    <p className="text-3xl font-bold text-foreground">{item.value}</p>
                    {item.change !== 0 && (
                      <div className={`flex items-center gap-1 text-xs font-medium ${item.invert ? (item.change < 0 ? 'text-emerald-400' : 'text-red-400') : (item.change > 0 ? 'text-emerald-400' : 'text-red-400')}`}>
                        {item.change > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {item.change > 0 ? '+' : ''}{item.change}% vs período anterior
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground border-t border-border/40 pt-2 mt-2">{item.hint}</p>
                  </div>
                ))
              )}
            </div>

            {/* Resumo de campanhas */}
            {campaignRows.length > 0 && (
              <div className="rounded-xl border border-border/50 bg-card/50 p-5 space-y-3">
                <p className="text-sm font-semibold">🏆 Suas campanhas (do melhor ao pior CTR)</p>
                <div className="space-y-2">
                  {[...campaignRows].sort((a, b) => b.ctr - a.ctr).slice(0, 5).map((c, i) => {
                    const rank = getRank(c.ctr);
                    return (
                      <div key={i} className="flex items-center justify-between gap-4 rounded-lg border border-border/40 bg-background/50 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{fmtMoney(c.spend)} investido · {fmt(c.clicks)} cliques</p>
                        </div>
                        <Badge variant="outline" className={`text-xs shrink-0 ${rank.color}`}>{rank.label}</Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border/50 bg-card/50 p-4 text-center space-y-2">
              <p className="text-sm font-medium">Quer ver gráficos de tendência, comparação de campanhas e análise de IA?</p>
              <button
                onClick={() => setViewMode('expert')}
                className="mt-1 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
              >
                ⚙️ Abrir modo especialista
              </button>
            </div>
          </div>
        )}

        {/* ── MODO ESPECIALISTA ── */}
        {viewMode === 'expert' && (<>

        {/* Token expired warning */}
        {tokenExpired && (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <div className="flex-1">
                <p className="font-medium text-destructive">Token expirado</p>
                <p className="text-sm text-muted-foreground">Reconecte nas configurações ou use o modo manual na aba IA Insights.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate('/settings')}>Reconectar</Button>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview"><BarChart3 className="mr-2 h-4 w-4" />Visão Geral</TabsTrigger>
            <TabsTrigger value="campaigns"><FileText className="mr-2 h-4 w-4" />Por Campanha</TabsTrigger>
            <TabsTrigger value="ai"><Sparkles className="mr-2 h-4 w-4" />IA Insights</TabsTrigger>
          </TabsList>

          {/* ═══ TAB: Overview ═══ */}
          <TabsContent value="overview" className="space-y-6">
            {/* KPIs */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
              {loadingAccount ? (
                Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)
              ) : (
                kpis.map((kpi, index) => {
                  const isInverse = lowerIsBetter.has(kpi.id);
                  const isPos = kpi.change > 0;
                  const isNeg = kpi.change < 0;
                  const trendColor = isInverse
                    ? isNeg ? 'text-emerald-400' : isPos ? 'text-destructive' : 'text-muted-foreground'
                    : isPos ? 'text-emerald-400' : isNeg ? 'text-destructive' : 'text-muted-foreground';
                  const TrendIcon = isPos ? TrendingUp : isNeg ? TrendingDown : Minus;

                  return (
                    <motion.div key={kpi.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                      <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/30 transition-all">
                        <CardContent className="p-4">
                          <p className="text-xs text-muted-foreground">{kpi.label}</p>
                          <p className="text-xl font-bold">{kpi.value}</p>
                          {kpi.change !== 0 && (
                            <div className={`flex items-center gap-1 text-xs font-medium mt-1 ${trendColor}`}>
                              <TrendIcon className="h-3 w-3" />
                              <span>{isPos ? '+' : ''}{kpi.change}%</span>
                              <span className="text-muted-foreground ml-1">vs anterior</span>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })
              )}
            </div>

            {/* Chart */}
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader><CardTitle className="text-lg">Performance ao Longo do Tempo</CardTitle></CardHeader>
              <CardContent>
                {loadingDaily ? <Skeleton className="h-80 w-full" /> : (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="colorGasto" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorCliques" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                        <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))' }}
                          tickFormatter={(v) => new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} />
                        <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                        <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                        <Legend />
                        <Area type="monotone" dataKey="gasto" name="Gasto (R$)" stroke="hsl(var(--primary))" fill="url(#colorGasto)" />
                        <Area type="monotone" dataKey="cliques" name="Cliques" stroke="#8B5CF6" fill="url(#colorCliques)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ TAB: Campaigns ═══ */}
          <TabsContent value="campaigns" className="space-y-4">
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg">Performance por Campanha</CardTitle>
                <CardDescription>Métricas detalhadas de cada campanha no período selecionado</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingCampaigns ? <Skeleton className="h-64 w-full" /> : campaignRows.length === 0 ? (
                  <p className="text-center text-muted-foreground py-12">Nenhuma campanha encontrada no período.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Campanha</TableHead>
                          <TableHead className="text-right">Gasto</TableHead>
                          <TableHead className="text-right">Impressões</TableHead>
                          <TableHead className="text-right">Cliques</TableHead>
                          <TableHead className="text-right">CTR</TableHead>
                          <TableHead className="text-right">CPC</TableHead>
                          <TableHead className="text-right">Alcance</TableHead>
                          <TableHead className="text-center">Ranking</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {campaignRows.map((c: any, i: number) => {
                          const rank = getRank(c.ctr);
                          return (
                            <TableRow key={i}>
                              <TableCell className="font-medium max-w-[200px] truncate">{c.name}</TableCell>
                              <TableCell className="text-right">{fmtMoney(c.spend)}</TableCell>
                              <TableCell className="text-right">{fmt(c.impressions)}</TableCell>
                              <TableCell className="text-right">{fmt(c.clicks)}</TableCell>
                              <TableCell className="text-right">{c.ctr.toFixed(2)}%</TableCell>
                              <TableCell className="text-right">{fmtMoney(c.cpc)}</TableCell>
                              <TableCell className="text-right">{fmt(c.reach)}</TableCell>
                              <TableCell className="text-center">
                                <Badge variant="outline" className={rank.color}>{rank.label}</Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ TAB: AI Insights ═══ */}
          <TabsContent value="ai" className="space-y-6">
            {/* Manual fallback */}
            {(tokenExpired || (!isConnected && !isLoadingConn) || campaignRows.length === 0) && (
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2"><FileText className="h-5 w-5" /> Modo Manual</CardTitle>
                  <CardDescription>Cole suas métricas abaixo para analisar com IA mesmo sem conexão.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    placeholder="Cole aqui os dados das suas campanhas (ex: nome, spend, CTR, CPC, impressões...)"
                    value={manualData}
                    onChange={(e) => setManualData(e.target.value)}
                    className="min-h-[120px] bg-background/50"
                  />
                </CardContent>
              </Card>
            )}

            {/* AI action cards */}
            <div className="grid gap-4 md:grid-cols-3">
              {/* Diagnostic */}
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/30 transition-all">
                <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                    <Brain className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold">Diagnóstico de Performance</h3>
                  <p className="text-sm text-muted-foreground">Resumo executivo, pontos fortes/fracos e recomendações.</p>
                  <Button onClick={handleDiagnostic} disabled={diagnosticChat.isLoading} className="w-full mt-2">
                    {diagnosticChat.isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analisando...</> : 'Analisar Performance'}
                  </Button>
                </CardContent>
              </Card>

              {/* Anomalies */}
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/30 transition-all">
                <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
                    <AlertTriangle className="h-6 w-6 text-amber-400" />
                  </div>
                  <h3 className="font-semibold">Detecção de Anomalias</h3>
                  <p className="text-sm text-muted-foreground">Identifica picos, quedas e fadiga criativa.</p>
                  <Button onClick={handleAnomalies} disabled={anomalyChat.isLoading} variant="outline" className="w-full mt-2">
                    {anomalyChat.isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Detectando...</> : 'Detectar Anomalias'}
                  </Button>
                </CardContent>
              </Card>

              {/* Trends */}
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/30 transition-all">
                <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10">
                    <LineChart className="h-6 w-6 text-emerald-400" />
                  </div>
                  <h3 className="font-semibold">Previsão de Tendências</h3>
                  <p className="text-sm text-muted-foreground">Projeta performance futura e sugere ações proativas.</p>
                  <Button onClick={handleTrends} disabled={trendsChat.isLoading} variant="outline" className="w-full mt-2">
                    {trendsChat.isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Projetando...</> : 'Prever Tendências'}
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* AI Results */}
            {[
              { key: 'diagnostic', title: 'Diagnóstico de Performance', content: aiDiagnostic, icon: Brain },
              { key: 'anomalies', title: 'Detecção de Anomalias', content: aiAnomalies, icon: AlertTriangle },
              { key: 'trends', title: 'Previsão de Tendências', content: aiTrends, icon: LineChart },
            ].map(({ key, title, content, icon: Icon }) => content ? (
              <motion.div key={key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                  <CardHeader className="flex-row items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-5 w-5 text-primary" />
                      <CardTitle className="text-lg">{title}</CardTitle>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => copyToClipboard(content, key)}>
                      {copiedField === key ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <MarkdownRenderer content={content} />
                  </CardContent>
                </Card>
              </motion.div>
            ) : null)}
          </TabsContent>
        </Tabs>
        </>)}
      </div>
    </MainLayout>
  );
}
