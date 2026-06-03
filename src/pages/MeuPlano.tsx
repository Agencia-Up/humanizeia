import { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Zap, TrendingUp, CheckCircle2, XCircle, CreditCard, AlertTriangle,
  RefreshCcw, Star, Clock, BarChart3, Info,
  Bot, PenTool, Instagram, Mail, Brain, Target, ChevronLeft, Coins,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useSubscription, PLANS, ATENDIMENTO_PACKAGES, type PlanId } from '@/hooks/useSubscription';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { supabase } from '@/integrations/supabase/client';
import RecargaDialog from '@/components/subscription/RecargaDialog';

/* ── helpers ────────────────────────────────────────────────────────── */
function fmt(n: number) { return n.toLocaleString('pt-BR'); }
function fmtR(n: number) { return `R$ ${n.toFixed(2).replace('.', ',')}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
// 'YYYY-MM-DD' -> 'DD/MM' sem deslocar o dia por fuso (ancorando ao meio-dia).
function fmtDia(iso?: string | null) {
  if (!iso) return '--';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

const AGENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  davi: Instagram,
  joao: Mail,
  daniel: Brain,
  copywriter: PenTool,
  trafego: Target,
  default: Bot,
};

const AGENT_COLORS: Record<string, string> = {
  davi: 'text-pink-400',
  joao: 'text-green-400',
  daniel: 'text-yellow-400',
  copywriter: 'text-purple-400',
  trafego: 'text-blue-400',
  default: 'text-muted-foreground',
};

/* ── daily usage chart data ─────────────────────────────────────────── */
function buildChartData(transactions: any[]) {
  const days: Record<string, { date: string; consumo: number; recarga: number }> = {};
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    days[key] = { date: key, consumo: 0, recarga: 0 };
  }
  transactions.forEach((tx) => {
    const key = new Date(tx.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    if (days[key]) {
      if (tx.amount < 0) days[key].consumo += Math.abs(tx.amount);
      else days[key].recarga += tx.amount;
    }
  });
  return Object.values(days);
}

/* ── Plan comparison card ───────────────────────────────────────────── */
const PLAN_FEATURES: Record<PlanId, string[]> = {
  basico: [
    '🤖 Agente Pedro (SDR & IA)',
    'Área de membros / treinamento',
    '150 atendimentos/mês',
    'Até 5 instâncias de WhatsApp',
    'Dashboard básico',
    'Configurações essenciais',
    'Suporte via WhatsApp',
  ],
  pro: [
    '🤖 Agente Pedro (SDR & IA)',
    '🤝 Agente Marcos (CRM & WhatsApp)',
    '🎯 Agente José (Tráfego Pago)',
    'Área de membros / treinamento',
    '300 atendimentos/mês',
    'Até 10 instâncias de WhatsApp',
    'Dashboard avançado com métricas',
    'CRM de leads integrado',
    'Disparo em massa WhatsApp',
    'Gestão de Meta Ads e Google Ads',
    'Suporte prioritário',
  ],
  enterprise: [
    '🤖 Todos os 9 agentes IA liberados',
    'Pedro, Marcos, José, Paulo, Maria',
    'Davi, João, Daniel, Salomão',
    'Área de membros / treinamento',
    '500 atendimentos/mês',
    'Até 15 instâncias de WhatsApp',
    'Copywriting IA (Paulo)',
    'Design criativo IA (Maria)',
    'Social Media IA (Davi)',
    'Email Marketing IA (João)',
    'Estratégia de negócio (Daniel)',
    'Orquestrador central (Salomão)',
    'Suporte SLA + gerente exclusivo',
    'Consultoria estratégica',
  ],
};

/* ════════════════════════════════════════════════════════════════════ */
export default function MeuPlano() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    subscription, transactions, loading, error, refetch,
    tokensAvailable, tokensTotal, usagePercent,
    planInfo, upgradePlan,
  } = useSubscription();
  const { user } = useAuth();
  const { isSeller, loading: sellerLoading } = useSellerProfile(user?.id);

  const [tab, setTab] = useState<'overview' | 'upgrade' | 'recharge'>('overview');
  const [upgradingPlan, setUpgradingPlan] = useState<PlanId | null>(null);

  // Recarga: dialog de pagamento + cartao salvo (1-clique).
  const [recargaPkg, setRecargaPkg] = useState<{ atendimentos: number; price: number } | null>(null);
  const [savedCard, setSavedCard] = useState<{ last4: string | null; brand: string | null } | null>(null);
  useEffect(() => {
    if (!user) { setSavedCard(null); return; }
    let alive = true;
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from('profiles')
          .select('asaas_card_last4, asaas_card_brand')
          .eq('id', user.id)
          .maybeSingle();
        if (!alive) return;
        setSavedCard(data?.asaas_card_last4 ? { last4: data.asaas_card_last4, brand: data.asaas_card_brand } : null);
      } catch {
        if (alive) setSavedCard(null);
      }
    })();
    return () => { alive = false; };
  }, [user]);

  // Custo das conversas (IA) do PROPRIO cliente, ja com a margem aplicada no
  // servidor. A RPC e SECURITY DEFINER e so devolve o que e do auth.uid() —
  // nunca o custo real nem o markup.
  const [custo, setCusto] = useState<any>(null);
  const [custoLoading, setCustoLoading] = useState(true);
  useEffect(() => {
    if (!user) { setCusto(null); setCustoLoading(false); return; }
    let alive = true;
    (async () => {
      setCustoLoading(true);
      try {
        const { data, error: rpcErr } = await (supabase as any).rpc('cliente_meu_custo_overview');
        if (!alive) return;
        setCusto(rpcErr ? null : data);
      } catch {
        if (alive) setCusto(null);
      } finally {
        if (alive) setCustoLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [user]);

  if (loading || sellerLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <RefreshCcw className="h-5 w-5 animate-spin mr-2" /> Carregando plano...
      </div>
    );
  }

  // Vendedor (conta vinculada) nao tem plano proprio: a IA e o credito vivem na
  // conta master. Se cair aqui por URL direta (a opcao do menu ja fica oculta),
  // manda de volta pro dashboard.
  if (isSeller) {
    return <Navigate to="/dashboard" replace />;
  }

  // Erro ou subscription ausente: mostra mensagem com ação (em vez de tela em branco)
  if (error || !subscription) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-500" />
        <h2 className="text-lg font-semibold">Não foi possível carregar seu plano</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          {error || 'Não encontramos sua assinatura. Tente novamente em instantes ou contate o suporte.'}
        </p>
        <div className="flex gap-2 mt-2">
          <Button variant="outline" onClick={() => navigate('/dashboard')}>
            Voltar ao Dashboard
          </Button>
          <Button onClick={() => refetch()} className="gap-2">
            <RefreshCcw className="h-4 w-4" /> Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  const plan = PLANS[subscription.plan_id];
  const remaining = 100 - usagePercent;
  const isLow = remaining <= 20;
  const isCritical = remaining <= 10;
  const renewDate = new Date(subscription.renewal_date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const chartData = buildChartData(transactions);

  // ── Custo das conversas (IA) — dados para o grafico por dia ──────────
  const custoTotais = custo?.totais ?? null;
  const custoNConversas = Number(custoTotais?.n_conversas ?? 0);
  const custoTemDados = !!custoTotais && custoNConversas > 0;
  const custoMaxVal = Number(custoTotais?.dia_maior_valor ?? 0);
  const custoMinVal = Number(custoTotais?.dia_menor_valor ?? 0);
  const custoMedio = custoNConversas > 0 ? Number(custoTotais?.custo_cliente_brl ?? 0) / custoNConversas : 0;
  const custoChart = (custo?.por_dia ?? []).map((d: any) => ({
    dia: fmtDia(d.dia),
    custo: Number(d.custo_cliente_brl),
    n: Number(d.n_conversas),
  }));

  // Abre o checkout de recarga (cartao salvo = 1 clique; senao cartao novo/PIX).
  const handlePurchase = (amount: number, price: number) => {
    setRecargaPkg({ atendimentos: amount, price });
  };

  const handleUpgrade = async (planId: PlanId) => {
    setUpgradingPlan(planId);
    const res = await upgradePlan(planId);
    setUpgradingPlan(null);
    if (res.success) {
      toast({
        title: 'Upgrade solicitado!',
        description: `Migração para o plano ${PLANS[planId].name} em processamento.`,
      });
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      {/* Botão Voltar */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const canGoBack = (window.history.state?.idx ?? 0) > 0;
            if (canGoBack) navigate(-1);
            else navigate('/dashboard');
          }}
          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 px-2 rounded-lg transition-colors group"
        >
          <ChevronLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          Voltar
        </Button>
      </div>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-primary" />
            Meu Plano e Créditos
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Gerencie sua assinatura, atendimentos e upgrades</p>
        </div>
        <Badge
          className={`px-3 py-1 text-sm font-semibold ${
            subscription.status === 'active' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
            subscription.status === 'suspended' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-red-500/20 text-red-400'
          }`}
          variant="outline"
        >
          {subscription.status === 'active' ? 'Ativa' : subscription.status === 'suspended' ? 'Suspensa' : 'Cancelada'}
        </Badge>
      </div>

      {/* ── Plan info card ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Current plan */}
        <div className="md:col-span-2 rounded-xl border border-border/50 bg-card/60 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-widest">Plano atual</p>
              <h2 className="text-xl font-bold">{plan.name} <span className="text-muted-foreground font-normal text-sm">({plan.subtitle})</span></h2>
              <p className="text-2xl font-bold mt-1">R$ {plan.price.toLocaleString('pt-BR')}<span className="text-sm font-normal text-muted-foreground">/mês</span></p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Próxima cobrança</p>
              <p className="font-semibold flex items-center gap-1 justify-end">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" /> {renewDate}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{fmt(plan.atendimentosIncluded)} atendimentos/mês</p>
            </div>
          </div>

          {/* Token bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Atendimentos utilizados</span>
              <span className={`font-semibold ${isCritical ? 'text-red-400' : isLow ? 'text-yellow-400' : ''}`}>
                {fmt(subscription.tokens_used)} / {fmt(tokensTotal)}
              </span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${isCritical ? 'bg-red-500' : isLow ? 'bg-yellow-500' : 'bg-primary'}`}
                style={{ width: `${Math.min(100, usagePercent)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{fmt(tokensAvailable)} restantes</span>
              {isLow && (
                <span className={`flex items-center gap-1 font-medium ${isCritical ? 'text-red-400' : 'text-yellow-400'}`}>
                  <AlertTriangle className="h-3 w-3" />
                  {isCritical ? 'Atendimentos críticos!' : 'Atendimentos baixos'}
                </span>
              )}
              <span>Renova em {renewDate}</span>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex gap-2 mt-4 flex-wrap">
            <Button size="sm" className="bg-primary text-primary-foreground gap-1.5" onClick={() => setTab('recharge')}>
              <Zap className="h-3.5 w-3.5" /> Recarregar Atendimentos
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="flex flex-col gap-3">
          {[
            { label: 'Atendimentos inclusos/mês', value: fmt(plan.atendimentosIncluded), icon: Zap, color: 'text-primary' },
            { label: 'Atendimentos avulsos', value: fmt(subscription.tokens_purchased), icon: TrendingUp, color: 'text-green-400' },
            { label: 'Atendimentos restantes', value: fmt(tokensAvailable), icon: CreditCard, color: 'text-yellow-400' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border/50 bg-card/40 p-3.5 flex items-center gap-3">
              <div className="rounded-lg bg-background p-2">
                <s.icon className={`h-4 w-4 ${s.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="font-bold">{s.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-lg bg-muted/50 p-1 w-fit">
        {([
          { key: 'overview', label: 'Histórico' },
          { key: 'recharge', label: 'Recarregar Atendimentos' },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview tab ───────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-5">
          {/* Custo das suas conversas (IA) */}
          <div className="rounded-xl border border-border/50 bg-card/50 p-5">
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <Coins className="h-4 w-4 text-primary" /> Custo das suas conversas (IA)
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Quanto cada conversa do seu atendimento inteligente custou neste ciclo.
            </p>

            {custoLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                <RefreshCcw className="h-4 w-4 animate-spin" /> Carregando custos...
              </div>
            ) : !custoTemDados ? (
              <div className="text-sm text-muted-foreground py-6">
                Ainda não há conversas registradas neste ciclo. Assim que seu atendimento inteligente
                conversar com leads, o custo aparece aqui.
              </div>
            ) : (
              <>
                {/* Mini-stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  {[
                    { label: 'Custo total no ciclo', value: fmtR(Number(custoTotais.custo_cliente_brl)) },
                    { label: 'Conversas', value: fmt(custoNConversas) },
                    { label: 'Custo médio/conversa', value: fmtR(custoMedio) },
                    { label: 'Dia que mais gastou', value: `${fmtDia(custoTotais.dia_maior)} · ${fmtR(custoMaxVal)}` },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl border border-border/50 bg-card/40 p-3.5">
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="font-bold mt-0.5">{s.value}</p>
                    </div>
                  ))}
                </div>

                {/* Grafico de custo por dia */}
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={custoChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="dia" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} tickFormatter={(v: number) => `R$ ${v}`} />
                    <Tooltip
                      contentStyle={{ background: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#F9FAFB' }}
                      formatter={(v: number) => [fmtR(Number(v)), 'Custo']}
                    />
                    <Bar dataKey="custo" radius={[4, 4, 0, 0]}>
                      {custoChart.map((d: any, i: number) => (
                        <Cell
                          key={i}
                          fill={d.custo === custoMaxVal ? '#10B981' : d.custo === custoMinVal ? '#6B7280' : '#5C6BC0'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Dia que mais gastou</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-500 inline-block" /> Dia que menos gastou ({fmtDia(custoTotais.dia_menor)} · {fmtR(custoMinVal)})</span>
                </div>
              </>
            )}
          </div>

          {/* Chart */}
          <div className="rounded-xl border border-border/50 bg-card/50 p-5">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> Consumo últimos 14 dias
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="consumoGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#5C6BC0" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#5C6BC0" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="recargaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#F9FAFB' }}
                  formatter={(v: number) => [fmt(v), '']}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9CA3AF' }} />
                <Area type="monotone" dataKey="consumo" name="Consumo" stroke="#5C6BC0" fill="url(#consumoGrad)" strokeWidth={2} />
                <Area type="monotone" dataKey="recarga" name="Recarga" stroke="#10B981" fill="url(#recargaGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Transactions */}
          <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
            <div className="px-5 py-3 border-b border-border/40">
              <h3 className="font-semibold">Extrato de Atendimentos</h3>
            </div>
            <div className="divide-y divide-border/30">
              {transactions.slice(0, 15).map((tx) => {
                const AgentIcon = AGENT_ICONS[tx.agent || 'default'] || AGENT_ICONS.default;
                const agentColor = AGENT_COLORS[tx.agent || 'default'] || AGENT_COLORS.default;
                const isCredit = tx.amount > 0;
                return (
                  <div key={tx.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors">
                    <div className={`rounded-full p-1.5 ${isCredit ? 'bg-green-500/10' : 'bg-primary/10'}`}>
                      <AgentIcon className={`h-3.5 w-3.5 ${isCredit ? 'text-green-400' : agentColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{tx.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(tx.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        {tx.agent && <span className="ml-2 capitalize">· {tx.agent}</span>}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`font-semibold text-sm ${isCredit ? 'text-green-400' : 'text-foreground'}`}>
                        {isCredit ? '+' : ''}{fmt(tx.amount)}
                      </p>
                      <p className="text-xs text-muted-foreground">saldo: {fmt(tx.balance_after)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Upgrade tab ────────────────────────────────────────────── */}
      {tab === 'upgrade' && (
        <div className="space-y-5">
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-2">
            <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              Ao fazer upgrade, o valor é cobrado proporcionalmente ao período restante do ciclo atual. Seus tokens acumulados são preservados.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {(Object.values(PLANS) as typeof PLANS[keyof typeof PLANS][]).map((p) => {
              const isCurrent = p.id === subscription.plan_id;
              const isDowngrade = Object.keys(PLANS).indexOf(p.id) < Object.keys(PLANS).indexOf(subscription.plan_id);
              const features = PLAN_FEATURES[p.id];

              return (
                <div key={p.id} className={`rounded-xl border-2 ${isCurrent ? 'border-primary bg-primary/5' : 'border-border/50 bg-card/50'} p-5 flex flex-col relative`}>
                  {isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-primary text-primary-foreground rounded-full text-xs font-semibold">
                      Plano Atual
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground uppercase tracking-widest">{p.subtitle}</p>
                  <h3 className="text-lg font-bold mt-0.5">{p.name}</h3>
                  <p className="text-2xl font-bold mt-2">
                    R$ {p.price.toLocaleString('pt-BR')}
                    <span className="text-sm font-normal text-muted-foreground">/mês</span>
                  </p>
                  <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    <p>{fmt(p.atendimentosIncluded)} atendimentos/mês</p>
                    <p className="text-amber-400 font-medium">Implementação: R$ {p.setup.toLocaleString('pt-BR')}</p>
                  </div>
                  <div className="flex-1 my-4 space-y-2">
                    {features.map((f) => (
                      <div key={f} className="flex items-start gap-1.5 text-sm">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                  <Button
                    className="w-full"
                    variant={isCurrent ? 'outline' : 'default'}
                    disabled={isCurrent || isDowngrade || upgradingPlan === p.id}
                    onClick={() => !isCurrent && !isDowngrade && handleUpgrade(p.id)}
                  >
                    {isCurrent ? 'Plano Atual' : isDowngrade ? 'Downgrade não disponível' : upgradingPlan === p.id ? 'Processando...' : `Fazer Upgrade para ${p.name}`}
                  </Button>
                </div>
              );
            })}
          </div>

          {/* Value message */}
          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 flex items-start gap-3">
            <Star className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm">Mais do que atendimentos — mais poder de agência</p>
              <p className="text-sm text-muted-foreground mt-1">Cada upgrade desbloqueia funcionalidades de IA mais avançadas, menor custo por atendimento e maior ROI nas suas campanhas. O investimento se paga no primeiro mês.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Recharge tab ───────────────────────────────────────────── */}
      {tab === 'recharge' && (
        <div className="space-y-5">
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-2">
            <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              Acabaram os atendimentos do seu plano? Recarregue na hora em um dos pacotes abaixo. Os atendimentos não utilizados se acumulam para os próximos meses.
            </p>
          </div>

          {/* Cartao salvo (1-clique) */}
          {savedCard?.last4 && (
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-green-500 shrink-0" />
              <p className="text-xs text-muted-foreground">
                Cartão salvo: <strong>{savedCard.brand ? `${savedCard.brand} ` : ''}final •••• {savedCard.last4}</strong>. Suas recargas são liberadas em 1 clique.
              </p>
            </div>
          )}

          {/* Packages */}
          <div>
            <h3 className="font-semibold mb-3">Pacotes de Atendimentos</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {ATENDIMENTO_PACKAGES.map((pkg) => (
                <div key={pkg.atendimentos} className="rounded-xl border border-border/50 bg-card/50 p-4 flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <Zap className="h-4 w-4 text-primary" />
                    <span className="font-bold">{fmt(pkg.atendimentos)} atendimentos</span>
                  </div>
                  <p className="text-2xl font-bold text-primary">{fmtR(pkg.price)}</p>
                  <Button
                    size="sm"
                    className="w-full mt-1"
                    onClick={() => handlePurchase(pkg.atendimentos, pkg.price)}
                  >
                    {savedCard?.last4 ? 'Recarregar (1 clique)' : 'Recarregar'}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Payment note */}
          <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3 flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              Pagamento seguro via PIX ou cartão. Assim que a recarga for confirmada, os atendimentos entram no seu saldo automaticamente.
            </p>
          </div>
        </div>
      )}

      {/* ── Dialog de pagamento da recarga (checkout no painel) ──────── */}
      <RecargaDialog
        open={!!recargaPkg}
        onOpenChange={(o) => { if (!o) setRecargaPkg(null); }}
        pkg={recargaPkg}
        savedCard={savedCard}
        onCredited={() => { refetch(); }}
      />
    </div>
  );
}
