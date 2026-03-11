import { useState, useMemo, useCallback, useRef } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DollarSign, TrendingUp, Sparkles, LinkIcon, ArrowRight, Copy, ArrowUpRight, ArrowDownRight,
  BarChart3, Zap, Eye, MousePointerClick, RefreshCw, Link2Off, Settings, Target,
  Scale, Shuffle, Calculator, CheckCircle2, AlertTriangle, Minus, Play,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { useMetaCampaigns } from '@/hooks/useMetaCampaigns';
import { useMetaInsights } from '@/hooks/useMetaInsights';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';

const COLORS = [
  'hsl(217, 91%, 60%)', 'hsl(263, 70%, 58%)', 'hsl(160, 84%, 39%)',
  'hsl(38, 92%, 50%)', 'hsl(0, 84%, 60%)', 'hsl(330, 80%, 60%)',
  'hsl(187, 85%, 43%)', 'hsl(84, 60%, 50%)',
];

const fmtCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : n.toLocaleString('pt-BR');
const pctDiff = (a: number, b: number) => b === 0 ? 0 : ((a - b) / b) * 100;

type Strategy = 'performance' | 'equal' | 'ctr_weighted' | 'cpc_weighted' | 'roas_weighted' | 'custom';

interface Scenario {
  id: string;
  name: string;
  description: string;
  icon: typeof Target;
  allocations: Record<string, number>;
  estimatedImpact: { metric: string; change: number }[];
}

export default function BudgetAllocator() {
  const { connectedAccount, isLoading: isLoadingConn } = useMetaConnection();
  const isConnected = !!connectedAccount;
  const { campaigns, isLoading, updateCampaignBudget, refresh } = useMetaCampaigns({ enabled: isConnected });
  const navigate = useNavigate();
  const { toast } = useToast();

  const { data: insightsData } = useMetaInsights({
    accountId: connectedAccount?.account_id,
    level: 'campaign',
    fields: 'campaign_name,campaign_id,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type,action_values',
    enabled: isConnected,
  });

  // AI states
  const [aiRecommendation, setAiRecommendation] = useState('');
  const [aiImpact, setAiImpact] = useState('');
  const [manualData, setManualData] = useState('');
  const [activeStrategy, setActiveStrategy] = useState<Strategy>('performance');
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const aiRecRef = useRef('');
  const aiImpactRef = useRef('');

  const { sendSingleMessage: sendOptimize, isLoading: isOptimizing } = useClaudeChat({
    context: 'optimizer',
    onDelta: (d) => { aiRecRef.current += d; setAiRecommendation(aiRecRef.current); },
  });
  const { sendSingleMessage: sendImpact, isLoading: isPredicting } = useClaudeChat({
    context: 'optimizer',
    onDelta: (d) => { aiImpactRef.current += d; setAiImpact(aiImpactRef.current); },
  });

  const [budgetSliders, setBudgetSliders] = useState<Record<string, number>>({});

  const activeCampaigns = useMemo(
    () => campaigns.filter((c: any) => c.effective_status === 'ACTIVE' && c.daily_budget),
    [campaigns]
  );

  const insightsMap = useMemo(() => {
    const map: Record<string, any> = {};
    (insightsData?.data || []).forEach((r: any) => { if (r.campaign_id) map[r.campaign_id] = r; });
    return map;
  }, [insightsData]);

  const enriched = useMemo(() =>
    activeCampaigns.map((c: any) => {
      const m = insightsMap[c.id] || null;
      const spend = m ? Number(m.spend || 0) : 0;
      const clicks = m ? Number(m.clicks || 0) : 0;
      const ctr = m ? Number(m.ctr || 0) : 0;
      const cpc = m ? Number(m.cpc || 0) : 0;
      const cpm = m ? Number(m.cpm || 0) : 0;
      const reach = m ? Number(m.reach || 0) : 0;
      const impressions = m ? Number(m.impressions || 0) : 0;

      // Extract conversions and ROAS from actions
      let conversions = 0;
      let revenue = 0;
      if (m?.actions) {
        const purchaseAction = m.actions.find((a: any) => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
        if (purchaseAction) conversions = Number(purchaseAction.value || 0);
      }
      if (m?.action_values) {
        const purchaseValue = m.action_values.find((a: any) => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
        if (purchaseValue) revenue = Number(purchaseValue.value || 0);
      }
      const roas = spend > 0 ? revenue / spend : 0;
      const cpa = conversions > 0 ? spend / conversions : 0;

      // Efficiency score (0-100): weighted composite
      const ctrScore = Math.min(ctr / 3, 1) * 30; // 3% CTR = max
      const cpcScore = cpc > 0 ? Math.min(2 / cpc, 1) * 20 : 0; // R$2 CPC = max
      const roasScore = Math.min(roas / 5, 1) * 50; // 5x ROAS = max
      const efficiencyScore = Math.round(ctrScore + cpcScore + roasScore);

      return {
        ...c,
        budgetValue: Number(c.daily_budget) / 100,
        metrics: m,
        spend, clicks, ctr, cpc, cpm, reach, impressions,
        conversions, revenue, roas, cpa, efficiencyScore,
      };
    }),
    [activeCampaigns, insightsMap]
  );

  const totalBudget = useMemo(() => enriched.reduce((s, c) => s + c.budgetValue, 0), [enriched]);

  // Auto-distribute based on strategy
  const computeAllocation = useCallback((strategy: Strategy): Record<string, number> => {
    if (!enriched.length) return {};

    switch (strategy) {
      case 'equal': {
        const pct = Math.round(100 / enriched.length);
        const alloc: Record<string, number> = {};
        enriched.forEach((c, i) => { alloc[c.id] = i === enriched.length - 1 ? 100 - pct * (enriched.length - 1) : pct; });
        return alloc;
      }
      case 'performance': {
        const totalScore = enriched.reduce((s, c) => s + Math.max(c.efficiencyScore, 1), 0);
        const alloc: Record<string, number> = {};
        let remaining = 100;
        enriched.forEach((c, i) => {
          if (i === enriched.length - 1) { alloc[c.id] = remaining; }
          else {
            const pct = Math.round((Math.max(c.efficiencyScore, 1) / totalScore) * 100);
            alloc[c.id] = pct;
            remaining -= pct;
          }
        });
        return alloc;
      }
      case 'ctr_weighted': {
        const totalCtr = enriched.reduce((s, c) => s + Math.max(c.ctr, 0.01), 0);
        const alloc: Record<string, number> = {};
        let remaining = 100;
        enriched.forEach((c, i) => {
          if (i === enriched.length - 1) { alloc[c.id] = remaining; }
          else {
            const pct = Math.round((Math.max(c.ctr, 0.01) / totalCtr) * 100);
            alloc[c.id] = pct;
            remaining -= pct;
          }
        });
        return alloc;
      }
      case 'cpc_weighted': {
        // Inverse CPC — lower CPC gets more budget
        const invCpcs = enriched.map(c => c.cpc > 0 ? 1 / c.cpc : 1);
        const totalInv = invCpcs.reduce((s, v) => s + v, 0);
        const alloc: Record<string, number> = {};
        let remaining = 100;
        enriched.forEach((c, i) => {
          if (i === enriched.length - 1) { alloc[c.id] = remaining; }
          else {
            const pct = Math.round((invCpcs[i] / totalInv) * 100);
            alloc[c.id] = pct;
            remaining -= pct;
          }
        });
        return alloc;
      }
      case 'roas_weighted': {
        const totalRoas = enriched.reduce((s, c) => s + Math.max(c.roas, 0.1), 0);
        const alloc: Record<string, number> = {};
        let remaining = 100;
        enriched.forEach((c, i) => {
          if (i === enriched.length - 1) { alloc[c.id] = remaining; }
          else {
            const pct = Math.round((Math.max(c.roas, 0.1) / totalRoas) * 100);
            alloc[c.id] = pct;
            remaining -= pct;
          }
        });
        return alloc;
      }
      default:
        return budgetSliders;
    }
  }, [enriched, budgetSliders]);

  // Init sliders
  useMemo(() => {
    if (enriched.length && !Object.keys(budgetSliders).length) {
      const init: Record<string, number> = {};
      enriched.forEach(c => { init[c.id] = totalBudget > 0 ? Math.round((c.budgetValue / totalBudget) * 100) : 0; });
      setBudgetSliders(init);
    }
  }, [enriched, totalBudget]);

  const applyStrategy = useCallback((s: Strategy) => {
    setActiveStrategy(s);
    if (s !== 'custom') {
      setBudgetSliders(computeAllocation(s));
    }
  }, [computeAllocation]);

  const handleSliderChange = useCallback((id: string, val: number[]) => {
    setActiveStrategy('custom');
    setBudgetSliders(prev => ({ ...prev, [id]: val[0] }));
  }, []);

  const totalSliderPct = useMemo(() => Object.values(budgetSliders).reduce((s, v) => s + v, 0), [budgetSliders]);

  // Reallocation suggestions
  const suggestions = useMemo(() => {
    if (!enriched.length) return [];
    const sorted = [...enriched].sort((a, b) => b.efficiencyScore - a.efficiencyScore);
    const results: { from: typeof enriched[0]; to: typeof enriched[0]; amount: number; reason: string }[] = [];

    const worst = sorted.filter(c => c.efficiencyScore < 30 && c.budgetValue > 10);
    const best = sorted.filter(c => c.efficiencyScore > 60);

    for (const w of worst) {
      const target = best[0];
      if (!target || target.id === w.id) continue;
      const moveAmount = Math.round(w.budgetValue * 0.3);
      if (moveAmount < 5) continue;
      results.push({
        from: w,
        to: target,
        amount: moveAmount,
        reason: w.cpa > 0 ? `CPA de ${fmtCurrency(w.cpa)} muito alto` : `Score de eficiência ${w.efficiencyScore}/100`,
      });
    }
    return results.slice(0, 5);
  }, [enriched]);

  // Scenarios
  const scenarios: Scenario[] = useMemo(() => {
    if (!enriched.length) return [];
    const perfAlloc = computeAllocation('performance');
    const ctrAlloc = computeAllocation('ctr_weighted');
    const eqAlloc = computeAllocation('equal');

    const estimateImpact = (alloc: Record<string, number>) => {
      let totalClicks = 0, totalSpend = 0, totalReach = 0;
      enriched.forEach(c => {
        const pct = alloc[c.id] ?? 0;
        const newBudget = (totalBudget * pct) / 100;
        const ratio = c.budgetValue > 0 ? newBudget / c.budgetValue : 1;
        totalClicks += c.clicks * ratio;
        totalSpend += c.spend * ratio;
        totalReach += c.reach * Math.sqrt(ratio);
      });
      const currentClicks = enriched.reduce((s, c) => s + c.clicks, 0);
      const currentReach = enriched.reduce((s, c) => s + c.reach, 0);
      return [
        { metric: 'Clicks', change: pctDiff(totalClicks, currentClicks) },
        { metric: 'Reach', change: pctDiff(totalReach, currentReach) },
        { metric: 'CPC Médio', change: totalClicks > 0 && currentClicks > 0 ? pctDiff(totalSpend / totalClicks, enriched.reduce((s, c) => s + c.spend, 0) / currentClicks) : 0 },
      ];
    };

    return [
      {
        id: 'perf', name: 'Máxima Performance', description: 'Aloca mais para campanhas com melhor score',
        icon: Target, allocations: perfAlloc, estimatedImpact: estimateImpact(perfAlloc),
      },
      {
        id: 'ctr', name: 'Otimizar Engajamento', description: 'Prioriza campanhas com melhor CTR',
        icon: MousePointerClick, allocations: ctrAlloc, estimatedImpact: estimateImpact(ctrAlloc),
      },
      {
        id: 'equal', name: 'Distribuição Igual', description: 'Divide igualmente entre campanhas ativas',
        icon: Scale, allocations: eqAlloc, estimatedImpact: estimateImpact(eqAlloc),
      },
    ];
  }, [enriched, computeAllocation, totalBudget]);

  const handleApplyBudgets = useCallback(async () => {
    for (const c of enriched) {
      const pct = budgetSliders[c.id] ?? 0;
      const newBudget = (totalBudget * pct) / 100;
      if (Math.abs(newBudget - c.budgetValue) > 0.5) {
        await updateCampaignBudget.mutateAsync({ campaignId: c.id, dailyBudget: newBudget });
      }
    }
    toast({ title: '✅ Orçamentos atualizados no Gerenciador de Anúncios!' });
  }, [enriched, budgetSliders, totalBudget, updateCampaignBudget, toast]);

  const handleApplyScenario = useCallback((scenario: Scenario) => {
    setBudgetSliders(scenario.allocations);
    setActiveScenario(scenario.id);
    setActiveStrategy('custom');
    toast({ title: `Cenário "${scenario.name}" aplicado ao simulador` });
  }, [toast]);

  const handleApplySuggestion = useCallback((suggestion: typeof suggestions[0]) => {
    setBudgetSliders(prev => {
      const fromPct = prev[suggestion.from.id] ?? 0;
      const toPct = prev[suggestion.to.id] ?? 0;
      const movePct = totalBudget > 0 ? Math.round((suggestion.amount / totalBudget) * 100) : 0;
      return { ...prev, [suggestion.from.id]: Math.max(0, fromPct - movePct), [suggestion.to.id]: toPct + movePct };
    });
    setActiveStrategy('custom');
    toast({ title: `Realocação de ${fmtCurrency(suggestion.amount)} aplicada ao simulador` });
  }, [totalBudget, toast]);

  // AI
  const buildDataSummary = useCallback(() => {
    if (manualData.trim()) return manualData;
    return enriched.map(c =>
      `Campanha: ${c.name} | Budget: R$${c.budgetValue.toFixed(2)}/dia | Score: ${c.efficiencyScore}/100 | Spend: R$${c.spend.toFixed(2)} | CTR: ${c.ctr.toFixed(2)}% | CPC: R$${c.cpc.toFixed(2)} | CPM: R$${c.cpm.toFixed(2)} | ROAS: ${c.roas.toFixed(2)}x | CPA: R$${c.cpa.toFixed(2)} | Conversões: ${c.conversions}`
    ).join('\n');
  }, [enriched, manualData]);

  const handleOptimize = useCallback(async () => {
    aiRecRef.current = '';
    setAiRecommendation('');
    await sendOptimize(`Analise as seguintes campanhas de Meta Ads e recomende a alocação ótima de orçamento. Para cada campanha, diga se devo AUMENTAR, MANTER ou REDUZIR o budget, com percentual sugerido e justificativa baseada nas métricas. Considere ROAS, CPA, CTR e eficiência geral. Orçamento total diário: R$${totalBudget.toFixed(2)}\n\nDADOS:\n${buildDataSummary()}`);
  }, [buildDataSummary, sendOptimize, totalBudget]);

  const handlePredictImpact = useCallback(async () => {
    aiImpactRef.current = '';
    setAiImpact('');
    const sim = enriched.map(c => {
      const pct = budgetSliders[c.id] ?? 0;
      const nb = (totalBudget * pct) / 100;
      return `${c.name}: R$${c.budgetValue.toFixed(2)} → R$${nb.toFixed(2)}`;
    }).join('\n');
    await sendImpact(`Com base nas métricas atuais, preveja o impacto desta redistribuição. Estime mudanças em clicks, reach, conversões e ROAS. Dê notas de risco.\n\nMÉTRICAS:\n${buildDataSummary()}\n\nREDISTRIBUIÇÃO:\n${sim}`);
  }, [enriched, budgetSliders, totalBudget, buildDataSummary, sendImpact]);

  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); toast({ title: 'Copiado!' }); };

  const isTokenError = useMemo(() => {
    const errMsg = String(insightsData?.error || '').toLowerCase();
    return errMsg.includes('token') || errMsg.includes('oauth') || errMsg.includes('190');
  }, [insightsData]);

  const hasData = enriched.length > 0;
  const showManualMode = isTokenError || (!isLoading && !hasData);

  // Chart data
  const chartData = enriched.slice(0, 8).map((c, i) => ({
    name: c.name.length > 20 ? c.name.slice(0, 20) + '…' : c.name,
    current: c.budgetValue,
    proposed: (totalBudget * (budgetSliders[c.id] ?? 0)) / 100,
    color: COLORS[i % COLORS.length],
  }));

  const pieData = enriched.slice(0, 8).map((c, i) => ({
    name: c.name.length > 20 ? c.name.slice(0, 20) + '…' : c.name,
    value: c.budgetValue,
    color: COLORS[i % COLORS.length],
  }));

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

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl flex items-center gap-2">
              <DollarSign className="h-7 w-7 text-primary" /> Budget Allocator
            </h1>
            <p className="text-muted-foreground">Distribuição inteligente de orçamento baseada em performance</p>
          </div>
          <div className="flex items-center gap-3">
            {totalBudget > 0 && (
              <Badge variant="outline" className="text-lg px-4 py-1.5 border-primary/30">
                Total: {fmtCurrency(totalBudget)}/dia
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => refresh?.()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
            </Button>
          </div>
        </div>

        {/* Manual mode banner */}
        {showManualMode && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Link2Off className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 space-y-3">
                  <p className="font-medium">Dados indisponíveis — use o modo manual</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => navigate('/settings')}><Settings className="h-4 w-4 mr-1" /> Reconectar</Button>
                  </div>
                  <Textarea placeholder="Cole dados das campanhas..." value={manualData} onChange={e => setManualData(e.target.value)} rows={4} className="bg-background/50" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* KPI Row */}
        {hasData && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard label="Campanhas Ativas" value={String(enriched.length)} icon={<BarChart3 className="h-4 w-4" />} />
            <KPICard label="Budget Total/dia" value={fmtCurrency(totalBudget)} icon={<DollarSign className="h-4 w-4" />} />
            <KPICard label="Score Médio" value={`${Math.round(enriched.reduce((s, c) => s + c.efficiencyScore, 0) / enriched.length)}/100`} icon={<Target className="h-4 w-4" />} />
            <KPICard label="Sugestões" value={String(suggestions.length)} icon={<Sparkles className="h-4 w-4" />} accent />
          </div>
        )}

        <Tabs defaultValue="auto" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="auto"><Zap className="h-4 w-4 mr-1" /> Auto</TabsTrigger>
            <TabsTrigger value="simulator"><Calculator className="h-4 w-4 mr-1" /> Simulador</TabsTrigger>
            <TabsTrigger value="scenarios"><Shuffle className="h-4 w-4 mr-1" /> Cenários</TabsTrigger>
            <TabsTrigger value="ai"><Sparkles className="h-4 w-4 mr-1" /> IA</TabsTrigger>
          </TabsList>

          {/* ── TAB: AUTO DISTRIBUTION ── */}
          <TabsContent value="auto" className="space-y-4">
            {/* Strategy selector */}
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <CardTitle className="text-lg">Distribuição Automática</CardTitle>
                  <Select value={activeStrategy} onValueChange={(v) => applyStrategy(v as Strategy)}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="performance">🎯 Por Performance</SelectItem>
                      <SelectItem value="ctr_weighted">📈 Por CTR</SelectItem>
                      <SelectItem value="cpc_weighted">💰 Por CPC (inverso)</SelectItem>
                      <SelectItem value="roas_weighted">🚀 Por ROAS</SelectItem>
                      <SelectItem value="equal">⚖️ Igual</SelectItem>
                      <SelectItem value="custom">✏️ Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {!hasData ? (
                  <p className="text-center text-muted-foreground py-10">Nenhuma campanha ativa com orçamento diário.</p>
                ) : (
                  <div className="space-y-4">
                    {/* Pie chart */}
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value">
                            {pieData.map((e, i) => <Cell key={i} fill={e.color} stroke="transparent" />)}
                          </Pie>
                          <Tooltip content={({ active, payload }: any) => active && payload?.[0] ? (
                            <div className="rounded-lg border border-border bg-popover p-2 shadow-lg text-sm">
                              <p className="font-medium text-foreground">{payload[0].name}</p>
                              <p className="text-muted-foreground">{fmtCurrency(payload[0].value)}/dia</p>
                            </div>
                          ) : null} />
                          <Legend formatter={(v: string) => <span className="text-xs text-muted-foreground">{v}</span>} wrapperStyle={{ fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Campaign rows with efficiency */}
                    <div className="space-y-3">
                      {enriched.sort((a, b) => b.efficiencyScore - a.efficiencyScore).map((c, i) => {
                        const pct = budgetSliders[c.id] ?? 0;
                        const newBudget = (totalBudget * pct) / 100;
                        const diff = newBudget - c.budgetValue;
                        return (
                          <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                            className="rounded-lg border border-border/50 bg-card/30 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                                <span className="text-sm font-medium truncate">{c.name}</span>
                                <EfficiencyBadge score={c.efficiencyScore} />
                              </div>
                              <div className="flex items-center gap-2 text-sm shrink-0">
                                <span className="text-muted-foreground">{fmtCurrency(c.budgetValue)}</span>
                                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                <span className="font-medium">{fmtCurrency(newBudget)}</span>
                                {diff !== 0 && (
                                  <span className={`text-xs flex items-center gap-0.5 ${diff > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {diff > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                    {Math.abs(diff).toFixed(0)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <Slider value={[pct]} min={0} max={100} step={1} onValueChange={v => handleSliderChange(c.id, v)} className="flex-1" />
                              <span className="text-sm font-mono w-12 text-right">{pct}%</span>
                            </div>
                            {c.metrics && (
                              <div className="flex flex-wrap gap-2 pt-1">
                                <MiniMetric label="CTR" value={`${c.ctr.toFixed(2)}%`} />
                                <MiniMetric label="CPC" value={`R$${c.cpc.toFixed(2)}`} />
                                <MiniMetric label="ROAS" value={`${c.roas.toFixed(1)}x`} />
                                <MiniMetric label="Conv" value={String(c.conversions)} />
                              </div>
                            )}
                          </motion.div>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t border-border/30">
                      <Badge variant={totalSliderPct === 100 ? 'default' : 'destructive'}>{totalSliderPct}% alocado</Badge>
                      <Button onClick={handleApplyBudgets} disabled={totalSliderPct !== 100 || updateCampaignBudget.isPending} className="gradient-primary">
                        <Play className="h-4 w-4 mr-1" />
                        {updateCampaignBudget.isPending ? 'Aplicando...' : 'Aplicar no Gerenciador'}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Reallocation suggestions */}
            {suggestions.length > 0 && (
              <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" /> Sugestões de Realocação
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {suggestions.map((s, i) => (
                    <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                      className="flex items-center gap-3 rounded-lg border border-border/40 bg-muted/20 p-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-sm flex-wrap">
                          <span className="font-medium text-red-400 truncate max-w-[120px]">{s.from.name}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="font-medium text-emerald-400 truncate max-w-[120px]">{s.to.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{s.reason} • Realocar {fmtCurrency(s.amount)}/dia</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleApplySuggestion(s)} className="shrink-0 h-7 text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Aplicar
                      </Button>
                    </motion.div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── TAB: SIMULADOR ── */}
          <TabsContent value="simulator" className="space-y-4">
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader><CardTitle className="text-lg">Comparativo: Atual vs Proposto</CardTitle></CardHeader>
              <CardContent>
                {!hasData ? (
                  <p className="text-center text-muted-foreground py-10">Sem dados para simular.</p>
                ) : (
                  <>
                    <div className="h-64 mb-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} barGap={4}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                          <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                          <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v) => `R$${v}`} />
                          <Tooltip content={({ active, payload, label }: any) => active && payload ? (
                            <div className="rounded-lg border border-border bg-popover p-2 shadow-lg text-sm">
                              <p className="font-medium text-foreground mb-1">{label}</p>
                              {payload.map((p: any, i: number) => (
                                <p key={i} className="text-muted-foreground">{p.name}: {fmtCurrency(p.value)}</p>
                              ))}
                            </div>
                          ) : null} />
                          <Bar dataKey="current" name="Atual" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} opacity={0.5} />
                          <Bar dataKey="proposed" name="Proposto" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                          <Legend />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Impact estimate table */}
                    <div className="rounded-lg border border-border/40 divide-y divide-border/30">
                      <div className="grid grid-cols-5 gap-2 p-3 text-xs font-medium text-muted-foreground">
                        <span>Campanha</span><span>Atual</span><span>Proposto</span><span>Δ Budget</span><span>Est. Clicks</span>
                      </div>
                      {enriched.map(c => {
                        const pct = budgetSliders[c.id] ?? 0;
                        const nb = (totalBudget * pct) / 100;
                        const diff = nb - c.budgetValue;
                        const ratio = c.budgetValue > 0 ? nb / c.budgetValue : 1;
                        const estClicks = Math.round(c.clicks * ratio);
                        return (
                          <div key={c.id} className="grid grid-cols-5 gap-2 p-3 text-sm items-center">
                            <span className="truncate font-medium">{c.name}</span>
                            <span className="text-muted-foreground">{fmtCurrency(c.budgetValue)}</span>
                            <span>{fmtCurrency(nb)}</span>
                            <span className={diff > 0 ? 'text-emerald-400' : diff < 0 ? 'text-red-400' : 'text-muted-foreground'}>
                              {diff > 0 ? '+' : ''}{fmtCurrency(diff)}
                            </span>
                            <span>{fmtNum(estClicks)}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex gap-3 pt-4">
                      <Button onClick={handleApplyBudgets} disabled={totalSliderPct !== 100 || updateCampaignBudget.isPending} className="gradient-primary">
                        <Play className="h-4 w-4 mr-1" /> Aplicar Mudanças
                      </Button>
                      <Button variant="outline" onClick={handlePredictImpact} disabled={isPredicting}>
                        <Sparkles className="h-4 w-4 mr-1" /> {isPredicting ? 'Prevendo...' : 'Prever com IA'}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {aiImpact && (
              <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Previsão de Impacto</CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => copyToClipboard(aiImpact)}><Copy className="h-4 w-4" /></Button>
                  </div>
                </CardHeader>
                <CardContent><MarkdownRenderer content={aiImpact} /></CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── TAB: CENÁRIOS ── */}
          <TabsContent value="scenarios" className="space-y-4">
            {!hasData ? (
              <Card className="border-border/50 bg-card/50">
                <CardContent className="py-10 text-center text-muted-foreground">Sem campanhas para gerar cenários.</CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                {scenarios.map((sc) => {
                  const Icon = sc.icon;
                  const isActive = activeScenario === sc.id;
                  return (
                    <motion.div key={sc.id} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                      <Card className={`border-border/50 bg-card/50 backdrop-blur-sm cursor-pointer transition-all ${isActive ? 'border-primary/50 ring-1 ring-primary/20' : 'hover:border-primary/30'}`}
                        onClick={() => handleApplyScenario(sc)}>
                        <CardContent className="pt-6 space-y-4">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                              <Icon className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-sm">{sc.name}</h3>
                              <p className="text-xs text-muted-foreground">{sc.description}</p>
                            </div>
                          </div>

                          {/* Estimated impact */}
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Impacto Estimado</p>
                            {sc.estimatedImpact.map((imp, i) => (
                              <div key={i} className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">{imp.metric}</span>
                                <span className={imp.change > 0 ? 'text-emerald-400' : imp.change < 0 ? 'text-red-400' : 'text-muted-foreground'}>
                                  {imp.change > 0 ? '+' : ''}{imp.change.toFixed(1)}%
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* Allocation preview */}
                          <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
                            {enriched.map((c, i) => {
                              const pct = sc.allocations[c.id] ?? 0;
                              return <div key={c.id} className="h-full" style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />;
                            })}
                          </div>

                          <Button size="sm" variant={isActive ? 'default' : 'outline'} className="w-full">
                            {isActive ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Aplicado</> : 'Selecionar Cenário'}
                          </Button>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── TAB: IA ── */}
          <TabsContent value="ai" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm cursor-pointer hover:border-primary/30 transition-colors" onClick={handleOptimize}>
                <CardContent className="pt-6 text-center space-y-3">
                  <div className="mx-auto h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Sparkles className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold">Alocação Ótima com IA</h3>
                  <p className="text-sm text-muted-foreground">Análise profunda com recomendações personalizadas</p>
                  <Button size="sm" disabled={isOptimizing} className="w-full">
                    {isOptimizing ? <><RefreshCw className="h-4 w-4 mr-1 animate-spin" /> Analisando...</> : 'Otimizar com IA'}
                  </Button>
                </CardContent>
              </Card>
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm cursor-pointer hover:border-primary/30 transition-colors" onClick={handlePredictImpact}>
                <CardContent className="pt-6 text-center space-y-3">
                  <div className="mx-auto h-12 w-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                    <TrendingUp className="h-6 w-6 text-emerald-400" />
                  </div>
                  <h3 className="font-semibold">Previsão de Impacto</h3>
                  <p className="text-sm text-muted-foreground">Estime resultados da redistribuição atual</p>
                  <Button size="sm" variant="outline" disabled={isPredicting} className="w-full">
                    {isPredicting ? <><RefreshCw className="h-4 w-4 mr-1 animate-spin" /> Prevendo...</> : 'Prever Impacto'}
                  </Button>
                </CardContent>
              </Card>
            </div>

            {(showManualMode || !hasData) && (
              <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardHeader><CardTitle className="text-lg">Modo Manual</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3">Cole os dados das campanhas para usar a IA sem conexão.</p>
                  <Textarea placeholder="Ex: Campanha Vendas | Budget: R$100/dia | CTR: 2.5%..." value={manualData} onChange={e => setManualData(e.target.value)} rows={5} className="bg-background/50" />
                </CardContent>
              </Card>
            )}

            {aiRecommendation && (
              <Card className="border-primary/20 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Recomendação</CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => copyToClipboard(aiRecommendation)}><Copy className="h-4 w-4" /></Button>
                  </div>
                </CardHeader>
                <CardContent><MarkdownRenderer content={aiRecommendation} /></CardContent>
              </Card>
            )}
            {aiImpact && (
              <Card className="border-emerald-500/20 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2"><TrendingUp className="h-5 w-5 text-emerald-400" /> Previsão</CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => copyToClipboard(aiImpact)}><Copy className="h-4 w-4" /></Button>
                  </div>
                </CardHeader>
                <CardContent><MarkdownRenderer content={aiImpact} /></CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

function KPICard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: boolean }) {
  return (
    <Card className={`border-border/50 bg-card/50 backdrop-blur-sm ${accent ? 'border-primary/30' : ''}`}>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">{icon}<span className="text-xs">{label}</span></div>
        <p className={`text-xl font-bold ${accent ? 'text-primary' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function EfficiencyBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'text-emerald-400 border-emerald-500/30' : score >= 40 ? 'text-amber-400 border-amber-500/30' : 'text-red-400 border-red-500/30';
  return <Badge variant="outline" className={`text-[10px] h-4 ${color}`}>{score}/100</Badge>;
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-[10px] rounded bg-muted/40 px-1.5 py-0.5">
      <span className="text-muted-foreground">{label}:</span> <span className="font-medium">{value}</span>
    </span>
  );
}
