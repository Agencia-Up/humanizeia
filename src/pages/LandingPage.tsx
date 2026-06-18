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
  LayoutDashboard, PenTool, Megaphone, Menu, X,
  Smartphone, Cog, LineChart,
  Filter, Tags, Timer, FileText, MapPin, Upload,
  Send, ShieldCheck, List, RefreshCw, LayoutGrid, Kanban,
  Palette, Crown, Lock, PlayCircle,
  Phone, Database, Plus,
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
/* DEPRECADO (Prompt 8 — landing redesign 16/05): array de 3 planos antigos
   (Básico/Pro/Enterprise) substituído por plano único PRO com toggle
   mensal/anual. Mantido COMENTADO em vez de deletado pra facilitar reverter
   caso necessário. Nova fonte de verdade: estado React `billing` + card
   único renderizado na seção <section id="planos">.

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
      'Até 5 instâncias de WhatsApp',
      'Geração de imagens até 300/mês',
      'Conectividade para 1 conta de Instagram',
      '1 perfil de Facebook conectado',
      '4 pesquisas/mês com Agente Estratégico',
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
      'Até 10 instâncias de WhatsApp',
      'Geração de imagens até 500/mês',
      'Conectividade para 2 contas de Instagram',
      '2 perfis de Facebook conectados',
      '8 pesquisas/mês com Agente Estratégico',
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
      'Até 20 instâncias de WhatsApp',
      'Geração de imagens até 800/mês',
      'Conectividade para 5 contas de Instagram',
      '5 perfis de Facebook conectados',
      '20 pesquisas/mês com Agente Estratégico',
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
*/

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

/* ── FAQ (Prompt 9 — redesign 16/05 — 8 perguntas estratégicas) ──────── */
const faqs = [
  {
    q: 'Preciso trocar de número do WhatsApp?',
    a: 'Não. Pedro e Marcos trabalham com o seu número atual — sem trocar de chip, sem perder histórico.',
  },
  {
    q: 'Pedro funciona 24 horas mesmo?',
    a: 'Sim. Atendimento contínuo, todos os dias, sem pausa, sem fim de semana, sem feriado. O primeiro contato com o cliente sai em segundos.',
  },
  {
    q: 'Posso definir minhas próprias regras de qualificação?',
    a: 'Sim. Você configura forma de pagamento (à vista, financiado, aluguel), valor de entrada, CPF, prazo desejado e qualquer outro critério que faça sentido pra sua operação.',
  },
  {
    q: 'E se eu quiser que o vendedor assuma a conversa antes da IA terminar?',
    a: 'Pode. Qualquer vendedor pode entrar manualmente e assumir o lead a qualquer momento. Pedro detecta e para de responder automaticamente nessa conversa.',
  },
  {
    q: 'Marcos pode bloquear meu número por enviar muita mensagem?',
    a: 'Marcos foi feito justamente para evitar isso. Ele dispara segmentado por origem/funil/cidade, com intervalos seguros entre envios, e nunca envia duas vezes pro mesmo lead na mesma campanha.',
  },
  {
    q: 'Posso cancelar quando quiser?',
    a: 'Sim. Sem multa, sem fidelidade. Você decide quando começar e quando parar.',
  },
  {
    q: 'O Agente José já está incluso no PRO e no PRO MAX?',
    a: 'Sim. Pedro, Marcos e José entram no PRO e no PRO MAX. Os próximos agentes do ecossistema serão liberados aos poucos para assinantes ativos.',
  },
  {
    q: 'Como funciona o suporte?',
    a: 'Direto no WhatsApp, com pessoas reais, em horário comercial. Sem chatbot enrolando, sem ticket abandonado.',
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

// Coloque o arquivo do video em public/logos-por-dentro.mp4 para ativar o player.
const DEMO_VIDEO_SRC = '/logos-por-dentro.mp4';
const PRO_CHECKOUT_URL = '/checkout?plano=pro&ciclo=mensal';
const PRO_MAX_CONTACT_URL = 'mailto:suporte@logosiabrasil.com?subject=Quero%20conhecer%20o%20PRO%20MAX%20da%20LOGOS%7CIA';

/* ── Componente Principal ───────────────────────────────────────────── */
export default function LandingPage() {
  const { user, loading } = useAuth();
  const { isDarkMode, toggleDarkMode } = useAppStore();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [demoVideoAvailable, setDemoVideoAvailable] = useState(Boolean(DEMO_VIDEO_SRC));

  if (!loading && user) return <Navigate to="/tela-inicial" replace />;

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">

      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur-md">
        <div className="px-4 md:px-6 py-3.5 flex items-center justify-between gap-4">

          {/* Logo (Prompt redesign 16/05 — usa imagem real LOGOS|IA, sem span ao lado) */}
          <Link to="/" className="flex items-center shrink-0 hover:opacity-90 transition-opacity">
            <LogosIALogo size="sm" variant={isDarkMode ? 'dark' : 'light'} />
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#demo" className="hover:text-foreground transition-colors">Por dentro</a>
            <a href="#como-funciona" className="hover:text-foreground transition-colors">Como funciona</a>
            <a href="#agente-pedro" className="hover:text-foreground transition-colors">Pedro</a>
            <a href="#agente-marcos" className="hover:text-foreground transition-colors">Marcos</a>
            <a href="#em-breve" className="hover:text-foreground transition-colors">Agentes</a>
            <a href="#planos" className="hover:text-foreground transition-colors">Planos</a>
            <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
          </nav>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
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
              <Link to={PRO_CHECKOUT_URL}>Começar agora</Link>
            </Button>
          </div>

          {/* Mobile Actions */}
          <div className="flex md:hidden items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleDarkMode}
              className="text-muted-foreground hover:text-foreground h-9 w-9"
            >
              {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(v => !v)}
              className="text-muted-foreground hover:text-foreground h-9 w-9"
              aria-label="Menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Dropdown Nav */}
        {mobileMenuOpen && (
          <nav className="md:hidden border-t border-border/40 bg-background/98 px-4 py-3 space-y-0.5">
            {[
              { href: '#demo', label: 'Por dentro' },
              { href: '#como-funciona', label: 'Como funciona' },
              { href: '#agente-pedro', label: 'Pedro' },
              { href: '#agente-marcos', label: 'Marcos' },
              { href: '#em-breve', label: 'Agentes' },
              { href: '#planos', label: 'Planos' },
              { href: '#faq', label: 'FAQ' },
            ].map(item => (
              <a
                key={item.href}
                href={item.href}
                className="block px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-card/60 rounded-lg transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                {item.label}
              </a>
            ))}
            <div className="pt-3 mt-2 border-t border-border/30 flex flex-col gap-2">
              <Button variant="outline" asChild className="w-full">
                <Link to="/auth" onClick={() => setMobileMenuOpen(false)}>Entrar</Link>
              </Button>
              <Button asChild className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                <Link to={PRO_CHECKOUT_URL} onClick={() => setMobileMenuOpen(false)}>Começar agora →</Link>
              </Button>
            </div>
          </nav>
        )}
      </header>

      {/* ── HERO (Prompt 3 — redesign 16/05) ─────────────────────────── */}
      <section className="relative px-4 md:px-6 py-12 md:py-20 overflow-hidden">
        {/* Background gradient orbs (azul-navy + dourado da marca) */}
        <div
          className="absolute top-10 -left-20 w-[28rem] h-[28rem] rounded-full blur-3xl pointer-events-none opacity-30"
          style={{ background: 'var(--brand-navy)' }}
        />
        <div
          className="absolute -bottom-20 -right-10 w-[24rem] h-[24rem] rounded-full blur-3xl pointer-events-none opacity-20"
          style={{ background: 'var(--brand-gold)' }}
        />

        <div className="relative max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-14 items-center animate-fade-in">

          {/* Coluna esquerda — texto */}
          <div className="text-center lg:text-left">
            {/* Logo em destaque no Hero (Prompt redesign 16/05) */}
            <div className="flex justify-center lg:justify-start mb-6">
              <LogosIALogo size="xl" variant={isDarkMode ? 'dark' : 'light'} />
            </div>

            {/* Badge */}
            <div
              className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium mb-6"
              style={{
                borderColor: 'var(--brand-gold)',
                background: 'rgba(212, 160, 23, 0.10)',
                color: 'var(--brand-gold)',
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Plataforma de Atendimento e Vendas com IA
            </div>

            {/* H1 */}
            <h1
              className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold leading-[1.1] mb-6"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Pare de perder lead no{' '}
              <span style={{ color: 'var(--brand-gold)' }}>WhatsApp</span>.
              <br className="hidden md:block" />
              {' '}A IA responde, organiza e{' '}
              <span className="bg-gradient-to-r from-[#0F2647] via-[#1A3A6B] to-[#D4A017] bg-clip-text text-transparent">
                vende junto
              </span>.
            </h1>

            {/* Subtítulo */}
            <p className="text-base md:text-lg lg:text-xl text-muted-foreground max-w-2xl mx-auto lg:mx-0 mb-8 leading-relaxed">
              <strong className="text-foreground">Pedro</strong> atende e qualifica em segundos.{' '}
              <strong className="text-foreground">Marcos</strong> organiza o CRM e os disparos.{' '}
              <strong className="text-foreground">José</strong> mostra quais campanhas escalar ou pausar.
              Sua operação vende mais sem depender de resposta manual o dia inteiro.
            </p>

            {/* Microbenefícios */}
            <div className="flex flex-wrap justify-center lg:justify-start items-center gap-x-5 gap-y-2 text-sm text-muted-foreground mb-8">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: 'var(--brand-success)' }} />
                Sem fidelidade
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: 'var(--brand-success)' }} />
                Liberação em 5 min
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: 'var(--brand-success)' }} />
                Cancele quando quiser
              </span>
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center lg:justify-start gap-3 w-full max-w-md mx-auto lg:mx-0">
              <Button
                asChild
                size="lg"
                className="px-8 text-base gap-2 font-semibold shadow-lg transition-all hover:translate-y-[-1px]"
                style={{
                  background: 'var(--brand-gold)',
                  color: 'var(--brand-navy)',
                  boxShadow: 'var(--shadow-gold)',
                }}
              >
                <Link to={PRO_CHECKOUT_URL}>
                  Assinar PRO agora <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="px-8 text-base font-medium border-foreground/30 text-foreground hover:bg-foreground/5"
              >
                <a href="#como-funciona">Ver como funciona</a>
              </Button>
            </div>
          </div>

          {/* Coluna direita — mockup placeholder */}
          <div className="relative">
            <div
              className="relative rounded-3xl border-2 p-6 md:p-8 backdrop-blur-sm"
              style={{
                borderColor: 'rgba(15, 38, 71, 0.15)',
                background: 'linear-gradient(135deg, rgba(15,38,71,0.04), rgba(212,160,23,0.06))',
                boxShadow: 'var(--shadow-medium)',
              }}
            >
              {/* Fluxo: WhatsApp → IA → CRM */}
              <div className="space-y-4">

                {/* Card 1: WhatsApp lead chegando */}
                <div className="rounded-xl bg-card border border-border/40 p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-10 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: 'rgba(22, 163, 74, 0.15)' }}
                    >
                      <MessageSquare className="h-5 w-5" style={{ color: 'var(--brand-success)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">Lead novo no WhatsApp</p>
                      <p className="text-sm font-medium truncate">"Oi, vi o anúncio do Onix"</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">agora</span>
                  </div>
                </div>

                {/* Seta */}
                <div className="flex justify-center">
                  <div className="text-2xl opacity-40 text-foreground">↓</div>
                </div>

                {/* Card 2: Pedro IA respondendo */}
                <div
                  className="rounded-xl border p-4"
                  style={{
                    borderColor: 'var(--brand-gold)',
                    background: 'rgba(212, 160, 23, 0.06)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-10 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: 'var(--brand-gold)' }}
                    >
                      <Bot className="h-5 w-5" style={{ color: 'var(--brand-navy)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs" style={{ color: 'var(--brand-gold)' }}>Pedro atendeu · 3s</p>
                      <p className="text-sm font-medium truncate">Qualificado · troca: SIM · à vista</p>
                    </div>
                  </div>
                </div>

                {/* Seta */}
                <div className="flex justify-center">
                  <div className="text-2xl opacity-40 text-foreground">↓</div>
                </div>

                {/* Card 3: CRM organizado */}
                <div
                  className="rounded-xl border p-4"
                  style={{
                    borderColor: 'var(--brand-navy)',
                    background: 'rgba(15, 38, 71, 0.05)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-10 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: 'var(--brand-navy)' }}
                    >
                      <LayoutDashboard className="h-5 w-5" style={{ color: 'var(--brand-cream)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold" style={{ color: 'var(--brand-gold)' }}>Marcos · CRM</p>
                      <p className="text-sm font-medium truncate">→ Vendedor João · briefing pronto</p>
                    </div>
                  </div>
                </div>

                {/* Seta */}
                <div className="flex justify-center">
                  <div className="text-2xl opacity-40 text-foreground">↓</div>
                </div>

                {/* Card 4: José otimiza mídia */}
                <div
                  className="rounded-xl border p-4"
                  style={{
                    borderColor: 'rgba(212, 160, 23, 0.55)',
                    background: 'rgba(212, 160, 23, 0.08)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-10 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: 'rgba(212, 160, 23, 0.18)' }}
                    >
                      <Target className="h-5 w-5" style={{ color: 'var(--brand-gold)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold" style={{ color: 'var(--brand-gold)' }}>José · Tráfego IA</p>
                      <p className="text-sm font-medium truncate">Escalar campanha Onix · CPL saudável</p>
                    </div>
                  </div>
                </div>

              </div>

              {/* Badge "ao vivo" */}
              <div className="absolute -top-3 -right-3">
                <Badge
                  className="border-0 px-3 py-1 text-[10px] font-bold shadow-md"
                  style={{
                    background: 'var(--brand-success)',
                    color: 'white',
                  }}
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse mr-1.5" />
                  AO VIVO
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Métricas em destaque (full-width, abaixo do grid 2-col) */}
        <div className="relative max-w-4xl mx-auto mt-14 md:mt-20">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
            {[
              { value: '3', label: 'Agentes ativos no PRO' },
              { value: '24/7', label: 'Pedro atende sem parar' },
              { value: 'José', label: 'Otimização de tráfego IA' },
              { value: '5min', label: 'Liberação após pagar' },
            ].map((m) => (
              <div
                key={m.label}
                className="rounded-xl border-2 p-4 md:p-5 transition-all hover:translate-y-[-2px] hover:shadow-lg bg-card border-foreground/15"
                style={{ boxShadow: 'var(--shadow-medium)' }}
              >
                <p
                  className="text-3xl md:text-4xl font-extrabold leading-none"
                  style={{
                    fontFamily: 'var(--font-display)',
                    color: 'var(--brand-gold)',
                    textShadow: '0 2px 12px rgba(212, 160, 23, 0.30)',
                  }}
                >
                  {m.value}
                </p>
                <p className="text-xs md:text-sm font-medium text-foreground/80 mt-2">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── VIDEO DEMO ───────────────────────────────────────────────── */}
      <section id="demo" className="px-4 md:px-6 py-14 md:py-20 bg-card/25">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[0.9fr_1.35fr] gap-8 lg:gap-12 items-center">
          <div className="text-center lg:text-left">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary">
              Veja por dentro
            </Badge>
            <h2
              className="text-3xl sm:text-4xl md:text-5xl font-extrabold leading-tight mb-5"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Assista a Logos IA trabalhando numa operação real.
            </h2>
            <p className="text-base md:text-lg text-muted-foreground leading-relaxed mb-6">
              Mostre aqui Pedro atendendo, Marcos organizando os leads e José analisando campanhas.
              Essa demonstração encurta a decisão de compra porque o cliente entende em minutos como a plataforma funciona.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              {[
                'Lead atendido em segundos',
                'CRM atualizado automaticamente',
                'Tráfego analisado pelo José',
              ].map((item) => (
                <div key={item} className="rounded-lg border border-border/50 bg-background/60 px-3 py-3 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: 'var(--brand-success)' }} />
                  <span className="font-medium text-foreground/90">{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div
            className="relative overflow-hidden rounded-2xl border-2"
            style={{
              borderColor: 'rgba(212, 160, 23, 0.35)',
              background: 'linear-gradient(160deg, #0A1C36 0%, #12305C 100%)',
              boxShadow: '0 28px 80px -28px rgba(15, 38, 71, 0.75)',
            }}
          >
            <div className="aspect-video w-full">
              {demoVideoAvailable ? (
                <video
                  className="h-full w-full object-cover"
                  controls
                  playsInline
                  preload="metadata"
                  poster="/plano-pro-oferta.png"
                  onError={() => setDemoVideoAvailable(false)}
                >
                  <source src={DEMO_VIDEO_SRC} type="video/mp4" />
                </video>
              ) : (
                <div className="h-full w-full flex flex-col items-center justify-center text-center px-6">
                  <div
                    className="h-20 w-20 rounded-full flex items-center justify-center mb-5"
                    style={{
                      background: 'rgba(212, 160, 23, 0.14)',
                      border: '1px solid rgba(212, 160, 23, 0.40)',
                    }}
                  >
                    <PlayCircle className="h-11 w-11" style={{ color: 'var(--brand-gold)' }} />
                  </div>
                  <p className="text-xl md:text-2xl font-extrabold" style={{ color: 'var(--brand-cream)', fontFamily: 'var(--font-display)' }}>
                    Demonstração da Logos IA por dentro
                  </p>
                  <p className="text-sm md:text-base mt-3 max-w-lg" style={{ color: 'rgba(250, 248, 242, 0.70)' }}>
                    Pedro, Marcos e José conectados em uma única jornada: atendimento, CRM, campanha e decisão comercial.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── COMO FUNCIONA (Prompt 4 — redesign 16/05) ────────────────── */}
      <section id="como-funciona" className="relative px-4 md:px-6 py-16 md:py-24 overflow-hidden">
        {/* Background sutil */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            background: 'linear-gradient(135deg, var(--brand-navy) 0%, transparent 50%, var(--brand-gold) 100%)',
          }}
        />

        <div className="relative max-w-6xl mx-auto">

          {/* Header da seção */}
          <div className="text-center mb-14 md:mb-20 animate-fade-in">
            <Badge
              variant="outline"
              className="mb-4 px-4 py-1 text-xs font-semibold uppercase tracking-wider"
              style={{
                borderColor: 'var(--brand-gold)',
                color: 'var(--brand-gold)',
                background: 'rgba(212, 160, 23, 0.08)',
              }}
            >
              Como funciona
            </Badge>
            <h2
              className="text-3xl sm:text-4xl md:text-5xl font-extrabold leading-tight max-w-3xl mx-auto text-foreground"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Em <span style={{ color: 'var(--brand-gold)' }}>3 passos</span>, sua operação muda de patamar.
            </h2>
          </div>

          {/* 3 cards de passos */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {[
              {
                num: '1',
                title: 'Conecte seu WhatsApp',
                desc: 'Em menos de 5 minutos seu número está ativo na plataforma, sem trocar de chip, sem perder histórico.',
                Icon: Smartphone,
                color: 'var(--brand-success)',
                bg: 'rgba(22, 163, 74, 0.10)',
              },
              {
                num: '2',
                title: 'Ative Pedro e Marcos',
                desc: 'Configure as regras de qualificação, importe sua base e deixe a IA assumir o trabalho repetitivo.',
                Icon: Cog,
                color: 'var(--brand-gold)',
                bg: 'rgba(212, 160, 23, 0.10)',
              },
              {
                num: '3',
                title: 'Acompanhe e venda mais',
                desc: 'Veja no CRM ao vivo quais leads estão quentes, qualificados e prontos pro fechamento.',
                Icon: LineChart,
                color: 'var(--brand-blue)',                 // azul claro da paleta (estava navy escuro = invisível em dark)
                bg: 'rgba(59, 130, 196, 0.12)',
              },
            ].map((step, i) => (
              <div
                key={step.num}
                className="relative rounded-2xl bg-card p-6 md:p-8 transition-all duration-200 hover:translate-y-[-4px] group"
                style={{
                  border: '1px solid rgba(15, 38, 71, 0.10)',
                  boxShadow: 'var(--shadow-soft)',
                  animation: `fadeIn 0.5s ease-out ${i * 0.15}s both`,
                }}
              >
                {/* Número grande no fundo do card — usa a cor do passo + opacity maior pra ser visível */}
                <div
                  className="absolute top-3 right-5 text-7xl md:text-9xl font-black leading-none select-none pointer-events-none"
                  style={{
                    fontFamily: 'var(--font-display)',
                    color: step.color,
                    opacity: 0.22,
                  }}
                >
                  {step.num}
                </div>

                {/* Ícone */}
                <div
                  className="relative w-14 h-14 rounded-2xl flex items-center justify-center mb-5 transition-transform group-hover:scale-110"
                  style={{ background: step.bg }}
                >
                  <step.Icon className="h-7 w-7" style={{ color: step.color }} strokeWidth={2} />
                </div>

                {/* Label "Passo N" */}
                <p
                  className="text-xs font-bold uppercase tracking-widest mb-2"
                  style={{ color: step.color }}
                >
                  Passo {step.num}
                </p>

                {/* Título */}
                <h3
                  className="text-xl md:text-2xl font-bold mb-3 leading-tight"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {step.title}
                </h3>

                {/* Descrição */}
                <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                  {step.desc}
                </p>

                {/* Conectivo entre cards (linha horizontal pontilhada) — só desktop, exceto último */}
                {i < 2 && (
                  <div
                    className="hidden md:block absolute top-1/2 -right-4 w-8 h-px pointer-events-none"
                    style={{
                      background: 'repeating-linear-gradient(90deg, var(--brand-navy) 0 4px, transparent 4px 8px)',
                      opacity: 0.20,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AGENTE PEDRO (Prompt 5 — redesign 16/05) ──────────────────── */}
      <section
        id="agente-pedro"
        className="relative px-4 md:px-6 py-16 md:py-24 overflow-hidden"
        style={{ background: 'rgba(15, 38, 71, 0.03)' }}
      >
        {/* Background orb sutil */}
        <div
          className="absolute top-20 right-10 w-96 h-96 rounded-full blur-3xl pointer-events-none opacity-10"
          style={{ background: 'var(--brand-gold)' }}
        />

        <div className="relative max-w-6xl mx-auto">

          {/* ── HEADER ────────────────────────────────────── */}
          <div className="text-center mb-12 md:mb-14 animate-fade-in">
            {/* Badge AGENTE ATIVO (verde) */}
            <Badge
              className="mb-5 border-0 px-4 py-1.5 text-xs font-bold uppercase tracking-wider"
              style={{
                background: 'var(--brand-success-bg)',
                color: 'var(--brand-success)',
              }}
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full mr-2 animate-pulse"
                style={{ background: 'var(--brand-success)' }}
              />
              Agente Ativo
            </Badge>

            {/* H2 */}
            <h2
              className="text-3xl sm:text-4xl md:text-5xl font-extrabold leading-tight mb-4 max-w-4xl mx-auto text-foreground"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              <span style={{ color: 'var(--brand-gold)' }}>Pedro</span> — O atendente que nunca dorme, nunca esquece, nunca deixa um lead esfriar.
            </h2>

            {/* Subtítulo */}
            <p className="text-base md:text-xl text-muted-foreground max-w-2xl mx-auto">
              Atendimento humano. Velocidade de máquina. Qualificação cirúrgica.
            </p>
          </div>

          {/* ── BLOCO DE DOR ────────────────────────────────── */}
          <div
            className="relative max-w-4xl mx-auto mb-14 md:mb-16 rounded-2xl p-6 md:p-8"
            style={{
              background: 'rgba(220, 38, 38, 0.04)',
              borderLeft: '4px solid var(--brand-gold)',
            }}
          >
            <p className="text-base md:text-lg text-foreground/90 leading-relaxed mb-3">
              Você já <strong>perdeu venda</strong> porque o lead mandou mensagem às 22h e ninguém respondeu?
              Já passou um lead <em>"quente"</em> pro vendedor e descobriu que era curioso?
              Já viu sua equipe gastar 80% do tempo respondendo perguntas básicas em vez de fechar negócio?
            </p>
            <p
              className="text-lg md:text-xl font-bold mt-4"
              style={{ color: 'var(--brand-gold)' }}
            >
              Pedro acaba com isso.
            </p>
          </div>

          {/* ── GRID DE 9 FUNCIONALIDADES ──────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6 mb-14 md:mb-16">
            {[
              {
                Icon: Clock,
                title: 'Atende 24/7 no seu WhatsApp',
                desc: 'Primeiro contato em segundos, todo dia, toda hora — sem fim de semana, sem feriado.',
                isGold: true,
              },
              {
                Icon: Filter,
                title: 'Qualifica com regras suas',
                desc: 'Forma de pagamento, entrada, CPF, prazo, e qualquer critério que você definir.',
                isGold: false,
              },
              {
                Icon: Tags,
                title: 'Classifica automaticamente',
                desc: 'Cada lead vai pro CRM marcado como Qualificado, Pouco qualificado ou Ausente — sem ninguém olhar.',
                isGold: true,
              },
              {
                Icon: Timer,
                title: 'Sabe a hora certa de transferir',
                desc: 'Se o lead não responde, espera 5min, manda reengajamento, espera mais 5min, e só então passa pro vendedor.',
                isGold: false,
              },
              {
                Icon: FileText,
                title: 'Entrega o lead com briefing pronto',
                desc: 'Quando transfere, o vendedor já recebe um resumo: o que o lead respondeu, o que ficou faltando, e a última coisa que disse.',
                isGold: true,
              },
              {
                Icon: Brain,
                title: 'Não se reapresenta',
                desc: 'Pedro lembra cada conversa. Cliente não recebe "oi, sou o Pedro" duas vezes. Atendimento contínuo.',
                isGold: false,
              },
              {
                Icon: MapPin,
                title: 'Captura a origem certa',
                desc: 'Porta da loja, Marketplace do Facebook, OLX, Mercado Livre, Instagram do vendedor — você sabe de onde veio cada lead.',
                isGold: true,
              },
              {
                Icon: Globe,
                title: 'Identifica cidade e região',
                desc: 'Etiqueta colorida no lead, visível pro vendedor de cara.',
                isGold: false,
              },
              {
                Icon: Upload,
                title: 'Aceita lead manual e por planilha',
                desc: 'Importação rápida, sem retrabalho, sem duplicar.',
                isGold: true,
              },
            ].map((feat, i) => {
              const accentColor = feat.isGold ? 'var(--brand-gold)' : 'var(--brand-navy)';
              const accentBg = feat.isGold ? 'rgba(212, 160, 23, 0.10)' : 'rgba(15, 38, 71, 0.08)';
              return (
                <div
                  key={feat.title}
                  className="group rounded-2xl bg-card p-5 md:p-6 transition-all duration-200 hover:translate-y-[-3px]"
                  style={{
                    border: '1px solid rgba(15, 38, 71, 0.10)',
                    boxShadow: 'var(--shadow-soft)',
                    animation: `fadeIn 0.5s ease-out ${i * 0.05}s both`,
                  }}
                >
                  {/* Ícone */}
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110"
                    style={{ background: accentBg }}
                  >
                    <feat.Icon className="h-5 w-5" style={{ color: accentColor }} strokeWidth={2} />
                  </div>

                  {/* Título */}
                  <h3
                    className="text-base md:text-lg font-bold mb-2 leading-tight"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {feat.title}
                  </h3>

                  {/* Descrição */}
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feat.desc}
                  </p>
                </div>
              );
            })}
          </div>

          {/* ── BLOCO RESULTADO PROMETIDO ─────────────────── */}
          <div
            className="relative max-w-4xl mx-auto rounded-3xl p-8 md:p-10 text-center overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, var(--brand-navy) 0%, var(--brand-navy-light) 100%)',
              boxShadow: 'var(--shadow-strong)',
            }}
          >
            {/* Glow dourado de fundo */}
            <div
              className="absolute -top-20 -right-20 w-64 h-64 rounded-full blur-3xl pointer-events-none opacity-30"
              style={{ background: 'var(--brand-gold)' }}
            />
            <p
              className="relative text-lg md:text-2xl font-bold leading-snug"
              style={{ color: 'var(--brand-cream)', fontFamily: 'var(--font-display)' }}
            >
              Enquanto seus concorrentes ainda estão lendo a mensagem do cliente,{' '}
              <span style={{ color: 'var(--brand-gold)' }}>
                o seu lead já foi atendido, qualificado e está no CRM
              </span>
              {' '}— pronto pro vendedor fechar.
            </p>
          </div>

          {/* ── PARA QUEM É ───────────────────────────────── */}
          <p className="text-center text-sm text-muted-foreground mt-8 max-w-2xl mx-auto">
            <strong className="text-foreground">Para quem é:</strong>{' '}
            Lojas físicas, concessionárias, imobiliárias, e qualquer operação que recebe lead por WhatsApp e precisa qualificar antes de transferir.
          </p>

        </div>
      </section>

      {/* ── AGENTE MARCOS (Prompt 6 — redesign 16/05) ─────────────────── */}
      <section
        id="agente-marcos"
        className="relative px-4 md:px-6 py-16 md:py-24 overflow-hidden"
        style={{ background: 'rgba(212, 160, 23, 0.03)' }}
      >
        {/* Background orb sutil (navy, lado oposto do Pedro) */}
        <div
          className="absolute top-20 left-10 w-96 h-96 rounded-full blur-3xl pointer-events-none opacity-10"
          style={{ background: 'var(--brand-navy)' }}
        />

        <div className="relative max-w-6xl mx-auto">

          {/* ── HEADER ────────────────────────────────────── */}
          <div className="text-center mb-12 md:mb-14 animate-fade-in">
            <Badge
              className="mb-5 border-0 px-4 py-1.5 text-xs font-bold uppercase tracking-wider"
              style={{
                background: 'var(--brand-success-bg)',
                color: 'var(--brand-success)',
              }}
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full mr-2 animate-pulse"
                style={{ background: 'var(--brand-success)' }}
              />
              Agente Ativo
            </Badge>

            <h2
              className="text-3xl sm:text-4xl md:text-5xl font-extrabold leading-tight mb-4 max-w-4xl mx-auto text-foreground"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Marcos — Disparo em massa que <span style={{ color: 'var(--brand-gold)' }}>não queima base</span>. CRM que conversa com o WhatsApp.
            </h2>

            <p className="text-base md:text-xl text-muted-foreground max-w-2xl mx-auto">
              Acabe com listas duplicadas, envios duplicados e CRM esquecido. Marcos centraliza disparo, segmentação e funil em um lugar só.
            </p>
          </div>

          {/* ── BLOCO DE DOR ────────────────────────────────── */}
          <div
            className="relative max-w-4xl mx-auto mb-14 md:mb-16 rounded-2xl p-6 md:p-8"
            style={{
              background: 'rgba(220, 38, 38, 0.04)',
              borderLeft: '4px solid var(--brand-navy)',
            }}
          >
            <p className="text-base md:text-lg text-foreground/90 leading-relaxed mb-3">
              Você já mandou disparo em massa e <strong>bloquearam seu número</strong>?
              Já mandou a mesma promoção pro mesmo lead 3 vezes?
              Já viu sua base de contatos espalhada em planilha, no celular do vendedor e numa ferramenta que ninguém abre?
            </p>
            <p
              className="text-lg md:text-xl font-bold mt-4"
              style={{ color: 'var(--brand-navy)' }}
            >
              Marcos resolve isso de uma vez.
            </p>
          </div>

          {/* ── GRID DE 8 FUNCIONALIDADES (4x2 desktop) ─────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 md:gap-6 mb-14 md:mb-16">
            {[
              {
                Icon: Send,
                title: 'Disparo em massa inteligente',
                desc: 'Segmenta por coluna, origem, status do funil, cidade. Manda só pra quem importa.',
                isNavy: true,
              },
              {
                Icon: ShieldCheck,
                title: 'Não envia pra quem já recebeu',
                desc: 'Se um lead já entrou na automação, Marcos não reenvia. Sua base não esquenta.',
                isNavy: false,
              },
              {
                Icon: List,
                title: 'Listas com rastreabilidade total',
                desc: 'Cada lista tem nome, data, origem e quantidade. Você sabe exatamente o que tem.',
                isNavy: true,
              },
              {
                Icon: RefreshCw,
                title: 'Sincronização automática com Pedro',
                desc: 'Lead que chega no Pedro aparece automaticamente nas listas do Marcos. Zero retrabalho.',
                isNavy: false,
              },
              {
                Icon: LayoutGrid,
                title: 'CRM com visão dupla',
                desc: 'Por origem (Porta, Marketplace) e por status do funil (Ausente, Qualificado, Negociação).',
                isNavy: true,
              },
              {
                Icon: Kanban,
                title: 'CRM ao vivo (Kanban em tempo real)',
                desc: 'Arraste o lead entre etapas. Toda a equipe vê o mesmo funil no mesmo instante.',
                isNavy: false,
              },
              {
                Icon: Upload,
                title: 'Importação manual, planilha ou Pedro',
                desc: 'Escolhe a origem, joga na lista e segue o jogo.',
                isNavy: true,
              },
              {
                Icon: Filter,
                title: 'Filtros antes do disparo',
                desc: 'Antes de enviar, escolhe o recorte exato. Não dispara cego.',
                isNavy: false,
              },
            ].map((feat, i) => {
              // Marcos: padrão inverso ao Pedro (navy primeiro)
              const accentColor = feat.isNavy ? 'var(--brand-navy)' : 'var(--brand-gold)';
              const accentBg = feat.isNavy ? 'rgba(15, 38, 71, 0.08)' : 'rgba(212, 160, 23, 0.10)';
              return (
                <div
                  key={feat.title}
                  className="group rounded-2xl bg-card p-5 md:p-6 transition-all duration-200 hover:translate-y-[-3px]"
                  style={{
                    border: '1px solid rgba(15, 38, 71, 0.10)',
                    boxShadow: 'var(--shadow-soft)',
                    animation: `fadeIn 0.5s ease-out ${i * 0.05}s both`,
                  }}
                >
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110"
                    style={{ background: accentBg }}
                  >
                    <feat.Icon className="h-5 w-5" style={{ color: accentColor }} strokeWidth={2} />
                  </div>

                  <h3
                    className="text-base font-bold mb-2 leading-tight"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {feat.title}
                  </h3>

                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feat.desc}
                  </p>
                </div>
              );
            })}
          </div>

          {/* ── BLOCO RESULTADO PROMETIDO (inverso: fundo dourado) ─── */}
          <div
            className="relative max-w-4xl mx-auto rounded-3xl p-8 md:p-10 text-center overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, var(--brand-gold-hover) 0%, var(--brand-gold) 100%)',
              boxShadow: 'var(--shadow-strong)',
            }}
          >
            <div
              className="absolute -top-20 -left-20 w-64 h-64 rounded-full blur-3xl pointer-events-none opacity-30"
              style={{ background: 'var(--brand-navy)' }}
            />
            <p
              className="relative text-lg md:text-2xl font-bold leading-snug"
              style={{ color: 'var(--brand-navy)', fontFamily: 'var(--font-display)' }}
            >
              Você manda{' '}
              <span style={{ color: 'var(--brand-cream)' }}>
                a oferta certa pra pessoa certa
              </span>
              , no momento certo, sem queimar contato e sem inflar o número de "mortos" na sua base.
            </p>
          </div>

          {/* ── PARA QUEM É ───────────────────────────────── */}
          <p className="text-center text-sm text-muted-foreground mt-8 max-w-2xl mx-auto">
            <strong className="text-foreground">Para quem é:</strong>{' '}
            Empresas que fazem campanhas recorrentes (promoções, lançamentos, recall), gestores de tráfego que precisam reativar base, e times comerciais que querem ver o funil ao vivo.
          </p>

        </div>
      </section>

      {/* ── AGENTES (Prompt 7 — redesign 16/05) ─────────────────────── */}
      <section
        id="em-breve"
        className="relative px-4 md:px-6 py-16 md:py-24 overflow-hidden bg-background"
      >
        <div className="relative max-w-6xl mx-auto">

          {/* ── HEADER ────────────────────────────────────── */}
          <div className="text-center mb-12 md:mb-14 animate-fade-in">
            <Badge
              variant="outline"
              className="mb-4 px-4 py-1 text-xs font-semibold uppercase tracking-wider border-foreground/30 text-foreground bg-foreground/5"
            >
              <Sparkles className="inline-block h-3 w-3 mr-1.5" />
              Agentes da operação
            </Badge>

            <h2
              className="text-3xl sm:text-4xl md:text-5xl font-extrabold leading-tight mb-4 max-w-4xl mx-auto text-foreground"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Pedro, Marcos e José já entram no{' '}
              <span style={{ color: 'var(--brand-gold)' }}>PRO</span>.
              <br className="hidden md:block" />
              {' '}O restante do ecossistema continua crescendo.
            </h2>

            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              O PRO e o PRO MAX já incluem atendimento, CRM/disparo e tráfego inteligente.
              Os próximos agentes entram como expansão para quem quer centralizar marketing e vendas na Logos IA.
            </p>
          </div>

          {/* ── GRID 4x2 DESKTOP / 2x4 TABLET / 1 MOBILE ──────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
            {[
              {
                name: 'José',
                desc: 'Gestão inteligente de tráfego pago no Meta e Google Ads',
                Icon: Target,
                color: '#E65100',
                bg: 'rgba(230, 81, 0, 0.08)',
                included: true,
              },
              {
                name: 'Paulo',
                desc: 'Copywriter IA com termômetro de estilo e tom configurável',
                Icon: PenTool,
                color: '#7C3AED',
                bg: 'rgba(124, 58, 237, 0.08)',
              },
              {
                name: 'Maria',
                desc: 'Design criativo com IA generativa — imagens e edição',
                Icon: Palette,
                color: '#EC4899',
                bg: 'rgba(236, 72, 153, 0.08)',
              },
              {
                name: 'Davi',
                desc: 'Social media — calendário editorial e posts automáticos',
                Icon: Instagram,
                color: '#0EA5E9',
                bg: 'rgba(14, 165, 233, 0.08)',
              },
              {
                name: 'João',
                desc: 'E-mail marketing — sequências de nutrição e campanhas',
                Icon: Mail,
                color: '#10B981',
                bg: 'rgba(16, 185, 129, 0.08)',
              },
              {
                name: 'Daniel',
                desc: 'Estratégia de negócio + fluxograma visual de vendas',
                Icon: Brain,
                color: '#3B82F6',
                bg: 'rgba(59, 130, 246, 0.08)',
              },
              {
                name: 'Lucas',
                desc: 'Funil de vendas visual com 6 templates prontos',
                Icon: Layers,
                color: '#F59E0B',
                bg: 'rgba(245, 158, 11, 0.08)',
              },
              {
                name: 'Salomão',
                desc: 'Orquestrador central — distribui tarefas entre agentes',
                Icon: Crown,
                color: '#D4A017',
                bg: 'rgba(212, 160, 23, 0.10)',
              },
            ].map((agent, i) => {
              const included = Boolean(agent.included);

              return (
                <div
                  key={agent.name}
                  className="relative rounded-2xl bg-card p-5 select-none border-foreground/10 border"
                  style={{
                    boxShadow: included ? '0 22px 60px -26px rgba(212, 160, 23, 0.75)' : 'var(--shadow-soft)',
                    opacity: included ? 1 : 0.62,
                    cursor: included ? 'default' : 'not-allowed',
                    animation: `fadeIn 0.5s ease-out ${i * 0.05}s both`,
                    filter: included ? 'none' : 'grayscale(0.25)',
                    borderColor: included ? 'rgba(212, 160, 23, 0.38)' : 'rgba(255,255,255,0.10)',
                  }}
                >
                  <div className="absolute top-3 right-3">
                    <span
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border"
                      style={{
                        background: included ? 'rgba(34, 197, 94, 0.16)' : 'var(--brand-gold)',
                        color: included ? 'var(--brand-success)' : 'var(--brand-navy)',
                        borderColor: included ? 'rgba(34, 197, 94, 0.35)' : 'var(--brand-gold-hover)',
                        boxShadow: included ? 'none' : '0 2px 8px rgba(212, 160, 23, 0.45), inset 0 -1px 0 rgba(0,0,0,0.15)',
                      }}
                    >
                      {included ? (
                        <CheckCircle2 className="h-2.5 w-2.5" strokeWidth={3} />
                      ) : (
                        <Lock className="h-2.5 w-2.5" strokeWidth={3} />
                      )}
                      {included ? 'Incluso no PRO' : 'Em breve'}
                    </span>
                  </div>

                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                    style={{
                      background: agent.bg,
                      filter: included ? 'none' : 'saturate(0.65)',
                    }}
                  >
                    <agent.Icon className="h-6 w-6" style={{ color: agent.color, opacity: included ? 1 : 0.80 }} strokeWidth={2} />
                  </div>

                  <h3
                    className="text-lg font-bold mb-2 leading-tight text-foreground"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {agent.name}
                  </h3>

                  <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">
                    {agent.desc}
                  </p>
                </div>
              );
            })}
          </div>

          {/* ── Disclaimer ───────────────────────────────── */}
          <p className="text-center text-sm text-muted-foreground mt-10 max-w-2xl mx-auto">
            <Sparkles className="inline-block h-3.5 w-3.5 mr-1.5" style={{ color: 'var(--brand-gold)' }} />
            José já está incluso no PRO e PRO MAX. Quem é assinante ativo entra primeiro nos próximos lançamentos.
          </p>

        </div>
      </section>

      {/* ── COMPARATIVO: R$57K vs R$2.497 ─────────────────────────── */}
      <section id="solucao" className="px-4 md:px-6 py-16 md:py-20 bg-card/20">
        <div className="max-w-5xl mx-auto">

          {/* Headline principal */}
          <div className="text-center mb-14">
            <Badge variant="outline" className="mb-5 border-yellow-500/40 text-yellow-400 text-sm px-4 py-1">
              PARE E PENSE POR 30 SEGUNDOS
            </Badge>
            <h2 className="text-2xl sm:text-3xl md:text-5xl font-bold leading-tight mb-4">
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
            <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5 md:p-7">
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
                  <span className="text-2xl font-bold text-red-400">R$ 15.000/mês</span>
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
            <div className="rounded-2xl border border-green-500/40 bg-green-500/5 p-5 md:p-7 relative overflow-hidden">
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
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 md:p-8 text-center mb-12 md:mb-16">
            <p className="text-muted-foreground text-sm uppercase tracking-widest mb-3">Você leu certo</p>
            <div className="flex items-center justify-center gap-4 md:gap-6 flex-wrap mb-4">
              <div className="text-center">
                <p className="text-3xl md:text-5xl font-black text-red-400 line-through opacity-60">R$ 15.000</p>
                <p className="text-xs text-muted-foreground mt-1">Modelo tradicional / mês</p>
              </div>
              <div className="text-2xl font-bold text-muted-foreground">vs</div>
              <div className="text-center">
                <p className="text-3xl md:text-5xl font-black text-green-400">R$ 2.497</p>
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
          <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-5 md:p-8 mb-12 md:mb-16">
            <h3 className="text-xl font-bold text-center mb-8 text-yellow-400">
              A Matemática é Brutal — Em 12 Meses:
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Modelo Tradicional</p>
                <p className="text-3xl font-black text-red-400">R$ 180.000</p>
                <p className="text-xs text-muted-foreground mt-1">por ano</p>
              </div>
              <div className="flex items-center justify-center py-2 sm:py-0">
                <div className="text-center">
                  <p className="text-3xl font-black text-green-400">R$ 140.036</p>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-12 md:mb-16">
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
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5 md:p-8 text-center mb-8 md:mb-10">
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
            <Button asChild size="lg" className="bg-green-600 hover:bg-green-700 text-white px-8 text-base md:text-lg gap-2 py-5 rounded-2xl font-bold shadow-lg shadow-green-900/30 h-auto whitespace-normal max-w-sm md:max-w-none">
              <Link to={PRO_CHECKOUT_URL} className="flex items-center justify-center gap-2 text-center leading-snug">
                Quero Multiplicar Meus Resultados e Economizar Até R$15k/mês com IA
                <ArrowRight className="h-5 w-5 shrink-0" />
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground mt-3">
              Sem contrato · Cancele quando quiser · Setup em menos de 24h
            </p>
          </div>
        </div>
      </section>

      {/* ── O PROBLEMA ─────────────────────────────────────────────── */}
      <section className="px-4 md:px-6 py-16 md:py-20 bg-card/30">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4 border-red-500/30 text-red-400">O Problema</Badge>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4">Agências tradicionais estão te limitando</h2>
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
      <section id="diferenciais" className="px-4 md:px-6 py-16 md:py-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary">A Solução</Badge>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4">LogosIA: A Inteligência Artificial que Nunca Dorme para o Seu Marketing</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">Imagine ter uma equipe de marketing de elite, trabalhando 24 horas por dia, 7 dias por semana, sem salário, sem férias e sem reuniões. A LogosIA é essa realidade. Nossos 9 agentes de IA especializados operam com precisão matemática, otimizando suas campanhas, criando conteúdo de alta conversão e gerenciando seus leads de forma autônoma.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: Zap, title: 'Operação 24/7 Ininterrupta', desc: 'Seus anúncios são otimizados e seu conteúdo é publicado enquanto você dorme.', color: 'text-primary', bg: 'bg-primary/10' },
              { icon: Shield, title: 'Zero Erros Humanos', desc: 'Algoritmos avançados eliminam inconsistências e garantem performance máxima.', color: 'text-blue-400', bg: 'bg-blue-500/10' },
              { icon: Rocket, title: 'Escalabilidade Ilimitada', desc: 'Atende a 1 ou 1.000 campanhas com a mesma qualidade e velocidade, sem aumentar sua equipe.', color: 'text-purple-400', bg: 'bg-purple-500/10' },
              { icon: BarChart3, title: 'ROI Claro e Mensurável', desc: 'Dashboard unificado com todas as métricas que importam: ROAS, CPA, CPL, e muito mais.', color: 'text-green-400', bg: 'bg-green-500/10' },
              { icon: Brain, title: 'IA Adaptativa', desc: 'Aprende continuamente com seus dados, refinando estratégias e superando a concorrência.', color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
              { icon: Award, title: 'Metodologia de Elite', desc: 'Validada e mentorada pela renomada Comunidade Viver de IA.', color: 'text-orange-400', bg: 'bg-orange-500/10' },
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

      {/*
       * Seções antigas REMOVIDAS (16/05) — duplicavam conteúdo:
       *   - "AGENTES — Sua equipe completa de IA" (6 agentes que NÃO estão ativos)
       *     → substituída por seção "Em breve" (id="em-breve") com 8 agentes do sistema
       *   - "COMPARATIVO DE PERFORMANCE — Logos IA vs Mercado" (radar/barra/tabela)
       *     → removida por solicitação do usuário (não faz sentido vender Pedro+Marcos
       *       comparando com agências completas)
       *
       * Arrays `agents`, `radarData`, `barData` no topo do arquivo agora estão
       * sem uso — preservados pra rollback se necessário.
       */}

      {/* ── PLANO PRO (Redesign mockup 17/05 — navy + dourado, premium) ─── */}
      <section
        id="planos"
        className="relative px-4 md:px-6 py-16 md:py-24 overflow-hidden"
      >
        {/* Background sutil pra destacar o card */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(212, 160, 23, 0.08) 0%, transparent 70%)',
          }}
        />

        <div className="relative max-w-5xl mx-auto">

          {/* ── HEADER ───────────────────────────────────── */}
          <div className="text-center mb-10 md:mb-14 animate-fade-in">
            <Badge
              variant="outline"
              className="mb-4 px-4 py-1 text-xs font-semibold uppercase tracking-wider"
              style={{
                borderColor: 'var(--brand-gold)',
                color: 'var(--brand-gold)',
                background: 'rgba(212, 160, 23, 0.08)',
              }}
            >
              Oferta Fundador
            </Badge>

            <h2
              className="text-3xl sm:text-4xl md:text-5xl font-extrabold leading-tight mb-3 text-foreground"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Escolha entre PRO e PRO MAX. <span style={{ color: 'var(--brand-gold)' }}>Pedro, Marcos e José inclusos</span>.
            </h2>

            <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto">
              Comece com atendimento, CRM e tráfego IA no PRO. Suba para o PRO MAX quando quiser mais volume, prioridade e acompanhamento.
            </p>
          </div>

          {/* ── CARD PRO — USA A ARTE COMPLETA COMO IMAGEM ─────────── */}
          <div className="relative mx-auto">

            {/* ── DOIS CARDS: PRO FUNDADOR + PRO MAX (lado a lado) ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 max-w-4xl mx-auto items-stretch">

              {/* ===== CARD PRO FUNDADOR (destaque dourado) ===== */}
              <div className="relative">
                {/* Glow externo dourado */}
                <div
                  className="absolute -inset-3 rounded-[2rem] blur-2xl opacity-30 pointer-events-none"
                  style={{ background: 'linear-gradient(135deg, var(--brand-gold) 0%, transparent 70%)' }}
                />
                <div
                  className="relative h-full rounded-[1.75rem] overflow-hidden flex flex-col"
                  style={{
                    background: 'linear-gradient(160deg, #12305C 0%, var(--brand-navy) 55%, #0A1C36 100%)',
                    border: '2px solid var(--brand-gold)',
                    boxShadow: '0 32px 80px -16px rgba(15, 38, 71, 0.55), 0 0 60px rgba(212, 160, 23, 0.20)',
                  }}
                >
                  {/* Faixa dourada no topo */}
                  <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg, var(--brand-gold), #F0C75A, var(--brand-gold))' }} />

                  {/* Ribbon Oferta Fundador */}
                  <div className="px-6 md:px-8 pt-6">
                    <div
                      className="inline-flex items-center gap-2 px-3 py-1 rounded-full"
                      style={{ background: 'rgba(212, 160, 23, 0.15)', border: '1px solid rgba(212, 160, 23, 0.40)' }}
                    >
                      <Crown className="h-3.5 w-3.5" style={{ color: 'var(--brand-gold)' }} />
                      <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--brand-gold)' }}>
                        Oferta Fundador · 10 primeiros
                      </span>
                    </div>
                  </div>

                  <div className="px-6 md:px-8 pt-4 pb-7 flex flex-col flex-1">
                    <h3
                      className="text-3xl font-black uppercase tracking-wide"
                      style={{ fontFamily: 'var(--font-display)', color: 'var(--brand-cream)' }}
                    >
                      Pro
                    </h3>
                    <p className="text-sm mt-1 mb-5" style={{ color: 'rgba(250, 248, 242, 0.70)' }}>
                      Entre pela oferta fundador com Pedro, Marcos e José inclusos.
                    </p>

                    {/* Preço mensal */}
                    <div className="flex items-end gap-1 leading-none">
                      <span className="text-2xl font-bold pb-1.5" style={{ color: 'var(--brand-gold)', fontFamily: 'var(--font-display)' }}>R$</span>
                      <span
                        className="text-6xl font-black leading-none"
                        style={{ color: 'var(--brand-gold)', fontFamily: 'var(--font-display)', textShadow: '0 4px 24px rgba(212, 160, 23, 0.40)' }}
                      >
                        497
                      </span>
                      <span className="text-2xl font-bold pb-1.5" style={{ color: 'var(--brand-gold)', fontFamily: 'var(--font-display)' }}>,90</span>
                      <span className="text-base font-semibold pb-2 ml-1" style={{ color: 'rgba(250, 248, 242, 0.70)' }}>/mês</span>
                    </div>
                    <p className="text-xs mt-2" style={{ color: 'rgba(250, 248, 242, 0.65)' }}>
                      + R$ 1.497 de implementação (pagamento único)
                    </p>

                    {/* Highlight 300 conversas */}
                    <div
                      className="mt-5 mb-5 rounded-xl p-3 text-center"
                      style={{ background: 'rgba(212, 160, 23, 0.12)', border: '1px solid rgba(212, 160, 23, 0.30)' }}
                    >
                      <span className="text-lg font-extrabold" style={{ color: 'var(--brand-gold)', fontFamily: 'var(--font-display)' }}>
                        300 conversas/mês
                      </span>
                      <span className="block text-[11px] uppercase tracking-widest mt-0.5" style={{ color: 'rgba(250, 248, 242, 0.75)' }}>
                        incluídas no atendimento com IA
                      </span>
                    </div>

                    {/* Features */}
                    <ul className="space-y-2.5 text-sm flex-1">
                      {[
                        'CRM completo de leads',
                        'Até 10 conexões de WhatsApp',
                        'Disparo em massa segmentado',
                        'Follow-up automático 24/7',
                        'Pedro, Marcos e José inclusos',
                        'Exportação de planilhas e relatórios',
                        'Suporte prioritário',
                      ].map((f) => (
                        <li key={f} className="flex items-start gap-2.5">
                          <span
                            className="mt-0.5 shrink-0 rounded-full flex items-center justify-center"
                            style={{ width: 18, height: 18, background: 'rgba(212, 160, 23, 0.18)' }}
                          >
                            <CheckCircle2 className="h-3 w-3" style={{ color: 'var(--brand-gold)' }} />
                          </span>
                          <span style={{ color: 'rgba(250, 248, 242, 0.92)' }}>{f}</span>
                        </li>
                      ))}
                    </ul>

                    {/* CTA — único botão */}
                    <Button
                      asChild
                      size="lg"
                      className="mt-7 w-full text-base font-extrabold gap-2 py-6 uppercase tracking-wider transition-all hover:translate-y-[-2px]"
                      style={{
                        background: 'linear-gradient(135deg, var(--brand-gold-hover) 0%, var(--brand-gold) 50%, var(--brand-gold-light) 100%)',
                        color: 'var(--brand-navy)',
                        boxShadow: '0 12px 32px rgba(212, 160, 23, 0.45), inset 0 -3px 0 rgba(0,0,0,0.20)',
                        border: '2px solid var(--brand-gold-hover)',
                      }}
                    >
                      <Link to={PRO_CHECKOUT_URL}>
                        Quero o Pro Fundador <ArrowRight className="h-5 w-5" strokeWidth={3} />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>

              {/* ===== CARD PRO MAX ===== */}
              <div className="relative">
                <div
                  className="relative h-full rounded-[1.75rem] overflow-hidden flex flex-col"
                  style={{
                    background: 'linear-gradient(160deg, #12305C 0%, var(--brand-navy) 55%, #0A1C36 100%)',
                    border: '1px solid rgba(212, 160, 23, 0.30)',
                    boxShadow: '0 24px 60px -20px rgba(15, 38, 71, 0.50)',
                  }}
                >
                  <div className="h-1.5 w-full" style={{ background: 'rgba(212, 160, 23, 0.45)' }} />

                  <div className="px-6 md:px-8 pt-6">
                    <div
                      className="inline-flex items-center gap-2 px-3 py-1 rounded-full"
                      style={{ background: 'rgba(250, 248, 242, 0.08)', border: '1px solid rgba(250, 248, 242, 0.18)' }}
                    >
                      <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'rgba(250, 248, 242, 0.85)' }}>
                        Para escala
                      </span>
                    </div>
                  </div>

                  <div className="px-6 md:px-8 pt-4 pb-7 flex flex-col flex-1">
                    <h3
                      className="text-3xl font-black uppercase tracking-wide"
                      style={{ fontFamily: 'var(--font-display)', color: 'var(--brand-cream)' }}
                    >
                      Pro Max
                    </h3>
                    <p className="text-sm mt-1 mb-5" style={{ color: 'rgba(250, 248, 242, 0.70)' }}>
                      Mais volume, prioridade e acompanhamento para operações em crescimento.
                    </p>

                    {/* Preço mensal */}
                    <div className="flex items-end gap-1 leading-none">
                      <span className="text-2xl font-bold pb-1.5" style={{ color: 'var(--brand-gold)', fontFamily: 'var(--font-display)' }}>R$</span>
                      <span
                        className="text-6xl font-black leading-none"
                        style={{ color: 'var(--brand-gold)', fontFamily: 'var(--font-display)', textShadow: '0 4px 24px rgba(212, 160, 23, 0.30)' }}
                      >
                        1.497
                      </span>
                      <span className="text-2xl font-bold pb-1.5" style={{ color: 'var(--brand-gold)', fontFamily: 'var(--font-display)' }}>,00</span>
                      <span className="text-base font-semibold pb-2 ml-1" style={{ color: 'rgba(250, 248, 242, 0.70)' }}>/mês</span>
                    </div>
                    <p className="text-xs mt-2" style={{ color: 'rgba(250, 248, 242, 0.65)' }}>
                      + R$ 5.997 de implementação (pagamento único)
                    </p>

                    {/* Highlight 500 conversas */}
                    <div
                      className="mt-5 mb-5 rounded-xl p-3 text-center"
                      style={{ background: 'rgba(250, 248, 242, 0.06)', border: '1px solid rgba(250, 248, 242, 0.14)' }}
                    >
                      <span className="text-lg font-extrabold" style={{ color: 'var(--brand-cream)', fontFamily: 'var(--font-display)' }}>
                        500 conversas/mês
                      </span>
                      <span className="block text-[11px] uppercase tracking-widest mt-0.5" style={{ color: 'rgba(250, 248, 242, 0.70)' }}>
                        incluídas no atendimento com IA
                      </span>
                    </div>

                    {/* Features */}
                    <ul className="space-y-2.5 text-sm flex-1">
                      {[
                        'Pedro, Marcos e José inclusos',
                        'CRM completo + painel ao vivo',
                        'Até 15 conexões de WhatsApp',
                        'Tráfego IA com relatórios avançados',
                        'Mais volume de conversas e recargas menores',
                        'Prioridade de implementação',
                        'Suporte estratégico',
                      ].map((f) => (
                        <li key={f} className="flex items-start gap-2.5">
                          <span
                            className="mt-0.5 shrink-0 rounded-full flex items-center justify-center"
                            style={{ width: 18, height: 18, background: 'rgba(250, 248, 242, 0.12)' }}
                          >
                            <CheckCircle2 className="h-3 w-3" style={{ color: 'var(--brand-cream)' }} />
                          </span>
                          <span style={{ color: 'rgba(250, 248, 242, 0.88)' }}>{f}</span>
                        </li>
                      ))}
                    </ul>

                    {/* CTA — único botão */}
                    <Button
                      asChild
                      size="lg"
                      className="mt-7 w-full text-base font-bold gap-2 py-6 uppercase tracking-wider transition-all hover:translate-y-[-2px]"
                      style={{
                        background: 'transparent',
                        color: 'var(--brand-cream)',
                        border: '2px solid var(--brand-gold)',
                      }}
                    >
                      <a href={PRO_MAX_CONTACT_URL}>
                        Quero o PRO MAX <ArrowRight className="h-5 w-5" strokeWidth={3} />
                      </a>
                    </Button>
                  </div>
                </div>
              </div>

            </div>

            {/* Nota do fundador + microcopy de segurança */}
            <div className="mt-8 text-center">
              <p className="text-sm font-semibold" style={{ color: 'var(--brand-gold)' }}>
                PRO inclui Pedro, Marcos e José. PRO MAX aumenta volume, prioridade e acompanhamento.
              </p>
              <p className="text-xs text-muted-foreground mt-2 flex items-center justify-center gap-1.5">
                <Lock className="h-3 w-3" />
                Ambiente seguro · Liberação em 5 min · Cancele quando quiser
              </p>
            </div>

            {/* Container antigo (escondido — preserva código pro caso de querer voltar) */}
            <div className="hidden">
              {/* Padrão circuito decorativo no canto inferior direito (sutil) */}
              <div
                className="absolute bottom-0 right-0 w-80 h-80 pointer-events-none opacity-[0.08]"
                style={{
                  backgroundImage: `
                    radial-gradient(circle at 1px 1px, var(--brand-gold) 1px, transparent 0),
                    linear-gradient(90deg, transparent 49%, var(--brand-gold) 49%, var(--brand-gold) 51%, transparent 51%)
                  `,
                  backgroundSize: '20px 20px, 40px 40px',
                  backgroundPosition: '0 0, 0 0',
                  maskImage: 'radial-gradient(circle at 100% 100%, black 0%, transparent 70%)',
                  WebkitMaskImage: 'radial-gradient(circle at 100% 100%, black 0%, transparent 70%)',
                }}
              />

              {/* Glow dourado no topo */}
              <div
                className="absolute -top-32 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full blur-3xl pointer-events-none opacity-25"
                style={{ background: 'var(--brand-gold)' }}
              />

              <div className="relative p-6 md:p-12">

                {/* ── LOGO no topo ── */}
                <div className="flex justify-center mb-4">
                  <LogosIALogo size="lg" variant="dark" />
                </div>

                {/* ── BADGE "PLANO PRO" ── */}
                <div className="flex justify-center mb-8 md:mb-10">
                  <div
                    className="inline-flex items-center gap-2 px-6 py-2 rounded-md border-2"
                    style={{
                      borderColor: 'var(--brand-gold)',
                      background: 'rgba(212, 160, 23, 0.05)',
                    }}
                  >
                    <span
                      className="text-base md:text-lg font-bold uppercase tracking-[0.25em]"
                      style={{ color: 'var(--brand-cream)', fontFamily: 'var(--font-display)' }}
                    >
                      Plano
                    </span>
                    <span
                      className="text-base md:text-lg font-extrabold uppercase tracking-[0.25em]"
                      style={{ color: 'var(--brand-gold)', fontFamily: 'var(--font-display)' }}
                    >
                      Pro
                    </span>
                  </div>
                </div>

                {/* ── 2 CARDS DE PREÇO (lado-a-lado com + no meio) ── */}
                <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-6 mb-10 md:mb-14">

                  {/* Card Implementação */}
                  <div className="text-center flex-1 max-w-xs">
                    <p
                      className="text-xs md:text-sm font-semibold uppercase tracking-widest mb-3"
                      style={{ color: 'var(--brand-cream)', opacity: 0.85 }}
                    >
                      Implementação
                    </p>
                    <div className="flex items-end justify-center gap-1 leading-none">
                      <span
                        className="text-2xl md:text-3xl font-bold pb-2"
                        style={{ color: 'var(--brand-gold)', fontFamily: 'var(--font-display)' }}
                      >
                        R$
                      </span>
                      <span
                        className="text-5xl md:text-7xl font-black leading-none"
                        style={{
                          color: 'var(--brand-gold)',
                          fontFamily: 'var(--font-display)',
                          textShadow: '0 4px 24px rgba(212, 160, 23, 0.40)',
                        }}
                      >
                        1.497
                      </span>
                    </div>
                    <p
                      className="text-xs md:text-sm font-semibold uppercase tracking-widest mt-3"
                      style={{ color: 'var(--brand-cream)', opacity: 0.70 }}
                    >
                      Pagamento Único
                    </p>
                  </div>

                  {/* Símbolo + (botão circular) */}
                  <div
                    className="w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center shrink-0 my-2 md:my-0"
                    style={{
                      border: '2px solid var(--brand-gold)',
                      background: 'rgba(212, 160, 23, 0.10)',
                    }}
                  >
                    <Plus className="h-6 w-6 md:h-7 md:w-7" style={{ color: 'var(--brand-gold)' }} strokeWidth={3} />
                  </div>

                  {/* Card Mensalidade */}
                  <div className="text-center flex-1 max-w-xs">
                    <p
                      className="text-xs md:text-sm font-semibold uppercase tracking-widest mb-3"
                      style={{ color: 'var(--brand-cream)', opacity: 0.85 }}
                    >
                      Mensalidade
                    </p>
                    <div className="flex items-end justify-center gap-1 leading-none">
                      <span
                        className="text-2xl md:text-3xl font-bold pb-2"
                        style={{ color: 'var(--brand-gold)', fontFamily: 'var(--font-display)' }}
                      >
                        R$
                      </span>
                      <span
                        className="text-5xl md:text-7xl font-black leading-none"
                        style={{
                          color: 'var(--brand-gold)',
                          fontFamily: 'var(--font-display)',
                          textShadow: '0 4px 24px rgba(212, 160, 23, 0.40)',
                        }}
                      >
                        497
                      </span>
                    </div>
                    <p
                      className="text-xs md:text-sm font-semibold uppercase tracking-widest mt-3"
                      style={{ color: 'var(--brand-cream)', opacity: 0.70 }}
                    >
                      Cobrado Mensalmente
                    </p>
                  </div>
                </div>

                {/* ── DIVISOR "RECURSOS INCLUSOS" ── */}
                <div className="flex items-center gap-3 md:gap-4 mb-8 md:mb-10">
                  <div className="flex-1 h-px" style={{ background: 'rgba(212, 160, 23, 0.30)' }} />
                  <span
                    className="text-xs md:text-sm font-bold uppercase tracking-[0.25em] shrink-0"
                    style={{ color: 'var(--brand-cream)', opacity: 0.80 }}
                  >
                    Recursos Inclusos
                  </span>
                  <div className="flex-1 h-px" style={{ background: 'rgba(212, 160, 23, 0.30)' }} />
                </div>

                {/* ── GRID 8 FEATURES (2 colunas) ── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 md:gap-x-10 gap-y-6 mb-10 md:mb-12">
                  {[
                    {
                      Icon: Users,
                      title: 'CRM Completo',
                      desc: 'Organize, gerencie e escale seu relacionamento com leads.',
                    },
                    {
                      Icon: Phone,
                      title: 'Conexão de até 10 WhatsApp',
                      desc: 'Gerencie múltiplos atendimentos em um só lugar.',
                    },
                    {
                      Icon: Send,
                      title: 'Disparo em massa',
                      desc: 'Envie mensagens em massa com segmentação avançada.',
                    },
                    {
                      Icon: Database,
                      title: '300 conversas/mês inclusas',
                      desc: 'Mais inteligência, mais automações e mais resultados.',
                    },
                    {
                      Icon: TrendingUp,
                      title: 'Follow-up automático',
                      desc: 'Automatize acompanhamentos e nunca mais perca vendas.',
                    },
                    {
                      Icon: Brain,
                      title: 'Inteligência artificial',
                      desc: 'Atendimento inteligente, respostas automáticas e muito mais.',
                    },
                    {
                      Icon: FileText,
                      title: 'Exportação de planilhas',
                      desc: 'Exporte seus dados e relatórios sempre que precisar.',
                    },
                    {
                      Icon: ShieldCheck,
                      title: 'Suporte prioritário',
                      desc: 'Suporte dedicado para te ajudar sempre que precisar.',
                    },
                  ].map((feat) => (
                    <div key={feat.title} className="flex items-start gap-3 md:gap-4">
                      {/* Ícone em círculo dourado */}
                      <div
                        className="w-11 h-11 md:w-12 md:h-12 rounded-full flex items-center justify-center shrink-0"
                        style={{
                          border: '2px solid var(--brand-gold)',
                          background: 'rgba(212, 160, 23, 0.08)',
                        }}
                      >
                        <feat.Icon className="h-5 w-5 md:h-5.5 md:w-5.5" style={{ color: 'var(--brand-gold)' }} strokeWidth={2} />
                      </div>
                      {/* Texto */}
                      <div className="flex-1 min-w-0 pt-0.5">
                        <h4
                          className="text-sm md:text-base font-bold uppercase tracking-wider mb-1 leading-tight"
                          style={{ color: 'var(--brand-gold)', fontFamily: 'var(--font-display)' }}
                        >
                          {feat.title}
                        </h4>
                        <p className="text-xs md:text-sm leading-relaxed" style={{ color: 'var(--brand-cream)', opacity: 0.85 }}>
                          {feat.desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* ── 3 HIGHLIGHTS BOTTOM (Tokens / Conexões / Segurança) ── */}
                <div
                  className="rounded-2xl p-5 md:p-6 mb-8 md:mb-10"
                  style={{
                    border: '1px solid var(--brand-gold)',
                    background: 'rgba(212, 160, 23, 0.05)',
                  }}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 md:gap-4">
                    {[
                      { Icon: Users, top: '300', bottom: 'CONVERSAS / MÊS' },
                      { Icon: Phone, top: 'ATÉ 10', bottom: 'CONEXÕES DE WHATSAPP' },
                      { Icon: ShieldCheck, top: 'SEGURANÇA', bottom: 'E DADOS PROTEGIDOS' },
                    ].map((h, i) => (
                      <div key={i} className="flex items-center gap-3 justify-center sm:justify-start">
                        <div
                          className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
                          style={{
                            border: '2px solid var(--brand-gold)',
                            background: 'rgba(212, 160, 23, 0.10)',
                          }}
                        >
                          <h.Icon className="h-5 w-5" style={{ color: 'var(--brand-gold)' }} strokeWidth={2.5} />
                        </div>
                        <div>
                          <p
                            className="text-base md:text-lg font-extrabold uppercase tracking-wide leading-none"
                            style={{ color: 'var(--brand-gold)', fontFamily: 'var(--font-display)' }}
                          >
                            {h.top}
                          </p>
                          <p
                            className="text-[10px] md:text-xs font-semibold uppercase tracking-widest mt-1"
                            style={{ color: 'var(--brand-cream)', opacity: 0.80 }}
                          >
                            {h.bottom}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── CTA GIGANTE ── */}
                <Button
                  asChild
                  size="lg"
                  className="w-full text-lg md:text-xl font-extrabold gap-3 py-7 md:py-8 transition-all hover:translate-y-[-2px] uppercase tracking-wider"
                  style={{
                    background: 'linear-gradient(135deg, var(--brand-gold-hover) 0%, var(--brand-gold) 50%, var(--brand-gold-light) 100%)',
                    color: 'var(--brand-navy)',
                    boxShadow: '0 12px 32px rgba(212, 160, 23, 0.50), inset 0 -3px 0 rgba(0,0,0,0.20)',
                    border: '2px solid var(--brand-gold-hover)',
                  }}
                >
                  <Link to={PRO_CHECKOUT_URL}>
                    Quero Começar Agora <ArrowRight className="h-6 w-6" strokeWidth={3} />
                  </Link>
                </Button>

                {/* ── Microcopy de segurança ── */}
                <p
                  className="text-center text-xs md:text-sm font-medium mt-5 flex items-center justify-center gap-2"
                  style={{ color: 'var(--brand-cream)', opacity: 0.70 }}
                >
                  <Lock className="h-3.5 w-3.5" style={{ color: 'var(--brand-gold)' }} />
                  Ambiente seguro e 100% confiável
                </p>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ── DEPOIMENTOS ────────────────────────────────────────────── */}
      <section className="px-4 md:px-6 py-16 md:py-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary">Resultados Reais</Badge>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4">Quem já usa a Logos IA</h2>
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
      <section id="faq" className="px-4 md:px-6 py-16 md:py-20 bg-card/30">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary">FAQ</Badge>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4">Perguntas frequentes</h2>
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

      {/* ── CTA FINAL (Prompt 9 — redesign 16/05) ─────────────────────── */}
      <section
        className="relative px-4 md:px-6 py-20 md:py-28 overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, var(--brand-navy) 0%, var(--brand-navy-light) 100%)',
        }}
      >
        {/* Glow gold de fundo */}
        <div
          className="absolute -top-20 left-1/2 -translate-x-1/2 w-[40rem] h-[40rem] rounded-full blur-3xl pointer-events-none opacity-20"
          style={{ background: 'var(--brand-gold)' }}
        />
        <div
          className="absolute -bottom-20 -left-20 w-96 h-96 rounded-full blur-3xl pointer-events-none opacity-15"
          style={{ background: 'var(--brand-gold)' }}
        />

        <div className="relative max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div
            className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium mb-8"
            style={{
              borderColor: 'var(--brand-gold)',
              background: 'rgba(212, 160, 23, 0.10)',
              color: 'var(--brand-gold)',
            }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Comece hoje mesmo
          </div>

          {/* Título */}
          <h2
            className="text-3xl sm:text-4xl md:text-6xl font-extrabold leading-[1.1] mb-6"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--brand-cream)' }}
          >
            Pare de perder lead{' '}
            <span style={{ color: 'var(--brand-gold)' }}>enquanto você dorme</span>.
          </h2>

          {/* Subtítulo */}
          <p className="text-base md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed" style={{ color: 'rgba(250, 248, 242, 0.80)' }}>
            <strong style={{ color: 'var(--brand-cream)' }}>Pedro, Marcos e José</strong> começam a trabalhar hoje.
            Você só precisa decidir parar de fazer o que uma IA pode fazer melhor.
          </p>

          {/* CTA */}
          <Button
            asChild
            size="lg"
            className="px-10 text-base md:text-lg font-bold gap-2 py-6 transition-all hover:translate-y-[-2px]"
            style={{
              background: 'var(--brand-gold)',
              color: 'var(--brand-navy)',
              boxShadow: 'var(--shadow-gold)',
            }}
          >
            <Link to={PRO_CHECKOUT_URL}>
              Assinar PRO agora <ArrowRight className="h-5 w-5" />
            </Link>
          </Button>

          {/* Microcopy */}
          <p className="text-sm mt-5" style={{ color: 'rgba(250, 248, 242, 0.65)' }}>
            <CheckCircle2 className="inline-block h-3.5 w-3.5 mr-1.5" style={{ color: 'var(--brand-gold)' }} />
            Liberação em até 5 minutos. Sem fidelidade.
          </p>
        </div>
      </section>

      {/* ── FOOTER (Prompt 9 — redesign 16/05) ─────────────────────────── */}
      <footer
        className="px-4 md:px-6 pt-12 pb-6"
        style={{ background: 'var(--brand-navy-dark)', color: 'var(--brand-cream)' }}
      >
        <div className="max-w-6xl mx-auto">

          {/* Grid 4 colunas */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-10 pb-10">

            {/* Coluna 1 — Marca (Prompt redesign 16/05 — logo dark pra fundo navy) */}
            <div className="col-span-2 md:col-span-1">
              <div className="mb-3">
                <LogosIALogo size="md" variant="dark" />
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'rgba(250, 248, 242, 0.65)' }}>
                Atendimento, CRM e tráfego IA pra quem vive de WhatsApp.
              </p>
            </div>

            {/* Coluna 2 — Produto */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--brand-gold)' }}>
                Produto
              </h4>
              <ul className="space-y-2.5 text-sm">
                <li><a href="#agente-pedro" className="opacity-80 hover:opacity-100 transition-opacity">Agente Pedro</a></li>
                <li><a href="#agente-marcos" className="opacity-80 hover:opacity-100 transition-opacity">Agente Marcos</a></li>
                <li><a href="#em-breve" className="opacity-80 hover:opacity-100 transition-opacity">Agentes</a></li>
                <li><a href="#planos" className="opacity-80 hover:opacity-100 transition-opacity">Preço</a></li>
              </ul>
            </div>

            {/* Coluna 3 — Empresa */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--brand-gold)' }}>
                Empresa
              </h4>
              <ul className="space-y-2.5 text-sm">
                <li><a href="#como-funciona" className="opacity-80 hover:opacity-100 transition-opacity">Como funciona</a></li>
                <li><a href="#faq" className="opacity-80 hover:opacity-100 transition-opacity">FAQ</a></li>
                <li><a href="mailto:suporte@logosiabrasil.com" className="opacity-80 hover:opacity-100 transition-opacity">Contato</a></li>
                <li><Link to="/auth" className="opacity-80 hover:opacity-100 transition-opacity">Login</Link></li>
              </ul>
            </div>

            {/* Coluna 4 — Legal */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--brand-gold)' }}>
                Legal
              </h4>
              <ul className="space-y-2.5 text-sm">
                <li><a href="/privacy-policy.html" className="opacity-80 hover:opacity-100 transition-opacity">Privacidade</a></li>
                <li><a href="/terms-of-service.html" className="opacity-80 hover:opacity-100 transition-opacity">Termos de Uso</a></li>
                <li><span className="opacity-60 text-xs">LGPD: dados tratados conforme lei brasileira</span></li>
              </ul>
            </div>

          </div>

          {/* Bottom bar */}
          <div className="pt-6" style={{ borderTop: '1px solid rgba(250, 248, 242, 0.10)' }}>
            <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">

              {/* Identidade da empresa + CNPJ — visivel pra conformidade legal/Meta */}
              <p className="text-xs leading-relaxed" style={{ color: 'rgba(250, 248, 242, 0.80)' }}>
                <span className="font-semibold" style={{ color: 'var(--brand-cream)' }}>Agencia Up Business LTDA</span>
                <span className="opacity-75">&nbsp;·&nbsp;CNPJ 45.660.833/0001-17&nbsp;·&nbsp;Taubaté/SP</span>
              </p>

              {/* Copyright + links legais + selo — mesma secao/fonte */}
              <div
                className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs sm:justify-end"
                style={{ color: 'rgba(250, 248, 242, 0.60)' }}
              >
                <span>© {new Date().getFullYear()} LOGOS|IA</span>
                <span className="opacity-40">·</span>
                <a href="/privacy-policy.html" className="opacity-85 hover:opacity-100 transition-opacity">Política de Privacidade</a>
                <span className="opacity-40">·</span>
                <a href="/terms-of-service.html" className="opacity-85 hover:opacity-100 transition-opacity">Termos de Uso</a>
                <span className="opacity-40">·</span>
                <span>Feito no Brasil 🇧🇷</span>
              </div>
            </div>
          </div>

        </div>
      </footer>
    </div>
  );
}
