import { useState, useMemo, useCallback, useRef } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DollarSign, TrendingUp, Sparkles, LinkIcon, ArrowRight, Copy, AlertTriangle,
  BarChart3, Zap, Eye, MousePointerClick, RefreshCw, Link2Off, Settings,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { motion } from 'framer-motion';
import { useMetaCampaigns } from '@/hooks/useMetaCampaigns';
import { useMetaInsights } from '@/hooks/useMetaInsights';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';

const COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4', '#84CC16'];

const fmtCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtBudget = (cents: number | string | undefined) => cents ? fmtCurrency(Number(cents) / 100) : 'N/A';
const fmtNum = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : n.toLocaleString('pt-BR');

export default function BudgetAllocator() {
  const { connectedAccount, isLoading: isLoadingConn } = useMetaConnection();
  const isConnected = !!connectedAccount;
  const { campaigns, isLoading, updateCampaignBudget } = useMetaCampaigns({ enabled: isConnected });
  const navigate = useNavigate();
  const { toast } = useToast();

  const { data: insightsData, isLoading: isLoadingInsights } = useMetaInsights({
    accountId: connectedAccount?.account_id,
    level: 'campaign',
    fields: 'campaign_name,campaign_id,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency',
    enabled: isConnected,
  });

  // AI states
  const [aiRecommendation, setAiRecommendation] = useState('');
  const [aiImpact, setAiImpact] = useState('');
  const [aiEfficiency, setAiEfficiency] = useState('');
  const [manualData, setManualData] = useState('');
  const aiRecRef = useRef('');
  const aiImpactRef = useRef('');
  const aiEffRef = useRef('');

  const { sendSingleMessage: sendOptimize, isLoading: isOptimizing } = useClaudeChat({
    context: 'optimizer',
    onDelta: (d) => { aiRecRef.current += d; setAiRecommendation(aiRecRef.current); },
  });
  const { sendSingleMessage: sendImpact, isLoading: isPredicting } = useClaudeChat({
    context: 'optimizer',
    onDelta: (d) => { aiImpactRef.current += d; setAiImpact(aiImpactRef.current); },
  });
  const { sendSingleMessage: sendEfficiency, isLoading: isAnalyzing } = useClaudeChat({
    context: 'optimizer',
    onDelta: (d) => { aiEffRef.current += d; setAiEfficiency(aiEffRef.current); },
  });

  // Slider state
  const [budgetSliders, setBudgetSliders] = useState<Record<string, number>>({});

  const activeCampaigns = useMemo(
    () => campaigns.filter((c: any) => c.effective_status === 'ACTIVE' && c.daily_budget),
    [campaigns]
  );

  const insightsMap = useMemo(() => {
    const map: Record<string, any> = {};
    const rows = insightsData?.data || [];
    rows.forEach((r: any) => { if (r.campaign_id) map[r.campaign_id] = r; });
    return map;
  }, [insightsData]);

  const enriched = useMemo(() =>
    activeCampaigns.map((c: any) => ({
      ...c,
      budgetValue: Number(c.daily_budget) / 100,
      metrics: insightsMap[c.id] || null,
    })),
    [activeCampaigns, insightsMap]
  );

  const totalBudget = useMemo(() => enriched.reduce((s, c) => s + c.budgetValue, 0), [enriched]);

  // Init sliders when campaigns load
  useMemo(() => {
    if (enriched.length && !Object.keys(budgetSliders).length) {
      const init: Record<string, number> = {};
      enriched.forEach(c => { init[c.id] = totalBudget > 0 ? Math.round((c.budgetValue / totalBudget) * 100) : 0; });
      setBudgetSliders(init);
    }
  }, [enriched, totalBudget]);

  const handleSliderChange = useCallback((id: string, val: number[]) => {
    setBudgetSliders(prev => ({ ...prev, [id]: val[0] }));
  }, []);

  const totalSliderPct = useMemo(() => Object.values(budgetSliders).reduce((s, v) => s + v, 0), [budgetSliders]);

  const handleApplyBudgets = useCallback(async () => {
    for (const c of enriched) {
      const pct = budgetSliders[c.id] ?? 0;
      const newBudget = (totalBudget * pct) / 100;
      if (Math.abs(newBudget - c.budgetValue) > 0.5) {
        await updateCampaignBudget.mutateAsync({ campaignId: c.id, dailyBudget: newBudget });
      }
    }
    toast({ title: 'Orçamentos atualizados!' });
  }, [enriched, budgetSliders, totalBudget, updateCampaignBudget, toast]);

  // Token expired detection
  const isTokenError = useMemo(() => {
    const errMsg = String(insightsData?.error || '').toLowerCase();
    return errMsg.includes('token') || errMsg.includes('oauth') || errMsg.includes('190');
  }, [insightsData]);

  // Build data summary for AI
  const buildDataSummary = useCallback(() => {
    if (manualData.trim()) return manualData;
    return enriched.map(c => {
      const m = c.metrics;
      return `Campanha: ${c.name} | Budget/dia: R$${c.budgetValue.toFixed(2)} | Objetivo: ${c.objective || 'N/A'}${m ? ` | Spend: R$${Number(m.spend).toFixed(2)} | CTR: ${Number(m.ctr).toFixed(2)}% | CPC: R$${Number(m.cpc).toFixed(2)} | CPM: R$${Number(m.cpm).toFixed(2)} | Impressões: ${m.impressions} | Clicks: ${m.clicks} | Reach: ${m.reach}` : ''}`;
    }).join('\n');
  }, [enriched, manualData]);

  const buildSimulatorSummary = useCallback(() => {
    return enriched.map(c => {
      const pct = budgetSliders[c.id] ?? 0;
      const newBudget = (totalBudget * pct) / 100;
      const diff = newBudget - c.budgetValue;
      return `${c.name}: Atual R$${c.budgetValue.toFixed(2)}/dia → Novo R$${newBudget.toFixed(2)}/dia (${diff >= 0 ? '+' : ''}${diff.toFixed(2)})`;
    }).join('\n');
  }, [enriched, budgetSliders, totalBudget]);

  const handleOptimize = useCallback(async () => {
    aiRecRef.current = '';
    setAiRecommendation('');
    const data = buildDataSummary();
    await sendOptimize(`Analise as seguintes campanhas de Meta Ads e recomende a alocação ótima de orçamento. Para cada campanha, diga se devo AUMENTAR, MANTER ou REDUZIR o budget, com percentual sugerido e justificativa baseada nas métricas. Orçamento total diário: R$${totalBudget.toFixed(2)}\n\nDADOS:\n${data}`);
  }, [buildDataSummary, sendOptimize, totalBudget]);

  const handlePredictImpact = useCallback(async () => {
    aiImpactRef.current = '';
    setAiImpact('');
    const sim = buildSimulatorSummary();
    const data = buildDataSummary();
    await sendImpact(`Com base nas métricas atuais das campanhas, preveja o impacto da seguinte redistribuição de orçamento. Estime como CTR, CPC, reach e conversões seriam afetados.\n\nMÉTRICAS ATUAIS:\n${data}\n\nREDISTRIBUIÇÃO PROPOSTA:\n${sim}`);
  }, [buildSimulatorSummary, buildDataSummary, sendImpact]);

  const handleEfficiency = useCallback(async () => {
    aiEffRef.current = '';
    setAiEfficiency('');
    const data = buildDataSummary();
    await sendEfficiency(`Faça uma análise de eficiência de gasto das seguintes campanhas de Meta Ads. Identifique: campanhas com melhor ROI, campanhas desperdiçando budget, oportunidades de escala e recomendações de corte. Use tabelas comparativas.\n\nDADOS:\n${data}`);
  }, [buildDataSummary, sendEfficiency]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copiado!' });
  };

  // Pie chart data
  const chartData = enriched.slice(0, 8).map((c, i) => ({
    name: c.name.length > 25 ? c.name.slice(0, 25) + '…' : c.name,
    value: c.budgetValue,
    color: COLORS[i % COLORS.length],
  }));

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload?.[0]) {
      const pct = totalBudget > 0 ? ((payload[0].value / totalBudget) * 100).toFixed(1) : '0';
      return (
        <div className="rounded-lg border border-border bg-popover p-3 shadow-lg">
          <p className="font-medium text-foreground">{payload[0].name}</p>
          <p className="text-sm text-muted-foreground">{fmtCurrency(payload[0].value)}/dia ({pct}%)</p>
        </div>
      );
    }
    return null;
  };

  // Skip loading gate — let the page render immediately with cached data

  // Disconnected state
  if (!isConnected) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <LinkIcon className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Conecte seu Meta Ads</h2>
          <p className="text-muted-foreground text-center max-w-md">Para gerenciar orçamento com IA, conecte sua conta.</p>
          <Button onClick={() => navigate('/settings')} className="gradient-primary">Ir para Configurações</Button>
        </div>
      </MainLayout>
    );
  }

  const hasData = enriched.length > 0;
  const showManualMode = isTokenError || (!isLoading && !hasData);

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl flex items-center gap-2">
              <DollarSign className="h-7 w-7 text-primary" /> Budget Allocator
            </h1>
            <p className="text-muted-foreground">Gerencie e otimize orçamentos com inteligência artificial</p>
          </div>
          {totalBudget > 0 && (
            <Badge variant="outline" className="text-lg px-4 py-1.5 border-primary/30">
              Total: {fmtCurrency(totalBudget)}/dia
            </Badge>
          )}
        </div>

        {/* Token error / manual mode banner */}
        {showManualMode && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Link2Off className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 space-y-3">
                  <div>
                    <p className="font-medium text-amber-200">Dados indisponíveis</p>
                    <p className="text-sm text-muted-foreground">Token expirado ou sem campanhas ativas. Reconecte ou use o modo manual abaixo.</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => navigate('/settings')}>
                      <Settings className="h-4 w-4 mr-1" /> Reconectar
                    </Button>
                  </div>
                  <Textarea
                    placeholder="Cole aqui os dados das suas campanhas (nome, budget, métricas)..."
                    value={manualData}
                    onChange={e => setManualData(e.target.value)}
                    rows={4}
                    className="bg-background/50"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview"><BarChart3 className="h-4 w-4 mr-1" /> Visão Geral</TabsTrigger>
            <TabsTrigger value="simulator"><TrendingUp className="h-4 w-4 mr-1" /> Simulador</TabsTrigger>
            <TabsTrigger value="ai"><Sparkles className="h-4 w-4 mr-1" /> IA Optimizer</TabsTrigger>
          </TabsList>

          {/* ── TAB: VISÃO GERAL ───────────────────── */}
          <TabsContent value="overview" className="space-y-4">
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader><CardTitle className="text-lg">Alocação Atual — Orçamento Diário</CardTitle></CardHeader>
              <CardContent>
                {!hasData ? (
                  <p className="text-center text-muted-foreground py-10">Nenhuma campanha ativa com orçamento diário.</p>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={chartData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} dataKey="value">
                          {chartData.map((entry, i) => <Cell key={i} fill={entry.color} stroke="transparent" />)}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                        <Legend formatter={(v: string) => <span className="text-xs text-muted-foreground">{v}</span>} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Enriched campaign cards */}
            {enriched.length === 0 ? null : (
              <div className="space-y-3">
                {enriched.slice(0, 10).map((c, i) => {
                  const m = c.metrics;
                  return (
                    <motion.div key={c.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                      className="rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <div>
                            <p className="font-medium">{c.name}</p>
                            <Badge variant="secondary" className="text-xs mt-0.5">{c.objective || 'N/A'}</Badge>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold">{fmtCurrency(c.budgetValue)}<span className="text-sm font-normal text-muted-foreground">/dia</span></p>
                        </div>
                      </div>
                      {m && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 pt-3 border-t border-border/30">
                          <MetricPill icon={<DollarSign className="h-3.5 w-3.5" />} label="Spend" value={fmtCurrency(Number(m.spend))} />
                          <MetricPill icon={<MousePointerClick className="h-3.5 w-3.5" />} label="CTR" value={`${Number(m.ctr).toFixed(2)}%`} />
                          <MetricPill icon={<DollarSign className="h-3.5 w-3.5" />} label="CPC" value={`R$${Number(m.cpc).toFixed(2)}`} />
                          <MetricPill icon={<DollarSign className="h-3.5 w-3.5" />} label="CPM" value={`R$${Number(m.cpm).toFixed(2)}`} />
                          <MetricPill icon={<Eye className="h-3.5 w-3.5" />} label="Reach" value={fmtNum(Number(m.reach || 0))} />
                          <MetricPill icon={<MousePointerClick className="h-3.5 w-3.5" />} label="Clicks" value={fmtNum(Number(m.clicks || 0))} />
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── TAB: SIMULADOR ───────────────────── */}
          <TabsContent value="simulator" className="space-y-4">
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Simulador de Redistribuição</CardTitle>
                  <Badge variant={totalSliderPct === 100 ? 'default' : 'destructive'} className="text-sm">
                    {totalSliderPct}% alocado
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {!hasData && !manualData ? (
                  <p className="text-center text-muted-foreground py-10">Sem campanhas disponíveis. Use o modo manual acima ou conecte sua conta.</p>
                ) : (
                  <>
                    {enriched.map((c, i) => {
                      const pct = budgetSliders[c.id] ?? 0;
                      const newBudget = (totalBudget * pct) / 100;
                      const diff = newBudget - c.budgetValue;
                      return (
                        <div key={c.id} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                              <span className="text-sm font-medium truncate max-w-[200px]">{c.name}</span>
                            </div>
                            <div className="flex items-center gap-3 text-sm">
                              <span className="text-muted-foreground">{fmtCurrency(c.budgetValue)}</span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                              <span className="font-medium">{fmtCurrency(newBudget)}</span>
                              <span className={`text-xs ${diff > 0 ? 'text-emerald-400' : diff < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                                {diff > 0 ? '+' : ''}{fmtCurrency(diff)}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <Slider value={[pct]} min={0} max={100} step={1} onValueChange={v => handleSliderChange(c.id, v)} className="flex-1" />
                            <span className="text-sm font-mono w-12 text-right">{pct}%</span>
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex gap-3 pt-4 border-t border-border/30">
                      <Button onClick={handleApplyBudgets} disabled={totalSliderPct !== 100 || updateCampaignBudget.isPending} className="gradient-primary">
                        <DollarSign className="h-4 w-4 mr-1" />
                        {updateCampaignBudget.isPending ? 'Aplicando...' : 'Aplicar Mudanças'}
                      </Button>
                      <Button variant="outline" onClick={handlePredictImpact} disabled={isPredicting}>
                        <Sparkles className="h-4 w-4 mr-1" />
                        {isPredicting ? 'Prevendo...' : 'Prever Impacto com IA'}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* AI Impact result */}
            {aiImpact && (
              <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Previsão de Impacto</CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => copyToClipboard(aiImpact)}><Copy className="h-4 w-4" /></Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <MarkdownRenderer content={aiImpact} />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── TAB: IA OPTIMIZER ───────────────────── */}
          <TabsContent value="ai" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm cursor-pointer hover:border-primary/30 transition-colors" onClick={handleOptimize}>
                <CardContent className="pt-6 text-center space-y-3">
                  <div className="mx-auto h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Sparkles className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold">Alocação Ótima</h3>
                  <p className="text-sm text-muted-foreground">IA analisa métricas e sugere a melhor distribuição de budget</p>
                  <Button size="sm" disabled={isOptimizing} className="w-full">
                    {isOptimizing ? <><RefreshCw className="h-4 w-4 mr-1 animate-spin" /> Analisando...</> : 'Otimizar'}
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card/50 backdrop-blur-sm cursor-pointer hover:border-primary/30 transition-colors" onClick={handlePredictImpact}>
                <CardContent className="pt-6 text-center space-y-3">
                  <div className="mx-auto h-12 w-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                    <TrendingUp className="h-6 w-6 text-emerald-400" />
                  </div>
                  <h3 className="font-semibold">Previsão de Impacto</h3>
                  <p className="text-sm text-muted-foreground">Estime o impacto de redistribuições de orçamento nas métricas</p>
                  <Button size="sm" variant="outline" disabled={isPredicting} className="w-full">
                    {isPredicting ? <><RefreshCw className="h-4 w-4 mr-1 animate-spin" /> Prevendo...</> : 'Prever'}
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card/50 backdrop-blur-sm cursor-pointer hover:border-primary/30 transition-colors" onClick={handleEfficiency}>
                <CardContent className="pt-6 text-center space-y-3">
                  <div className="mx-auto h-12 w-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
                    <Zap className="h-6 w-6 text-amber-400" />
                  </div>
                  <h3 className="font-semibold">Análise de Eficiência</h3>
                  <p className="text-sm text-muted-foreground">Relatório de eficiência de gasto com recomendações de corte e escala</p>
                  <Button size="sm" variant="outline" disabled={isAnalyzing} className="w-full">
                    {isAnalyzing ? <><RefreshCw className="h-4 w-4 mr-1 animate-spin" /> Analisando...</> : 'Analisar'}
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Manual mode in AI tab too */}
            {(showManualMode || !hasData) && (
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardHeader><CardTitle className="text-lg">Modo Manual</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3">Cole os dados das suas campanhas para usar a IA mesmo sem conexão.</p>
                  <Textarea
                    placeholder="Ex: Campanha Vendas | Budget: R$100/dia | CTR: 2.5% | CPC: R$1.20..."
                    value={manualData}
                    onChange={e => setManualData(e.target.value)}
                    rows={5}
                    className="bg-background/50"
                  />
                </CardContent>
              </Card>
            )}

            {/* AI Optimization result */}
            {aiRecommendation && (
              <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Recomendação de Alocação</CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => copyToClipboard(aiRecommendation)}><Copy className="h-4 w-4" /></Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <MarkdownRenderer content={aiRecommendation} />
                </CardContent>
              </Card>
            )}

            {/* AI Efficiency result */}
            {aiEfficiency && (
              <Card className="border-amber-500/20 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2"><Zap className="h-5 w-5 text-amber-400" /> Análise de Eficiência</CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => copyToClipboard(aiEfficiency)}><Copy className="h-4 w-4" /></Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <MarkdownRenderer content={aiEfficiency} />
                </CardContent>
              </Card>
            )}

            {/* Impact result in AI tab */}
            {aiImpact && (
              <Card className="border-emerald-500/20 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2"><TrendingUp className="h-5 w-5 text-emerald-400" /> Previsão de Impacto</CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => copyToClipboard(aiImpact)}><Copy className="h-4 w-4" /></Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <MarkdownRenderer content={aiImpact} />
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

function MetricPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <p className="text-[10px] text-muted-foreground leading-none">{label}</p>
        <p className="text-xs font-medium">{value}</p>
      </div>
    </div>
  );
}
