import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useAgentTasks } from '@/contexts/AgentTasksContext';
import { useAgentChat } from '@/contexts/AgentChatContext';
import {
  Brain, BarChart3, Compass, Lightbulb, Loader2, Sparkles, Target,
  TrendingUp, ChevronRight, Shield, Star, Search, Trash2, Copy,
  Calendar, AlertCircle, Crosshair, HeartCrack,
} from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────────────────────

const BUSINESS_TYPES = [
  { value: 'ecommerce', label: '🛒 E-commerce' },
  { value: 'servicos', label: '🛠️ Prestação de Serviços' },
  { value: 'saas', label: '💻 SaaS / Software' },
  { value: 'infoprodutos', label: '📚 Infoprodutos' },
  { value: 'clinica', label: '🏥 Clínica / Saúde' },
  { value: 'agencia', label: '📣 Agência de Marketing' },
  { value: 'varejo', label: '🏪 Varejo Físico' },
  { value: 'outro', label: '🔷 Outro' },
];

const STRATEGY_TYPES = [
  { value: 'crescimento', label: '📈 Estratégia de Crescimento' },
  { value: 'posicionamento', label: '🎯 Posicionamento de Marca' },
  { value: 'competitividade', label: '⚔️ Análise Competitiva' },
  { value: 'lancamento', label: '🚀 Lançamento de Produto' },
  { value: 'retencao', label: '🔄 Retenção de Clientes' },
  { value: 'expansao', label: '🌍 Expansão de Mercado' },
];

const SWOT_QUADRANTS = [
  {
    title: 'Forças', emoji: '💪', desc: 'Vantagens competitivas internas',
    items: ['Equipe experiente', 'Produto diferenciado', 'Base de clientes fiel'],
    cardCls: 'border-emerald-500/25 hover:border-emerald-500/40',
    iconCls: 'bg-emerald-500/15 border-emerald-500/20',
    titleCls: 'text-emerald-400',
    starCls: 'text-emerald-400 fill-emerald-400',
  },
  {
    title: 'Fraquezas', emoji: '⚠️', desc: 'Limitações e pontos de melhoria',
    items: ['Orçamento limitado', 'Processos manuais', 'Dependência de poucos clientes'],
    cardCls: 'border-red-500/25 hover:border-red-500/40',
    iconCls: 'bg-red-500/15 border-red-500/20',
    titleCls: 'text-red-400',
    starCls: 'text-red-400 fill-red-400',
  },
  {
    title: 'Oportunidades', emoji: '🚀', desc: 'Tendências e brechas do mercado',
    items: ['Mercado em expansão', 'Automação com IA', 'Parcerias estratégicas'],
    cardCls: 'border-blue-500/25 hover:border-blue-500/40',
    iconCls: 'bg-blue-500/15 border-blue-500/20',
    titleCls: 'text-blue-400',
    starCls: 'text-blue-400 fill-blue-400',
  },
  {
    title: 'Ameaças', emoji: '🛡️', desc: 'Riscos externos e concorrência',
    items: ['Concorrência crescente', 'Mudanças no algoritmo', 'Instabilidade econômica'],
    cardCls: 'border-amber-500/25 hover:border-amber-500/40',
    iconCls: 'bg-amber-500/15 border-amber-500/20',
    titleCls: 'text-amber-400',
    starCls: 'text-amber-400 fill-amber-400',
  },
];

// Section accent classes — complete names for Tailwind JIT
const SECTION_ACCENTS = [
  'border-l-blue-500',
  'border-l-purple-500',
  'border-l-emerald-500',
  'border-l-amber-500',
];

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface StrategySection { title: string; content: string; icon: string; }
interface GeneratedStrategy {
  title: string; executive_summary: string;
  sections: StrategySection[]; key_metrics: string[];
  timeline: string; risk_factors: string[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DanielEstrategia() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { createTask } = useAgentTasks();
  const { getHistory, saveMessage, clearHistory } = useAgentChat();
  const navigate = useNavigate();

  const [viewMode, setViewMode] = useState<'simplified' | 'expert'>('simplified');
  const [activeTab, setActiveTab] = useState('estrategia');
  const [generating, setGenerating] = useState(false);
  const [strategy, setStrategy] = useState<GeneratedStrategy | null>(null);

  // ── Form state ──
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('servicos');
  const [strategyType, setStrategyType] = useState('crescimento');
  const [currentSituation, setCurrentSituation] = useState('');
  const [mainChallenge, setMainChallenge] = useState('');
  const [budget, setBudget] = useState('');
  const [timeframe, setTimeframe] = useState('6');

  // ── Research state ──
  const [researchNiche, setResearchNiche] = useState('');
  const [researchLinks, setResearchLinks] = useState('');
  const [researchPlatforms, setResearchPlatforms] = useState<string[]>(['instagram', 'tiktok', 'google']);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchResult, setResearchResult] = useState<any>(null);
  const [researchError, setResearchError] = useState('');

  // ── Load history ──
  useEffect(() => {
    const loadHistory = async () => {
      const history = await getHistory('daniel');
      const lastStrategy = [...history].reverse().find(m => m.role === 'assistant' && m.metadata?.type === 'business_strategy');
      if (lastStrategy?.metadata?.strategy) setStrategy(lastStrategy.metadata.strategy as any);
      const lastResearch = [...history].reverse().find(m => m.role === 'assistant' && m.metadata?.type === 'niche_research');
      if (lastResearch?.metadata?.research) setResearchResult(lastResearch.metadata.research as any);
    };
    loadHistory();
  }, [getHistory]);

  const handleClearHistory = async () => {
    try {
      await clearHistory('daniel');
      setStrategy(null);
      setResearchResult(null);
      toast({ title: 'Histórico limpo.' });
    } catch (err: any) {
      toast({ title: 'Erro ao limpar', description: err.message, variant: 'destructive' });
    }
  };

  const handleGenerate = async () => {
    if (!businessName.trim() || !mainChallenge.trim()) return;
    setGenerating(true);
    try {
      await saveMessage('daniel', 'user', `Análise estratégica para: ${businessName}`);
      const taskId = await createTask('daniel', 'generate_strategy', {
        business_name: businessName.trim(), business_type: businessType,
        strategy_type: strategyType, main_challenge: mainChallenge.trim(),
      });
      const { data, error } = await supabase.functions.invoke('daniel-strategy-api', {
        body: {
          action: 'generate_strategy',
          business_name: businessName.trim(), business_type: businessType,
          strategy_type: strategyType, current_situation: currentSituation.trim(),
          main_challenge: mainChallenge.trim(), budget: budget.trim(),
          timeframe_months: parseInt(timeframe), task_id: taskId,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setStrategy(data.strategy);
      await saveMessage('daniel', 'assistant', `Estratégia para ${businessName} gerada.`, { type: 'business_strategy', strategy: data.strategy });
    } catch {
      const demo = buildDemoStrategy(businessName, strategyType, mainChallenge, parseInt(timeframe));
      setStrategy(demo);
      await saveMessage('daniel', 'assistant', `Estratégia demonstrativa para ${businessName}.`, { type: 'business_strategy', strategy: demo });
      toast({ title: 'Modo demo', description: 'Mostrando estratégia demonstrativa.' });
    } finally {
      setGenerating(false);
    }
  };

  const handleResearch = async () => {
    if (!researchNiche.trim()) {
      toast({ title: 'Informe o nicho', description: 'Digite o nicho antes de pesquisar.', variant: 'destructive' });
      return;
    }
    setResearchLoading(true);
    setResearchResult(null);
    setResearchError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada');
      await saveMessage('daniel', 'user', `Pesquisar nicho: ${researchNiche}`);
      const { data, error } = await supabase.functions.invoke('daniel-strategy-api', {
        body: { action: 'research_trends', niche: researchNiche, links: researchLinks, platforms: researchPlatforms },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setResearchResult(data.research);
      await saveMessage('daniel', 'assistant', `Pesquisa para ${researchNiche}.`, { type: 'niche_research', research: data.research });
      const briefCount = data.research?.content_briefs?.length || 0;
      const gapCount = data.research?.competitive_gaps?.length || 0;
      toast({ title: '🔍 Pesquisa 2.0 concluída!', description: `${briefCount} pautas + ${gapCount} brechas identificadas.` });
    } catch (err: any) {
      setResearchError(err.message);
      toast({ title: 'Erro na pesquisa', description: err.message, variant: 'destructive' });
    } finally {
      setResearchLoading(false);
    }
  };

  const togglePlatform = (p: string) =>
    setResearchPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <MainLayout>
      <div className="space-y-5">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card p-5 sm:p-6">
          {/* Decorative background */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-blue-500/5 via-purple-500/5 to-transparent" />
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-blue-500/6 blur-3xl" />

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Identity */}
            <div className="flex items-center gap-4">
              <div className="relative shrink-0">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-500/20 to-purple-600/20 shadow-lg shadow-blue-500/10">
                  <Brain className="h-6 w-6 text-blue-400" />
                </div>
                <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-background bg-emerald-500">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                </span>
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-bold tracking-tight sm:text-2xl">DANIEL</h1>
                  <Badge variant="outline" className="gap-1 border-blue-500/30 text-[10px] text-blue-400">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                    Online
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground sm:text-sm">Estratégia de Negócios com Inteligência Artificial</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Mode switcher */}
              <div className="flex h-9 overflow-hidden rounded-xl border border-border/60 bg-muted/30 text-xs">
                <button
                  onClick={() => { setViewMode('simplified'); setActiveTab('estrategia'); }}
                  className={`h-full px-3.5 font-medium transition-all ${viewMode === 'simplified' ? 'bg-blue-500 text-white' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  📊 Simplificado
                </button>
                <button
                  onClick={() => setViewMode('expert')}
                  className={`h-full px-3.5 font-medium transition-all ${viewMode === 'expert' ? 'bg-blue-500 text-white' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  ⚙️ Especialista
                </button>
              </div>

              <Button variant="ghost" size="sm" onClick={handleClearHistory}
                className="h-9 gap-1.5 rounded-xl text-xs text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Limpar</span>
              </Button>
            </div>
          </div>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className={`grid w-full rounded-xl ${viewMode === 'simplified' ? 'grid-cols-2' : 'grid-cols-4'}`}>
            <TabsTrigger value="estrategia" className="gap-1.5 rounded-lg text-xs">
              <Compass className="h-3.5 w-3.5" />Estratégia
            </TabsTrigger>
            <TabsTrigger value="pesquisa" className="gap-1.5 rounded-lg text-xs">
              <Search className="h-3.5 w-3.5" />Pesquisa
            </TabsTrigger>
            {viewMode === 'expert' && <>
              <TabsTrigger value="analise" className="gap-1.5 rounded-lg text-xs">
                <BarChart3 className="h-3.5 w-3.5" />Análise
              </TabsTrigger>
              <TabsTrigger value="swot" className="gap-1.5 rounded-lg text-xs">
                <Target className="h-3.5 w-3.5" />SWOT
              </TabsTrigger>
            </>}
          </TabsList>

          {/* ── ESTRATÉGIA TAB ─────────────────────────────────────────────── */}
          <TabsContent value="estrategia" className="mt-5">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

              {/* Form */}
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10">
                      <Lightbulb className="h-4 w-4 text-blue-400" />
                    </span>
                    Configurar Análise
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Nome do negócio *</Label>
                    <Input placeholder="ex: LogosIA, Minha Empresa..." value={businessName}
                      onChange={e => setBusinessName(e.target.value)} className="bg-background/60" />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tipo de negócio</Label>
                      <Select value={businessType} onValueChange={setBusinessType}>
                        <SelectTrigger className="bg-background/60"><SelectValue /></SelectTrigger>
                        <SelectContent>{BUSINESS_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tipo de estratégia</Label>
                      <Select value={strategyType} onValueChange={setStrategyType}>
                        <SelectTrigger className="bg-background/60"><SelectValue /></SelectTrigger>
                        <SelectContent>{STRATEGY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Situação atual</Label>
                    <Textarea placeholder="Descreva onde você está hoje — faturamento, clientes, equipe..."
                      value={currentSituation} onChange={e => setCurrentSituation(e.target.value)}
                      rows={3} className="resize-none bg-background/60" />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Principal desafio *</Label>
                    <Textarea placeholder="Qual é o maior obstáculo que impede seu crescimento?"
                      value={mainChallenge} onChange={e => setMainChallenge(e.target.value)}
                      rows={2} className="resize-none bg-background/60" />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Orçamento</Label>
                      <Input placeholder="ex: R$ 10.000/mês" value={budget}
                        onChange={e => setBudget(e.target.value)} className="bg-background/60" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Prazo</Label>
                      <Select value={timeframe} onValueChange={setTimeframe}>
                        <SelectTrigger className="bg-background/60"><SelectValue /></SelectTrigger>
                        <SelectContent>{['3', '6', '12', '18', '24'].map(m => <SelectItem key={m} value={m}>{m} meses</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button className="h-11 w-full rounded-xl gradient-primary text-sm font-semibold text-primary-foreground"
                    onClick={handleGenerate} disabled={generating || !businessName.trim() || !mainChallenge.trim()}>
                    {generating
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analisando com IA...</>
                      : <><Sparkles className="mr-2 h-4 w-4" />Gerar Plano Estratégico</>}
                  </Button>
                </CardContent>
              </Card>

              {/* Output */}
              {strategy ? (
                <div className="space-y-3">
                  {/* Executive summary */}
                  <div className="rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/8 to-purple-500/5 p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500/20">
                        <Brain className="h-3.5 w-3.5 text-blue-400" />
                      </span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">Plano Estratégico</span>
                    </div>
                    <h2 className="text-base font-bold leading-snug text-foreground sm:text-lg">{strategy.title}</h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{strategy.executive_summary}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/30 pt-3">
                      <Badge variant="outline" className="gap-1 border-blue-500/30 text-[10px] text-blue-400">
                        <Target className="h-2.5 w-2.5" />
                        {STRATEGY_TYPES.find(t => t.value === strategyType)?.label || strategyType}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">{strategy.timeline}</Badge>
                    </div>
                  </div>

                  {/* Phases */}
                  {strategy.sections.map((section, i) => (
                    <div key={i} className={`rounded-xl border border-l-4 border-border/50 bg-card/80 p-4 ${SECTION_ACCENTS[i % SECTION_ACCENTS.length]}`}>
                      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                        <span className="text-base">{section.icon}</span>
                        {section.title}
                      </h3>
                      <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{section.content}</p>
                    </div>
                  ))}

                  {/* KPIs */}
                  <div className="rounded-xl border border-border/50 bg-card/80 p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                      <TrendingUp className="h-4 w-4 text-emerald-400" />
                      Métricas-Chave (KPIs)
                    </h3>
                    <div className="space-y-2">
                      {strategy.key_metrics.map((m, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                          <span className="text-foreground">{m}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Risks */}
                  <div className="rounded-xl border border-l-4 border-l-red-500 border-border/50 bg-card/80 p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                      <Shield className="h-4 w-4 text-red-400" />
                      Fatores de Risco
                    </h3>
                    <div className="space-y-2">
                      {strategy.risk_factors.map((r, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <span className="mt-0.5 text-red-400">⚠️</span>
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border/40 bg-card/30 px-6 py-20 text-center sm:py-28">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 to-purple-500/10">
                    <Brain className="h-8 w-8 text-muted-foreground/30" />
                  </div>
                  <p className="text-sm font-medium text-foreground">DANIEL vai analisar seu negócio</p>
                  <p className="mt-2 max-w-xs text-xs leading-relaxed text-muted-foreground">
                    Preencha o formulário ao lado para gerar seu plano estratégico personalizado com IA 🧠
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── PESQUISA TAB ───────────────────────────────────────────────── */}
          <TabsContent value="pesquisa" className="mt-5 space-y-5">
            {/* Info banner */}
            <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-gradient-to-r from-blue-500/8 to-transparent p-4">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-500/20 bg-blue-500/15">
                <Search className="h-4 w-4 text-blue-400" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">Pesquisa de Tendências com IA</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  DANIEL analisa o que está viral no nicho do seu cliente — Instagram, TikTok e Google — e gera pautas prontas para o Davi publicar.{' '}
                  <span className="text-blue-400/70">Configure o Apify em Integrações para dados reais.</span>
                </p>
              </div>
            </div>

            {/* Form card */}
            <Card className="border-border/60 shadow-sm">
              <CardContent className="space-y-4 pt-5">
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Nicho do cliente</Label>
                  <Input value={researchNiche} onChange={e => setResearchNiche(e.target.value)}
                    placeholder="Ex: emagrecimento, marketing digital, moda feminina..."
                    className="bg-background/60"
                    onKeyDown={e => e.key === 'Enter' && handleResearch()} />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Links de referência (opcional)</Label>
                  <Textarea value={researchLinks} onChange={e => setResearchLinks(e.target.value)}
                    placeholder="Cole links de perfis do Instagram, vídeos do TikTok ou sites concorrentes..."
                    rows={3} className="resize-none bg-background/60" />
                </div>

                <div className="space-y-2">
                  <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Plataformas</Label>
                  <div className="flex flex-wrap gap-2">
                    {[{ id: 'instagram', label: '📸 Instagram' }, { id: 'tiktok', label: '🎵 TikTok' }, { id: 'google', label: '🔍 Google' }].map(p => (
                      <button key={p.id} onClick={() => togglePlatform(p.id)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                          researchPlatforms.includes(p.id)
                            ? 'border-blue-500/40 bg-blue-500/15 text-blue-400'
                            : 'border-border/50 text-muted-foreground hover:border-border hover:text-foreground'
                        }`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <Button onClick={handleResearch} disabled={researchLoading || !researchNiche.trim()}
                  className="h-11 w-full rounded-xl gradient-primary font-semibold text-primary-foreground">
                  {researchLoading
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Pesquisando tendências...</>
                    : <><Search className="mr-2 h-4 w-4" />Pesquisar Tendências</>}
                </Button>

                {researchError && <p className="text-xs text-destructive">{researchError}</p>}
              </CardContent>
            </Card>

            {/* Results */}
            {researchResult && (
              <div className="space-y-5">

                {/* Source badge */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Fonte dos dados:</span>
                  <Badge className={researchResult.data_source === 'apify_scraping'
                    ? 'border-emerald-500/30 bg-emerald-500/15 text-[10px] text-emerald-400'
                    : 'border-blue-500/30 bg-blue-500/15 text-[10px] text-blue-400'}>
                    {researchResult.data_source === 'apify_scraping' ? '✅ Dados reais (Apify)' : '🧠 Análise IA Profunda v2'}
                  </Badge>
                  {researchResult.content_briefs?.length > 0 && (
                    <Badge className="border-purple-500/30 bg-purple-500/15 text-[10px] text-purple-400">
                      {researchResult.content_briefs.length} pautas
                    </Badge>
                  )}
                  {researchResult.competitive_gaps?.length > 0 && (
                    <Badge className="border-emerald-500/30 bg-emerald-500/15 text-[10px] text-emerald-400">
                      {researchResult.competitive_gaps.length} brechas
                    </Badge>
                  )}
                </div>

                {/* ── SIMPLIFIED MODE ─────────────────────────────────────── */}
                {viewMode === 'simplified' && (
                  <>
                    {/* Manifesto estratégico */}
                    {researchResult.recommendation && (
                      <div className="space-y-4 rounded-xl border border-purple-500/20 bg-gradient-to-br from-purple-500/8 to-blue-500/5 p-5">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-purple-500/20">
                            <Brain className="h-3.5 w-3.5 text-purple-400" />
                          </span>
                          <p className="text-sm font-bold text-purple-400">🎯 Manifesto Estratégico</p>
                        </div>
                        <p className="text-sm leading-relaxed text-foreground">{researchResult.recommendation}</p>
                      </div>
                    )}

                    {/* Pautas prontas — até 5 no modo simplificado */}
                    {researchResult.content_briefs?.length > 0 && (
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold">📋 Pautas prontas para usar</h3>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {researchResult.content_briefs.slice(0, 5).map((brief: any) => (
                            <div key={brief.id} className="space-y-2 rounded-lg border border-border/50 bg-card/60 p-3">
                              {brief.angle && (
                                <span className="inline-block rounded bg-blue-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-400">
                                  {brief.angle}
                                </span>
                              )}
                              <p className="text-xs font-semibold leading-snug text-foreground">{brief.title}</p>
                              <p className="text-[11px] text-muted-foreground line-clamp-2">{brief.hook}</p>
                              <Button size="sm" variant="outline"
                                className="h-7 w-full border-purple-500/30 text-[11px] text-purple-400 hover:bg-purple-500/10"
                                onClick={() => {
                                  localStorage.setItem('daniel_selected_brief', JSON.stringify(brief));
                                  toast({ title: 'Enviando pauta...', description: 'Abrindo o Copywriter AI.' });
                                  navigate('/copywriter');
                                }}>
                                📋 Usar essa pauta
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Pain Map — simplified */}
                    {researchResult.pain_map?.length > 0 && (
                      <div className="rounded-xl border border-red-500/20 bg-gradient-to-br from-red-500/5 to-transparent p-4">
                        <div className="mb-3 flex items-center gap-2">
                          <HeartCrack className="h-4 w-4 text-red-400" />
                          <h3 className="text-sm font-semibold text-red-400">Mapa de Dores do Público</h3>
                        </div>
                        <div className="space-y-2">
                          {researchResult.pain_map.slice(0, 3).map((pain: any, i: number) => (
                            <div key={i} className="rounded-lg border border-red-500/15 bg-card/40 p-3">
                              <div className="flex items-start gap-2">
                                <span className="mt-0.5 text-red-400">⚡</span>
                                <div>
                                  <p className="text-xs font-semibold text-foreground">{pain.title}</p>
                                  <p className="mt-0.5 text-[11px] text-muted-foreground">{pain.description}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Viral formats */}
                    {researchResult.viral_formats?.length > 0 && (
                      <div>
                        <h3 className="mb-3 text-sm font-semibold">⚡ Formatos virais no nicho</h3>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          {researchResult.viral_formats.map((f: any, i: number) => (
                            <div key={i} className="space-y-1.5 rounded-xl border border-border/50 bg-card/40 p-3.5">
                              <p className="text-sm font-semibold text-foreground">{f.format}</p>
                              <p className="text-[11px] text-muted-foreground">{f.description}</p>
                              <p className="text-[11px] italic text-blue-400/80">Ex: {f.example}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ── EXPERT MODE ─────────────────────────────────────────── */}
                {viewMode === 'expert' && (
                  <>
                    {/* Manifesto */}
                    {researchResult.recommendation && (
                      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-5">
                        <p className="mb-2 text-xs font-semibold text-blue-400">💡 Manifesto Estratégico</p>
                        <p className="text-sm leading-relaxed text-foreground">{researchResult.recommendation}</p>
                      </div>
                    )}

                    {/* Pain Map */}
                    {researchResult.pain_map?.length > 0 && (
                      <div>
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                          <HeartCrack className="h-4 w-4 text-red-400" />
                          Mapa de Dores ({researchResult.pain_map.length} identificadas)
                        </h3>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {researchResult.pain_map.map((pain: any, i: number) => (
                            <div key={i} className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                              <div className="mb-2 flex items-center justify-between">
                                <p className="text-sm font-semibold text-foreground">{pain.title}</p>
                                {pain.category && (
                                  <Badge className="text-[9px] border-red-500/30 bg-red-500/10 text-red-400">{pain.category}</Badge>
                                )}
                              </div>
                              <p className="text-[11px] leading-relaxed text-muted-foreground">{pain.description}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Trending Topics */}
                    {researchResult.trending_topics?.length > 0 && (
                      <div>
                        <h3 className="mb-3 text-sm font-semibold">🔥 Tópicos em alta — 5 Ângulos de Ataque</h3>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {researchResult.trending_topics.map((t: any, i: number) => (
                            <div key={i} className="space-y-2 rounded-xl border border-border/50 bg-card/40 p-3.5">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  {t.angle && (
                                    <span className="mb-1 inline-block rounded bg-blue-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
                                      {t.angle}
                                    </span>
                                  )}
                                  <p className="text-sm font-medium leading-snug text-foreground">{t.topic}</p>
                                </div>
                                <Badge variant="outline" className={`shrink-0 text-[9px] ${
                                  t.engagement_potential === 'muito alto' || t.engagement_potential === 'alto' ? 'border-emerald-500/40 text-emerald-400' :
                                  t.engagement_potential === 'médio' ? 'border-amber-500/40 text-amber-400' :
                                  'border-muted/40 text-muted-foreground'
                                }`}>{t.engagement_potential}</Badge>
                              </div>
                              <p className="text-[11px] leading-relaxed text-muted-foreground">{t.why_trending}</p>
                              <div className="flex flex-wrap gap-1.5">
                                <span className="rounded bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">{t.best_format}</span>
                                <span className="rounded bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">{t.best_platform}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Content Briefs */}
                    {researchResult.content_briefs?.length > 0 && (
                      <div>
                        <h3 className="mb-3 text-sm font-semibold">📋 Pautas prontas ({researchResult.content_briefs.length})</h3>
                        <div className="space-y-3">
                          {researchResult.content_briefs.map((brief: any) => (
                            <div key={brief.id} className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-4">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="mb-1 flex flex-wrap gap-1.5">
                                    {brief.angle && (
                                      <Badge className="text-[9px] border-blue-500/30 bg-blue-500/10 text-blue-400">{brief.angle}</Badge>
                                    )}
                                    <Badge variant="outline" className="text-[9px]">{brief.format}</Badge>
                                    <Badge variant="outline" className="text-[9px]">{brief.platform}</Badge>
                                    <Badge variant="outline" className={`text-[9px] ${
                                      brief.estimated_reach === 'viral' ? 'border-purple-500/30 text-purple-400' :
                                      brief.estimated_reach === 'alto' ? 'border-emerald-500/30 text-emerald-400' : 'text-muted-foreground'
                                    }`}>🎯 {brief.estimated_reach}</Badge>
                                  </div>
                                  <p className="text-sm font-semibold text-foreground">{brief.title}</p>
                                </div>
                                <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-[10px]"
                                  onClick={() => {
                                    localStorage.setItem('daniel_selected_brief', JSON.stringify(brief));
                                    toast({ title: 'Enviando pauta...', description: 'Abrindo o Copywriter AI.' });
                                    navigate('/copywriter');
                                  }}>
                                  📋 Usar essa pauta
                                </Button>
                              </div>
                              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                                <p className="text-[11px] font-medium text-blue-300">🎣 Hook: "{brief.hook}"</p>
                              </div>
                              {brief.slides_or_points?.length > 0 && (
                                <div className="space-y-2">
                                  {brief.slides_or_points.map((point: string, j: number) => (
                                    <div key={j} className="flex items-start gap-2 rounded-lg bg-muted/20 p-2.5 text-xs">
                                      <span className="shrink-0 font-mono text-blue-400 font-bold">{j + 1}.</span>
                                      <span className="leading-relaxed text-foreground/90">{point}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="flex flex-wrap gap-1">
                                {brief.hashtags?.map((tag: string, j: number) => (
                                  <span key={j} className="text-[10px] text-blue-400/70">#{tag}</span>
                                ))}
                              </div>
                              <div className="rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-2">
                                <p className="text-[10px] text-amber-300/80">🧠 {brief.reason}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Content Calendar */}
                    {researchResult.content_calendar?.length > 0 && (
                      <div>
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                          <Calendar className="h-4 w-4 text-emerald-400" />
                          Calendário Editorial Sugerido — 7 Dias
                        </h3>
                        <div className="overflow-hidden rounded-xl border border-border/50 bg-card/40">
                          <div className="grid grid-cols-5 gap-0 border-b border-border/40 bg-muted/20 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            <span>Dia</span><span>Formato</span><span className="col-span-2">Tema / Ângulo</span><span>Horário</span>
                          </div>
                          {researchResult.content_calendar.map((day: any, i: number) => (
                            <div key={i} className={`grid grid-cols-5 gap-0 px-4 py-3 text-xs ${
                              i % 2 === 0 ? 'bg-transparent' : 'bg-muted/10'
                            } border-b border-border/20 last:border-0`}>
                              <span className="font-semibold text-foreground">{day.day}</span>
                              <span className="text-muted-foreground">{day.format}</span>
                              <span className="col-span-2 text-foreground/80">{day.theme}</span>
                              <span className="text-emerald-400">{day.best_time}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Competitive Gaps */}
                    {researchResult.competitive_gaps?.length > 0 && (
                      <div>
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                          <Crosshair className="h-4 w-4 text-emerald-400" />
                          Brechas da Concorrência — Oportunidades Inexploradas
                        </h3>
                        <div className="space-y-3">
                          {researchResult.competitive_gaps.map((gap: any, i: number) => (
                            <div key={i} className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                              <div className="mb-2 flex items-start gap-2">
                                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">
                                  {i + 1}
                                </span>
                                <p className="text-sm font-semibold text-foreground">{gap.title}</p>
                              </div>
                              <p className="mb-2 ml-7 text-[11px] leading-relaxed text-muted-foreground">{gap.why_empty}</p>
                              {gap.content_type && (
                                <div className="ml-7">
                                  <Badge className="text-[9px] border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                                    💡 {gap.content_type}
                                  </Badge>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Viral Formats */}
                    {researchResult.viral_formats?.length > 0 && (
                      <div>
                        <h3 className="mb-3 text-sm font-semibold">⚡ Formatos virais no nicho</h3>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          {researchResult.viral_formats.map((f: any, i: number) => (
                            <div key={i} className="space-y-1.5 rounded-xl border border-border/50 bg-card/40 p-3.5">
                              <p className="text-sm font-semibold text-foreground">{f.format}</p>
                              <p className="text-[11px] text-muted-foreground">{f.description}</p>
                              <p className="text-[11px] italic text-blue-400/80">Ex: {f.example}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

              </div>
            )}
          </TabsContent>

          {/* ── ANÁLISE TAB ────────────────────────────────────────────────── */}
          <TabsContent value="analise" className="mt-5">
            <Card className="border-border/50">
              <CardContent className="space-y-5 py-16 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 to-indigo-500/10">
                  <BarChart3 className="h-8 w-8 text-blue-400/50" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Análise Consolidada de Dados</p>
                  <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    DANIEL vai cruzar dados de Meta Ads, Google Ads, LinkedIn e WhatsApp para gerar insights estratégicos em tempo real.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {['ROI por canal', 'LTV de clientes', 'CAC por fonte', 'Tendências de mercado', 'Benchmark do setor'].map(item => (
                    <Badge key={item} variant="outline" className="text-xs">{item}</Badge>
                  ))}
                </div>
                <Badge variant="secondary" className="text-xs">Em desenvolvimento</Badge>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── SWOT TAB ───────────────────────────────────────────────────── */}
          <TabsContent value="swot" className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {SWOT_QUADRANTS.map(q => (
                <Card key={q.title} className={`border transition-shadow hover:shadow-md ${q.cardCls}`}>
                  <CardHeader className="pb-3">
                    <span className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl border text-lg ${q.iconCls}`}>
                      {q.emoji}
                    </span>
                    <CardTitle className={`text-sm ${q.titleCls}`}>{q.title}</CardTitle>
                    <p className="text-[11px] text-muted-foreground">{q.desc}</p>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="space-y-2">
                      {q.items.map(item => (
                        <li key={item} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <Star className={`mt-0.5 h-3 w-3 shrink-0 ${q.starCls}`} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="border-border/50 bg-card/50">
              <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Gerar SWOT personalizada com IA</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    DANIEL analisa os dados reais do seu negócio para preencher este quadrante automaticamente.
                  </p>
                </div>
                <Button size="sm" className="shrink-0 rounded-xl gradient-primary text-primary-foreground"
                  onClick={() => setActiveTab('estrategia')}>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />Gerar com IA
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </div>
    </MainLayout>
  );
}

// ─── Demo Strategy Builder ────────────────────────────────────────────────────

function buildDemoStrategy(businessName: string, type: string, challenge: string, months: number): GeneratedStrategy {
  return {
    title: `Plano Estratégico ${months} Meses — ${businessName}`,
    executive_summary: `Com base no desafio "${challenge}", o plano estratégico de ${months} meses para ${businessName} foca em três pilares: crescimento sustentável, eficiência operacional e diferenciação competitiva. A abordagem combina automação inteligente, otimização de canais e fortalecimento da proposta de valor.`,
    sections: [
      {
        icon: '🎯',
        title: 'Fase 1 — Diagnóstico e Base (mês 1-2)',
        content: `• Mapeamento completo de processos e gargalos\n• Análise de dados históricos e identificação de padrões\n• Definição de personas e jornada do cliente\n• Estabelecimento de baseline de métricas`,
      },
      {
        icon: '📈',
        title: 'Fase 2 — Aceleração (mês 3-4)',
        content: `• Implementação de funil de vendas otimizado\n• Lançamento de campanhas de aquisição segmentadas\n• Automação de nurturing e follow-up\n• Testes A/B em canais principais`,
      },
      {
        icon: '🚀',
        title: 'Fase 3 — Escala (mês 5+)',
        content: `• Expansão dos canais mais performáticos\n• Programa de fidelização e indicação\n• Parcerias estratégicas e co-marketing\n• Internacionalização ou novo segmento`,
      },
    ],
    key_metrics: [
      'CAC (Custo de Aquisição de Clientes) — meta: reduzir 30%',
      'LTV (Lifetime Value) — meta: aumentar 50%',
      'Taxa de conversão do funil — meta: 5%+',
      'NPS (Net Promoter Score) — meta: 70+',
      'MRR (Receita Mensal Recorrente) — meta: crescer 20%/mês',
    ],
    timeline: `${months} meses`,
    risk_factors: [
      'Dependência excessiva de um único canal de aquisição',
      'Pressão de preço por concorrentes de baixo custo',
      'Capacidade operacional insuficiente para absorver crescimento rápido',
      'Mudanças regulatórias ou de plataformas (Meta, Google)',
    ],
  };
}
