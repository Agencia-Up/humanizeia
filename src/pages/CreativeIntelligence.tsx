import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCreativeIntelligence, CreativeWithScore } from '@/hooks/useCreativeIntelligence';
import {
  Brain, Image, Video, TrendingUp, TrendingDown, Zap, AlertTriangle,
  Palette, Crown, Target, BarChart3, RefreshCw, Sparkles, Eye,
  MousePointer, DollarSign, Star, Flame, ArrowRight, Layers,
  FlaskConical, CheckCircle, XCircle, Clock, Loader2,
} from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────────────────

const scoreColor = (s: number) => s >= 75 ? 'text-emerald-400' : s >= 50 ? 'text-amber-400' : 'text-red-400';
const scoreBg = (s: number) => s >= 75 ? 'bg-emerald-500/10 border-emerald-500/20' : s >= 50 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-red-500/10 border-red-500/20';
const fatigueColor = (f: number) => f >= 70 ? 'text-red-400' : f >= 40 ? 'text-amber-400' : 'text-emerald-400';
const fatigueLabel = (f: number) => f >= 70 ? 'Exausto' : f >= 40 ? 'Moderada' : 'Saudavel';

export default function CreativeIntelligence() {
  const {
    isLoading, getRankedCreatives, getABTests, getSelectionLog, getStats,
  } = useCreativeIntelligence();

  const [creatives, setCreatives] = useState<CreativeWithScore[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [abTests, setAbTests] = useState<any[]>([]);
  const [selectionLog, setSelectionLog] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    const [c, s, t, l] = await Promise.all([
      getRankedCreatives({ limit: 50 }),
      getStats(),
      getABTests(),
      getSelectionLog(30),
    ]);
    setCreatives(c);
    setStats(s);
    setAbTests(t);
    setSelectionLog(l);
    setLoading(false);
  };

  const filtered = filter === 'all' ? creatives
    : filter === 'top' ? creatives.filter(c => c.performance_score >= 75)
    : filter === 'exhausted' ? creatives.filter(c => c.fatigue_score >= 70)
    : filter === 'bezalel' ? creatives.filter(c => c.created_by === 'bezalel')
    : filter === 'unused' ? creatives.filter(c => c.times_used === 0)
    : creatives;

  return (
    <MainLayout>
      <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Brain className="h-7 w-7 text-purple-400" />
              Inteligência Criativa
              <Badge variant="outline" className="text-xs border-purple-500/30 text-purple-400">
                JOSÉ + BEZALEL
              </Badge>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Seleção inteligente, A/B testing e otimização contínua de criativos
            </p>
          </div>
          <Button onClick={loadAll} variant="outline" size="sm" className="gap-2" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar
          </Button>
        </div>

        {/* KPI Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <KPICard icon={<Layers className="h-4 w-4 text-blue-400" />} label="Total Criativos" value={stats.totalCreatives} />
            <KPICard icon={<Star className="h-4 w-4 text-emerald-400" />} label="Score Medio" value={`${stats.avgScore}/100`} />
            <KPICard icon={<Crown className="h-4 w-4 text-yellow-400" />} label="Top Performers" value={stats.topPerformers} />
            <KPICard icon={<Flame className="h-4 w-4 text-red-400" />} label="Exaustos" value={stats.exhausted} />
            <KPICard icon={<FlaskConical className="h-4 w-4 text-purple-400" />} label="Testes A/B" value={stats.runningTests} sub="ativos" />
            <KPICard icon={<Palette className="h-4 w-4 text-purple-400" />} label="Por BEZALEL" value={stats.byBezalel} />
          </div>
        )}

        <Tabs defaultValue="library" className="space-y-4">
          <TabsList className="bg-background/50 border border-border/50 h-10 overflow-x-auto flex-nowrap">
            <TabsTrigger value="library" className="gap-1.5 text-xs">
              <Image className="h-3.5 w-3.5" /> Biblioteca Ranqueada
            </TabsTrigger>
            <TabsTrigger value="abtests" className="gap-1.5 text-xs">
              <FlaskConical className="h-3.5 w-3.5" /> Testes A/B
              {abTests.filter(t => t.status === 'running').length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                  {abTests.filter(t => t.status === 'running').length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="log" className="gap-1.5 text-xs">
              <Clock className="h-3.5 w-3.5" /> Log de Decisões
            </TabsTrigger>
            <TabsTrigger value="flow" className="gap-1.5 text-xs">
              <Zap className="h-3.5 w-3.5" /> Fluxo Automático
            </TabsTrigger>
          </TabsList>

          {/* ── Biblioteca Ranqueada ── */}
          <TabsContent value="library" className="space-y-4">
            <div className="flex items-center gap-3">
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-48 h-8 text-sm">
                  <SelectValue placeholder="Filtrar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="top">Top Performers (75+)</SelectItem>
                  <SelectItem value="exhausted">Exaustos (fadiga 70+)</SelectItem>
                  <SelectItem value="bezalel">Criados por BEZALEL</SelectItem>
                  <SelectItem value="unused">Nunca Usados</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">{filtered.length} criativos</span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Image className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">Nenhum criativo encontrado</p>
                  <p className="text-xs text-muted-foreground mt-1">Envie criativos na Biblioteca ou gere com BEZALEL</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map(c => (
                  <CreativeCard key={c.id} creative={c} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Testes A/B ── */}
          <TabsContent value="abtests" className="space-y-4">
            {abTests.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <FlaskConical className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">Nenhum teste A/B ativo</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    JOSÉ cria testes automaticamente quando detecta fadiga criativa
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {abTests.map(test => (
                  <ABTestCard key={test.id} test={test} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Log de Decisões ── */}
          <TabsContent value="log" className="space-y-3">
            {selectionLog.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Clock className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">Nenhuma decisão registrada ainda</p>
                </CardContent>
              </Card>
            ) : (
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {selectionLog.map(entry => (
                    <LogEntry key={entry.id} entry={entry} />
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          {/* ── Fluxo Automático ── */}
          <TabsContent value="flow">
            <AutoFlowDiagram />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────────

function KPICard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          {icon}
          <span className="text-[11px]">{label}</span>
        </div>
        <p className="text-xl font-bold">
          {value}
          {sub && <span className="text-xs font-normal text-muted-foreground ml-1">{sub}</span>}
        </p>
      </CardContent>
    </Card>
  );
}

function CreativeCard({ creative: c }: { creative: CreativeWithScore }) {
  return (
    <Card className={`overflow-hidden border ${scoreBg(c.performance_score)}`}>
      {/* Thumbnail */}
      <div className="relative h-40 bg-muted/20 overflow-hidden">
        {c.thumbnail_url || c.file_url ? (
          <img src={c.thumbnail_url || c.file_url} alt={c.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {c.file_type === 'video' ? <Video className="h-10 w-10 text-muted-foreground/30" /> : <Image className="h-10 w-10 text-muted-foreground/30" />}
          </div>
        )}
        {/* Score badge */}
        <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs font-bold ${c.performance_score >= 75 ? 'bg-emerald-500 text-white' : c.performance_score >= 50 ? 'bg-amber-500 text-white' : 'bg-red-500 text-white'}`}>
          {c.performance_score}/100
        </div>
        {/* Type badge */}
        <div className="absolute top-2 left-2">
          <Badge variant="secondary" className="text-[10px] h-5">
            {c.file_type === 'video' ? <Video className="h-3 w-3 mr-1" /> : <Image className="h-3 w-3 mr-1" />}
            {c.file_type}
          </Badge>
        </div>
        {/* Creator badge */}
        {c.created_by === 'bezalel' && (
          <div className="absolute bottom-2 left-2">
            <Badge className="text-[10px] h-5 bg-purple-500/80 border-purple-400/30">
              <Palette className="h-3 w-3 mr-1" /> BEZALEL
            </Badge>
          </div>
        )}
      </div>

      <CardContent className="p-3 space-y-2">
        <p className="text-sm font-medium truncate">{c.name}</p>

        {/* Metrics row */}
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <div className="text-center">
            <p className="text-muted-foreground">CTR</p>
            <p className={`font-semibold ${c.avg_ctr >= 2 ? 'text-emerald-400' : c.avg_ctr >= 1 ? 'text-amber-400' : 'text-muted-foreground'}`}>
              {c.avg_ctr > 0 ? `${c.avg_ctr.toFixed(1)}%` : '-'}
            </p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground">ROAS</p>
            <p className={`font-semibold ${c.avg_roas >= 3 ? 'text-emerald-400' : c.avg_roas >= 1.5 ? 'text-amber-400' : 'text-muted-foreground'}`}>
              {c.avg_roas > 0 ? `${c.avg_roas.toFixed(1)}x` : '-'}
            </p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground">Usos</p>
            <p className="font-semibold">{c.times_used}</p>
          </div>
        </div>

        {/* Fatigue bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Fadiga</span>
            <span className={fatigueColor(c.fatigue_score)}>
              {c.fatigue_score}% — {fatigueLabel(c.fatigue_score)}
            </span>
          </div>
          <Progress value={c.fatigue_score} className="h-1.5" />
        </div>

        {/* Tags */}
        {c.tags && c.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {c.tags.slice(0, 3).map(tag => (
              <Badge key={tag} variant="outline" className="text-[9px] h-4 px-1.5">{tag}</Badge>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" className="flex-1 h-7 text-[11px] gap-1">
            <BarChart3 className="h-3 w-3" /> Performance
          </Button>
          {c.fatigue_score >= 40 && (
            <Button size="sm" variant="outline" className="flex-1 h-7 text-[11px] gap-1 text-purple-400 border-purple-500/30">
              <Sparkles className="h-3 w-3" /> Nova Variação
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ABTestCard({ test }: { test: any }) {
  const statusIcon = test.status === 'running' ? <Clock className="h-4 w-4 text-blue-400" />
    : test.status === 'concluded' ? <CheckCircle className="h-4 w-4 text-emerald-400" />
    : <XCircle className="h-4 w-4 text-red-400" />;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {statusIcon}
            <div>
              <p className="text-sm font-medium">{test.test_name || `Teste #${test.id.slice(0, 8)}`}</p>
              <p className="text-xs text-muted-foreground">Campanha: {test.campaign_id_meta}</p>
            </div>
          </div>
          <div className="text-right">
            <Badge variant={test.status === 'running' ? 'default' : 'secondary'} className="text-xs">
              {test.status === 'running' ? 'Em andamento' : test.status === 'concluded' ? 'Concluido' : 'Cancelado'}
            </Badge>
            {test.winner && (
              <p className="text-xs mt-1">
                <Crown className="h-3 w-3 inline text-yellow-400 mr-1" />
                Variante {test.winner.toUpperCase()} venceu
                {test.improvement_pct && <span className="text-emerald-400"> (+{test.improvement_pct.toFixed(1)}%)</span>}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LogEntry({ entry }: { entry: any }) {
  const actionConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    selected: { icon: <Target className="h-3.5 w-3.5" />, color: 'text-blue-400', label: 'Selecionado' },
    replaced: { icon: <RefreshCw className="h-3.5 w-3.5" />, color: 'text-amber-400', label: 'Substituido' },
    promoted: { icon: <TrendingUp className="h-3.5 w-3.5" />, color: 'text-emerald-400', label: 'Promovido' },
    retired: { icon: <TrendingDown className="h-3.5 w-3.5" />, color: 'text-red-400', label: 'Aposentado' },
  };

  const cfg = actionConfig[entry.action] || actionConfig.selected;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/5 border border-border/30">
      <div className={cfg.color}>{cfg.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-[10px] h-4 ${cfg.color}`}>{cfg.label}</Badge>
          {entry.score_at_selection && (
            <span className="text-[10px] text-muted-foreground">Score: {entry.score_at_selection}</span>
          )}
        </div>
        {entry.reason && <p className="text-xs text-muted-foreground mt-1 truncate">{entry.reason}</p>}
      </div>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
        {new Date(entry.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}

function AutoFlowDiagram() {
  const steps = [
    { icon: <Palette className="h-5 w-5 text-purple-400" />, agent: 'BEZALEL', title: 'Gera Criativos', desc: 'IA gera imagens, videos e copies. Usuario também pode enviar.' },
    { icon: <Layers className="h-5 w-5 text-blue-400" />, agent: 'BIBLIOTECA', title: 'Armazena na Biblioteca', desc: 'Criativos são classificados por nicho, tipo e objetivo.' },
    { icon: <Brain className="h-5 w-5 text-emerald-400" />, agent: 'JOSE', title: 'Seleção Inteligente', desc: 'JOSE seleciona os melhores com base em performance historica.' },
    { icon: <Target className="h-5 w-5 text-amber-400" />, agent: 'META ADS', title: 'Sobe Campanhas', desc: 'Criativos são inseridos nos anuncios via Meta Ads API.' },
    { icon: <BarChart3 className="h-5 w-5 text-cyan-400" />, agent: 'JOSE', title: 'Monitora Metricas', desc: 'CTR, CPA, ROAS, frequencia monitorados em tempo real.' },
    { icon: <FlaskConical className="h-5 w-5 text-purple-400" />, agent: 'JOSE', title: 'Testa Variações', desc: 'A/B testing continuo para encontrar os melhores criativos.' },
    { icon: <RefreshCw className="h-5 w-5 text-orange-400" />, agent: 'JOSE + BEZALEL', title: 'Substitui e Otimiza', desc: 'Criativos exaustos são substituidos, vencedores são escalados.' },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-400" />
          Fluxo de Otimização Contínua
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {steps.map((step, i) => (
            <div key={i}>
              <div className="flex items-start gap-4 p-3 rounded-lg hover:bg-muted/10 transition-colors">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-background border border-border/50 flex items-center justify-center">
                  {step.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{step.title}</p>
                    <Badge variant="outline" className="text-[9px] h-4">{step.agent}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{step.desc}</p>
                </div>
                <span className="text-xs text-muted-foreground font-mono mt-1">#{i + 1}</span>
              </div>
              {i < steps.length - 1 && (
                <div className="flex justify-center">
                  <ArrowRight className="h-4 w-4 text-muted-foreground/30 rotate-90" />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 p-4 rounded-lg bg-gradient-to-r from-purple-500/10 to-emerald-500/10 border border-purple-500/20">
          <p className="text-sm font-semibold text-center">
            <Sparkles className="h-4 w-4 inline text-purple-400 mr-1" />
            Gestor de tráfego autônomo com inteligência criativa integrada
          </p>
          <p className="text-xs text-muted-foreground text-center mt-1">
            JOSÉ + BEZALEL trabalham juntos 24/7 sem intervenção manual
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
