import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LogosIALogo, LogosIAIcon } from '@/components/brand/LogosIALogo';
import {
  Sparkles, BarChart3, Zap, Shield, Bot, Target, Mail, TrendingUp,
  Users, Clock, CheckCircle2, XCircle, ArrowRight, Star, ChevronDown,
  MessageSquare, Globe, Layers, Award, Rocket, Brain, Instagram,
  LayoutDashboard, PenTool, Megaphone,
} from 'lucide-react';
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { Moon, Sun } from 'lucide-react';

/* ── Dados para os gráficos ─────────────────────────────────────────── */
const radarData = [
  { metric: 'Velocidade', logosIA: 98, agenciaComum: 45, g4: 70 },
  { metric: 'Consistência', logosIA: 99, agenciaComum: 55, g4: 80 },
  { metric: 'Custo/Resultado', logosIA: 96, agenciaComum: 40, g4: 60 },
  { metric: 'Escalabilidade', logosIA: 100, agenciaComum: 35, g4: 65 },
  { metric: 'Disponibilidade', logosIA: 100, agenciaComum: 50, g4: 75 },
  { metric: 'Fechamento', logosIA: 94, agenciaComum: 58, g4: 82 },
];

const barData = [
  { name: 'Logos IA', velocidade: 98, custo: 96, fechamento: 94, fill: '#5C6BC0' },
  { name: 'G4 Educação', velocidade: 70, custo: 60, fechamento: 82, fill: '#DAA520' },
  { name: 'Agência Comum', velocidade: 45, custo: 40, fechamento: 58, fill: '#6B7280' },
];

/* ── Planos ─────────────────────────────────────────────────────────── */
const plans = [
  {
    id: 'basico',
    name: 'Básico',
    subtitle: 'Solo',
    price: 497,
    setup: '3.000',
    tokens: '50.000',
    tokenCost: 'R$ 1,50 / 1k tokens',
    color: 'border-border/60',
    highlight: false,
    badge: null,
    features: [
      'Dashboard de métricas essenciais',
      'Agente Copywriting inteligente',
      'Social Media — 1 plataforma',
      'Funil WhatsApp simplificado (1 funil)',
      'Gestor de tráfego assistido',
      'Agente Design Essencial (IA)',
      'Modo claro/escuro',
      'Menu de tutoriais básicos',
    ],
    missing: ['Múltiplas redes sociais', 'CRM de leads', 'Gerenciamento de usuários', 'Consultoria estratégica'],
    cta: 'Começar com Básico',
  },
  {
    id: 'pro',
    name: 'Pro',
    subtitle: 'Agência',
    price: 997,
    setup: '5.000',
    tokens: '150.000',
    tokenCost: 'R$ 1,00 / 1k tokens',
    color: 'border-primary',
    highlight: true,
    badge: 'Mais Popular',
    features: [
      'Dashboard de métricas avançado',
      'Agente Copywriting estratégico + insights preditivos',
      'Social Media — até 3 plataformas',
      'Funil WhatsApp otimizado + CRM integrado',
      'Gestor de tráfego ativo (Meta + Google Ads)',
      'Agente Design Criativo (imagens + vídeo IA)',
      'Gerenciamento de múltiplos usuários',
      'Tutoriais completos + aulas em vídeo',
      'Calendário de planejamento de conteúdo',
      'Insights de melhores/piores copies e posts',
    ],
    missing: ['Consultoria trimestral VIP', 'Integrações ERP/CRM custom', 'SLA dedicado'],
    cta: 'Assinar Pro',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    subtitle: 'Custom',
    price: 2497,
    setup: '10.000',
    tokens: '500.000',
    tokenCost: 'R$ 0,50 / 1k tokens',
    color: 'border-yellow-500/60',
    highlight: false,
    badge: 'Ápice da IA',
    features: [
      'Tudo do Pro sem restrições de volume',
      'Dashboard preditivo com projeções de ROI',
      'Agentes com IA adaptativa (aprendizado contínuo)',
      'Prioridade no suporte com SLA + gerente exclusivo',
      'Acesso antecipado a features beta',
      'Customização profunda e integrações ERP/CRM',
      'Gerenciamento avançado de equipe + auditoria',
      'Consultoria estratégica trimestral (Viver de IA)',
      'Relatórios executivos customizáveis',
      'Implementação VIP personalizada',
    ],
    missing: [],
    cta: 'Falar com Especialista',
  },
];

/* ── Agentes ────────────────────────────────────────────────────────── */
const agents = [
  {
    icon: Target,
    name: 'Gestor de Tráfego',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    desc: 'Integração com Meta Ads e Google Ads. Cria, pausa e otimiza campanhas. CRM de leads com segmentação automática.',
  },
  {
    icon: PenTool,
    name: 'Copywriting IA',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    desc: 'Gera copies de alta conversão para anúncios, e-mails e redes sociais. Análise de sentimentos e insights preditivos.',
  },
  {
    icon: Instagram,
    name: 'DAVI — Social Media',
    color: 'text-pink-400',
    bg: 'bg-pink-500/10',
    desc: 'Cria carrosséis com IA (GPT-4o), agenda posts em múltiplas plataformas e monitora insights em tempo real.',
  },
  {
    icon: Mail,
    name: 'JOÃO — E-mail Marketing',
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    desc: 'Gera sequências de e-mail com objetivo e tom configuráveis. Nutrição, vendas, reativação e onboarding.',
  },
  {
    icon: Brain,
    name: 'DANIEL — Estratégia',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    desc: 'Plano estratégico em 3 fases, SWOT automatizado, definição de KPIs e análise de riscos do negócio.',
  },
  {
    icon: MessageSquare,
    name: 'Funil WhatsApp',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    desc: 'Automação de funis de vendas via WhatsApp. Scripts avançados, follow-ups e acompanhamento de leads.',
  },
];

/* ── FAQ ────────────────────────────────────────────────────────────── */
const faqs = [
  {
    q: 'Preciso de conhecimento técnico para usar a Logos IA?',
    a: 'Não. A plataforma foi desenvolvida para qualquer empreendedor ou profissional de marketing. A IA faz o trabalho pesado — você só configura os objetivos.',
  },
  {
    q: 'O que é a Taxa de Implementação (Setup)?',
    a: 'É o investimento único para configurar e personalizar a plataforma para o seu negócio. Inclui integração das suas contas de anúncios, configuração dos agentes e treinamento inicial.',
  },
  {
    q: 'O que são os tokens e como funcionam as recargas?',
    a: 'Tokens são a unidade de consumo da IA (geração de copies, e-mails, carrosséis etc). Cada plano inclui um volume mensal. Ao esgotar, você recarrega avulsamente — quanto maior o plano, menor o custo por token.',
  },
  {
    q: 'Posso conectar meu Instagram, Meta Ads e Google Ads?',
    a: 'Sim. Basta clicar em "Conectar" dentro da plataforma e autorizar via OAuth — o processo leva menos de 2 minutos, sem API nem configuração técnica.',
  },
  {
    q: 'Como funciona a mentoria da Comunidade Viver de IA?',
    a: 'Nossos 9 agentes de IA são desenvolvidos e calibrados pela equipe da Logos IA, com base nas melhores práticas de marketing digital. No plano Enterprise, você tem suporte direto com nossa equipe de especialistas.',
  },
  {
    q: 'Existe contrato de fidelidade?',
    a: 'Não. Os planos são mensais e você pode cancelar a qualquer momento. A taxa de implementação é cobrada uma única vez.',
  },
];

/* ── Depoimentos ────────────────────────────────────────────────────── */
const testimonials = [
  {
    name: 'Rafael M.',
    role: 'Dono de e-commerce de moda',
    text: 'Em 30 dias, o ROAS das minhas campanhas subiu de 2,1x para 4,8x. O agente de tráfego identificou públicos que eu nunca teria achado sozinho.',
    stars: 5,
  },
  {
    name: 'Carla D.',
    role: 'Gestora de tráfego',
    text: 'Atendo 12 clientes sozinha usando a Logos IA. O que levava uma semana de trabalho, agora entrego em 1 dia. Multiplicou minha capacidade.',
    stars: 5,
  },
  {
    name: 'Bruno S.',
    role: 'Agência de marketing digital',
    text: 'Implementamos o plano Pro para a nossa agência. O ROI do investimento se pagou no segundo mês. A IA de estratégia (DANIEL) impressionou nossos clientes.',
    stars: 5,
  },
];

/* ── Componente Principal ───────────────────────────────────────────── */
export default function LandingPage() {
  const { user, loading } = useAuth();
  const { isDarkMode, toggleDarkMode } = useAppStore();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  if (!loading && user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">

      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LogosIAIcon size={36} />
          <LogosIALogo size="sm" showText iconOnly={false} />
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
          <a href="#solucao" className="hover:text-foreground transition-colors">Solução</a>
          <a href="#agentes" className="hover:text-foreground transition-colors">Agentes</a>
          <a href="#performance" className="hover:text-foreground transition-colors">Performance</a>
          <a href="#planos" className="hover:text-foreground transition-colors">Planos</a>
          <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
        </nav>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleDarkMode}
            className="text-muted-foreground hover:text-foreground"
            title={isDarkMode ? 'Modo claro' : 'Modo escuro'}
          >
            {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" asChild className="text-muted-foreground hover:text-foreground">
            <Link to="/auth">Entrar</Link>
          </Button>
          <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Link to="/auth?tab=signup">Começar agora</Link>
          </Button>
        </div>
      </header>

      {/* ── HERO ───────────────────────────────────────────────────── */}
      <section className="relative px-6 py-24 flex flex-col items-center text-center overflow-hidden">
        {/* Background gradient orbs */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-yellow-500/8 rounded-full blur-3xl pointer-events-none" />

        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm text-primary font-medium mb-6">
          <Award className="h-3.5 w-3.5" />
          Mentorada pela Comunidade Viver de IA
        </div>

        <h1 className="text-4xl md:text-6xl font-bold max-w-4xl leading-tight mb-6">
          Transforme Seu Marketing: Sua{' '}
          <span className="bg-gradient-to-r from-[#5C6BC0] to-[#DAA520] bg-clip-text text-transparent">
            Agência de IA Autônoma
          </span>
          {' '}que Multiplica Seus Resultados 24/7
        </h1>

        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-4">
          Cansado de agências caras e ineficientes? A LogosIA é a revolução que você precisa: 9 Agentes de IA especializados trabalhando em perfeita sincronia para escalar seu negócio, reduzir custos e gerar resultados previsíveis, sem falhas humanas ou gestão de equipe.
        </p>

        <p className="text-sm text-muted-foreground mb-10 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
          Sem contrato de fidelidade &nbsp;·&nbsp;
          <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
          Setup em menos de 24h &nbsp;·&nbsp;
          <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
          Cancele quando quiser
        </p>

        <div className="flex items-center gap-4 flex-wrap justify-center mb-16">
          <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 px-8 text-base gap-2">
            <Link to="/auth?tab=signup">
              Agendar Implementação VIP <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="px-8 text-base">
            <Link to="/auth">Ver o Dashboard</Link>
          </Button>
        </div>

        {/* Métricas em destaque */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl w-full">
          {[
            { value: '9', label: 'Agentes de IA ativos' },
            { value: '24/7', label: 'Operação ininterrupta' },
            { value: '10×', label: 'Mais rápido que agência' },
            { value: '3×', label: 'Mais barato que agências' },
          ].map((m) => (
            <div key={m.label} className="rounded-xl border border-border/50 bg-card/40 p-4 backdrop-blur-sm">
              <p className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-[#5C6BC0] to-[#DAA520] bg-clip-text text-transparent">{m.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{m.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── COMPARATIVO: R$57K vs R$2.497 ─────────────────────────── */}
      <section id="solucao" className="px-6 py-20 bg-card/20">
        <div className="max-w-5xl mx-auto">

          {/* Headline principal */}
          <div className="text-center mb-14">
            <Badge variant="outline" className="mb-5 border-yellow-500/40 text-yellow-400 text-sm px-4 py-1">
              PARE E PENSE POR 30 SEGUNDOS
            </Badge>
            <h2 className="text-3xl md:text-5xl font-bold leading-tight mb-4">
              O Custo Oculto da Agência Tradicional:{' '}
              <span className="text-red-400">Tempo, Dinheiro e Frustração</span>
            </h2>
            <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mt-6">
              Você está pagando uma fortuna por uma equipe de marketing que opera em horário comercial, com falhas de comunicação, erros humanos e resultados inconsistentes. A gestão de múltiplos profissionais consome seu tempo e energia, desviando o foco do que realmente importa: o crescimento do seu negócio. Enquanto você lida com encargos, férias e a alta rotatividade, seus concorrentes avançam com soluções mais ágeis e eficientes.
            </p>
            <div className="mt-8 p-6 bg-red-500/10 border border-red-500/20 rounded-2xl max-w-3xl mx-auto">
              <p className="text-xl font-bold text-red-400">
                Pare e Pense: Você continuará pagando R$5.000 a R$15.000/mês por uma operação limitada, ou investirá em uma solução que entrega resultados superiores por uma fração do custo?
              </p>
            </div>
          </div>

          {/* Cards de comparação */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">

            {/* OPÇÃO 1 — Modelo Tradicional */}
            <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-7">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                  <XCircle className="h-4 w-4 text-red-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-widest">Opção 1</p>
                  <h3 className="font-bold text-red-400">O Modelo Tradicional</h3>
                </div>
              </div>
              <div className="space-y-2.5 mb-6">
                {[
                  ['Gestor de tráfego', 'R$ 8.000/mês'],
                  ['Copywriter', 'R$ 6.000/mês'],
                  ['Estrategista', 'R$ 10.000/mês'],
                  ['SDR', 'R$ 4.000/mês'],
                  ['Social Media', 'R$ 4.000/mês'],
                  ['Designer', 'R$ 5.000/mês'],
                  ['Especialista em funil', 'R$ 8.000/mês'],
                  ['Gerente geral', 'R$ 12.000/mês'],
                ].map(([role, price]) => (
                  <div key={role} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{role}</span>
                    <span className="font-medium text-red-300">{price}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-red-500/20 pt-4 mb-5">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-sm">TOTAL</span>
                  <span className="text-2xl font-bold text-red-400">R$ 57.000/mês</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  + encargos, férias, 13º, treinamentos, rotatividade...
                </p>
              </div>
              <div className="space-y-2">
                {[
                  'Gestão de 8 pessoas diferentes',
                  'Falhas de comunicação entre equipes',
                  'Erros humanos custosos',
                  'Trabalho apenas em horário comercial',
                  'Resultados imprevisíveis',
                  'Dependência total de pessoas',
                ].map((prob) => (
                  <div key={prob} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                    {prob}
                  </div>
                ))}
              </div>
            </div>

            {/* OPÇÃO 2 — Logos IA */}
            <div className="rounded-2xl border border-green-500/40 bg-green-500/5 p-7 relative overflow-hidden">
              <div className="absolute top-4 right-4">
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">ESCOLHA INTELIGENTE</Badge>
              </div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-green-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-widest">Opção 2</p>
                  <h3 className="font-bold text-green-400">Logos IA — Agência Autônoma</h3>
                </div>
              </div>
              <div className="space-y-2.5 mb-6">
                {[
                  ['Todas as 8 funções por IA', '24/7'],
                  ['Zero falhas de comunicação', '✓'],
                  ['Operação ininterrupta', '24h/dia'],
                  ['Processos 100% padronizados', '✓'],
                  ['Velocidade 10× superior', '✓'],
                  ['Resultados previsíveis e escaláveis', '✓'],
                  ['Zero gestão de pessoas', '✓'],
                  ['9 agentes especializados', 'inclusos'],
                ].map(([benefit, val]) => (
                  <div key={benefit} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{benefit}</span>
                    <span className="font-medium text-green-300">{val}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-green-500/20 pt-4">
                <p className="text-xs text-muted-foreground mb-1">Taxa de implementação: R$ 10.000 (uma vez)</p>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-sm">MENSALIDADE</span>
                  <span className="text-2xl font-bold text-green-400">R$ 2.497/mês</span>
                </div>
              </div>
            </div>
          </div>

          {/* Contraste brutal */}
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-8 text-center mb-16">
            <p className="text-muted-foreground text-sm uppercase tracking-widest mb-3">Você leu certo</p>
            <div className="flex items-center justify-center gap-6 flex-wrap mb-4">
              <div className="text-center">
                <p className="text-4xl md:text-5xl font-black text-red-400 line-through opacity-60">R$ 57.000</p>
                <p className="text-xs text-muted-foreground mt-1">Modelo tradicional / mês</p>
              </div>
              <div className="text-3xl font-bold text-muted-foreground">vs</div>
              <div className="text-center">
                <p className="text-4xl md:text-5xl font-black text-green-400">R$ 2.497</p>
                <p className="text-xs text-muted-foreground mt-1">Logos IA / mês</p>
              </div>
            </div>
            <p className="text-muted-foreground text-sm max-w-xl mx-auto">
              <span className="text-yellow-400 font-semibold">Enquanto uma pessoa trabalha 8h/dia,</span> nossa IA trabalha 24h.
              Enquanto uma equipe comete erros, nossa IA executa com precisão matemática.
              Enquanto você gasta meses treinando pessoas, nossa IA já sabe tudo.
            </p>
          </div>

          {/* A matemática brutal — 12 meses */}
          <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-8 mb-16">
            <h3 className="text-xl font-bold text-center mb-8 text-yellow-400">
              A Matemática é Brutal — Em 12 Meses:
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Modelo Tradicional</p>
                <p className="text-3xl font-black text-red-400">R$ 684.000</p>
                <p className="text-xs text-muted-foreground mt-1">por ano</p>
              </div>
              <div className="flex items-center justify-center">
                <div className="text-center">
                  <p className="text-4xl font-black text-green-400">R$ 644.036</p>
                  <p className="text-sm text-green-400 font-semibold mt-1">de economia no 1º ano</p>
                </div>
              </div>
              <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Logos IA</p>
                <p className="text-3xl font-black text-green-400">R$ 39.964</p>
                <p className="text-xs text-muted-foreground mt-1">por ano</p>
              </div>
            </div>
            <div className="mt-6 text-center">
              <p className="text-sm text-muted-foreground mb-3">Com essa economia, você pode:</p>
              <div className="flex flex-wrap gap-3 justify-center">
                {['Contratar mais vendedores', 'Investir em estoque', 'Expandir para novos mercados', 'R$ 644k a mais no caixa'].map(item => (
                  <span key={item} className="text-xs bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 px-3 py-1.5 rounded-full">
                    ✓ {item}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Nossa entrega completa */}
          <div className="text-center mb-10">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary">Nossa Entrega Completa</Badge>
            <h3 className="text-2xl md:text-3xl font-bold mb-2">Tudo rodando simultaneamente, 24/7, sem parar.</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-16">
            {[
              { icon: '🎯', title: 'Tráfego Pago', desc: 'Google, Meta e LinkedIn' },
              { icon: '✍️', title: 'Copywriting IA', desc: 'Anúncios, emails e LPs' },
              { icon: '📊', title: 'Estratégia', desc: 'Baseada em dados reais' },
              { icon: '📞', title: 'SDR Automatizado', desc: 'Prospecção sem parar' },
              { icon: '📱', title: 'Social Media', desc: 'Gestão completa de redes' },
              { icon: '🎨', title: 'Design de Criativos', desc: 'Materiais e artes' },
              { icon: '🔄', title: 'Funis de Venda', desc: 'Construção e otimização' },
              { icon: '📈', title: 'CRM de Leads', desc: 'Gestão e nutrição' },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-border/40 bg-card/40 p-4 text-center hover:border-primary/30 transition-colors">
                <p className="text-2xl mb-2">{item.icon}</p>
                <p className="font-semibold text-sm">{item.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Urgência final */}
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center mb-10">
            <p className="text-lg font-bold mb-3">Aqui está a verdade:</p>
            <p className="text-muted-foreground mb-4 max-w-xl mx-auto">
              Daqui 2 anos, toda empresa que não migrou para IA vai estar pagando{' '}
              <span className="text-red-400 font-semibold">20× mais caro</span> por marketing.
              Os espertos estão entrando agora. Os atrasados vão pagar o preço depois.
            </p>
            <p className="text-xs text-muted-foreground">
              Daqui 2 anos, toda empresa que não migrou para IA vai estar pagando 20x mais caro por marketing.
            </p>
          </div>

          {/* CTA principal */}
          <div className="text-center">
            <Button asChild size="lg" className="bg-green-600 hover:bg-green-700 text-white px-10 text-lg gap-3 py-6 rounded-2xl font-bold shadow-lg shadow-green-900/30">
              <Link to="/auth?tab=signup">
                QUERO ECONOMIZAR R$50.000/MÊS COM IA <ArrowRight className="h-5 w-5" />
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground mt-3">
              Sem contrato · Cancele quando quiser · Setup em menos de 24h
            </p>
          </div>
        </div>
      </section>

      {/* ── O PROBLEMA ─────────────────────────────────────────────── */}
      <section className="px-6 py-20 bg-card/30">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4 border-red-500/30 text-red-400">O Problema</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Agências tradicionais estão te limitando</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">Enquanto você paga caro por serviços lentos e inconsistentes, seus concorrentes já automatizaram com IA.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: Clock, title: 'Horário comercial', desc: 'Agências param às 18h. Sua concorrência não para nunca.', color: 'text-red-400', bg: 'bg-red-500/10' },
              { icon: TrendingUp, title: 'Alto custo fixo', desc: 'R$ 5k–10k/mês sem garantia de resultado mensurável.', color: 'text-orange-400', bg: 'bg-orange-500/10' },
              { icon: Users, title: 'Equipe limitada', desc: 'Sujeita a erros humanos, férias, rotatividade e humor.', color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
              { icon: Layers, title: 'Sem escalabilidade', desc: 'Para crescer, precisam contratar mais — e você paga mais.', color: 'text-red-400', bg: 'bg-red-500/10' },
            ].map((p) => (
              <div key={p.title} className="rounded-xl border border-border/50 bg-background/50 p-5">
                <div className={`inline-flex p-2.5 rounded-lg ${p.bg} mb-3`}>
                  <p.icon className={`h-5 w-5 ${p.color}`} />
                </div>
                <h3 className="font-semibold mb-1.5">{p.title}</h3>
                <p className="text-sm text-muted-foreground">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── A SOLUÇÃO ──────────────────────────────────────────────── */}
      <section id="diferenciais" className="px-6 py-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary">A Solução</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Logos IA — A Agência que nunca dorme</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">Seis agentes de IA trabalhando em sincronia, 24 horas por dia, 7 dias por semana. Sem falhas humanas. Sem custos de equipe. Com resultado mensurável.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: Zap, title: 'Operação 24/7', desc: 'Nunca para. Seus anúncios são otimizados enquanto você dorme.', color: 'text-primary', bg: 'bg-primary/10' },
              { icon: Shield, title: 'Zero erros humanos', desc: 'Algoritmos precisos eliminam inconsistências e variações de performance.', color: 'text-blue-400', bg: 'bg-blue-500/10' },
              { icon: Rocket, title: 'Escalabilidade ilimitada', desc: 'Atende 1 ou 1.000 campanhas com a mesma qualidade e velocidade.', color: 'text-purple-400', bg: 'bg-purple-500/10' },
              { icon: BarChart3, title: 'ROI claro e mensurável', desc: 'Dashboard unificado com ROAS, CPA, CPL e todas as métricas que importam.', color: 'text-green-400', bg: 'bg-green-500/10' },
              { icon: Brain, title: 'IA adaptativa', desc: 'Aprende com seus dados e melhora continuamente as estratégias.', color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
              { icon: Award, title: 'Metodologia de elite', desc: 'Certificada e mentorada pela Comunidade Viver de IA — referência nacional.', color: 'text-orange-400', bg: 'bg-orange-500/10' },
            ].map((f) => (
              <div key={f.title} className="rounded-xl border border-border/50 bg-card/50 p-5 hover:border-primary/30 transition-colors">
                <div className={`inline-flex p-2.5 rounded-lg ${f.bg} mb-3`}>
                  <f.icon className={`h-5 w-5 ${f.color}`} />
                </div>
                <h3 className="font-semibold mb-1.5">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AGENTES ────────────────────────────────────────────────── */}
      <section id="agentes" className="px-6 py-20 bg-card/30">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary">Agentes Inteligentes</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Sua equipe completa de IA</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">6 agentes especializados trabalhando em conjunto como uma agência de marketing de elite — sem salário, sem férias, sem reuniões.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {agents.map((a) => (
              <div key={a.name} className="rounded-xl border border-border/50 bg-background/60 p-5 hover:border-primary/20 transition-colors group">
                <div className={`inline-flex p-2.5 rounded-lg ${a.bg} mb-3 group-hover:scale-110 transition-transform`}>
                  <a.icon className={`h-5 w-5 ${a.color}`} />
                </div>
                <h3 className="font-semibold mb-2">{a.name}</h3>
                <p className="text-sm text-muted-foreground">{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMPARATIVO DE PERFORMANCE ─────────────────────────────── */}
      <section id="performance" className="px-6 py-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4 border-yellow-500/30 text-yellow-400">Análise Comparativa</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Logos IA vs. Mercado</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">9 agentes de IA especializados superam agências inteiras com dezenas de funcionários. Veja a comparação.</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
            {/* Radar Chart */}
            <div className="rounded-xl border border-border/50 bg-card/50 p-6">
              <h3 className="font-semibold mb-4 text-center text-sm text-muted-foreground uppercase tracking-wide">Análise Multidimensional</h3>
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#374151" />
                  <PolarAngleAxis dataKey="metric" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <Radar name="Logos IA" dataKey="logosIA" stroke="#5C6BC0" fill="#5C6BC0" fillOpacity={0.3} />
                  <Radar name="G4 Educação" dataKey="g4" stroke="#DAA520" fill="#DAA520" fillOpacity={0.15} />
                  <Radar name="Agência Comum" dataKey="agenciaComum" stroke="#6B7280" fill="#6B7280" fillOpacity={0.1} />
                  <Legend wrapperStyle={{ fontSize: '12px', color: '#9CA3AF' }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* Bar Chart */}
            <div className="rounded-xl border border-border/50 bg-card/50 p-6">
              <h3 className="font-semibold mb-4 text-center text-sm text-muted-foreground uppercase tracking-wide">Performance por Indicador (%)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={barData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" tick={{ fill: '#9CA3AF', fontSize: 11 }} width={90} />
                  <Tooltip
                    contentStyle={{ background: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#F9FAFB' }}
                    labelStyle={{ color: '#F9FAFB' }}
                  />
                  <Bar dataKey="velocidade" name="Velocidade" fill="#5C6BC0" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="custo" name="Custo/Result." fill="#DAA520" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="fechamento" name="Fechamento" fill="#10B981" radius={[0, 4, 4, 0]} />
                  <Legend wrapperStyle={{ fontSize: '12px', color: '#9CA3AF' }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tabela comparativa */}
          <div className="rounded-xl border border-border/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-card border-b border-border/50">
                  <th className="text-left px-5 py-3 text-muted-foreground font-medium">Característica</th>
                  <th className="px-5 py-3 text-muted-foreground font-medium text-center">Agência Comum</th>
                  <th className="px-5 py-3 text-muted-foreground font-medium text-center">G4 Educação</th>
                  <th className="px-5 py-3 text-primary font-semibold text-center bg-primary/5">Logos IA</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Custo mensal', 'R$ 5.000 – 10.000', 'Alto investimento', 'R$ 497 – 2.497'],
                  ['Operação', 'Horário comercial', 'Alta performance', '24/7 ininterrupta'],
                  ['Escalabilidade', 'Limitada por equipe', 'Grande investimento', 'Ilimitada, instantânea'],
                  ['Consistência', 'Variável / erros humanos', 'Alta, mas humana', 'Perfeita (algoritmos)'],
                  ['ROI mensurável', 'Difícil de aferir', 'Focado em educação', 'Claro e em tempo real'],
                  ['Mentoria/Validação', 'Variável', 'Reconhecida', 'Comunidade Viver de IA'],
                ].map(([feature, comum, g4, logos], i) => (
                  <tr key={feature} className={`border-b border-border/30 ${i % 2 === 0 ? 'bg-background/30' : ''}`}>
                    <td className="px-5 py-3 font-medium">{feature}</td>
                    <td className="px-5 py-3 text-center text-muted-foreground">{comum}</td>
                    <td className="px-5 py-3 text-center text-yellow-400/80">{g4}</td>
                    <td className="px-5 py-3 text-center text-primary font-medium bg-primary/5">{logos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground/60 text-center mt-3">* Dados baseados em benchmarks de mercado e estudos internos da Comunidade Viver de IA.</p>
        </div>
      </section>

      {/* ── PLANOS ─────────────────────────────────────────────────── */}
      <section id="planos" className="px-6 py-20 bg-card/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary">Planos Premium</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Escolha seu nível de performance</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">Todos os planos incluem taxa de implementação única — garantia de que você começa do jeito certo.</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={`relative rounded-2xl border-2 ${plan.color} bg-background/80 p-6 flex flex-col ${plan.highlight ? 'shadow-[0_0_40px_rgba(92,107,192,0.2)]' : ''}`}
              >
                {plan.badge && (
                  <div className={`absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-xs font-semibold ${plan.highlight ? 'bg-primary text-primary-foreground' : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'}`}>
                    {plan.badge}
                  </div>
                )}

                <div className="mb-5">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">{plan.subtitle}</p>
                  <h3 className="text-2xl font-bold">{plan.name}</h3>
                  <div className="mt-4 flex items-end gap-1">
                    <span className="text-sm text-muted-foreground">R$</span>
                    <span className="text-4xl font-bold">{plan.price.toLocaleString('pt-BR')}</span>
                    <span className="text-muted-foreground text-sm pb-1">/mês</span>
                  </div>
                  <div className="mt-2 flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">+ R$ {plan.setup} taxa de implementação (única vez)</span>
                    <span className="text-xs text-muted-foreground">{plan.tokens} tokens/mês inclusos</span>
                    <span className="text-xs text-primary/80">Recarga: {plan.tokenCost}</span>
                  </div>
                </div>

                <div className="flex-1 space-y-2.5 mb-6">
                  {plan.features.map((f) => (
                    <div key={f} className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                      <span className="text-sm">{f}</span>
                    </div>
                  ))}
                  {plan.missing.map((f) => (
                    <div key={f} className="flex items-start gap-2 opacity-40">
                      <XCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <span className="text-sm line-through">{f}</span>
                    </div>
                  ))}
                </div>

                <Button
                  asChild
                  className={`w-full ${plan.highlight ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'variant-outline border border-border'}`}
                  variant={plan.highlight ? 'default' : 'outline'}
                >
                  <Link to="/auth?tab=signup">{plan.cta}</Link>
                </Button>
              </div>
            ))}
          </div>

          {/* Serviços adicionais */}
          <div className="mt-12 rounded-xl border border-border/50 bg-background/60 p-6">
            <h3 className="font-semibold mb-5 text-center">Serviços Adicionais (Upsells)</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {[
                { icon: Users, title: 'Suporte Humanizado', desc: 'Atendimento direto com especialistas da equipe Logos IA via WhatsApp ou Zoom.', price: 'Sob consulta' },
                { icon: Brain, title: 'Mentoria Individual', desc: 'Sessões 1:1 com especialistas da Comunidade Viver de IA para maximizar seus resultados.', price: 'Sob consulta' },
                { icon: Globe, title: 'Implementação Custom', desc: 'Integrações com ERP, CRM legado e sistemas internos da sua empresa.', price: 'Sob consulta' },
              ].map((s) => (
                <div key={s.title} className="rounded-lg border border-border/40 bg-card/40 p-4">
                  <s.icon className="h-5 w-5 text-primary mb-2" />
                  <h4 className="font-medium mb-1">{s.title}</h4>
                  <p className="text-xs text-muted-foreground mb-2">{s.desc}</p>
                  <span className="text-xs text-primary">{s.price}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── DEPOIMENTOS ────────────────────────────────────────────── */}
      <section className="px-6 py-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary">Resultados Reais</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Quem já usa a Logos IA</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((t) => (
              <div key={t.name} className="rounded-xl border border-border/50 bg-card/50 p-5 flex flex-col">
                <div className="flex gap-1 mb-3">
                  {Array.from({ length: t.stars }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 text-yellow-400 fill-yellow-400" />
                  ))}
                </div>
                <p className="text-sm text-muted-foreground flex-1 mb-4">"{t.text}"</p>
                <div>
                  <p className="font-semibold text-sm">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────────── */}
      <section id="faq" className="px-6 py-20 bg-card/30">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary">FAQ</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Perguntas frequentes</h2>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <div key={i} className="rounded-xl border border-border/50 bg-background/60 overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-5 py-4 text-left font-medium hover:bg-card/50 transition-colors"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span>{faq.q}</span>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4 text-sm text-muted-foreground border-t border-border/30 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 flex flex-col items-center text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-yellow-500/5 pointer-events-none" />
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm text-primary font-medium mb-6">
          <Sparkles className="h-3.5 w-3.5" />
          Comece hoje mesmo
        </div>
        <h2 className="text-3xl md:text-5xl font-bold max-w-3xl mb-6">
          Pronto para ter uma{' '}
          <span className="bg-gradient-to-r from-[#5C6BC0] to-[#DAA520] bg-clip-text text-transparent">
            agência de IA
          </span>{' '}
          trabalhando por você?
        </h2>
        <p className="text-muted-foreground max-w-xl mb-10">
          Junte-se a centenas de empreendedores e agências que já substituíram custos de agência por resultados de IA.
        </p>
        <div className="flex items-center gap-4 flex-wrap justify-center">
          <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 px-10 text-base gap-2">
            <Link to="/auth?tab=signup">
              Agendar Implementação VIP <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="px-8 text-base">
            <a href="mailto:carvalho@scalpergx.com.br">Falar com especialista</a>
          </Button>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────────────── */}
      <footer className="border-t border-border/40 px-6 py-8">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <LogosIAIcon size={28} />
            <span className="text-sm font-semibold">Logos IA</span>
            <span className="text-xs text-muted-foreground ml-2">Mentorada pela Comunidade Viver de IA</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap justify-center">
            <span>© {new Date().getFullYear()} LogosIA. Todos os direitos reservados.</span>
            <a href="/privacy" className="hover:text-primary transition-colors">Privacidade</a>
            <a href="/terms" className="hover:text-primary transition-colors">Termos</a>
            <a href="mailto:carvalho@scalpergx.com.br" className="hover:text-primary transition-colors">Contato</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
