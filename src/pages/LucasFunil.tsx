import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Layers, Loader2, Sparkles, Copy, CheckCheck, TrendingUp, TrendingDown,
  Zap, BarChart3, Users, ArrowRight, Save, ExternalLink, AlertCircle,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FunnelStage {
  id: string;
  name: string;
  emoji: string;
  agents: { name: string; color: string }[];
  conversionRate: number;
  description: string;
}

interface LPCopy {
  headline: string;
  subheadline: string;
  hero_text: string;
  benefits: string[];
  social_proof: string;
  offer_headline: string;
  offer_description: string;
  guarantee: string;
  faq: { q: string; a: string }[];
  cta_primary: string;
  cta_secondary: string;
  urgency_text: string;
}

interface FunnelTemplate {
  id: string;
  emoji: string;
  title: string;
  description: string;
  stages: string[];
  conversion: string;
  stages_data: FunnelStage[];
}

// ─── Default Data ─────────────────────────────────────────────────────────────

const DEFAULT_STAGES: FunnelStage[] = [
  {
    id: 'traffic',
    name: 'Tráfego',
    emoji: '📡',
    agents: [{ name: 'JOSÉ', color: 'bg-blue-500' }],
    conversionRate: 100,
    description: 'Meta/Google Ads',
  },
  {
    id: 'landing',
    name: 'Landing Page',
    emoji: '🖥️',
    agents: [{ name: 'LUCAS', color: 'bg-orange-500' }, { name: 'PAULO', color: 'bg-yellow-500' }],
    conversionRate: 28,
    description: 'Visitantes',
  },
  {
    id: 'lead',
    name: 'Lead Capturado',
    emoji: '📩',
    agents: [{ name: 'LUCAS', color: 'bg-orange-500' }, { name: 'JOÃO', color: 'bg-green-500' }],
    conversionRate: 70,
    description: 'Leads',
  },
  {
    id: 'nurture',
    name: 'Nutrição',
    emoji: '🌱',
    agents: [{ name: 'JOÃO', color: 'bg-green-500' }, { name: 'MARCOS', color: 'bg-purple-500' }],
    conversionRate: 50,
    description: 'Leads Nutridos',
  },
  {
    id: 'offer',
    name: 'Proposta/Oferta',
    emoji: '💼',
    agents: [{ name: 'MARCOS', color: 'bg-purple-500' }, { name: 'PAULO', color: 'bg-yellow-500' }],
    conversionRate: 30,
    description: 'Oportunidades',
  },
  {
    id: 'client',
    name: 'Cliente',
    emoji: '🏆',
    agents: [{ name: 'MARCOS', color: 'bg-purple-500' }],
    conversionRate: 50,
    description: 'Vendas Fechadas',
  },
];

const FUNNEL_TEMPLATES: FunnelTemplate[] = [
  {
    id: 'lancamento',
    emoji: '🚀',
    title: 'Lançamento Digital',
    description: 'Para infoprodutos e cursos online com alta conversão em eventos',
    stages: ['Tráfego Frio', 'Página de Captura', 'Sequência Email', 'Webinário/VSL', 'Carrinho'],
    conversion: '2–4%',
    stages_data: [
      { id: 'traffic', name: 'Tráfego Frio', emoji: '📡', agents: [{ name: 'JOSÉ', color: 'bg-blue-500' }], conversionRate: 100, description: 'Meta/YouTube Ads' },
      { id: 'landing', name: 'Página de Captura', emoji: '📧', agents: [{ name: 'LUCAS', color: 'bg-orange-500' }, { name: 'PAULO', color: 'bg-yellow-500' }], conversionRate: 35, description: 'Captura de leads' },
      { id: 'lead', name: 'Sequência Email', emoji: '✉️', agents: [{ name: 'JOÃO', color: 'bg-green-500' }], conversionRate: 60, description: 'Nutrição via email' },
      { id: 'nurture', name: 'Webinário/VSL', emoji: '🎬', agents: [{ name: 'PAULO', color: 'bg-yellow-500' }, { name: 'LUCAS', color: 'bg-orange-500' }], conversionRate: 40, description: 'Apresentação ao vivo' },
      { id: 'offer', name: 'Carrinho', emoji: '🛒', agents: [{ name: 'LUCAS', color: 'bg-orange-500' }], conversionRate: 15, description: 'Checkout' },
      { id: 'client', name: 'Cliente', emoji: '🏆', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 90, description: 'Pós-venda' },
    ],
  },
  {
    id: 'perpetuo',
    emoji: '🔄',
    title: 'Perpétuo/Evergreen',
    description: 'Vendas automatizadas 24/7 sem depender de lançamentos',
    stages: ['Ads', 'LP', 'Email Nurture', 'Oferta', 'Upsell'],
    conversion: '1–3%',
    stages_data: [
      { id: 'traffic', name: 'Tráfego Ads', emoji: '📡', agents: [{ name: 'JOSÉ', color: 'bg-blue-500' }], conversionRate: 100, description: 'Meta/Google Ads' },
      { id: 'landing', name: 'Landing Page', emoji: '🖥️', agents: [{ name: 'LUCAS', color: 'bg-orange-500' }, { name: 'PAULO', color: 'bg-yellow-500' }], conversionRate: 30, description: 'Captura e venda' },
      { id: 'lead', name: 'Email Nurture', emoji: '📧', agents: [{ name: 'JOÃO', color: 'bg-green-500' }], conversionRate: 55, description: 'Sequência automática' },
      { id: 'offer', name: 'Oferta Principal', emoji: '💰', agents: [{ name: 'LUCAS', color: 'bg-orange-500' }], conversionRate: 8, description: 'Produto principal' },
      { id: 'upsell', name: 'Upsell', emoji: '⬆️', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 30, description: 'Oferta complementar' },
      { id: 'client', name: 'Cliente VIP', emoji: '🏆', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 100, description: 'Retenção' },
    ],
  },
  {
    id: 'b2b',
    emoji: '🤝',
    title: 'Consultoria B2B',
    description: 'Para serviços de alto ticket com ciclo de vendas consultivo',
    stages: ['LinkedIn/Ads', 'LP', 'Formulário', 'Reunião', 'Proposta', 'Fechamento'],
    conversion: '8–15%',
    stages_data: [
      { id: 'traffic', name: 'LinkedIn/Ads', emoji: '💼', agents: [{ name: 'JOSÉ', color: 'bg-blue-500' }, { name: 'DAVI', color: 'bg-pink-500' }], conversionRate: 100, description: 'Prospecção ativa' },
      { id: 'landing', name: 'Landing Page', emoji: '🖥️', agents: [{ name: 'LUCAS', color: 'bg-orange-500' }], conversionRate: 40, description: 'Apresentação' },
      { id: 'form', name: 'Formulário', emoji: '📋', agents: [{ name: 'LUCAS', color: 'bg-orange-500' }], conversionRate: 60, description: 'Qualificação' },
      { id: 'meeting', name: 'Reunião', emoji: '📞', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 70, description: 'Discovery call' },
      { id: 'proposal', name: 'Proposta', emoji: '📄', agents: [{ name: 'PAULO', color: 'bg-yellow-500' }, { name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 50, description: 'Envio de proposta' },
      { id: 'client', name: 'Fechamento', emoji: '🏆', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 60, description: 'Contrato assinado' },
    ],
  },
  {
    id: 'clinica',
    emoji: '🏥',
    title: 'Clínica/Saúde',
    description: 'Para profissionais da saúde com foco em consultas e pacotes',
    stages: ['Tráfego Local', 'LP', 'WhatsApp', 'Consulta Gratuita', 'Pacote'],
    conversion: '20–35%',
    stages_data: [
      { id: 'traffic', name: 'Tráfego Local', emoji: '📍', agents: [{ name: 'JOSÉ', color: 'bg-blue-500' }], conversionRate: 100, description: 'Meta/Google Local' },
      { id: 'landing', name: 'Landing Page', emoji: '🖥️', agents: [{ name: 'LUCAS', color: 'bg-orange-500' }, { name: 'PAULO', color: 'bg-yellow-500' }], conversionRate: 45, description: 'Apresentação clínica' },
      { id: 'whatsapp', name: 'WhatsApp', emoji: '💬', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 75, description: 'Primeiro contato' },
      { id: 'consult', name: 'Consulta Gratuita', emoji: '🩺', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 65, description: 'Avaliação inicial' },
      { id: 'offer', name: 'Pacote', emoji: '📦', agents: [{ name: 'LUCAS', color: 'bg-orange-500' }, { name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 55, description: 'Tratamento completo' },
      { id: 'client', name: 'Paciente', emoji: '🏆', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 100, description: 'Fidelização' },
    ],
  },
  {
    id: 'auto',
    emoji: '🚗',
    title: 'Concessionária/Auto',
    description: 'Para vendas de veículos com jornada digital-presencial',
    stages: ['Meta Ads', 'LP Test Drive', 'WhatsApp', 'Visita', 'Proposta'],
    conversion: '3–8%',
    stages_data: [
      { id: 'traffic', name: 'Meta Ads', emoji: '📡', agents: [{ name: 'JOSÉ', color: 'bg-blue-500' }], conversionRate: 100, description: 'Segmentação por interesse' },
      { id: 'landing', name: 'LP Test Drive', emoji: '🚗', agents: [{ name: 'LUCAS', color: 'bg-orange-500' }, { name: 'PAULO', color: 'bg-yellow-500' }], conversionRate: 25, description: 'Agendamento de test drive' },
      { id: 'whatsapp', name: 'WhatsApp', emoji: '💬', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 80, description: 'Qualificação e follow-up' },
      { id: 'visit', name: 'Visita Presencial', emoji: '🏢', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 60, description: 'Test drive e apresentação' },
      { id: 'proposal', name: 'Proposta', emoji: '📄', agents: [{ name: 'PAULO', color: 'bg-yellow-500' }, { name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 45, description: 'Negociação e financiamento' },
      { id: 'client', name: 'Venda', emoji: '🏆', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 100, description: 'Entrega do veículo' },
    ],
  },
  {
    id: 'ecommerce',
    emoji: '🛒',
    title: 'E-commerce',
    description: 'Para lojas virtuais com foco em carrinho e recompra',
    stages: ['Tráfego', 'Página Produto', 'Carrinho', 'Checkout', 'Pós-venda'],
    conversion: '1–2%',
    stages_data: [
      { id: 'traffic', name: 'Tráfego', emoji: '📡', agents: [{ name: 'JOSÉ', color: 'bg-blue-500' }], conversionRate: 100, description: 'Meta/Google Shopping' },
      { id: 'product', name: 'Página do Produto', emoji: '🛍️', agents: [{ name: 'LUCAS', color: 'bg-orange-500' }, { name: 'MARIA', color: 'bg-rose-500' }], conversionRate: 15, description: 'Visualização do produto' },
      { id: 'cart', name: 'Carrinho', emoji: '🛒', agents: [{ name: 'LUCAS', color: 'bg-orange-500' }], conversionRate: 65, description: 'Adição ao carrinho' },
      { id: 'checkout', name: 'Checkout', emoji: '💳', agents: [{ name: 'LUCAS', color: 'bg-orange-500' }], conversionRate: 55, description: 'Finalização de compra' },
      { id: 'postsale', name: 'Pós-venda', emoji: '📦', agents: [{ name: 'JOÃO', color: 'bg-green-500' }, { name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 40, description: 'Retenção e recompra' },
      { id: 'client', name: 'Cliente Fiel', emoji: '🏆', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 100, description: 'LTV maximizado' },
    ],
  },
];

// ─── Performance data for metrics tab ────────────────────────────────────────

const FUNNEL_CHART_DATA = [
  { etapa: 'Tráfego', visitas: 10000 },
  { etapa: 'LP', visitas: 2800 },
  { etapa: 'Lead', visitas: 1960 },
  { etapa: 'Nutrição', visitas: 980 },
  { etapa: 'Oferta', visitas: 294 },
  { etapa: 'Cliente', visitas: 147 },
];

const WEEKLY_DATA = [
  { day: 'Seg', leads: 82, conversoes: 4 },
  { day: 'Ter', leads: 118, conversoes: 7 },
  { day: 'Qua', leads: 95, conversoes: 5 },
  { day: 'Qui', leads: 143, conversoes: 9 },
  { day: 'Sex', leads: 167, conversoes: 11 },
  { day: 'Sáb', leads: 134, conversoes: 8 },
  { day: 'Dom', leads: 108, conversoes: 6 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeCounts(stages: FunnelStage[], trafficVolume: number): number[] {
  const counts: number[] = [];
  let current = trafficVolume;
  stages.forEach((stage, i) => {
    if (i === 0) {
      counts.push(current);
    } else {
      current = Math.round(current * (stage.conversionRate / 100));
      counts.push(current);
    }
  });
  return counts;
}

function computeFinalConversion(stages: FunnelStage[]): number {
  let rate = 1;
  stages.slice(1).forEach((stage) => {
    rate *= stage.conversionRate / 100;
  });
  return parseFloat((rate * 100).toFixed(2));
}

// ─── CopySection component ────────────────────────────────────────────────────

function CopySection({ label, content, multiline = false }: { label: string; content: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        <button onClick={handleCopy} className="p-1 rounded hover:bg-muted transition-colors">
          {copied ? <CheckCheck className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
      </div>
      {multiline ? (
        <p className="text-sm leading-relaxed text-foreground">{content}</p>
      ) : (
        <p className="text-sm font-semibold text-foreground">{content}</p>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LucasFunil() {
  const { toast } = useToast();

  // Tab 1 — Funnel Builder
  const [funnelStages, setFunnelStages] = useState<FunnelStage[]>(DEFAULT_STAGES);
  const [trafficVolume, setTrafficVolume] = useState(10000);
  const [savedFunnel, setSavedFunnel] = useState(false);

  // Tab 3 — LP Copy Generator
  const [generating, setGenerating] = useState(false);
  const [copyResult, setCopyResult] = useState<LPCopy | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  // Form fields
  const [produto, setProduto] = useState('');
  const [publico, setPublico] = useState('');
  const [dor, setDor] = useState('');
  const [beneficios, setBeneficios] = useState('');
  const [provas, setProvas] = useState('');
  const [oferta, setOferta] = useState('');
  const [garantia, setGarantia] = useState('');
  const [cta, setCta] = useState('');

  // ── Funnel Builder helpers ──────────────────────────────────────────────────

  const counts = computeCounts(funnelStages, trafficVolume);
  const finalConversion = computeFinalConversion(funnelStages);
  const maxCount = counts[0] || 1;

  const updateConversion = useCallback((id: string, value: number) => {
    setFunnelStages((prev) =>
      prev.map((s) => (s.id === id ? { ...s, conversionRate: Math.min(100, Math.max(1, value)) } : s))
    );
  }, []);

  const applyTemplate = (template: FunnelTemplate) => {
    setFunnelStages(template.stages_data);
    toast({ title: `Modelo "${template.title}" aplicado!`, description: 'Ajuste as taxas de conversão conforme sua realidade.' });
  };

  const handleSaveFunnel = () => {
    setSavedFunnel(true);
    setTimeout(() => setSavedFunnel(false), 2000);
    toast({ title: 'Funil salvo!', description: 'Configuração do funil salva com sucesso.' });
  };

  // ── LP Copy Generator ───────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!produto.trim() || !publico.trim()) {
      toast({ title: 'Campos obrigatórios', description: 'Preencha pelo menos Produto e Público-alvo.', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    setCopyResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('lucas-funnel-api', {
        body: {
          action: 'generate_lp_copy',
          briefing: { produto: produto.trim(), publico: publico.trim(), dor: dor.trim(), beneficios: beneficios.trim(), provas: provas.trim(), oferta: oferta.trim(), garantia: garantia.trim(), cta: cta.trim() },
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setCopyResult(data.copy);
      setIsDemoMode(data.demo === true);
    } catch (err: any) {
      toast({ title: 'Erro ao gerar copy', description: err.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyAll = () => {
    if (!copyResult) return;
    const text = [
      `HEADLINE: ${copyResult.headline}`,
      `SUBHEADLINE: ${copyResult.subheadline}`,
      `HERO TEXT: ${copyResult.hero_text}`,
      `BENEFÍCIOS:\n${copyResult.benefits.join('\n')}`,
      `PROVA SOCIAL: ${copyResult.social_proof}`,
      `OFERTA — ${copyResult.offer_headline}\n${copyResult.offer_description}`,
      `GARANTIA: ${copyResult.guarantee}`,
      `FAQ:\n${copyResult.faq.map((f) => `P: ${f.q}\nR: ${f.a}`).join('\n\n')}`,
      `CTA PRINCIPAL: ${copyResult.cta_primary}`,
      `CTA SECUNDÁRIO: ${copyResult.cta_secondary}`,
      `URGÊNCIA: ${copyResult.urgency_text}`,
    ].join('\n\n─────────────\n\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2500);
    toast({ title: 'Copy copiado!', description: 'Todo o copy foi copiado para sua área de transferência.' });
  };

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
              <div className="p-2 rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-500/20">
                <Layers className="h-6 w-6 text-orange-400" />
              </div>
              LUCAS — Funil de Vendas
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Construa funis de alta conversão com inteligência artificial
            </p>
          </div>
          <Badge variant="outline" className="gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
            LUCAS Online
          </Badge>
        </div>

        <Tabs defaultValue="construtor">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="construtor" className="gap-1.5 text-xs sm:text-sm">🔀 Construtor</TabsTrigger>
            <TabsTrigger value="modelos" className="gap-1.5 text-xs sm:text-sm">📋 Modelos</TabsTrigger>
            <TabsTrigger value="copy" className="gap-1.5 text-xs sm:text-sm">✍️ Copy de LP</TabsTrigger>
            <TabsTrigger value="metricas" className="gap-1.5 text-xs sm:text-sm">📊 Métricas</TabsTrigger>
          </TabsList>

          {/* ─── Tab 1: Construtor de Funil ──────────────────────────────────── */}
          <TabsContent value="construtor" className="mt-5 space-y-5">
            {/* Traffic Volume */}
            <Card className="border-orange-500/20 bg-orange-500/5">
              <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-orange-300">Volume de Entrada Mensal</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Defina a quantidade de visitantes/leads que entram no topo do funil por mês</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={trafficVolume}
                    onChange={(e) => setTrafficVolume(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-32 text-right font-mono font-bold text-orange-300 border-orange-500/40 bg-background"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">visitas/mês</span>
                </div>
              </CardContent>
            </Card>

            {/* Visual Funnel */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="h-4 w-4 text-orange-400" />
                  Funil Visual Interativo
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {funnelStages.map((stage, idx) => {
                  const count = counts[idx];
                  const barWidth = Math.max(15, Math.round((count / maxCount) * 100));
                  return (
                    <div key={stage.id} className="space-y-1.5">
                      <div className="flex items-center gap-3">
                        {/* Stage info */}
                        <div className="w-36 flex-shrink-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-base">{stage.emoji}</span>
                            <div>
                              <p className="text-xs font-semibold leading-tight">{stage.name}</p>
                              <p className="text-[10px] text-muted-foreground">{stage.description}</p>
                            </div>
                          </div>
                        </div>

                        {/* Funnel bar */}
                        <div className="flex-1 relative h-9 flex items-center">
                          <div
                            className="h-full rounded-r-md transition-all duration-500 flex items-center px-2 min-w-[40px]"
                            style={{
                              width: `${barWidth}%`,
                              background: `linear-gradient(90deg, hsl(${30 - idx * 4}, 90%, ${55 - idx * 3}%) 0%, hsl(${25 - idx * 4}, 85%, ${50 - idx * 3}%) 100%)`,
                              opacity: 1 - idx * 0.08,
                            }}
                          >
                            <span className="text-xs font-bold text-white/90 drop-shadow-sm whitespace-nowrap">
                              {count.toLocaleString('pt-BR')}
                            </span>
                          </div>
                        </div>

                        {/* Agents */}
                        <div className="w-28 flex-shrink-0 flex flex-wrap gap-1 justify-end">
                          {stage.agents.map((agent) => (
                            <span key={agent.name} className={`text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full ${agent.color}`}>
                              {agent.name}
                            </span>
                          ))}
                        </div>

                        {/* Conversion rate input */}
                        {idx > 0 && (
                          <div className="w-20 flex-shrink-0 flex items-center gap-1">
                            <Input
                              type="number"
                              min={1}
                              max={100}
                              value={stage.conversionRate}
                              onChange={(e) => updateConversion(stage.id, parseInt(e.target.value) || 1)}
                              className="w-14 h-7 text-xs text-center font-mono border-border/50 bg-muted/30"
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                        )}
                        {idx === 0 && <div className="w-20 flex-shrink-0" />}
                      </div>
                      {idx < funnelStages.length - 1 && (
                        <div className="ml-36 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <ArrowRight className="h-2.5 w-2.5" />
                          <span>
                            {idx + 1 < funnelStages.length
                              ? `${funnelStages[idx + 1].conversionRate}% avança para ${funnelStages[idx + 1].name}`
                              : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Summary + Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="border-orange-500/30 bg-orange-500/5 sm:col-span-2">
                <CardContent className="p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Taxa de conversão final</p>
                      <p className="text-2xl font-bold text-orange-400 mt-1">{finalConversion}%</p>
                      <p className="text-[10px] text-muted-foreground">do tráfego ao cliente</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Clientes estimados/mês</p>
                      <p className="text-2xl font-bold text-emerald-400 mt-1">
                        {counts[counts.length - 1].toLocaleString('pt-BR')}
                      </p>
                      <p className="text-[10px] text-muted-foreground">de {trafficVolume.toLocaleString('pt-BR')} visitantes</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-2">
                  <Button
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white gap-2 text-sm"
                    onClick={handleSaveFunnel}
                  >
                    {savedFunnel ? <CheckCheck className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                    {savedFunnel ? 'Salvo!' : 'Salvar Funil'}
                  </Button>
                  <Button variant="outline" className="w-full gap-2 text-sm" asChild>
                    <Link to="/crm">
                      <ExternalLink className="h-4 w-4" />
                      Ver no CRM
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ─── Tab 2: Modelos de Funil ──────────────────────────────────────── */}
          <TabsContent value="modelos" className="mt-5">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {FUNNEL_TEMPLATES.map((template) => (
                <Card key={template.id} className="hover:border-orange-500/40 transition-colors group">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{template.emoji}</span>
                        <div>
                          <CardTitle className="text-sm">{template.title}</CardTitle>
                          <p className="text-xs text-muted-foreground mt-0.5">{template.description}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] text-orange-400 border-orange-400/40 shrink-0">
                        {template.conversion}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      {template.stages.map((stage, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <Badge variant="secondary" className="text-[10px] px-2 py-0.5">{stage}</Badge>
                          {i < template.stages.length - 1 && (
                            <ArrowRight className="h-2.5 w-2.5 text-muted-foreground flex-shrink-0" />
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {Array.from(new Set(template.stages_data.flatMap(s => s.agents.map(a => a.name)))).map((agent) => (
                        <span key={agent} className="text-[9px] font-semibold text-white px-1.5 py-0.5 rounded-full bg-orange-500/70">
                          {agent}
                        </span>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      className="w-full bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:border-orange-500/50 text-xs group-hover:bg-orange-500 group-hover:text-white transition-all"
                      onClick={() => applyTemplate(template)}
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                      Usar este modelo
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* ─── Tab 3: Copy de LP ───────────────────────────────────────────── */}
          <TabsContent value="copy" className="mt-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left — Form */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-orange-400" />
                    Briefing da Landing Page
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Produto/Serviço *</Label>
                    <Input
                      placeholder="Ex: Curso de Marketing Digital, Consultoria Financeira..."
                      value={produto}
                      onChange={(e) => setProduto(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Público-alvo *</Label>
                    <Input
                      placeholder="Ex: Empreendedores entre 25-45 anos..."
                      value={publico}
                      onChange={(e) => setPublico(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Principal problema/dor</Label>
                    <Textarea
                      placeholder="O que seu cliente mais sofre?"
                      value={dor}
                      onChange={(e) => setDor(e.target.value)}
                      rows={2}
                      className="resize-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Benefícios principais</Label>
                    <Textarea
                      placeholder="O que sua solução entrega?"
                      value={beneficios}
                      onChange={(e) => setBeneficios(e.target.value)}
                      rows={2}
                      className="resize-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Prova social</Label>
                    <Input
                      placeholder="Ex: 500+ clientes, resultados comprovados..."
                      value={provas}
                      onChange={(e) => setProvas(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Oferta/Preço</Label>
                    <Input
                      placeholder="Ex: R$997 ou 12x R$97"
                      value={oferta}
                      onChange={(e) => setOferta(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Garantia</Label>
                    <Input
                      placeholder="Ex: 30 dias ou dinheiro de volta"
                      value={garantia}
                      onChange={(e) => setGarantia(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">CTA desejado</Label>
                    <Input
                      placeholder="Ex: Comprar agora, Agendar consulta..."
                      value={cta}
                      onChange={(e) => setCta(e.target.value)}
                    />
                  </div>
                  <Button
                    className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold gap-2"
                    onClick={handleGenerate}
                    disabled={generating || !produto.trim() || !publico.trim()}
                  >
                    {generating ? (
                      <><Loader2 className="h-4 w-4 animate-spin" />Gerando copy...</>
                    ) : (
                      <><Sparkles className="h-4 w-4" />✨ Gerar Copy da LP</>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Right — Output */}
              {copyResult ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">Copy Gerado</h3>
                      {isDemoMode && (
                        <Badge variant="secondary" className="text-[10px]">Modo Demo</Badge>
                      )}
                    </div>
                    <Button size="sm" variant="outline" className="gap-2 text-xs" onClick={handleCopyAll}>
                      {copiedAll ? <CheckCheck className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedAll ? 'Copiado!' : 'Copiar Tudo'}
                    </Button>
                  </div>

                  {/* Headline */}
                  <Card className="border-orange-500/30 bg-orange-500/5">
                    <CardContent className="p-4 space-y-3">
                      <div>
                        <p className="text-[10px] text-orange-400 font-bold uppercase tracking-widest mb-1">🎯 Headline</p>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-lg font-bold leading-tight text-foreground">{copyResult.headline}</p>
                          <CopySection label="" content={copyResult.headline} />
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1">📝 Subheadline</p>
                        <CopySection label="" content={copyResult.subheadline} />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Hero + Benefits */}
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      <div>
                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-2">💬 Hero Text</p>
                        <p className="text-sm text-muted-foreground leading-relaxed">{copyResult.hero_text}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-2">✅ Benefícios</p>
                        <ul className="space-y-1.5">
                          {copyResult.benefits.map((b, i) => (
                            <li key={i} className="text-sm text-foreground">{b}</li>
                          ))}
                        </ul>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Social Proof */}
                  <Card className="border-emerald-500/20 bg-emerald-500/5">
                    <CardContent className="p-4">
                      <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mb-2">🏆 Prova Social</p>
                      <p className="text-sm text-foreground leading-relaxed">{copyResult.social_proof}</p>
                    </CardContent>
                  </Card>

                  {/* Offer */}
                  <Card className="border-amber-500/20 bg-amber-500/5">
                    <CardContent className="p-4 space-y-2">
                      <p className="text-[10px] text-amber-400 font-bold uppercase tracking-widest">💰 Oferta</p>
                      <p className="text-base font-bold text-foreground">{copyResult.offer_headline}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{copyResult.offer_description}</p>
                    </CardContent>
                  </Card>

                  {/* Guarantee */}
                  <Card className="border-blue-500/20 bg-blue-500/5">
                    <CardContent className="p-4">
                      <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-2">🛡️ Garantia</p>
                      <p className="text-sm text-foreground leading-relaxed">{copyResult.guarantee}</p>
                    </CardContent>
                  </Card>

                  {/* FAQ */}
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-3">❓ FAQ</p>
                      <div className="space-y-3">
                        {copyResult.faq.map((item, i) => (
                          <div key={i}>
                            <p className="text-xs font-semibold text-foreground">{item.q}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.a}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* CTA */}
                  <Card className="border-orange-500/30">
                    <CardContent className="p-4 space-y-3">
                      <p className="text-[10px] text-orange-400 font-bold uppercase tracking-widest">🚀 Call to Action</p>
                      <Button className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white font-bold text-sm">
                        {copyResult.cta_primary}
                      </Button>
                      <p className="text-xs text-center text-muted-foreground underline cursor-pointer">
                        {copyResult.cta_secondary}
                      </p>
                    </CardContent>
                  </Card>

                  {/* Urgency */}
                  <Card className="border-red-500/20 bg-red-500/5">
                    <CardContent className="p-4">
                      <p className="text-[10px] text-red-400 font-bold uppercase tracking-widest mb-1">⚡ Urgência</p>
                      <p className="text-sm font-semibold text-foreground">{copyResult.urgency_text}</p>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <Card className="border-dashed border-2 border-orange-500/20">
                  <CardContent className="py-24 text-center">
                    <div className="p-4 rounded-2xl bg-gradient-to-br from-orange-500/10 to-amber-500/10 w-fit mx-auto mb-4">
                      <Layers className="h-12 w-12 text-orange-400/50" />
                    </div>
                    <p className="text-muted-foreground text-sm font-medium">LUCAS vai criar seu copy de LP</p>
                    <p className="text-xs text-muted-foreground mt-2 max-w-xs mx-auto leading-relaxed">
                      Preencha o briefing ao lado com as informações do seu negócio e deixe o LUCAS criar um copy persuasivo de alta conversão ✨
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* ─── Tab 4: Métricas ──────────────────────────────────────────────── */}
          <TabsContent value="metricas" className="mt-5 space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="border-orange-500/20 bg-orange-500/5">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-muted-foreground">Taxa de Conversão Média</p>
                    <TrendingUp className="h-4 w-4 text-emerald-400" />
                  </div>
                  <p className="text-2xl font-bold text-orange-400">3.2%</p>
                  <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> +0.8% este mês
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-muted-foreground">Leads Gerados</p>
                    <Users className="h-4 w-4 text-blue-400" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">847</p>
                  <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> +12% vs. mês anterior
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-muted-foreground">Custo por Lead</p>
                    <BarChart3 className="h-4 w-4 text-amber-400" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">R$ 12,40</p>
                  <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
                    <TrendingDown className="h-3 w-3" /> -8% vs. mês anterior
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Funnel Bar Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-orange-400" />
                  Conversões por Etapa do Funil
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={FUNNEL_CHART_DATA} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="etapa" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                      labelStyle={{ color: 'hsl(var(--foreground))', fontSize: 12 }}
                    />
                    <Bar dataKey="visitas" name="Volume" fill="#f97316" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Weekly Line Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-orange-400" />
                  Performance dos Últimos 7 Dias
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={WEEKLY_DATA} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                      labelStyle={{ color: 'hsl(var(--foreground))', fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="leads" name="Leads" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="conversoes" name="Conversões" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* LUCAS Recommendations */}
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-orange-400" />
                Otimizações Recomendadas pelo LUCAS
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    icon: '📉',
                    title: 'Gargalo na Landing Page',
                    description: 'Taxa 28% abaixo da média do setor. Sugestão: teste novos headlines com o PAULO.',
                    agent: 'PAULO',
                    agentColor: 'bg-yellow-500',
                  },
                  {
                    icon: '📧',
                    title: 'Email com Baixo Engajamento',
                    description: 'Sequência de email com taxa de abertura de 18%. Acionar JOÃO para otimizar subject lines.',
                    agent: 'JOÃO',
                    agentColor: 'bg-green-500',
                  },
                  {
                    icon: '💬',
                    title: 'Alto Potencial no WhatsApp',
                    description: 'Leads que chegam ao MARCOS convertem 3x mais. Aumentar volume neste canal.',
                    agent: 'MARCOS',
                    agentColor: 'bg-purple-500',
                  },
                ].map((insight, i) => (
                  <Card key={i} className="hover:border-orange-500/30 transition-colors">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <span className="text-xl">{insight.icon}</span>
                        <div>
                          <p className="text-sm font-semibold">{insight.title}</p>
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{insight.description}</p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full gap-2 text-xs"
                      >
                        <span className={`text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full ${insight.agentColor}`}>
                          {insight.agent}
                        </span>
                        Acionar Agente
                        <Zap className="h-3 w-3 ml-auto" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
