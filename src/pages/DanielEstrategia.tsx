import { useState } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import {
  Brain, BarChart3, Compass, FileText, Lightbulb, Loader2,
  Sparkles, Target, TrendingUp, Zap, ChevronRight, Shield, Star, GitBranch,
} from 'lucide-react';
import { FunnelFlowchart } from '@/components/daniel/FunnelFlowchart';

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

interface StrategySection {
  title: string;
  content: string;
  icon: string;
}

interface GeneratedStrategy {
  title: string;
  executive_summary: string;
  sections: StrategySection[];
  key_metrics: string[];
  timeline: string;
  risk_factors: string[];
}

export default function DanielEstrategia() {
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState('estrategia');
  const [strategy, setStrategy] = useState<GeneratedStrategy | null>(null);

  // Form
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('servicos');
  const [strategyType, setStrategyType] = useState('crescimento');
  const [currentSituation, setCurrentSituation] = useState('');
  const [mainChallenge, setMainChallenge] = useState('');
  const [budget, setBudget] = useState('');
  const [timeframe, setTimeframe] = useState('6');

  const handleGenerate = async () => {
    if (!businessName.trim() || !mainChallenge.trim()) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('daniel-strategy-api', {
        body: {
          action: 'generate_strategy',
          business_name: businessName.trim(),
          business_type: businessType,
          strategy_type: strategyType,
          current_situation: currentSituation.trim(),
          main_challenge: mainChallenge.trim(),
          budget: budget.trim(),
          timeframe_months: parseInt(timeframe),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setStrategy(data.strategy);
    } catch (err: any) {
      // Demo mode fallback
      setStrategy(buildDemoStrategy(businessName, strategyType, mainChallenge, parseInt(timeframe)));
      toast({ title: 'Modo demo', description: 'Mostrando estratégia demonstrativa. Configure a API para análise completa.' });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
              <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20">
                <Brain className="h-6 w-6 text-purple-400" />
              </div>
              DANIEL — Estratégia
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Planejamento estratégico e análise de negócios com IA
            </p>
          </div>
          <Badge variant="outline" className="gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            DANIEL Online
          </Badge>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="estrategia" className="gap-1.5"><Compass className="h-3.5 w-3.5" />Plano Estratégico</TabsTrigger>
            <TabsTrigger value="analise" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" />Análise de Dados</TabsTrigger>
            <TabsTrigger value="swot" className="gap-1.5"><Target className="h-3.5 w-3.5" />SWOT / OKRs</TabsTrigger>
            <TabsTrigger value="fluxo" className="gap-1.5"><GitBranch className="h-3.5 w-3.5" />Fluxo de Vendas</TabsTrigger>
          </TabsList>

          {/* STRATEGY GENERATOR */}
          <TabsContent value="estrategia" className="mt-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Form */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-purple-400" />
                    Configurar Estratégia
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nome do negócio *</Label>
                    <Input placeholder="ex: LogosIA, Minha Empresa..." value={businessName} onChange={e => setBusinessName(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tipo de negócio</Label>
                      <Select value={businessType} onValueChange={setBusinessType}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{BUSINESS_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tipo de estratégia</Label>
                      <Select value={strategyType} onValueChange={setStrategyType}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{STRATEGY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Situação atual do negócio</Label>
                    <Textarea placeholder="Descreva onde você está hoje — faturamento, clientes, equipe..." value={currentSituation} onChange={e => setCurrentSituation(e.target.value)} rows={3} className="resize-none" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Principal desafio *</Label>
                    <Textarea placeholder="Qual é o maior obstáculo que impede seu crescimento?" value={mainChallenge} onChange={e => setMainChallenge(e.target.value)} rows={2} className="resize-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Orçamento disponível</Label>
                      <Input placeholder="ex: R$ 10.000/mês" value={budget} onChange={e => setBudget(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Prazo (meses)</Label>
                      <Select value={timeframe} onValueChange={setTimeframe}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['3', '6', '12', '18', '24'].map(m => <SelectItem key={m} value={m}>{m} meses</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button className="w-full gradient-primary text-primary-foreground" onClick={handleGenerate} disabled={generating || !businessName.trim() || !mainChallenge.trim()}>
                    {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analisando...</> : <><Sparkles className="h-4 w-4 mr-2" />Gerar Plano Estratégico</>}
                  </Button>
                </CardContent>
              </Card>

              {/* Output */}
              {strategy ? (
                <div className="space-y-4">
                  <Card className="border-purple-500/20 bg-purple-500/5">
                    <CardContent className="p-4">
                      <h2 className="font-bold text-lg text-purple-400">{strategy.title}</h2>
                      <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{strategy.executive_summary}</p>
                    </CardContent>
                  </Card>

                  {strategy.sections.map((section, i) => (
                    <Card key={i}>
                      <CardContent className="p-4">
                        <h3 className="font-semibold text-sm flex items-center gap-2 mb-2">
                          <span>{section.icon}</span> {section.title}
                        </h3>
                        <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{section.content}</p>
                      </CardContent>
                    </Card>
                  ))}

                  <Card>
                    <CardContent className="p-4">
                      <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                        <TrendingUp className="h-4 w-4 text-emerald-400" /> Métricas-Chave (KPIs)
                      </h3>
                      <div className="space-y-1.5">
                        {strategy.key_metrics.map((m, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <ChevronRight className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                            <span>{m}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-red-500/20">
                    <CardContent className="p-4">
                      <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                        <Shield className="h-4 w-4 text-red-400" /> Fatores de Risco
                      </h3>
                      <div className="space-y-1.5">
                        {strategy.risk_factors.map((r, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="text-red-400">⚠️</span> {r}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <Card className="border-dashed border-2 border-purple-500/20">
                  <CardContent className="py-20 text-center">
                    <Brain className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
                    <p className="text-muted-foreground text-sm">DANIEL vai analisar seu negócio</p>
                    <p className="text-xs text-muted-foreground mt-1">Preencha o formulário para gerar seu plano estratégico 🧠</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* ANALYSIS */}
          <TabsContent value="analise" className="mt-5">
            <Card className="border-dashed border-2 border-primary/20">
              <CardContent className="py-16 text-center space-y-4">
                <BarChart3 className="h-12 w-12 mx-auto text-primary/30" />
                <div>
                  <p className="font-medium">Análise Consolidada de Dados</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    DANIEL vai cruzar dados de Meta Ads, Google Ads, LinkedIn e WhatsApp para gerar insights estratégicos
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {['ROI por canal', 'LTV de clientes', 'CAC por fonte', 'Tendências de mercado', 'Benchmark do setor'].map(item => (
                    <Badge key={item} variant="outline" className="text-xs">{item}</Badge>
                  ))}
                </div>
                <Badge variant="secondary">Em desenvolvimento</Badge>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SWOT */}
          <TabsContent value="swot" className="mt-5">
            <div className="grid grid-cols-2 gap-4">
              {[
                { title: 'Forças', color: 'emerald', emoji: '💪', items: ['Equipe experiente', 'Produto diferenciado', 'Base de clientes fiel'] },
                { title: 'Fraquezas', color: 'red', emoji: '⚠️', items: ['Orçamento limitado', 'Processos manuais', 'Dependência de poucos clientes'] },
                { title: 'Oportunidades', color: 'blue', emoji: '🚀', items: ['Mercado em expansão', 'Automação com IA', 'Parcerias estratégicas'] },
                { title: 'Ameaças', color: 'amber', emoji: '🛡️', items: ['Concorrência crescente', 'Mudanças no algoritmo', 'Instabilidade econômica'] },
              ].map(quadrant => (
                <Card key={quadrant.title} className={`border-${quadrant.color}-500/30 bg-${quadrant.color}-500/5`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      {quadrant.emoji} {quadrant.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1.5">
                      {quadrant.items.map(item => (
                        <li key={item} className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Star className={`h-2.5 w-2.5 text-${quadrant.color}-400 fill-current flex-shrink-0`} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card className="mt-4">
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">Configure com DANIEL para gerar sua análise SWOT personalizada baseada nos seus dados reais</p>
                <Button size="sm" className="mt-3 gradient-primary text-primary-foreground" onClick={() => setActiveTab('estrategia')}>
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Gerar com IA
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
          {/* FUNNEL FLOWCHART */}
          <TabsContent value="fluxo" className="mt-5">
            <div className="space-y-4">
              <Card className="border-purple-500/20 bg-purple-500/5">
                <CardContent className="p-4">
                  <h2 className="font-bold text-sm text-purple-300 flex items-center gap-2 mb-1">
                    <GitBranch className="h-4 w-4" /> Mapa Visual do Funil AIDA
                  </h2>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Mapa visual completo da jornada do cliente — do primeiro anúncio até a recompra, com cada agente em seu papel dentro da metodologia AIDA.
                    Use o scroll e os controles para navegar pelo fluxo completo.
                  </p>
                </CardContent>
              </Card>
              <FunnelFlowchart />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

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
