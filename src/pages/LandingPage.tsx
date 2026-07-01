import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { MarketingHeader } from '@/components/marketing/MarketingHeader';
import { MarketingFooter } from '@/components/marketing/MarketingFooter';
import {
  ArrowRight, Play, Clock, Wallet, Zap, TrendingUp,
  MessageSquare, Database, Target, Phone, Mail, Check,
} from 'lucide-react';

// ── Home = RESUMO EXECUTIVO (redesign 20/06) ─────────────────────────────────
// Enxuta, mobile-first, vídeo no topo. Conteúdo técnico de cada agente vive em
// /pedro, /marcos, /jose. CTA primario = checkout de pagamento.

const DISPLAY = { fontFamily: 'var(--font-display)' } as const;

const AGENTS = [
  {
    nome: 'Pedro', tagline: 'o vendedor que nunca perde um lead.', to: '/agentes/pedro', Icon: MessageSquare,
    cor: '#16A34A', bg: 'rgba(22, 163, 74, 0.10)',
    desc: 'Responde no WhatsApp em segundos, qualifica o cliente, consulta o estoque e entrega o lead pronto pro seu time. Não esquece ninguém, não dorme, não some no fim de semana.',
    link: 'Ver como o Pedro vende',
  },
  {
    nome: 'Marcos', tagline: 'o CRM que protege o seu número.', to: '/agentes/marcos', Icon: Database,
    cor: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.10)',
    desc: 'Organiza seus contatos, dispara campanhas em massa e cuida da saúde do seu WhatsApp pra você não cair no banimento. Sua base inteira trabalhando a seu favor, sem dor de cabeça.',
    link: 'Como o Marcos protege seu número',
  },
  {
    nome: 'José', tagline: 'o gestor de tráfego que pensa como dono.', to: '/agentes/jose', Icon: Target,
    cor: '#E65100', bg: 'rgba(230, 81, 0, 0.10)',
    desc: 'Cria, analisa e otimiza campanhas no Meta e no Google. Decide pelo que importa: venda no fim do mês, não clique barato. Você aprova, ele executa.',
    link: 'Ver o José em ação',
  },
];

const BENEFITS = [
  { Icon: Clock, t: '24/7, inclusive feriado.', d: 'Seu marketing nunca tira folga.' },
  { Icon: Wallet, t: 'Custo previsível.', d: 'Sem encargos, sem CLT, sem rotatividade.' },
  { Icon: Zap, t: 'Pronto em minutos, não em meses.', d: '' },
  { Icon: TrendingUp, t: 'Otimização por venda real,', d: 'não por métrica de vaidade.' },
];

const COST_ROWS: [string, string, string][] = [
  ['Equipe', 'Gestor + social + atendente', 'Agentes de IA'],
  ['Disponibilidade', 'Horário comercial', '24/7'],
  ['Resposta ao lead', 'Minutos a horas', 'Segundos'],
  ['Implementação', 'Semanas', '5 minutos'],
  ['Férias, falta, rotatividade', 'Sim', 'Nunca'],
];

// Planos COM preço (repostos 24/06 — valores do último estado com preço, commit 86c3b02).
// Botao dos planos abre o checkout seguro de pagamento.
const PLANS = [
  {
    id: 'basico',
    checkout: '/checkout?plano=basico&ciclo=mensal',
    badge: 'Plano de entrada',
    nome: 'Básico',
    tagline: 'Comece com o Pedro atendendo e qualificando seus leads no WhatsApp.',
    price: '497', cents: ',00',
    priceNote: '+ R$ 1.500 de implementação (pagamento único)',
    destaque: '1 agente incluso',
    destaqueSub: 'Pedro SDR no atendimento com IA',
    features: [
      'Agente Pedro incluso',
      'Trabalha com 1 agente de IA',
      'Até 5 instâncias de WhatsApp conectadas',
      'CRM completo de leads',
      'Qualificação automática no WhatsApp',
      'Follow-up automático 24/7',
      'Suporte por e-mail',
    ],
    cta: 'Quero o Básico',
    featured: false,
  },
  {
    id: 'pro',
    checkout: '/checkout?plano=pro&ciclo=mensal',
    badge: 'Mais popular',
    nome: 'Pro',
    tagline: 'Pedro qualifica, Marcos organiza e José mostra onde seu tráfego está perdendo dinheiro.',
    price: '497', cents: ',90',
    priceNote: 'Promoção fundador por 3 meses. Depois, R$ 797,90/mês.',
    setupNote: 'Implementação: R$ 1.997,90 por R$ 1.497,90 (única)',
    destaque: '3 agentes inclusos',
    destaqueSub: 'Pedro + Marcos + José trabalhando juntos',
    features: [
      'Agentes Pedro, Marcos e José inclusos',
      'CRM completo de leads',
      'Até 10 conexões de WhatsApp',
      'Disparo em massa segmentado',
      'Follow-up automático 24/7',
      'José analisa campanhas e aponta o que pausar ou escalar',
      'Conversas ilimitadas com sua própria chave de IA',
      'Exportação de planilhas e relatórios',
      'Suporte prioritário',
    ],
    cta: 'Quero o Pro',
    featured: true,
  },
  {
    id: 'promax',
    checkout: '/checkout?plano=enterprise&ciclo=mensal', // Pro Max = enterprise no checkout
    badge: 'Operação completa',
    nome: 'Pro Max',
    tagline: 'Tudo do Pro, dimensionado para empresas com mais clientes e mais operação.',
    price: '797', cents: ',90',
    priceNote: 'Promoção fundador por 3 meses. Depois, R$ 1.297,90/mês.',
    setupNote: 'Implementação: R$ 1.997,90 por R$ 1.497,90 (única)',
    destaque: 'Todos os agentes liberados',
    destaqueSub: 'inclui José e a operação completa',
    features: [
      'Tudo do plano Pro',
      'Todos os agentes de IA liberados',
      'Agente José para tráfego IA',
      'Até 15 números de WhatsApp',
      'Maior capacidade de atendimento',
      'Todas as integrações liberadas',
      'Acompanhamento das conversas da equipe',
      'Onboarding e suporte VIP',
    ],
    cta: 'Quero o Pro Max',
    featured: false,
  },
];

export default function LandingPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const goToPlans = () => document.getElementById('planos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (!loading && user) return <Navigate to="/tela-inicial" replace />;

  return (
    <div className="min-h-screen bg-background pb-24 text-foreground overflow-x-hidden md:pb-0">
      <MarketingHeader
        onCta={goToPlans}
        ctaLabel="Conheça nossos planos"
        navItems={[
          { href: '#demo', label: 'Por dentro' },
          { href: '#agentes', label: 'Agentes' },
          { href: '#planos', label: 'Planos' },
          { href: '#custo', label: 'Comparativo' },
          { href: '#implementacao', label: 'Como funciona' },
        ]}
      />

      {/* ── HERO + VÍDEO ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border/40 bg-card/25 px-4 pb-12 pt-10 md:px-6 md:pb-16 md:pt-16">
        <div className="relative max-w-4xl mx-auto text-center">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold leading-[1.12] mb-4" style={DISPLAY}>
            A primeira equipe de marketing 100% movida por IA — <span style={{ color: 'var(--brand-gold)' }}>trabalhando pelo seu negócio agora.</span>
          </h1>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto mb-7">
            Tráfego pago, criativos, CRM e atendimento no WhatsApp, cuidados por agentes de IA que não dormem, não faltam e custam uma fração de uma equipe tradicional.
          </p>

          {/* Vídeo em destaque central */}
          <div id="demo" className="relative mx-auto max-w-3xl overflow-hidden rounded-2xl border-2"
            style={{ borderColor: 'rgba(212, 160, 23, 0.35)', boxShadow: '0 28px 80px -28px rgba(15, 38, 71, 0.65)' }}>
            <div className="aspect-video w-full bg-black">
              <iframe
                className="h-full w-full"
                src="https://www.youtube.com/embed/CnX93PWOv8U"
                title="Logos IA em ação"
                frameBorder="0"
                allow="accelerated-encoding; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
                loading="lazy"
              />
            </div>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a href="#demo" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              <Play className="h-4 w-4" style={{ color: 'var(--brand-gold)' }} /> Veja como funciona em 90 segundos
            </a>
            <Button size="lg" onClick={goToPlans} className="bg-primary text-primary-foreground hover:bg-primary/90 px-6">
              Conheça nossos planos <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── FAIXA DE BENEFÍCIOS ──────────────────────────────────── */}
      <section className="px-4 md:px-6 py-8 bg-card/30 border-y border-border/40">
        <div className="max-w-5xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-4">
          {BENEFITS.map(b => (
            <div key={b.t} className="flex items-start gap-3">
              <b.Icon className="h-5 w-5 shrink-0 mt-0.5" style={{ color: 'var(--brand-gold)' }} />
              <p className="text-sm leading-snug"><span className="font-semibold text-foreground">{b.t}</span>{b.d ? <span className="text-muted-foreground"> {b.d}</span> : null}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CONHEÇA SEUS AGENTES ─────────────────────────────────── */}
      <section id="agentes" className="px-4 md:px-6 py-14 md:py-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3" style={DISPLAY}>Conheça seus agentes</h2>
            <p className="text-muted-foreground">
              Cada agente cuida de uma parte do seu marketing. Juntos, funcionam como uma agência inteira — só que dentro do seu negócio.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
            {AGENTS.map(a => (
              <div key={a.nome} className="rounded-2xl border border-foreground/10 bg-card p-6 flex flex-col transition-all hover:-translate-y-1 hover:shadow-lg">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl mb-4" style={{ background: a.bg }}>
                  <a.Icon className="h-6 w-6" style={{ color: a.cor }} />
                </div>
                <h3 className="text-lg font-bold mb-1" style={DISPLAY}>
                  <span style={{ color: a.cor }}>{a.nome}</span> — {a.tagline}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed flex-1 mb-4">{a.desc}</p>
                <Link to={a.to} className="inline-flex items-center gap-1.5 text-sm font-semibold hover:gap-2.5 transition-all" style={{ color: a.cor }}>
                  {a.link} <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ))}
          </div>

          <p className="text-center text-sm text-muted-foreground italic mt-8">
            E novos agentes a caminho: criativos, copy, e-mail e funil de vendas.
          </p>
        </div>
      </section>

      {/* ── COMPARATIVO DE CUSTO ─────────────────────────────────── */}
      <section id="custo" className="px-4 md:px-6 py-14 md:py-20 bg-card/30 border-y border-border/40">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center mb-8" style={DISPLAY}>
            Quanto custa <span style={{ color: 'var(--brand-gold)' }}>não</span> ter a Logos IA?
          </h2>

          {/* Tabela (desktop) */}
          <div className="hidden sm:block overflow-hidden rounded-2xl border border-border/60">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--brand-navy)', color: 'var(--brand-cream)' }}>
                  <th className="text-left font-semibold px-4 py-3"></th>
                  <th className="text-left font-semibold px-4 py-3">Modelo tradicional</th>
                  <th className="text-left font-semibold px-4 py-3">Logos IA</th>
                </tr>
              </thead>
              <tbody>
                {COST_ROWS.map((r, i) => (
                  <tr key={r[0]} className={i % 2 ? 'bg-background' : 'bg-card/40'}>
                    <td className="px-4 py-3 font-medium text-foreground">{r[0]}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r[1]}</td>
                    <td className="px-4 py-3 font-semibold" style={{ color: 'var(--brand-gold)' }}>{r[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards empilhados (mobile) */}
          <div className="sm:hidden space-y-3">
            {COST_ROWS.map(r => (
              <div key={r[0]} className="rounded-xl border border-border/60 bg-card p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">{r[0]}</p>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{r[1]}</span>
                  <span className="font-semibold text-right" style={{ color: 'var(--brand-gold)' }}>{r[2]}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-8">
            <Button size="lg" onClick={goToPlans} className="bg-primary text-primary-foreground hover:bg-primary/90 px-6">
              Faça as contas: quanto te custa cada lead hoje? <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── NO AR EM 5 MINUTOS ───────────────────────────────────── */}
      <section id="implementacao" className="px-4 md:px-6 py-14 md:py-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center mb-10" style={DISPLAY}>No ar em 5 minutos</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { n: '1', t: 'Conecte', d: 'seu WhatsApp e suas contas de anúncio.' },
              { n: '2', t: 'Escolha', d: 'os agentes que vão trabalhar pra você.' },
              { n: '3', t: 'Pronto.', d: 'Seu marketing já está no ar.' },
            ].map(s => (
              <div key={s.n} className="rounded-2xl border border-foreground/10 bg-card p-6 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full text-lg font-bold"
                  style={{ background: 'var(--brand-gold)', color: 'var(--brand-navy-dark)' }}>{s.n}</div>
                <p className="text-base"><span className="font-bold text-foreground" style={DISPLAY}>{s.t}</span> <span className="text-muted-foreground">{s.d}</span></p>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground italic mt-7">Sem instalação, sem técnico, sem espera.</p>
        </div>
      </section>

      {/* ── PLANOS (só features; sem preço — Wander fecha por WhatsApp) ─────── */}
      <section id="planos" className="px-4 md:px-6 py-14 md:py-20 bg-card/30 border-y border-border/40">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3" style={DISPLAY}>Escolha seu plano</h2>
            <p className="text-muted-foreground">
              Três jeitos de começar. Apertou o botão, falo com você no WhatsApp pra te explicar tudo e marcar uma reunião.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6 items-stretch">
            {PLANS.map((p) => (
              <div
                key={p.id}
                className={`relative rounded-2xl p-6 md:p-7 flex flex-col bg-card transition-all ${p.featured ? 'border-2 md:scale-[1.02]' : 'border border-foreground/10'}`}
                style={p.featured ? { borderColor: 'var(--brand-gold)', boxShadow: '0 0 40px rgba(212, 160, 23, 0.18)' } : undefined}
              >
                {p.featured && (
                  <span
                    className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                    style={{ background: 'var(--brand-gold)', color: 'var(--brand-navy-dark)' }}
                  >
                    {p.badge}
                  </span>
                )}
                {!p.featured && (
                  <span className="self-start mb-3 inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border border-border/60 text-muted-foreground">
                    {p.badge}
                  </span>
                )}

                <h3 className="text-2xl font-extrabold mb-1" style={DISPLAY}>{p.nome}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">{p.tagline}</p>

                <div className="mb-5">
                  <div className="flex items-end gap-0.5">
                    <span className="text-sm font-semibold text-muted-foreground pb-1.5">R$</span>
                    <span className="text-4xl font-extrabold text-foreground" style={DISPLAY}>{p.price}</span>
                    <span className="text-2xl font-extrabold text-foreground" style={DISPLAY}>{p.cents}</span>
                    <span className="text-sm font-semibold text-muted-foreground pb-1.5 ml-1">/mês</span>
                  </div>
                  {p.priceNote && <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{p.priceNote}</p>}
                  {p.setupNote && <p className="text-xs text-muted-foreground/80 mt-1 leading-snug">{p.setupNote}</p>}
                </div>

                <div className="rounded-xl border border-foreground/10 bg-background/60 p-3 mb-5">
                  <p className="text-sm font-bold text-foreground" style={DISPLAY}>{p.destaque}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.destaqueSub}</p>
                </div>

                <ul className="space-y-2.5 mb-6 flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="h-4 w-4 shrink-0 mt-0.5" style={{ color: 'var(--brand-gold)' }} />
                      <span className="text-foreground/90 leading-snug">{f}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  size="lg"
                  onClick={() => navigate(p.checkout)}
                  className={p.featured
                    ? 'w-full text-base'
                    : 'w-full bg-primary text-primary-foreground hover:bg-primary/90'}
                  style={p.featured ? { background: 'var(--brand-gold)', color: 'var(--brand-navy-dark)' } : undefined}
                >
                  {p.cta} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-8">
            Condições finais e formas de pagamento a gente alinha direto no WhatsApp, ajustado ao seu cenário.
          </p>
        </div>
      </section>

      {/* ── CHAMADA FINAL ────────────────────────────────────────── */}
      <section className="px-4 md:px-6 py-16 md:py-24" style={{ background: 'var(--brand-navy)', color: 'var(--brand-cream)' }}>
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4" style={DISPLAY}>
            Sua concorrência já responde leads em segundos. E você?
          </h2>
          <p className="text-base md:text-lg mb-8" style={{ color: 'rgba(250, 248, 242, 0.85)' }}>
            Coloque a Logos IA pra trabalhar hoje. No ar em 5 minutos.
          </p>
          <Button size="lg" onClick={goToPlans} className="px-7 text-base"
            style={{ background: 'var(--brand-gold)', color: 'var(--brand-navy-dark)' }}>
            Conheça nossos planos <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-x-6 gap-y-2 text-sm" style={{ color: 'rgba(250, 248, 242, 0.80)' }}>
            <a href="https://wa.me/5534999080815" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:opacity-100 opacity-90">
              <Phone className="h-4 w-4" /> WhatsApp +55 (34) 99908-0815
            </a>
            <a href="mailto:suporte@logosiabrasil.com" className="inline-flex items-center gap-2 hover:opacity-100 opacity-90">
              <Mail className="h-4 w-4" /> suporte@logosiabrasil.com
            </a>
          </div>
        </div>
      </section>

      <MarketingFooter />

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 p-3 shadow-2xl backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-muted-foreground">Pedro + Marcos + José</p>
            <p className="truncate text-sm font-bold text-foreground">Equipe de IA no ar em 5 minutos</p>
          </div>
          <Button
            onClick={goToPlans}
            className="shrink-0 bg-primary px-4 text-primary-foreground hover:bg-primary/90"
          >
            Planos
          </Button>
        </div>
      </div>
    </div>
  );
}
