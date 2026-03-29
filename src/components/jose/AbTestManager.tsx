import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import {
  FlaskConical, TrendingUp, TrendingDown, Minus, CheckCircle, Loader2,
  RefreshCw, Trophy, Pause, ArrowUp, Zap, BarChart3, Image,
} from 'lucide-react';

interface ConnectedAccount {
  account_id?: string;
  id?: string;
}

interface AbTestManagerProps {
  connectedAccount?: ConnectedAccount | null;
}

interface AbTest {
  id: string;
  test_name: string;
  control_adset_id: string;
  variant_adset_id: string;
  metric: string;
  start_date: string;
  end_date: string;
  status: string;
  control_metrics?: {
    spend: number;
    clicks: number;
    impressions: number;
    ctr: number;
    cpc: number;
    conversions: number;
    roas: number;
  };
  variant_metrics?: {
    spend: number;
    clicks: number;
    impressions: number;
    ctr: number;
    cpc: number;
    conversions: number;
    roas: number;
  };
  winner?: 'control' | 'variant';
  confidence?: number;
}

interface Creative {
  id: string;
  name: string;
  thumbnail_url?: string;
  spend: number;
  clicks: number;
  impressions: number;
  ctr: number;
  cpc: number;
  conversions: number;
  roas: number;
  conversion_rate: number;
}

const METRIC_OPTIONS = [
  { value: 'CTR', label: 'CTR (Taxa de Cliques)' },
  { value: 'CPA', label: 'CPA (Custo por Ação)' },
  { value: 'ROAS', label: 'ROAS (Retorno)' },
  { value: 'CPL', label: 'CPL (Custo por Lead)' },
  { value: 'CPC', label: 'CPC (Custo por Clique)' },
];

const DURATION_OPTIONS = [
  { value: '7', label: '7 dias' },
  { value: '14', label: '14 dias' },
  { value: '30', label: '30 dias' },
];

const fmt = (n: number, d = 2) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

function MetricCompare({ label, control, variant, lowerIsBetter = false, prefix = '' }: {
  label: string;
  control: number;
  variant: number;
  lowerIsBetter?: boolean;
  prefix?: string;
}) {
  const diff = variant - control;
  const isVariantBetter = lowerIsBetter ? diff < 0 : diff > 0;
  const pct = control > 0 ? Math.abs(diff / control) * 100 : 0;

  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded bg-muted/30 p-2 text-center">
          <p className="text-[10px] text-muted-foreground mb-0.5">Controle</p>
          <p className="text-sm font-bold">{prefix}{fmt(control)}</p>
        </div>
        <div className={`rounded p-2 text-center border ${isVariantBetter ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
          <p className="text-[10px] text-muted-foreground mb-0.5">Variante B</p>
          <div className="flex items-center justify-center gap-1">
            <p className={`text-sm font-bold ${isVariantBetter ? 'text-emerald-400' : 'text-red-400'}`}>{prefix}{fmt(variant)}</p>
            {diff !== 0 && (
              <span className={`text-[10px] ${isVariantBetter ? 'text-emerald-400' : 'text-red-400'}`}>
                {diff > 0 ? '+' : ''}{pct.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AbTestManager({ connectedAccount }: AbTestManagerProps) {
  const { toast } = useToast();

  // Tests state
  const [tests, setTests] = useState<AbTest[]>([]);
  const [isLoadingTests, setIsLoadingTests] = useState(false);

  // New test form
  const [testName, setTestName] = useState('');
  const [sourceAdsetId, setSourceAdsetId] = useState('');
  const [testMetric, setTestMetric] = useState('CTR');
  const [duration, setDuration] = useState('14');
  const [isCreatingTest, setIsCreatingTest] = useState(false);

  // Creative performance
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [isLoadingCreatives, setIsLoadingCreatives] = useState(false);

  const loadTests = async () => {
    if (!connectedAccount?.account_id) return;
    setIsLoadingTests(true);
    try {
      const { data } = await (supabase as any).functions.invoke('apollo-agent', {
        body: { action: 'get_ab_results', targetAccountId: connectedAccount.account_id },
      });
      setTests(data?.tests || []);
    } catch { /* ignore */ } finally {
      setIsLoadingTests(false);
    }
  };

  const loadCreatives = async () => {
    if (!connectedAccount?.account_id) return;
    setIsLoadingCreatives(true);
    try {
      const { data } = await (supabase as any).functions.invoke('apollo-agent', {
        body: { action: 'get_creative_performance', targetAccountId: connectedAccount.account_id },
      });
      setCreatives(data?.creatives || []);
    } catch { /* ignore */ } finally {
      setIsLoadingCreatives(false);
    }
  };

  useEffect(() => {
    loadTests();
    loadCreatives();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedAccount?.account_id]);

  const handleCreateTest = async () => {
    if (!sourceAdsetId.trim()) {
      toast({ title: 'Ad Set obrigatório', description: 'Informe o ID do ad set a ser testado.', variant: 'destructive' });
      return;
    }
    if (!connectedAccount?.account_id) {
      toast({ title: 'Sem conta conectada', variant: 'destructive' });
      return;
    }
    setIsCreatingTest(true);
    try {
      const { data } = await (supabase as any).functions.invoke('apollo-agent', {
        body: {
          action: 'ab_test_setup',
          targetAccountId: connectedAccount.account_id,
          test_name: testName || `Teste A/B — ${new Date().toLocaleDateString('pt-BR')}`,
          source_adset_id: sourceAdsetId,
          metric: testMetric,
          duration_days: parseInt(duration),
        },
      });

      if (data?.test_id) {
        toast({ title: '🧪 Teste A/B criado!', description: `Variante B criada: ${data.variant_adset_id}` });
        setTestName('');
        setSourceAdsetId('');
        loadTests();
      } else {
        toast({ title: 'Erro ao criar teste', description: data?.error || 'Tente novamente', variant: 'destructive' });
      }
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsCreatingTest(false);
    }
  };

  const getMetricValues = (test: AbTest) => {
    const c = test.control_metrics;
    const v = test.variant_metrics;
    if (!c || !v) return null;
    const m = test.metric?.toLowerCase();
    return { control: (c as any)[m] || 0, variant: (v as any)[m] || 0 };
  };

  const daysLeft = (endDate: string) => {
    const diff = new Date(endDate).getTime() - Date.now();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 0;
  };

  return (
    <div className="space-y-6">
      {/* Active Tests */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-orange-400" />
            Testes A/B Ativos
            {tests.length > 0 && (
              <Badge variant="outline" className="text-[10px] bg-orange-500/10 text-orange-400 border-orange-500/30">
                {tests.length}
              </Badge>
            )}
          </CardTitle>
          <Button size="sm" variant="outline" onClick={loadTests} disabled={isLoadingTests} className="gap-1.5 h-8 text-xs">
            {isLoadingTests ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Atualizar
          </Button>
        </CardHeader>
        <CardContent>
          {isLoadingTests ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Carregando testes...</span>
            </div>
          ) : tests.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground">
              <FlaskConical className="h-8 w-8 opacity-30" />
              <p className="text-sm">Nenhum teste A/B criado ainda.</p>
              <p className="text-xs">Crie um teste abaixo para comparar variantes de público ou criativo.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {tests.map(test => {
                const metricVals = getMetricValues(test);
                const lowerIsBetter = ['cpa', 'cpc', 'cpl'].includes(test.metric?.toLowerCase());

                return (
                  <div key={test.id} className="rounded-xl border border-border/50 p-4 space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm">{test.test_name}</p>
                          <Badge variant="outline" className={`text-[10px] ${test.status === 'running' ? 'text-emerald-400 border-emerald-500/30' : 'text-muted-foreground'}`}>
                            {test.status === 'running' ? 'Rodando' : test.status}
                          </Badge>
                          {test.winner && (
                            <Badge className="text-[10px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30 gap-1">
                              <Trophy className="h-2.5 w-2.5" />
                              {test.winner === 'control' ? 'Controle vence' : 'Variante B vence'}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                          <span>Métrica: {test.metric}</span>
                          <span>Início: {new Date(test.start_date).toLocaleDateString('pt-BR')}</span>
                          {daysLeft(test.end_date) > 0 && <span>{daysLeft(test.end_date)} dias restantes</span>}
                        </div>
                      </div>
                      {test.confidence !== undefined && (
                        <div className="text-right flex-shrink-0">
                          <p className="text-[10px] text-muted-foreground">Confiança</p>
                          <p className={`text-sm font-bold ${test.confidence >= 80 ? 'text-emerald-400' : test.confidence >= 60 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                            {test.confidence}%
                          </p>
                        </div>
                      )}
                    </div>

                    {test.confidence !== undefined && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>Confiança estatística</span>
                          <span>{test.confidence}%</span>
                        </div>
                        <Progress value={test.confidence} className="h-1.5" />
                      </div>
                    )}

                    {metricVals && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <MetricCompare
                          label="CTR (%)"
                          control={test.control_metrics?.ctr || 0}
                          variant={test.variant_metrics?.ctr || 0}
                        />
                        <MetricCompare
                          label="CPC (R$)"
                          control={test.control_metrics?.cpc || 0}
                          variant={test.variant_metrics?.cpc || 0}
                          lowerIsBetter
                          prefix="R$ "
                        />
                        <MetricCompare
                          label="Conversões"
                          control={test.control_metrics?.conversions || 0}
                          variant={test.variant_metrics?.conversions || 0}
                        />
                        <MetricCompare
                          label="ROAS"
                          control={test.control_metrics?.roas || 0}
                          variant={test.variant_metrics?.roas || 0}
                        />
                      </div>
                    )}

                    {test.winner && test.confidence !== undefined && test.confidence >= 70 && (
                      <div className="flex items-center justify-between p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-emerald-400" />
                          <p className="text-sm font-medium text-emerald-400">
                            {test.winner === 'variant' ? 'Variante B é melhor' : 'Controle é melhor'} — {test.confidence}% de confiança
                          </p>
                        </div>
                        <Button size="sm" className="gap-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs">
                          <ArrowUp className="h-3 w-3" />
                          Aplicar vencedor
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* New Test Form */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-orange-400" />
              Iniciar Novo Teste A/B
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome do teste</Label>
              <Input
                value={testName}
                onChange={e => setTestName(e.target.value)}
                placeholder="Ex: Criativo Foto vs Vídeo"
                className="text-sm h-8"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">ID do Ad Set (controle)</Label>
              <Input
                value={sourceAdsetId}
                onChange={e => setSourceAdsetId(e.target.value)}
                placeholder="Ex: 12345678901"
                className="text-sm h-8 font-mono"
              />
              <p className="text-[10px] text-muted-foreground">O JOSÉ vai clonar este ad set como Variante B automaticamente.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Métrica a otimizar</Label>
                <Select value={testMetric} onValueChange={setTestMetric}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METRIC_OPTIONS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Duração</Label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATION_OPTIONS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              onClick={handleCreateTest}
              disabled={isCreatingTest || !sourceAdsetId.trim()}
              className="w-full gap-2 bg-orange-500 hover:bg-orange-600 text-white"
              size="sm"
            >
              {isCreatingTest
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Criando...</>
                : <><Zap className="h-3.5 w-3.5" /> Iniciar Teste A/B</>
              }
            </Button>
          </CardContent>
        </Card>

        {/* Creative Performance */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-orange-400" />
              Performance de Criativos
            </CardTitle>
            <Button size="sm" variant="outline" onClick={loadCreatives} disabled={isLoadingCreatives} className="gap-1 h-7 text-[11px]">
              {isLoadingCreatives ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Ver
            </Button>
          </CardHeader>
          <CardContent>
            {isLoadingCreatives ? (
              <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-xs">Carregando criativos...</span>
              </div>
            ) : creatives.length === 0 ? (
              <div className="flex flex-col items-center py-6 gap-2 text-muted-foreground">
                <Image className="h-7 w-7 opacity-30" />
                <p className="text-xs text-center">Clique em "Ver" para carregar a performance dos seus criativos.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {creatives.slice(0, 6).map((creative, i) => {
                  const rank = i + 1;
                  const rankColor = rank === 1 ? 'text-amber-400' : rank === 2 ? 'text-zinc-400' : 'text-zinc-600';
                  const isTop = rank <= 2;

                  return (
                    <div key={creative.id} className={`flex items-center gap-3 rounded-lg border p-2.5 transition-colors ${isTop ? 'border-orange-500/30 bg-orange-500/5' : 'border-border/40'}`}>
                      <span className={`text-xs font-bold w-4 text-center flex-shrink-0 ${rankColor}`}>#{rank}</span>

                      <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${isTop ? 'bg-orange-500/20' : 'bg-muted/50'}`}>
                        {creative.thumbnail_url ? (
                          <img src={creative.thumbnail_url} alt="" className="w-full h-full rounded-md object-cover" />
                        ) : (
                          <Image className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{creative.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">CTR: <span className={`font-medium ${creative.ctr >= 1.5 ? 'text-emerald-400' : ''}`}>{fmt(creative.ctr)}%</span></span>
                          <span className="text-[10px] text-muted-foreground">Gasto: R${fmt(creative.spend, 0)}</span>
                        </div>
                      </div>

                      <div className="flex gap-1 flex-shrink-0">
                        {isTop ? (
                          <Badge className="text-[10px] bg-orange-500/20 text-orange-400 border-orange-500/30 gap-0.5">
                            <TrendingUp className="h-2.5 w-2.5" /> Escalar
                          </Badge>
                        ) : (
                          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-muted-foreground gap-0.5">
                            <Pause className="h-2.5 w-2.5" /> Pausar
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
