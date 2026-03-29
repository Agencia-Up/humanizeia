import { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
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
import { useAuth } from '@/hooks/useAuth';
import { useAgentTasks } from '@/contexts/AgentTasksContext';
import { useAgentChat } from '@/contexts/AgentChatContext';
import {
  Brain, BarChart3, Compass, Lightbulb, Loader2,
  Sparkles, Target, TrendingUp, TrendingDown, Zap, ChevronRight, Shield, Star,
  Layers, Users, ArrowRight, Save, ExternalLink, Copy, CheckCheck, Search, Trash2,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

// ─── Lucas types & data ──────────────────────────────────────────────────────

interface FunnelStage {
  id: string; name: string; emoji: string;
  agents: { name: string; color: string }[];
  conversionRate: number; description: string;
}
interface LPCopy {
  headline: string; subheadline: string; hero_text: string; benefits: string[];
  social_proof: string; offer_headline: string; offer_description: string;
  guarantee: string; faq: { q: string; a: string }[]; cta_primary: string;
  cta_secondary: string; urgency_text: string;
}
interface FunnelTemplate {
  id: string; emoji: string; title: string; description: string;
  stages: string[]; conversion: string; stages_data: FunnelStage[];
}

const DEFAULT_STAGES: FunnelStage[] = [
  { id: 'traffic', name: 'Tráfego', emoji: '📡', agents: [{ name: 'JOSÉ', color: 'bg-blue-500' }], conversionRate: 100, description: 'Meta/Google Ads' },
  { id: 'landing', name: 'Landing Page', emoji: '🖥️', agents: [{ name: 'DANIEL', color: 'bg-cyan-500' }, { name: 'PAULO', color: 'bg-yellow-500' }], conversionRate: 28, description: 'Visitantes' },
  { id: 'lead', name: 'Lead Capturado', emoji: '📩', agents: [{ name: 'DANIEL', color: 'bg-cyan-500' }, { name: 'JOÃO', color: 'bg-green-500' }], conversionRate: 70, description: 'Leads' },
  { id: 'nurture', name: 'Nutrição', emoji: '🌱', agents: [{ name: 'JOÃO', color: 'bg-green-500' }, { name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 50, description: 'Leads Nutridos' },
  { id: 'offer', name: 'Proposta/Oferta', emoji: '💼', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }, { name: 'PAULO', color: 'bg-yellow-500' }], conversionRate: 30, description: 'Oportunidades' },
  { id: 'client', name: 'Cliente', emoji: '🏆', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 50, description: 'Vendas Fechadas' },
];

const FUNNEL_TEMPLATES: FunnelTemplate[] = [
  {
    id: 'lancamento', emoji: '🚀', title: 'Lançamento Digital',
    description: 'Para infoprodutos e cursos online com alta conversão em eventos',
    stages: ['Tráfego Frio', 'Página de Captura', 'Sequência Email', 'Webinário/VSL', 'Carrinho'], conversion: '2–4%',
    stages_data: [
      { id: 'traffic', name: 'Tráfego Frio', emoji: '📡', agents: [{ name: 'JOSÉ', color: 'bg-blue-500' }], conversionRate: 100, description: 'Meta/YouTube Ads' },
      { id: 'landing', name: 'Página de Captura', emoji: '📧', agents: [{ name: 'DANIEL', color: 'bg-cyan-500' }, { name: 'PAULO', color: 'bg-yellow-500' }], conversionRate: 35, description: 'Captura de leads' },
      { id: 'lead', name: 'Sequência Email', emoji: '✉️', agents: [{ name: 'JOÃO', color: 'bg-green-500' }], conversionRate: 60, description: 'Nutrição via email' },
      { id: 'nurture', name: 'Webinário/VSL', emoji: '🎬', agents: [{ name: 'PAULO', color: 'bg-yellow-500' }, { name: 'DANIEL', color: 'bg-cyan-500' }], conversionRate: 40, description: 'Apresentação ao vivo' },
      { id: 'offer', name: 'Carrinho', emoji: '🛒', agents: [{ name: 'DANIEL', color: 'bg-cyan-500' }], conversionRate: 15, description: 'Checkout' },
      { id: 'client', name: 'Cliente', emoji: '🏆', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 90, description: 'Pós-venda' },
    ],
  },
  {
    id: 'perpetuo', emoji: '🔄', title: 'Perpétuo/Evergreen',
    description: 'Vendas automatizadas 24/7 sem depender de lançamentos',
    stages: ['Ads', 'LP', 'Email Nurture', 'Oferta', 'Upsell'], conversion: '1–3%',
    stages_data: [
      { id: 'traffic', name: 'Tráfego Ads', emoji: '📡', agents: [{ name: 'JOSÉ', color: 'bg-blue-500' }], conversionRate: 100, description: 'Meta/Google Ads' },
      { id: 'landing', name: 'Landing Page', emoji: '🖥️', agents: [{ name: 'DANIEL', color: 'bg-cyan-500' }, { name: 'PAULO', color: 'bg-yellow-500' }], conversionRate: 30, description: 'Captura e venda' },
      { id: 'lead', name: 'Email Nurture', emoji: '📧', agents: [{ name: 'JOÃO', color: 'bg-green-500' }], conversionRate: 55, description: 'Sequência automática' },
      { id: 'offer', name: 'Oferta Principal', emoji: '💰', agents: [{ name: 'DANIEL', color: 'bg-cyan-500' }], conversionRate: 8, description: 'Produto principal' },
      { id: 'upsell', name: 'Upsell', emoji: '⬆️', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 30, description: 'Oferta complementar' },
      { id: 'client', name: 'Cliente VIP', emoji: '🏆', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 100, description: 'Retenção' },
    ],
  },
  {
    id: 'b2b', emoji: '🤝', title: 'Consultoria B2B',
    description: 'Para serviços de alto ticket com ciclo de vendas consultivo',
    stages: ['LinkedIn/Ads', 'LP', 'Formulário', 'Reunião', 'Proposta', 'Fechamento'], conversion: '8–15%',
    stages_data: [
      { id: 'traffic', name: 'LinkedIn/Ads', emoji: '💼', agents: [{ name: 'JOSÉ', color: 'bg-blue-500' }, { name: 'DAVI', color: 'bg-pink-500' }], conversionRate: 100, description: 'Prospecção ativa' },
      { id: 'landing', name: 'Landing Page', emoji: '🖥️', agents: [{ name: 'DANIEL', color: 'bg-cyan-500' }], conversionRate: 40, description: 'Apresentação' },
      { id: 'form', name: 'Formulário', emoji: '📋', agents: [{ name: 'DANIEL', color: 'bg-cyan-500' }], conversionRate: 60, description: 'Qualificação' },
      { id: 'meeting', name: 'Reunião', emoji: '📞', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 70, description: 'Discovery call' },
      { id: 'proposal', name: 'Proposta', emoji: '📄', agents: [{ name: 'PAULO', color: 'bg-yellow-500' }, { name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 50, description: 'Envio de proposta' },
      { id: 'client', name: 'Fechamento', emoji: '🏆', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 60, description: 'Contrato assinado' },
    ],
  },
  {
    id: 'clinica', emoji: '🏥', title: 'Clínica/Saúde',
    description: 'Para profissionais da saúde com foco em consultas e pacotes',
    stages: ['Tráfego Local', 'LP', 'WhatsApp', 'Consulta Gratuita', 'Pacote'], conversion: '20–35%',
    stages_data: [
      { id: 'traffic', name: 'Tráfego Local', emoji: '📍', agents: [{ name: 'JOSÉ', color: 'bg-blue-500' }], conversionRate: 100, description: 'Meta/Google Local' },
      { id: 'landing', name: 'Landing Page', emoji: '🖥️', agents: [{ name: 'DANIEL', color: 'bg-cyan-500' }, { name: 'PAULO', color: 'bg-yellow-500' }], conversionRate: 45, description: 'Apresentação clínica' },
      { id: 'whatsapp', name: 'WhatsApp', emoji: '💬', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 75, description: 'Primeiro contato' },
      { id: 'consult', name: 'Consulta Gratuita', emoji: '🩺', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 65, description: 'Avaliação inicial' },
      { id: 'offer', name: 'Pacote', emoji: '📦', agents: [{ name: 'DANIEL', color: 'bg-cyan-500' }, { name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 55, description: 'Tratamento completo' },
      { id: 'client', name: 'Paciente', emoji: '🏆', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 100, description: 'Fidelização' },
    ],
  },
  {
    id: 'ecommerce', emoji: '🛒', title: 'E-commerce',
    description: 'Para lojas virtuais com foco em carrinho e recompra',
    stages: ['Tráfego', 'Página Produto', 'Carrinho', 'Checkout', 'Pós-venda'], conversion: '1–2%',
    stages_data: [
      { id: 'traffic', name: 'Tráfego', emoji: '📡', agents: [{ name: 'JOSÉ', color: 'bg-blue-500' }], conversionRate: 100, description: 'Meta/Google Shopping' },
      { id: 'product', name: 'Página do Produto', emoji: '🛍️', agents: [{ name: 'DANIEL', color: 'bg-cyan-500' }, { name: 'MARIA', color: 'bg-rose-500' }], conversionRate: 15, description: 'Visualização do produto' },
      { id: 'cart', name: 'Carrinho', emoji: '🛒', agents: [{ name: 'DANIEL', color: 'bg-cyan-500' }], conversionRate: 65, description: 'Adição ao carrinho' },
      { id: 'checkout', name: 'Checkout', emoji: '💳', agents: [{ name: 'DANIEL', color: 'bg-cyan-500' }], conversionRate: 55, description: 'Finalização de compra' },
      { id: 'postsale', name: 'Pós-venda', emoji: '📦', agents: [{ name: 'JOÃO', color: 'bg-green-500' }, { name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 40, description: 'Retenção e recompra' },
      { id: 'client', name: 'Cliente Fiel', emoji: '🏆', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }], conversionRate: 100, description: 'LTV maximizado' },
    ],
  },
  {
    id: 'aida_basic', emoji: '🎯', title: 'Funil AIDA Completo',
    description: 'Modelo estratégico com cada agente responsável por uma etapa da jornada AIDA',
    stages: ['Atenção (DAVI)', 'Interesse (DANIEL)', 'Desejo (JOÃO)', 'Ação (MARCOS)', 'Pós-Venda (DANIEL)'], conversion: '3–8%',
    stages_data: [
      { id: 'atencao',   name: 'Atenção',   emoji: '👀', agents: [{ name: 'DAVI',   color: 'bg-sky-500' }],     conversionRate: 100, description: 'Conteúdo social que gera atenção' },
      { id: 'interesse', name: 'Interesse', emoji: '🖥️', agents: [{ name: 'DANIEL', color: 'bg-cyan-500' }, { name: 'PAULO', color: 'bg-yellow-500' }], conversionRate: 30, description: 'Landing page que converte visitantes' },
      { id: 'desejo',    name: 'Desejo',    emoji: '📧', agents: [{ name: 'JOÃO',   color: 'bg-emerald-500' }], conversionRate: 55, description: 'Email que aquece o lead' },
      { id: 'acao',      name: 'Ação',      emoji: '💳', agents: [{ name: 'MARCOS', color: 'bg-purple-500' }],  conversionRate: 15, description: 'Checkout e conversão' },
      { id: 'posvenda',  name: 'Pós-Venda', emoji: '📊', agents: [{ name: 'DANIEL', color: 'bg-cyan-500' }],   conversionRate: 90, description: 'Análise KPI e retenção' },
    ],
  },
];

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

function computeCounts(stages: FunnelStage[], trafficVolume: number): number[] {
  const counts: number[] = [];
  let current = trafficVolume;
  stages.forEach((stage, i) => {
    if (i === 0) { counts.push(current); }
    else { current = Math.round(current * (stage.conversionRate / 100)); counts.push(current); }
  });
  return counts;
}
function computeFinalConversion(stages: FunnelStage[]): number {
  let rate = 1;
  stages.slice(1).forEach(stage => { rate *= stage.conversionRate / 100; });
  return parseFloat((rate * 100).toFixed(2));
}
function CopySection({ label, content }: { label: string; content: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        <button onClick={() => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="p-1 rounded hover:bg-muted transition-colors">
          {copied ? <CheckCheck className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
      </div>
      <p className="text-sm font-semibold text-foreground">{content}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

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
  const { user } = useAuth();
  const { toast } = useToast();
  const { createTask } = useAgentTasks();
  const { getHistory, saveMessage, clearHistory } = useAgentChat();
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState('estrategia');
  const [strategy, setStrategy] = useState<GeneratedStrategy | null>(null);

  // Carregar histórico ao montar
  useEffect(() => {
    const loadHistory = async () => {
      const history = await getHistory('daniel');
      // Tentar encontrar a última estratégia gerada
      const lastStrategy = [...history].reverse().find(m => m.role === 'assistant' && m.metadata?.type === 'business_strategy');
      if (lastStrategy && lastStrategy.metadata?.strategy) {
        setStrategy(lastStrategy.metadata.strategy as any);
      }
      
      // Tentar encontrar o último copy de LP
      const lastCopy = [...history].reverse().find(m => m.role === 'assistant' && m.metadata?.type === 'lp_copy');
      if (lastCopy && lastCopy.metadata?.copy) {
        setCopyResult(lastCopy.metadata.copy as any);
      }

      // Tentar encontrar a última pesquisa
      const lastResearch = [...history].reverse().find(m => m.role === 'assistant' && m.metadata?.type === 'niche_research');
      if (lastResearch && lastResearch.metadata?.research) {
        setResearchResult(lastResearch.metadata.research as any);
      }
    };
    loadHistory();
  }, [getHistory]);

  const handleClearHistory = async () => {
    try {
      await clearHistory('daniel');
      setStrategy(null);
      setCopyResult(null);
      setResearchResult(null);
      toast({ title: 'Histórico da estratégia limpo.' });
    } catch (err: any) {
      toast({ title: 'Erro ao limpar', description: err.message, variant: 'destructive' });
    }
  };

  // Form — Strategy
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('servicos');
  const [strategyType, setStrategyType] = useState('crescimento');
  const [currentSituation, setCurrentSituation] = useState('');
  const [mainChallenge, setMainChallenge] = useState('');
  const [budget, setBudget] = useState('');
  const [timeframe, setTimeframe] = useState('6');

  // State — Funnel Builder (from Lucas)
  const [funnelStages, setFunnelStages] = useState<FunnelStage[]>(DEFAULT_STAGES);
  const [trafficVolume, setTrafficVolume] = useState(10000);
  const [savedFunnel, setSavedFunnel] = useState(false);
  const counts = computeCounts(funnelStages, trafficVolume);
  const finalConversion = computeFinalConversion(funnelStages);
  const maxCount = counts[0] || 1;
  const updateConversion = useCallback((id: string, value: number) => {
    setFunnelStages(prev => prev.map(s => s.id === id ? { ...s, conversionRate: Math.min(100, Math.max(1, value)) } : s));
  }, []);
  const applyTemplate = (template: FunnelTemplate) => {
    setFunnelStages(template.stages_data);
    toast({ title: `Modelo "${template.title}" aplicado!`, description: 'Ajuste as taxas de conversão conforme sua realidade.' });
  };

  // State — LP Copy Generator (from Lucas)
  const [generatingCopy, setGeneratingCopy] = useState(false);
  const [copyResult, setCopyResult] = useState<LPCopy | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [produto, setProduto] = useState('');
  const [publico, setPublico] = useState('');
  const [dor, setDor] = useState('');
  const [beneficios, setBeneficios] = useState('');
  const [provas, setProvas] = useState('');
  const [oferta, setOferta] = useState('');
  const [garantia, setGarantia] = useState('');
  const [cta, setCta] = useState('');

  // ── Research state ──
  const [researchNiche, setResearchNiche] = useState('');
  const [researchPlatforms, setResearchPlatforms] = useState<string[]>(['instagram', 'tiktok', 'google']);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchResult, setResearchResult] = useState<any>(null);
  const [researchError, setResearchError] = useState('');

  const handleGenerateCopy = async () => {
    if (!produto.trim() || !publico.trim()) {
      toast({ title: 'Campos obrigatórios', description: 'Preencha Produto e Público-alvo.', variant: 'destructive' });
      return;
    }
    setGeneratingCopy(true);
    setCopyResult(null);
    try {
      const briefing = { produto: produto.trim(), publico: publico.trim(), dor: dor.trim(), beneficios: beneficios.trim(), provas: provas.trim(), oferta: oferta.trim(), garantia: garantia.trim(), cta: cta.trim() };
      
      // Salvar request no histórico
      await saveMessage('daniel', 'user', `Gerar Copy de LP para: ${produto}`);

      const { data, error } = await supabase.functions.invoke('lucas-funnel-api', {
        body: { action: 'generate_lp_copy', briefing },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      setCopyResult(data.copy);
      setIsDemoMode(data.demo === true);

      // Salvar resultado no histórico
      await saveMessage('daniel', 'assistant', `Copy gerado para ${produto}.`, { 
        type: 'lp_copy',
        copy: data.copy 
      });

    } catch (err: any) {
      toast({ title: 'Erro ao gerar copy', description: err.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setGeneratingCopy(false);
    }
  };

  const handleCopyAll = () => {
    if (!copyResult) return;
    const text = [`HEADLINE: ${copyResult.headline}`, `SUBHEADLINE: ${copyResult.subheadline}`, `HERO TEXT: ${copyResult.hero_text}`, `BENEFÍCIOS:\n${copyResult.benefits.join('\n')}`, `PROVA SOCIAL: ${copyResult.social_proof}`, `OFERTA — ${copyResult.offer_headline}\n${copyResult.offer_description}`, `GARANTIA: ${copyResult.guarantee}`, `FAQ:\n${copyResult.faq.map(f => `P: ${f.q}\nR: ${f.a}`).join('\n\n')}`, `CTA PRINCIPAL: ${copyResult.cta_primary}`, `CTA SECUNDÁRIO: ${copyResult.cta_secondary}`, `URGÊNCIA: ${copyResult.urgency_text}`].join('\n\n─────────────\n\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2500);
    toast({ title: 'Copy copiado!', description: 'Todo o copy foi copiado para sua área de transferência.' });
  };

  const handleGenerate = async () => {
    if (!businessName.trim() || !mainChallenge.trim()) return;
    setGenerating(true);
    try {
      // 1. Salvar request no histórico
      await saveMessage('daniel', 'user', `Análise estratégica para: ${businessName}`);

      // 2. Criar tarefa em segundo plano
      const taskId = await createTask('daniel', 'generate_strategy', {
        business_name: businessName.trim(),
        business_type: businessType,
        strategy_type: strategyType,
        main_challenge: mainChallenge.trim()
      });

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
          task_id: taskId,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      setStrategy(data.strategy);

      // 3. Salvar resultado no histórico
      await saveMessage('daniel', 'assistant', `Estratégia para ${businessName} gerada com sucesso.`, { 
        type: 'business_strategy',
        strategy: data.strategy 
      });

    } catch (err: any) {
      // Demo mode fallback
      const demoStrategy = buildDemoStrategy(businessName, strategyType, mainChallenge, parseInt(timeframe));
      setStrategy(demoStrategy);
      
      await saveMessage('daniel', 'assistant', `Gerada estratégia demonstrativa para ${businessName}.`, { 
        type: 'business_strategy',
        strategy: demoStrategy 
      });

      toast({ title: 'Modo demo', description: 'Mostrando estratégia demonstrativa. Configure a API para análise completa.' });
    } finally {
      setGenerating(false);
    }
  };

  const handleResearch = async () => {
    if (!researchNiche.trim()) {
      toast({ title: 'Informe o nicho', description: 'Digite o nicho do seu cliente antes de pesquisar.', variant: 'destructive' });
      return;
    }
    setResearchLoading(true);
    setResearchResult(null);
    setResearchError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada');
      
      // 1. Salvar request no histórico
      await saveMessage('daniel', 'user', `Pesquisar nicho: ${researchNiche}`);

      const { data, error } = await supabase.functions.invoke('daniel-strategy-api', {
        body: { action: 'research_trends', niche: researchNiche, platforms: researchPlatforms },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      
      setResearchResult(data.research);

      // 2. Salvar resultado no histórico
      await saveMessage('daniel', 'assistant', `Resultados da pesquisa para ${researchNiche}.`, { 
        type: 'niche_research',
        research: data.research 
      });

      toast({ title: '🔍 Pesquisa concluída!', description: `${data.research?.content_briefs?.length || 0} pautas geradas para "${researchNiche}".` });
    } catch (err: any) {
      setResearchError(err.message);
      toast({ title: 'Erro na pesquisa', description: err.message, variant: 'destructive' });
    } finally {
      setResearchLoading(false);
    }
  };

  const togglePlatform = (p: string) => {
    setResearchPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
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
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearHistory}
              className="text-muted-foreground hover:text-destructive gap-1.5 text-xs h-8"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Limpar Histórico
            </Button>
            <Badge variant="outline" className="gap-1 h-8">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              DANIEL Online
            </Badge>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-8 text-xs">
            <TabsTrigger value="estrategia" className="gap-1 text-xs"><Compass className="h-3 w-3" />Estratégia</TabsTrigger>
            <TabsTrigger value="analise" className="gap-1 text-xs"><BarChart3 className="h-3 w-3" />Análise</TabsTrigger>
            <TabsTrigger value="swot" className="gap-1 text-xs"><Target className="h-3 w-3" />SWOT</TabsTrigger>
            <TabsTrigger value="construtor" className="gap-1 text-xs"><Layers className="h-3 w-3" />Construtor</TabsTrigger>
            <TabsTrigger value="modelos" className="gap-1 text-xs">📋 Modelos</TabsTrigger>
            <TabsTrigger value="copy" className="gap-1 text-xs">✍️ Copy LP</TabsTrigger>
            <TabsTrigger value="metricas" className="gap-1 text-xs"><TrendingUp className="h-3 w-3" />Métricas</TabsTrigger>
            <TabsTrigger value="pesquisa" className="text-[10px]">🔍 Pesquisa</TabsTrigger>
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
          {/* ─── CONSTRUTOR DE FUNIL ──────────────────────────────────────────── */}
          <TabsContent value="construtor" className="mt-5 space-y-5">
            <Card className="border-cyan-500/20 bg-cyan-500/5">
              <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-cyan-300">Volume de Entrada Mensal</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Visitantes/leads no topo do funil por mês</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input type="number" value={trafficVolume} onChange={e => setTrafficVolume(Math.max(1, parseInt(e.target.value) || 1))} className="w-32 text-right font-mono font-bold text-cyan-300 border-cyan-500/40 bg-background" />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">visitas/mês</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4 text-cyan-400" />Funil Visual Interativo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {funnelStages.map((stage, idx) => {
                  const count = counts[idx];
                  const barWidth = Math.max(15, Math.round((count / maxCount) * 100));
                  return (
                    <div key={stage.id} className="space-y-1.5">
                      <div className="flex items-center gap-3">
                        <div className="w-36 flex-shrink-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-base">{stage.emoji}</span>
                            <div>
                              <p className="text-xs font-semibold leading-tight">{stage.name}</p>
                              <p className="text-[10px] text-muted-foreground">{stage.description}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex-1 relative h-9 flex items-center">
                          <div className="h-full rounded-r-md transition-all duration-500 flex items-center px-2 min-w-[40px]" style={{ width: `${barWidth}%`, background: `linear-gradient(90deg, hsl(${190 - idx * 4}, 80%, ${55 - idx * 3}%) 0%, hsl(${185 - idx * 4}, 75%, ${50 - idx * 3}%) 100%)`, opacity: 1 - idx * 0.08 }}>
                            <span className="text-xs font-bold text-white/90 drop-shadow-sm whitespace-nowrap">{count.toLocaleString('pt-BR')}</span>
                          </div>
                        </div>
                        <div className="w-28 flex-shrink-0 flex flex-wrap gap-1 justify-end">
                          {stage.agents.map(agent => (<span key={agent.name} className={`text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full ${agent.color}`}>{agent.name}</span>))}
                        </div>
                        {idx > 0 ? (
                          <div className="w-20 flex-shrink-0 flex items-center gap-1">
                            <Input type="number" min={1} max={100} value={stage.conversionRate} onChange={e => updateConversion(stage.id, parseInt(e.target.value) || 1)} className="w-14 h-7 text-xs text-center font-mono border-border/50 bg-muted/30" />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                        ) : <div className="w-20 flex-shrink-0" />}
                      </div>
                      {idx < funnelStages.length - 1 && (
                        <div className="ml-36 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <ArrowRight className="h-2.5 w-2.5" />
                          <span>{idx + 1 < funnelStages.length ? `${funnelStages[idx + 1].conversionRate}% avança para ${funnelStages[idx + 1].name}` : ''}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="border-cyan-500/30 bg-cyan-500/5 sm:col-span-2">
                <CardContent className="p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Taxa de conversão final</p>
                      <p className="text-2xl font-bold text-cyan-400 mt-1">{finalConversion}%</p>
                      <p className="text-[10px] text-muted-foreground">do tráfego ao cliente</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Clientes estimados/mês</p>
                      <p className="text-2xl font-bold text-emerald-400 mt-1">{counts[counts.length - 1].toLocaleString('pt-BR')}</p>
                      <p className="text-[10px] text-muted-foreground">de {trafficVolume.toLocaleString('pt-BR')} visitantes</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 space-y-2">
                  <Button className="w-full bg-cyan-500 hover:bg-cyan-600 text-white gap-2 text-sm" onClick={() => { setSavedFunnel(true); setTimeout(() => setSavedFunnel(false), 2000); toast({ title: 'Funil salvo!' }); }}>
                    {savedFunnel ? <CheckCheck className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                    {savedFunnel ? 'Salvo!' : 'Salvar Funil'}
                  </Button>
                  <Button variant="outline" className="w-full gap-2 text-sm" asChild>
                    <Link to="/crm"><ExternalLink className="h-4 w-4" />Ver no CRM</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ─── MODELOS DE FUNIL ─────────────────────────────────────────────── */}
          <TabsContent value="modelos" className="mt-5">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {FUNNEL_TEMPLATES.map(template => (
                <Card key={template.id} className="hover:border-cyan-500/40 transition-colors group">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{template.emoji}</span>
                        <div>
                          <CardTitle className="text-sm">{template.title}</CardTitle>
                          <p className="text-xs text-muted-foreground mt-0.5">{template.description}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-400/40 shrink-0">{template.conversion}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      {template.stages.map((stage, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <Badge variant="secondary" className="text-[10px] px-2 py-0.5">{stage}</Badge>
                          {i < template.stages.length - 1 && <ArrowRight className="h-2.5 w-2.5 text-muted-foreground flex-shrink-0" />}
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {Array.from(new Set(template.stages_data.flatMap(s => s.agents.map(a => a.name)))).map(agent => (
                        <span key={agent} className="text-[9px] font-semibold text-white px-1.5 py-0.5 rounded-full bg-cyan-500/70">{agent}</span>
                      ))}
                    </div>
                    <Button size="sm" className="w-full bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:border-cyan-500/50 text-xs group-hover:bg-cyan-500 group-hover:text-white transition-all" onClick={() => applyTemplate(template)}>
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" />Usar este modelo
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* ─── COPY DE LP ───────────────────────────────────────────────────── */}
          <TabsContent value="copy" className="mt-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-400" />Briefing da Landing Page</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5"><Label className="text-xs">Produto/Serviço *</Label><Input placeholder="Ex: Curso de Marketing Digital..." value={produto} onChange={e => setProduto(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Público-alvo *</Label><Input placeholder="Ex: Empreendedores entre 25-45 anos..." value={publico} onChange={e => setPublico(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Principal problema/dor</Label><Textarea placeholder="O que seu cliente mais sofre?" value={dor} onChange={e => setDor(e.target.value)} rows={2} className="resize-none" /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Benefícios principais</Label><Textarea placeholder="O que sua solução entrega?" value={beneficios} onChange={e => setBeneficios(e.target.value)} rows={2} className="resize-none" /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Prova social</Label><Input placeholder="Ex: 500+ clientes, resultados comprovados..." value={provas} onChange={e => setProvas(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Oferta/Preço</Label><Input placeholder="Ex: R$997 ou 12x R$97" value={oferta} onChange={e => setOferta(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Garantia</Label><Input placeholder="Ex: 30 dias ou dinheiro de volta" value={garantia} onChange={e => setGarantia(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">CTA desejado</Label><Input placeholder="Ex: Comprar agora, Agendar consulta..." value={cta} onChange={e => setCta(e.target.value)} /></div>
                  <Button className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold gap-2" onClick={handleGenerateCopy} disabled={generatingCopy || !produto.trim() || !publico.trim()}>
                    {generatingCopy ? <><Loader2 className="h-4 w-4 animate-spin" />Gerando copy...</> : <><Sparkles className="h-4 w-4" />✨ Gerar Copy da LP</>}
                  </Button>
                </CardContent>
              </Card>
              {copyResult ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">Copy Gerado</h3>
                      {isDemoMode && <Badge variant="secondary" className="text-[10px]">Modo Demo</Badge>}
                    </div>
                    <Button size="sm" variant="outline" className="gap-2 text-xs" onClick={handleCopyAll}>
                      {copiedAll ? <CheckCheck className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedAll ? 'Copiado!' : 'Copiar Tudo'}
                    </Button>
                  </div>
                  <Card className="border-cyan-500/30 bg-cyan-500/5"><CardContent className="p-4 space-y-3">
                    <div><p className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest mb-1">🎯 Headline</p><p className="text-lg font-bold leading-tight text-foreground">{copyResult.headline}</p></div>
                    <div><p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1">📝 Subheadline</p><CopySection label="" content={copyResult.subheadline} /></div>
                  </CardContent></Card>
                  <Card><CardContent className="p-4 space-y-3">
                    <div><p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-2">💬 Hero Text</p><p className="text-sm text-muted-foreground leading-relaxed">{copyResult.hero_text}</p></div>
                    <div><p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-2">✅ Benefícios</p><ul className="space-y-1.5">{copyResult.benefits.map((b, i) => <li key={i} className="text-sm text-foreground">{b}</li>)}</ul></div>
                  </CardContent></Card>
                  <Card className="border-emerald-500/20 bg-emerald-500/5"><CardContent className="p-4"><p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mb-2">🏆 Prova Social</p><p className="text-sm text-foreground leading-relaxed">{copyResult.social_proof}</p></CardContent></Card>
                  <Card className="border-amber-500/20 bg-amber-500/5"><CardContent className="p-4 space-y-2"><p className="text-[10px] text-amber-400 font-bold uppercase tracking-widest">💰 Oferta</p><p className="text-base font-bold text-foreground">{copyResult.offer_headline}</p><p className="text-sm text-muted-foreground leading-relaxed">{copyResult.offer_description}</p></CardContent></Card>
                  <Card className="border-blue-500/20 bg-blue-500/5"><CardContent className="p-4"><p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-2">🛡️ Garantia</p><p className="text-sm text-foreground leading-relaxed">{copyResult.guarantee}</p></CardContent></Card>
                  <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-3">❓ FAQ</p><div className="space-y-3">{copyResult.faq.map((item, i) => <div key={i}><p className="text-xs font-semibold text-foreground">{item.q}</p><p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.a}</p></div>)}</div></CardContent></Card>
                  <Card className="border-cyan-500/30"><CardContent className="p-4 space-y-3"><p className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest">🚀 Call to Action</p><Button className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold text-sm">{copyResult.cta_primary}</Button><p className="text-xs text-center text-muted-foreground underline cursor-pointer">{copyResult.cta_secondary}</p></CardContent></Card>
                  <Card className="border-red-500/20 bg-red-500/5"><CardContent className="p-4"><p className="text-[10px] text-red-400 font-bold uppercase tracking-widest mb-1">⚡ Urgência</p><p className="text-sm font-semibold text-foreground">{copyResult.urgency_text}</p></CardContent></Card>
                </div>
              ) : (
                <Card className="border-dashed border-2 border-cyan-500/20">
                  <CardContent className="py-24 text-center">
                    <div className="p-4 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-blue-500/10 w-fit mx-auto mb-4">
                      <Layers className="h-12 w-12 text-cyan-400/50" />
                    </div>
                    <p className="text-muted-foreground text-sm font-medium">DANIEL vai criar seu copy de LP</p>
                    <p className="text-xs text-muted-foreground mt-2 max-w-xs mx-auto leading-relaxed">Preencha o briefing ao lado com as informações do seu negócio e deixe o DANIEL criar um copy persuasivo de alta conversão ✨</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* ─── MÉTRICAS ─────────────────────────────────────────────────────── */}
          <TabsContent value="metricas" className="mt-5 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="border-cyan-500/20 bg-cyan-500/5"><CardContent className="p-4">
                <div className="flex items-center justify-between mb-2"><p className="text-xs text-muted-foreground">Taxa de Conversão Média</p><TrendingUp className="h-4 w-4 text-emerald-400" /></div>
                <p className="text-2xl font-bold text-cyan-400">3.2%</p>
                <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1"><TrendingUp className="h-3 w-3" /> +0.8% este mês</p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="flex items-center justify-between mb-2"><p className="text-xs text-muted-foreground">Leads Gerados</p><Users className="h-4 w-4 text-blue-400" /></div>
                <p className="text-2xl font-bold text-foreground">847</p>
                <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1"><TrendingUp className="h-3 w-3" /> +12% vs. mês anterior</p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="flex items-center justify-between mb-2"><p className="text-xs text-muted-foreground">Custo por Lead</p><BarChart3 className="h-4 w-4 text-amber-400" /></div>
                <p className="text-2xl font-bold text-foreground">R$ 12,40</p>
                <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1"><TrendingDown className="h-3 w-3" /> -8% vs. mês anterior</p>
              </CardContent></Card>
            </div>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4 text-cyan-400" />Conversões por Etapa do Funil</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={FUNNEL_CHART_DATA} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="etapa" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} labelStyle={{ color: 'hsl(var(--foreground))', fontSize: 12 }} />
                    <Bar dataKey="visitas" name="Volume" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-cyan-400" />Performance dos Últimos 7 Dias</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={WEEKLY_DATA} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} labelStyle={{ color: 'hsl(var(--foreground))', fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="leads" name="Leads" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="conversoes" name="Conversões" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-400" />Otimizações Recomendadas pelo DANIEL</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { icon: '📉', title: 'Gargalo na Landing Page', description: 'Taxa 28% abaixo da média do setor. Sugestão: teste novos headlines com o PAULO.', agent: 'PAULO', agentColor: 'bg-yellow-500' },
                  { icon: '📧', title: 'Email com Baixo Engajamento', description: 'Sequência de email com taxa de abertura de 18%. Acionar JOÃO para otimizar subject lines.', agent: 'JOÃO', agentColor: 'bg-green-500' },
                  { icon: '💬', title: 'Alto Potencial no WhatsApp', description: 'Leads que chegam ao MARCOS convertem 3x mais. Aumentar volume neste canal.', agent: 'MARCOS', agentColor: 'bg-purple-500' },
                ].map((insight, i) => (
                  <Card key={i} className="hover:border-cyan-500/30 transition-colors">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <span className="text-xl">{insight.icon}</span>
                        <div><p className="text-sm font-semibold">{insight.title}</p><p className="text-xs text-muted-foreground mt-1 leading-relaxed">{insight.description}</p></div>
                      </div>
                      <Button size="sm" variant="outline" className="w-full gap-2 text-xs">
                        <span className={`text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full ${insight.agentColor}`}>{insight.agent}</span>
                        Acionar Agente
                        <Zap className="h-3 w-3 ml-auto" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>

        {/* ── PESQUISA DE TENDÊNCIAS ── */}
        <TabsContent value="pesquisa" className="space-y-5 mt-4">
          {/* Header */}
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-5 py-4 flex items-start gap-3">
            <Search className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-cyan-400">Pesquisa de Tendências com IA</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Daniel analisa o que está viral no nicho do seu cliente — Instagram, TikTok e Google — e gera pautas prontas para o Davi publicar.
                {' '}<span className="text-cyan-400/70">Configure o Apify em Integrações para dados reais.</span>
              </p>
            </div>
          </div>

          {/* Input form */}
          <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nicho do cliente</label>
              <input
                type="text"
                value={researchNiche}
                onChange={e => setResearchNiche(e.target.value)}
                placeholder="Ex: emagrecimento, marketing digital, moda feminina..."
                className="w-full text-sm px-3 py-2.5 rounded-lg border border-border/60 bg-background/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
                onKeyDown={e => e.key === 'Enter' && handleResearch()}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Plataformas</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { id: 'instagram', label: '📸 Instagram' },
                  { id: 'tiktok', label: '🎵 TikTok' },
                  { id: 'google', label: '🔍 Google' },
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => togglePlatform(p.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      researchPlatforms.includes(p.id)
                        ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400'
                        : 'border-border/50 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={handleResearch}
              disabled={researchLoading || !researchNiche.trim()}
              className="w-full gradient-primary text-primary-foreground"
            >
              {researchLoading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Pesquisando tendências...</>
              ) : (
                <><Search className="h-4 w-4 mr-2" />Pesquisar Tendências Agora</>
              )}
            </Button>

            {researchError && (
              <p className="text-xs text-destructive">{researchError}</p>
            )}
          </div>

          {/* Results */}
          {researchResult && (
            <div className="space-y-4">
              {/* Source badge */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">Fonte dos dados:</span>
                <Badge className={researchResult.data_source === 'apify_scraping'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]'
                  : 'bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]'
                }>
                  {researchResult.data_source === 'apify_scraping' ? '✅ Dados reais (Apify)' : '🤖 Análise IA (sem Apify)'}
                </Badge>
              </div>

              {/* Recommendation */}
              {researchResult.recommendation && (
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                  <p className="text-xs font-semibold text-cyan-400 mb-1">💡 Recomendação estratégica</p>
                  <p className="text-sm text-foreground">{researchResult.recommendation}</p>
                </div>
              )}

              {/* Trending topics */}
              {researchResult.trending_topics?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">🔥 Tópicos em alta</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {researchResult.trending_topics.map((t: any, i: number) => (
                      <div key={i} className="rounded-lg border border-border/50 bg-card/40 p-3 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-foreground leading-snug">{t.topic}</p>
                          <Badge variant="outline" className={`text-[9px] shrink-0 ${
                            t.engagement_potential === 'alto' ? 'border-emerald-500/40 text-emerald-400' :
                            t.engagement_potential === 'médio' ? 'border-amber-500/40 text-amber-400' :
                            'border-muted/40 text-muted-foreground'
                          }`}>{t.engagement_potential}</Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{t.why_trending}</p>
                        <div className="flex gap-1.5">
                          <span className="text-[10px] px-2 py-0.5 rounded bg-muted/30 text-muted-foreground">{t.best_format}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-muted/30 text-muted-foreground">{t.best_platform}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Content briefs */}
              {researchResult.content_briefs?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">📋 Pautas prontas ({researchResult.content_briefs.length})</h3>
                  <div className="space-y-3">
                    {researchResult.content_briefs.map((brief: any) => (
                      <div key={brief.id} className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-sm text-foreground">{brief.title}</p>
                            <div className="flex gap-1.5 mt-1">
                              <Badge variant="outline" className="text-[9px]">{brief.format}</Badge>
                              <Badge variant="outline" className="text-[9px]">{brief.platform}</Badge>
                              <Badge variant="outline" className={`text-[9px] ${
                                brief.estimated_reach === 'alto' ? 'text-emerald-400 border-emerald-500/30' : 'text-muted-foreground'
                              }`}>🎯 {brief.estimated_reach}</Badge>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-[10px] h-7 px-2 shrink-0"
                            onClick={() => {
                              navigator.clipboard.writeText(
                                `Título: ${brief.title}\nHook: ${brief.hook}\nPontos: ${brief.slides_or_points?.join(' | ')}\nCTA: ${brief.cta}\nHashtags: ${brief.hashtags?.map((h: string) => '#' + h).join(' ')}`
                              );
                              toast({ title: 'Pauta copiada!', description: 'Cole no Paulo ou Davi.' });
                            }}
                          >
                            <Copy className="h-3 w-3 mr-1" />Copiar
                          </Button>
                        </div>

                        <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/20 px-3 py-2">
                          <p className="text-[11px] text-cyan-300 font-medium">Hook: "{brief.hook}"</p>
                        </div>

                        {brief.slides_or_points?.length > 0 && (
                          <div className="space-y-1">
                            {brief.slides_or_points.map((point: string, j: number) => (
                              <div key={j} className="flex items-start gap-2 text-xs text-muted-foreground">
                                <span className="shrink-0 font-mono text-cyan-400">{j + 1}.</span>
                                <span>{point}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-1">
                          {brief.hashtags?.map((tag: string, j: number) => (
                            <span key={j} className="text-[10px] text-cyan-400/70">#{tag}</span>
                          ))}
                        </div>

                        <p className="text-[10px] text-muted-foreground italic">💡 {brief.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Viral formats */}
              {researchResult.viral_formats?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">⚡ Formatos virais no nicho</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {researchResult.viral_formats.map((f: any, i: number) => (
                      <div key={i} className="rounded-lg border border-border/50 bg-card/40 p-3 space-y-1.5">
                        <p className="text-sm font-semibold text-foreground">{f.format}</p>
                        <p className="text-[11px] text-muted-foreground">{f.description}</p>
                        <p className="text-[11px] text-cyan-400/80 italic">Ex: {f.example}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
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
