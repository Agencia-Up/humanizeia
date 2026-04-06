import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import { useMetaApi } from '@/hooks/useMetaApi';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import {
  FlaskConical, Plus, Trophy, TrendingUp, BarChart3, Sparkles, RefreshCw,
  Trash2, Pause, Play, Award, Brain, Percent, Search, CheckCircle2
} from 'lucide-react';
import { motion } from 'framer-motion';

const statusColors: Record<string, string> = {
  running: 'bg-primary/20 text-primary',
  completed: 'bg-success/20 text-success',
  paused: 'bg-warning/20 text-warning',
  winner_selected: 'bg-success/20 text-success',
};

const statusLabels: Record<string, string> = {
  running: 'Em andamento',
  completed: 'Concluído',
  paused: 'Pausado',
  winner_selected: 'Vencedor selecionado',
};

interface MetaAd {
  id: string;
  name: string;
  status: string;
  effective_status: string;
}

interface AdInsight {
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  spend?: string;
  reach?: string;
  frequency?: string;
  actions?: Array<{ action_type: string; value: string }>;
}

// Metric comparison config
const METRICS = [
  { key: 'impressions', label: 'Impressões', format: 'number', higherIsBetter: true },
  { key: 'clicks', label: 'Cliques', format: 'number', higherIsBetter: true },
  { key: 'ctr', label: 'CTR', format: 'percent', higherIsBetter: true },
  { key: 'cpc', label: 'CPC', format: 'currency', higherIsBetter: false },
  { key: 'cpm', label: 'CPM', format: 'currency', higherIsBetter: false },
  { key: 'spend', label: 'Gasto', format: 'currency', higherIsBetter: false },
  { key: 'reach', label: 'Alcance', format: 'number', higherIsBetter: true },
  { key: 'frequency', label: 'Frequência', format: 'decimal', higherIsBetter: false },
];

function formatMetric(value: number, format: string): string {
  if (isNaN(value)) return '—';
  switch (format) {
    case 'number': return Math.round(value).toLocaleString('pt-BR');
    case 'percent': return `${value.toFixed(2)}%`;
    case 'currency': return `R$ ${value.toFixed(2)}`;
    case 'decimal': return value.toFixed(2);
    default: return String(value);
  }
}

export default function ABTestingLab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { connectedAccount, isLoading: metaLoading } = useMetaConnection();
  const { callMetaApi } = useMetaApi();

  // Dialog states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [testName, setTestName] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [confidenceLevel, setConfidenceLevel] = useState('95');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Ads selection
  const [metaAds, setMetaAds] = useState<MetaAd[]>([]);
  const [selectedAdIds, setSelectedAdIds] = useState<string[]>([]);
  const [loadingAds, setLoadingAds] = useState(false);
  const [adSearch, setAdSearch] = useState('');

  // AI states
  const [aiResult, setAiResult] = useState('');
  const [aiResultTitle, setAiResultTitle] = useState('');
  const [analyzingTestId, setAnalyzingTestId] = useState<string | null>(null);

  // Manual fallback
  const [manualData, setManualData] = useState('');
  const [showManualDialog, setShowManualDialog] = useState(false);

  // Insights for expanded test
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const [insightsData, setInsightsData] = useState<Record<string, AdInsight>>({});
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [viewMode, setViewMode] = useState<'simplified' | 'expert'>('simplified');

  const { sendSingleMessage: analyzeWithAI, isLoading: aiLoading } = useClaudeChat({
    context: 'insights',
    onDelta: (delta) => setAiResult(prev => prev + delta),
    onComplete: () => setAnalyzingTestId(null),
    onError: (err) => {
      setAnalyzingTestId(null);
      toast({ title: 'Erro na análise', description: err, variant: 'destructive' });
    },
  });

  // Fetch tests
  const { data: tests, isLoading } = useQuery({
    queryKey: ['ab-tests', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ab_tests')
        .select('*, ab_test_variants(*)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  // Fetch real ads from Meta when dialog opens
  const fetchMetaAds = async () => {
    if (!connectedAccount) return;
    setLoadingAds(true);
    try {
      const data = await callMetaApi({
        endpoint: 'act_{ad_account_id}/ads',
        params: {
          fields: 'name,status,effective_status',
          limit: '100',
        },
      });
      setMetaAds(data?.data || []);
    } catch (err: any) {
      toast({ title: 'Erro ao buscar anúncios', description: err.message, variant: 'destructive' });
    } finally {
      setLoadingAds(false);
    }
  };

  useEffect(() => {
    if (isCreateOpen && connectedAccount) {
      fetchMetaAds();
      setSelectedAdIds([]);
      setAdSearch('');
    }
  }, [isCreateOpen, connectedAccount]);

  const toggleAdSelection = (adId: string) => {
    setSelectedAdIds(prev => {
      if (prev.includes(adId)) return prev.filter(id => id !== adId);
      if (prev.length >= 4) {
        toast({ title: 'Máximo 4 anúncios', variant: 'destructive' });
        return prev;
      }
      return [...prev, adId];
    });
  };

  // Create test with real ads
  const createTestMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Não autenticado');
      if (selectedAdIds.length < 2) throw new Error('Selecione pelo menos 2 anúncios');

      const { data: test, error: testError } = await supabase
        .from('ab_tests')
        .insert({
          user_id: user.id,
          name: testName,
          hypothesis,
          test_type: 'creative',
          confidence_level: parseFloat(confidenceLevel),
          status: 'running' as const,
          start_date: startDate,
          end_date: endDate,
        })
        .select()
        .single();
      if (testError) throw testError;

      const variantInserts = selectedAdIds.map((adId, i) => {
        const ad = metaAds.find(a => a.id === adId);
        return {
          test_id: test.id,
          name: ad?.name || `Ad ${adId}`,
          meta_ad_id: adId,
          is_control: i === 0,
          description: `Meta Ad ID: ${adId}`,
        };
      });
      const { error: varError } = await supabase.from('ab_test_variants').insert(variantInserts);
      if (varError) throw varError;
      return test;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ab-tests'] });
      toast({ title: 'Teste criado com sucesso!' });
      setIsCreateOpen(false);
      setTestName('');
      setHypothesis('');
      setSelectedAdIds([]);
    },
    onError: (err: any) => {
      toast({ title: 'Erro ao criar teste', description: err.message, variant: 'destructive' });
    },
  });

  // Fetch insights for a test's ads
  const fetchInsightsForTest = async (test: any) => {
    const variants = test.ab_test_variants?.filter((v: any) => v.meta_ad_id) || [];
    if (!variants.length) return;

    setExpandedTestId(test.id);
    setLoadingInsights(true);
    setInsightsData({});

    const since = test.start_date || startDate;
    const until = test.end_date || new Date().toISOString().split('T')[0];

    try {
      const results: Record<string, AdInsight> = {};
      await Promise.all(
        variants.map(async (v: any) => {
          try {
            const data = await callMetaApi({
              endpoint: `${v.meta_ad_id}/insights`,
              params: {
                fields: 'impressions,clicks,ctr,cpc,cpm,spend,reach,frequency,actions,cost_per_action_type',
                time_range: JSON.stringify({ since, until }),
              },
            });
            results[v.meta_ad_id] = data?.data?.[0] || {};
          } catch {
            results[v.meta_ad_id] = {};
          }
        })
      );
      setInsightsData(results);
    } finally {
      setLoadingInsights(false);
    }
  };

  // Auto-scale/pause logic
  const autoScaleMutation = useMutation({
    mutationFn: async ({ testId }: { testId: string }) => {
      const test = tests?.find((t: any) => t.id === testId);
      if (!test) throw new Error('Teste não encontrado');
      const variants = test.ab_test_variants?.filter((v: any) => v.meta_ad_id) || [];
      if (variants.length < 2) throw new Error('Precisa de pelo menos 2 variantes');

      // Fetch current insights
      const since = test.start_date || startDate;
      const until = test.end_date || new Date().toISOString().split('T')[0];

      const results: Record<string, any> = {};
      await Promise.all(variants.map(async (v: any) => {
        try {
          const data = await callMetaApi({
            endpoint: `${v.meta_ad_id}/insights`,
            params: {
              fields: 'impressions,clicks,ctr,cpc,spend,actions',
              time_range: JSON.stringify({ since, until }),
            },
          });
          results[v.meta_ad_id] = data?.data?.[0] || {};
        } catch { results[v.meta_ad_id] = {}; }
      }));

      // Determine winner/loser by CTR (primary) and CPC (secondary)
      const scored = variants.map((v: any) => {
        const insight = results[v.meta_ad_id] || {};
        const ctr = parseFloat(insight.ctr || '0');
        const cpc = parseFloat(insight.cpc || '999');
        const impressions = parseInt(insight.impressions || '0', 10);
        return { ...v, ctr, cpc, impressions, score: ctr * 100 - cpc };
      }).filter((v: any) => v.impressions > 100); // min impressions threshold

      if (scored.length < 2) throw new Error('Dados insuficientes — aguarde mais impressões');

      scored.sort((a, b) => b.score - a.score);
      const winner = scored[0];
      const losers = scored.slice(1);

      const actions: string[] = [];

      // Pause losers with significantly worse performance
      for (const loser of losers) {
        if (winner.ctr > 0 && loser.ctr < winner.ctr * 0.7) {
          // Loser has < 70% of winner's CTR — pause it
          try {
            await callMetaApi({ endpoint: loser.meta_ad_id, method: 'POST', body: { status: 'PAUSED' } });
            actions.push(`⏸️ Pausado: ${loser.name} (CTR ${loser.ctr.toFixed(2)}% vs ${winner.ctr.toFixed(2)}%)`);
          } catch (err: any) {
            actions.push(`❌ Erro ao pausar ${loser.name}: ${err.message}`);
          }
        }
      }

      // Declare winner
      await supabase.from('ab_tests').update({
        winner_variant_id: winner.id,
        status: 'winner_selected' as const,
        learnings: `Vencedor: ${winner.name} (CTR: ${winner.ctr.toFixed(2)}%, CPC: R$${winner.cpc.toFixed(2)})`,
      }).eq('id', testId);

      return { winner: winner.name, actions };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['ab-tests'] });
      toast({
        title: `🏆 Vencedor: ${result.winner}`,
        description: result.actions.length > 0 ? result.actions.join('\n') : 'Nenhuma ação automática necessária.',
      });
    },
    onError: (err: any) => {
      toast({ title: 'Erro na auto-otimização', description: err.message, variant: 'destructive' });
    },
  });

  // Mutations
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "running" | "paused" | "completed" | "winner_selected" }) => {
      const { error } = await supabase.from('ab_tests').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ab-tests'] }),
  });

  const declareWinnerMutation = useMutation({
    mutationFn: async ({ testId, variantId }: { testId: string; variantId: string }) => {
      const { error } = await supabase.from('ab_tests').update({
        winner_variant_id: variantId,
        status: 'winner_selected' as const,
      }).eq('id', testId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ab-tests'] });
      toast({ title: 'Vencedor declarado!' });
    },
  });

  const deleteTestMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('ab_test_variants').delete().eq('test_id', id);
      const { error } = await supabase.from('ab_tests').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ab-tests'] });
      toast({ title: 'Teste excluído' });
      if (expandedTestId) setExpandedTestId(null);
    },
  });

  // AI analysis with real data
  const handleAnalyzeTest = async (test: any) => {
    // Fetch fresh insights first
    await fetchInsightsForTest(test);
    
    setAnalyzingTestId(test.id);
    setAiResult('');
    setAiResultTitle(`Análise: ${test.name}`);

    const variants = test.ab_test_variants || [];
    const variantsWithMetrics = variants.map((v: any) => {
      const insight = insightsData[v.meta_ad_id] || {};
      return {
        name: v.name,
        is_control: v.is_control,
        meta_ad_id: v.meta_ad_id,
        impressions: insight.impressions || '0',
        clicks: insight.clicks || '0',
        ctr: insight.ctr || '0',
        cpc: insight.cpc || '0',
        cpm: insight.cpm || '0',
        spend: insight.spend || '0',
        reach: insight.reach || '0',
        frequency: insight.frequency || '0',
      };
    });

    const prompt = `Analise este teste A/B de anúncios reais do Meta Ads.

**Teste:** ${test.name}
**Hipótese:** ${test.hypothesis || 'Não informada'}
**Período:** ${test.start_date} a ${test.end_date || 'hoje'}
**Confiança desejada:** ${test.confidence_level || 95}%

**Anúncios e métricas reais:**
${JSON.stringify(variantsWithMetrics, null, 2)}

Por favor:
1. Compare as métricas lado a lado
2. Calcule a significância estatística aproximada
3. Identifique qual anúncio está vencendo em cada métrica
4. Recomende se deve parar o teste ou continuar
5. Sugira o vencedor com justificativa
6. Dê recomendações práticas

Formate em Markdown com headers, listas e emojis.`;

    await analyzeWithAI(prompt);
  };

  const handleSuggestTests = async () => {
    setAnalyzingTestId('suggest');
    setAiResult('');
    setAiResultTitle('Sugestões de Testes A/B');

    const prompt = `Sugira 3-5 testes A/B práticos para anúncios do Meta Ads. Para cada sugestão inclua:
1. Nome do teste
2. Hipótese fundamentada
3. O que comparar (tipo de criativo, copy, audiência)
4. Métrica principal a monitorar
5. Duração estimada

Formate em Markdown com headers e emojis.`;

    await analyzeWithAI(prompt);
  };

  const handleManualAnalysis = async () => {
    if (!manualData.trim()) return;
    setShowManualDialog(false);
    setAnalyzingTestId('manual');
    setAiResult('');
    setAiResultTitle('Análise Manual de Teste A/B');

    const prompt = `Analise os seguintes dados de teste A/B:\n\n${manualData}\n\nCalcule significância, identifique vencedor e recomende próximos passos. Formate em Markdown.`;
    await analyzeWithAI(prompt);
    setManualData('');
  };

  const totalTests = tests?.length || 0;
  const runningTests = tests?.filter((t: any) => t.status === 'running').length || 0;
  const completedTests = tests?.filter((t: any) => t.status === 'completed' || t.status === 'winner_selected').length || 0;
  const winnerTests = tests?.filter((t: any) => t.status === 'winner_selected').length || 0;
  const winRate = totalTests > 0 ? Math.round((winnerTests / totalTests) * 100) : 0;

  const filteredAds = metaAds.filter(ad =>
    ad.name.toLowerCase().includes(adSearch.toLowerCase())
  );

  // Determine winner per metric for highlighting
  const getMetricWinner = (variants: any[], metricKey: string, higherIsBetter: boolean) => {
    let bestIdx = -1;
    let bestVal = higherIsBetter ? -Infinity : Infinity;
    variants.forEach((v: any, i: number) => {
      const insight = insightsData[v.meta_ad_id] || {};
      const val = parseFloat((insight as any)[metricKey] || '0');
      if (higherIsBetter ? val > bestVal : val < bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    });
    return bestIdx;
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl">Comparador de Anúncios</h1>
            <p className="text-muted-foreground">Teste qual anúncio funciona melhor e invista no vencedor</p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {/* Toggle Simplificado / Especialista */}
            <div className="flex h-9 overflow-hidden rounded-xl border border-border/60 bg-muted/30 text-xs">
              <button
                onClick={() => setViewMode('simplified')}
                className={`h-full px-3.5 font-medium transition-all ${viewMode === 'simplified' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                🧪 Simplificado
              </button>
              <button
                onClick={() => setViewMode('expert')}
                className={`h-full px-3.5 font-medium transition-all ${viewMode === 'expert' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                ⚙️ Especialista
              </button>
            </div>
            <Button variant="outline" onClick={handleSuggestTests} disabled={aiLoading}>
              <Sparkles className="mr-2 h-4 w-4" /> Sugerir com IA
            </Button>
            <Button className="gradient-primary" onClick={() => setIsCreateOpen(true)} disabled={!connectedAccount}>
              <Plus className="mr-2 h-4 w-4" /> Criar Teste
            </Button>
          </div>
        </div>

        {/* ── MODO SIMPLIFICADO ── */}
        {viewMode === 'simplified' && (
          <div className="space-y-6">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <p className="text-sm font-medium text-foreground">💡 O que é um teste A/B?</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Você coloca dois anúncios para rodar ao mesmo tempo e o sistema mede qual traz mais resultado. Depois é só pausar o que perder e investir mais no que ganhar.
              </p>
            </div>

            <div>
              <h2 className="text-lg font-semibold mb-1">🚀 Ideias de testes para começar</h2>
              <p className="text-sm text-muted-foreground mb-4">Clique em uma ideia para criar o teste agora</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { emoji: '🖼️', title: 'Imagem vs Vídeo', description: 'Teste se um vídeo curto performa melhor do que uma imagem estática no seu anúncio.', hypothesis: 'O vídeo terá CTR mais alto do que a imagem estática' },
                  { emoji: '✍️', title: 'Dois textos diferentes', description: 'Mantenha a mesma imagem mas teste dois textos diferentes para ver qual convence mais.', hypothesis: 'Um texto mais curto e direto terá mais cliques do que um texto longo' },
                  { emoji: '🎯', title: 'Públicos diferentes', description: 'Mostre o mesmo anúncio para dois públicos distintos e veja qual responde melhor.', hypothesis: 'O público mais jovem (18-30) terá CTR mais alto' },
                  { emoji: '🔴 vs 🔵', title: 'Cores do criativo', description: 'Teste variações do seu criativo com cores ou fundos diferentes.', hypothesis: 'Criativo com fundo claro terá mais cliques do que fundo escuro' },
                  { emoji: '📢', title: 'CTAs diferentes', description: 'Teste chamadas para ação distintas como "Compre agora" vs "Saiba mais".', hypothesis: '"Compre agora" gerará mais conversões do que "Saiba mais"' },
                  { emoji: '⏰', title: 'Horário de veiculação', description: 'Teste o mesmo anúncio em horários diferentes do dia para achar o melhor momento.', hypothesis: 'Anúncios à noite terão mais conversões do que de manhã' },
                ].map((idea, i) => (
                  <button
                    key={i}
                    onClick={() => { setHypothesis(idea.hypothesis); setIsCreateOpen(true); }}
                    className="group flex flex-col gap-3 rounded-xl border border-border/50 bg-card/60 p-5 text-left transition-all hover:border-primary/50 hover:bg-primary/5 hover:shadow-md"
                  >
                    <span className="text-3xl">{idea.emoji}</span>
                    <div>
                      <p className="font-semibold text-sm text-foreground">{idea.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{idea.description}</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                      <Plus className="h-3 w-3" /> Criar este teste
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {tests && tests.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-3">Meus Testes</h2>
                <div className="space-y-2">
                  {tests.map((test: any) => (
                    <div key={test.id} className="flex items-center justify-between gap-4 rounded-lg border border-border/50 bg-card/50 px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`h-2 w-2 rounded-full shrink-0 ${test.status === 'running' ? 'bg-primary animate-pulse' : test.status === 'winner_selected' ? 'bg-emerald-400' : 'bg-muted-foreground'}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{test.name}</p>
                          <p className="text-xs text-muted-foreground">{statusLabels[test.status] || test.status}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className={`text-xs shrink-0 ${statusColors[test.status] || ''}`}>
                        {statusLabels[test.status] || test.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border/50 bg-card/50 p-4 text-center space-y-2">
              <p className="text-sm font-medium">Quer ver métricas detalhadas lado a lado?</p>
              <p className="text-xs text-muted-foreground">CTR, CPC, CPM, alcance e análise de IA para cada variante.</p>
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

        {!connectedAccount && !metaLoading && (
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="flex items-center gap-3 p-4">
              <BarChart3 className="h-5 w-5 text-warning" />
              <p className="text-sm text-muted-foreground">Conecte sua conta Meta Ads nas <a href="/settings" className="text-primary underline">Configurações</a> para criar testes com anúncios reais.</p>
            </CardContent>
          </Card>
        )}

        {/* KPIs */}
        <div className="grid gap-4 md:grid-cols-4">
          {[
            { icon: FlaskConical, label: 'Testes Totais', value: totalTests, color: 'primary' },
            { icon: Trophy, label: 'Concluídos', value: completedTests, color: 'success' },
            { icon: TrendingUp, label: 'Em Andamento', value: runningTests, color: 'warning' },
            { icon: Percent, label: 'Win Rate', value: `${winRate}%`, color: 'primary' },
          ].map(({ icon: Icon, label, value, color }) => (
            <Card key={label} className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-${color}/20`}>
                    <Icon className={`h-5 w-5 text-${color}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{value}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* AI Result */}
        {aiResult && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="border-primary/30 bg-card/50 backdrop-blur-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Brain className="h-5 w-5 text-primary" />
                    {aiResultTitle}
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setAiResult('')}>✕</Button>
                </div>
              </CardHeader>
              <CardContent>
                <MarkdownRenderer content={aiResult} />
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Tests Grid */}
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-lg" />)}
          </div>
        ) : !tests?.length ? (
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="flex flex-col items-center gap-3 py-16">
              <FlaskConical className="h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">Nenhum teste A/B criado ainda.</p>
              <Button className="gradient-primary" onClick={() => setIsCreateOpen(true)} disabled={!connectedAccount}>
                <Plus className="mr-2 h-4 w-4" /> Criar Primeiro Teste
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {tests.map((test: any, index: number) => {
              const variants = test.ab_test_variants || [];
              const hasMetaAds = variants.some((v: any) => v.meta_ad_id);
              const isExpanded = expandedTestId === test.id;

              return (
                <motion.div key={test.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                  <Card className="border-border/50 bg-card/50 backdrop-blur-sm transition-all hover:border-primary/30">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base">{test.name}</CardTitle>
                          <div className="mt-1 flex gap-2">
                            <Badge className={statusColors[test.status] || 'bg-muted text-muted-foreground'}>
                              {statusLabels[test.status] || test.status}
                            </Badge>
                            {hasMetaAds && <Badge variant="secondary">Meta Ads</Badge>}
                            {test.start_date && (
                              <Badge variant="outline" className="text-xs">
                                {new Date(test.start_date).toLocaleDateString('pt-BR')} — {test.end_date ? new Date(test.end_date).toLocaleDateString('pt-BR') : 'hoje'}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {test.hypothesis && <p className="text-sm text-muted-foreground">{test.hypothesis}</p>}

                      {/* Variant names */}
                      <div className="flex flex-wrap gap-2">
                        {variants.map((v: any) => (
                          <Badge key={v.id} variant={v.is_control ? 'default' : 'outline'} className="text-xs">
                            {v.is_control ? '🎯 ' : ''}{v.name}
                          </Badge>
                        ))}
                      </div>

                      {/* Side-by-side comparison table */}
                      {isExpanded && hasMetaAds && (
                        <div className="overflow-x-auto">
                          {loadingInsights ? (
                            <div className="flex items-center gap-2 py-6 justify-center">
                              <RefreshCw className="h-4 w-4 animate-spin" />
                              <span className="text-sm text-muted-foreground">Buscando métricas reais...</span>
                            </div>
                          ) : Object.keys(insightsData).length > 0 ? (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-[120px]">Métrica</TableHead>
                                  {variants.filter((v: any) => v.meta_ad_id).map((v: any) => (
                                    <TableHead key={v.id} className="text-center">
                                      {v.is_control ? '🎯 ' : ''}{v.name}
                                    </TableHead>
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {METRICS.map(metric => {
                                  const metaVariants = variants.filter((v: any) => v.meta_ad_id);
                                  const winnerIdx = getMetricWinner(metaVariants, metric.key, metric.higherIsBetter);
                                  const values = metaVariants.map((v: any) => {
                                    const insight = insightsData[v.meta_ad_id] || {};
                                    return parseFloat((insight as any)[metric.key] || '0');
                                  });
                                  const maxVal = Math.max(...values, 1);

                                  return (
                                    <TableRow key={metric.key}>
                                      <TableCell className="font-medium text-sm">{metric.label}</TableCell>
                                      {metaVariants.map((v: any, i: number) => {
                                        const val = values[i];
                                        const isWinner = i === winnerIdx && val > 0;
                                        return (
                                          <TableCell key={v.id} className="text-center">
                                            <div className={`text-sm font-semibold ${isWinner ? 'text-green-500' : ''}`}>
                                              {formatMetric(val, metric.format)}
                                              {isWinner && ' ✓'}
                                            </div>
                                            {(metric.format === 'number' || metric.format === 'currency') && (
                                              <Progress
                                                value={maxVal > 0 ? (val / maxVal) * 100 : 0}
                                                className={`mt-1 h-1.5 ${isWinner ? '[&>div]:bg-green-500' : ''}`}
                                              />
                                            )}
                                          </TableCell>
                                        );
                                      })}
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          ) : (
                            <p className="text-sm text-muted-foreground text-center py-4">Sem dados para o período selecionado.</p>
                          )}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex flex-wrap gap-1.5">
                        {hasMetaAds && (
                          <Button
                            size="sm"
                            variant={isExpanded ? 'default' : 'outline'}
                            onClick={() => {
                              if (isExpanded) {
                                setExpandedTestId(null);
                              } else {
                                fetchInsightsForTest(test);
                              }
                            }}
                            disabled={loadingInsights}
                            className="text-xs"
                          >
                            {loadingInsights ? <RefreshCw className="mr-1 h-3 w-3 animate-spin" /> : <BarChart3 className="mr-1 h-3 w-3" />}
                            {isExpanded ? 'Fechar Métricas' : 'Ver Métricas'}
                          </Button>
                        )}
                        {isExpanded && hasMetaAds && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => fetchInsightsForTest(test)}
                            disabled={loadingInsights}
                            className="text-xs"
                          >
                            <RefreshCw className="mr-1 h-3 w-3" /> Atualizar
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAnalyzeTest(test)}
                          disabled={aiLoading}
                          className="text-xs"
                        >
                          <Brain className="mr-1 h-3 w-3" /> Analisar com IA
                        </Button>
                        {test.status === 'running' && hasMetaAds && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => autoScaleMutation.mutate({ testId: test.id })}
                            disabled={autoScaleMutation.isPending}
                            className="text-xs gradient-primary text-primary-foreground"
                          >
                            {autoScaleMutation.isPending ? <RefreshCw className="mr-1 h-3 w-3 animate-spin" /> : <TrendingUp className="mr-1 h-3 w-3" />}
                            Auto Escalar/Pausar
                          </Button>
                        )}
                        {test.status === 'running' && variants.length > 0 && (
                          <Select onValueChange={(variantId) => declareWinnerMutation.mutate({ testId: test.id, variantId })}>
                            <SelectTrigger className="h-8 w-auto gap-1 text-xs">
                              <Award className="h-3 w-3" /> Vencedor
                            </SelectTrigger>
                            <SelectContent>
                              {variants.map((v: any) => (
                                <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {test.status === 'running' && (
                          <Button size="sm" variant="ghost" onClick={() => updateStatusMutation.mutate({ id: test.id, status: 'paused' })} className="text-xs">
                            <Pause className="mr-1 h-3 w-3" /> Pausar
                          </Button>
                        )}
                        {test.status === 'paused' && (
                          <Button size="sm" variant="ghost" onClick={() => updateStatusMutation.mutate({ id: test.id, status: 'running' })} className="text-xs">
                            <Play className="mr-1 h-3 w-3" /> Retomar
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => deleteTestMutation.mutate(test.id)} className="text-xs text-destructive hover:text-destructive">
                          <Trash2 className="mr-1 h-3 w-3" /> Excluir
                        </Button>
                      </div>

                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        {test.confidence_level && <span>Confiança: {test.confidence_level}%</span>}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
        </>)}
      </div>

      {/* Create Test Dialog — Select Real Ads */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Comparar Anúncios do Meta Ads</DialogTitle>
            <DialogDescription>Selecione 2 a 4 anúncios reais para comparar lado a lado</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Nome do Teste</label>
              <Input value={testName} onChange={e => setTestName(e.target.value)} placeholder="Ex: Vídeo vs Carrossel — Fevereiro" />
            </div>
            <div>
              <label className="text-sm font-medium">Hipótese (opcional)</label>
              <Textarea value={hypothesis} onChange={e => setHypothesis(e.target.value)} placeholder="Ex: O vídeo terá CTR 30% maior que o carrossel" rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Data Início</label>
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium">Data Fim</label>
                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Confiança</label>
              <Select value={confidenceLevel} onValueChange={setConfidenceLevel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="90">90%</SelectItem>
                  <SelectItem value="95">95%</SelectItem>
                  <SelectItem value="99">99%</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Ads list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Selecione os Anúncios ({selectedAdIds.length}/4)</label>
                <Button size="sm" variant="ghost" onClick={fetchMetaAds} disabled={loadingAds}>
                  <RefreshCw className={`mr-1 h-3 w-3 ${loadingAds ? 'animate-spin' : ''}`} /> Recarregar
                </Button>
              </div>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={adSearch}
                  onChange={e => setAdSearch(e.target.value)}
                  placeholder="Buscar anúncios..."
                  className="pl-9"
                />
              </div>
              <div className="max-h-[250px] overflow-y-auto space-y-1 rounded-lg border border-border/50 p-2">
                {loadingAds ? (
                  <div className="flex items-center gap-2 py-4 justify-center">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">Buscando anúncios...</span>
                  </div>
                ) : filteredAds.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Nenhum anúncio encontrado.</p>
                ) : (
                  filteredAds.map(ad => {
                    const isSelected = selectedAdIds.includes(ad.id);
                    const selIndex = selectedAdIds.indexOf(ad.id);
                    return (
                      <div
                        key={ad.id}
                        onClick={() => toggleAdSelection(ad.id)}
                        className={`flex items-center gap-3 rounded-md p-2.5 cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50 border border-transparent'
                        }`}
                      >
                        <Checkbox checked={isSelected} className="pointer-events-none" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{ad.name}</p>
                          <p className="text-xs text-muted-foreground">ID: {ad.id} · {ad.effective_status}</p>
                        </div>
                        {isSelected && (
                          <Badge variant={selIndex === 0 ? 'default' : 'secondary'} className="shrink-0 text-xs">
                            {selIndex === 0 ? '🎯 Controle' : `Variante ${String.fromCharCode(65 + selIndex)}`}
                          </Badge>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
            <Button
              className="gradient-primary"
              onClick={() => createTestMutation.mutate()}
              disabled={!testName.trim() || selectedAdIds.length < 2 || createTestMutation.isPending}
            >
              {createTestMutation.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Criar Teste ({selectedAdIds.length} ads)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Analysis Dialog */}
      <Dialog open={showManualDialog} onOpenChange={setShowManualDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Análise Manual de Teste A/B</DialogTitle>
            <DialogDescription>Cole seus dados de teste A/B para análise com IA</DialogDescription>
          </DialogHeader>
          <Textarea
            value={manualData}
            onChange={e => setManualData(e.target.value)}
            placeholder={`Cole aqui os dados. Ex:\n\nAd A: 10.000 imp, 250 cliques, CTR 2.5%\nAd B: 10.000 imp, 320 cliques, CTR 3.2%`}
            className="min-h-[150px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManualDialog(false)}>Cancelar</Button>
            <Button className="gradient-primary" onClick={handleManualAnalysis} disabled={!manualData.trim() || aiLoading}>
              <Brain className="mr-2 h-4 w-4" /> Analisar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
