import { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Zap, TrendingUp, CheckCircle2, XCircle, CreditCard, AlertTriangle,
  RefreshCcw, Star, Clock, BarChart3, Info,
  Bot, PenTool, Instagram, Mail, Brain, Target, ChevronLeft, Coins,
} from 'lucide-react';
import {
  ComposedChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useSubscription, PLANS, ATENDIMENTO_PACKAGES, type PlanId } from '@/hooks/useSubscription';
import { useToast } from '@/hooks/use-toast';
import { descricaoErro } from '@/lib/erroAmigavel';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { supabase } from '@/integrations/supabase/client';
import RecargaDialog from '@/components/subscription/RecargaDialog';

/* ── helpers ────────────────────────────────────────────────────────── */
function fmt(n: number) { return n.toLocaleString('pt-BR'); }
function fmtR(n: number) { return `R$ ${n.toFixed(2).replace('.', ',')}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function fmtUSD(n: number) { return `US$ ${Number(n || 0).toFixed(2)}`; }
function fmtCompact(n: number) {
  return Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n || 0));
}
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
    subscription, loading, error, refetch,
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

  // Custo real de tokens (IA) do PROPRIO cliente. A RPC e SECURITY DEFINER e
  // so devolve o consumo agregado do auth.uid(), sem permitir escolher user_id.
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

  // Saldo da chave OpenAI (BYOK): o cliente informa o saldo (US$); o sistema
  // converte para BRL e traduz em conversas usando R$0,50 por conversa.
  const [saldo, setSaldo] = useState<any>(null);
  const [balInput, setBalInput] = useState('');
  const [savingBal, setSavingBal] = useState(false);
  const fetchSaldo = async () => {
    try {
      const { data } = await (supabase as any).rpc('cliente_saldo_ia');
      setSaldo(data || null);
    } catch { setSaldo(null); }
  };
  useEffect(() => { if (user) fetchSaldo(); /* eslint-disable-next-line */ }, [user]);
  const handleSaveBalance = async () => {
    const usd = parseFloat(String(balInput).replace(',', '.'));
    if (!Number.isFinite(usd) || usd < 0) {
      toast({ title: 'Valor inválido', description: 'Informe o saldo em dólar (ex: 20).', variant: 'destructive' });
      return;
    }
    setSavingBal(true);
    try {
      const { error } = await (supabase as any).rpc('set_my_openai_balance', { p_usd: usd });
      if (error) throw error;
      setBalInput('');
      await fetchSaldo();
      toast({ title: 'Saldo atualizado!', description: 'Calculamos quantas conversas esse saldo adiciona.' });
    } catch (e: any) {
      toast({ title: 'Erro', description: descricaoErro(e), variant: 'destructive' });
    } finally { setSavingBal(false); }
  };

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
  const planFounder = (plan as any).founder === true;
  const planPriceNormal = Number((plan as any).priceNormal ?? plan.price);
  const renewDate = new Date(subscription.renewal_date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // ── Saldo BYOK: saldo informado vira conversas em cima de R$0,50/conversa.
  const temSaldo = !!saldo?.tem_saldo;
  const conversasTotal = Number(saldo?.conversas_total ?? 0);
  const conversasUsadas = Number(saldo?.conversas_usadas ?? 0);
  const conversasRestantes = Number(saldo?.conversas_restantes ?? 0);
  const custoConversa = Number(saldo?.custo_conversa ?? 0.50);
  const saldoPct = conversasTotal > 0 ? Math.min(100, (conversasUsadas / conversasTotal) * 100) : 0;
  const saldoLow = temSaldo && conversasTotal > 0 && conversasRestantes / conversasTotal <= 0.2;
  const saldoCritical = temSaldo && conversasTotal > 0 && conversasRestantes / conversasTotal <= 0.1;
  // ── Custo real de tokens (IA) — historico completo disponivel por dia.
  const custoTotais = custo?.totais ?? null;
  const custoChamadas = Number(custoTotais?.chamadas ?? 0);
  const custoOperacoes = Number(custoTotais?.operacoes ?? 0);
  const custoTokens = Number(custoTotais?.total_tokens ?? 0);
  const custoInputTokens = Number(custoTotais?.input_tokens ?? 0);
  const custoOutputTokens = Number(custoTotais?.output_tokens ?? 0);
  const custoBrl = Number(custoTotais?.custo_brl ?? 0);
  const custoUsd = Number(custoTotais?.custo_usd ?? 0);
  const custoTemDados = !!custoTotais && (custoTokens > 0 || custoBrl > 0 || custoOperacoes > 0);
  const custoMaxVal = Number(custoTotais?.dia_maior_valor ?? 0);
  const custoMedio = custoChamadas > 0 ? custoBrl / custoChamadas : 0;
  const custoChart = (custo?.por_dia ?? []).map((d: any) => ({
    dia: fmtDia(d.dia),
    custo: Number(d.custo_brl ?? 0),
    tokens: Number(d.total_tokens ?? 0),
    chamadas: Number(d.chamadas ?? d.operacoes ?? 0),
  }));

  // ── Historico de tokens: barras = tokens por dia; linha = custo real em BRL.
  const tokenChart = (custo?.por_dia ?? []).map((d: any) => {
    return {
      dia: fmtDia(d.dia),
      tokens: Number(d.total_tokens ?? 0),
      custo: Number(d.custo_brl ?? 0),
    };
  });
  const tokenTemDados = tokenChart.length > 0;

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
              <h2 className="text-xl font-bold flex items-center gap-2">
                {plan.name}
                {planFounder && (
                  <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
                    Fundador
                  </span>
                )}
              </h2>
              <p className="text-2xl font-bold mt-1">{fmtR(plan.price)}<span className="text-sm font-normal text-muted-foreground">/mês</span></p>
              {planFounder && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Promoção fundador nos 3 primeiros meses. Depois {fmtR(planPriceNormal)}/mês.
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Próxima cobrança</p>
              <p className="font-semibold flex items-center gap-1 justify-end">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" /> {renewDate}
              </p>
              <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1 justify-end">
                <Coins className="h-3 w-3" /> Conversas pela sua chave OpenAI
              </p>
            </div>
          </div>

          {/* Barra de conversas do saldo OpenAI */}
          {temSaldo ? (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Conversas usadas neste saldo</span>
                <span className={`font-semibold ${saldoCritical ? 'text-red-400' : saldoLow ? 'text-yellow-400' : ''}`}>
                  {fmt(conversasUsadas)} / {fmt(conversasTotal)}
                </span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${saldoCritical ? 'bg-red-500' : saldoLow ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(100, saldoPct)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="text-emerald-400 font-medium">≈ {fmt(conversasRestantes)} conversas restantes</span>
                {saldoLow && (
                  <span className={`flex items-center gap-1 font-medium ${saldoCritical ? 'text-red-400' : 'text-yellow-400'}`}>
                    <AlertTriangle className="h-3 w-3" />
                    {saldoCritical ? 'Saldo acabando!' : 'Saldo baixo'}
                  </span>
                )}
                <span>Atualize o saldo abaixo</span>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 text-xs text-muted-foreground">
              Informe abaixo o saldo da sua chave OpenAI para calcular quantas conversas esse valor adiciona.
            </div>
          )}

        </div>

        {/* Stats */}
        <div className="flex flex-col gap-3">
          {[
            { label: 'Conversas restantes', value: temSaldo ? `≈ ${fmt(conversasRestantes)}` : '—', icon: Coins, color: 'text-emerald-400' },
            { label: 'Conversas adicionadas', value: temSaldo ? fmt(conversasTotal) : '—', icon: TrendingUp, color: 'text-primary' },
            { label: 'Saldo restante', value: temSaldo ? fmtR(Number(saldo.restante_brl)) : '—', icon: CreditCard, color: 'text-yellow-400' },
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
          {/* Saldo da sua chave OpenAI -> conversas (BYOK) */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <Coins className="h-4 w-4 text-emerald-400" /> Saldo da sua chave OpenAI
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Informe o valor que você colocou na sua chave OpenAI. A gente converte para real e mostra quantas conversas esse saldo adiciona, usando R$0,50 por conversa.
            </p>

            {saldo?.tem_saldo ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-lg bg-background/40 border border-border/40 p-3">
                    <p className="text-[11px] text-muted-foreground">Saldo informado</p>
                    <p className="text-lg font-bold">US$ {Number(saldo.balance_usd).toFixed(2)}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtR(Number(saldo.saldo_brl))} = {fmt(conversasTotal)} conversas</p>
                  </div>
                  <div className="rounded-lg bg-background/40 border border-border/40 p-3">
                    <p className="text-[11px] text-muted-foreground">Já consumiu</p>
                    <p className="text-lg font-bold">{fmtR(Number(saldo.gasto_brl))}</p>
                    <p className="text-[11px] text-muted-foreground">{fmt(conversasUsadas)} conversas</p>
                  </div>
                  <div className="rounded-lg bg-background/40 border border-border/40 p-3">
                    <p className="text-[11px] text-muted-foreground">Resta</p>
                    <p className="text-lg font-bold text-emerald-400">{fmtR(Number(saldo.restante_brl))}</p>
                    <p className="text-[11px] text-muted-foreground">{fmt(conversasRestantes)} conversas</p>
                  </div>
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3">
                    <p className="text-[11px] text-emerald-300/80">Conversas restantes</p>
                    <p className="text-2xl font-extrabold text-emerald-400 leading-tight">≈ {fmt(conversasRestantes)}</p>
                    <p className="text-[11px] text-emerald-300/70">{fmtR(custoConversa)} cada conversa</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[160px]">
                    <label className="text-xs text-muted-foreground">Atualizar saldo (US$)</label>
                    <Input value={balInput} onChange={(e) => setBalInput(e.target.value)} placeholder="Ex: 20" inputMode="decimal" className="h-9 mt-1" />
                  </div>
                  <Button onClick={handleSaveBalance} disabled={savingBal} className="h-9">
                    {savingBal ? <RefreshCcw className="h-4 w-4 animate-spin" /> : 'Atualizar'}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  O histórico de gasto abaixo vem do consumo real da IA. O saldo acima usa o valor manual de {fmtR(custoConversa)} por conversa para ficar simples de acompanhar.
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[180px]">
                  <label className="text-xs text-muted-foreground">Quanto você tem de saldo na OpenAI? (US$)</label>
                  <Input value={balInput} onChange={(e) => setBalInput(e.target.value)} placeholder="Ex: 20" inputMode="decimal" className="h-9 mt-1" />
                </div>
                <Button onClick={handleSaveBalance} disabled={savingBal} className="h-9 gradient-primary text-white">
                  {savingBal ? <RefreshCcw className="h-4 w-4 animate-spin" /> : 'Calcular conversas'}
                </Button>
              </div>
            )}
          </div>

          {/* Custo real dos tokens (IA) */}
          <div className="rounded-xl border border-border/50 bg-card/50 p-5">
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <Coins className="h-4 w-4 text-primary" /> Custo real dos tokens (IA)
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Histórico real de gasto da IA na sua conta, calculado pelos tokens de entrada/saida e modelo usado.
            </p>

            {custoLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                <RefreshCcw className="h-4 w-4 animate-spin" /> Carregando custos...
              </div>
            ) : !custoTemDados ? (
              <div className="text-sm text-muted-foreground py-6">
                Ainda não há chamadas de IA registradas no histórico desta conta. Assim que os agentes usarem tokens,
                o custo aparece aqui.
              </div>
            ) : (
              <>
                {/* Mini-stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  {[
                    { label: 'Custo real histórico', value: `${fmtR(custoBrl)} (${fmtUSD(custoUsd)})` },
                    { label: 'Tokens históricos', value: fmt(custoTokens) },
                    { label: 'Entrada / saida', value: `${fmtCompact(custoInputTokens)} / ${fmtCompact(custoOutputTokens)}` },
                    { label: 'Custo medio/chamada', value: fmtR(custoMedio) },
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
                          fill={d.custo === custoMaxVal ? '#10B981' : '#5C6BC0'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Dia que mais gastou</span>
                  <span>{fmt(custoChamadas)} chamadas de IA em {fmt(custoOperacoes)} operacoes</span>
                </div>
                {(custo?.por_modelo ?? []).length > 0 && (
                  <div className="mt-5 overflow-hidden rounded-xl border border-border/50">
                    <div className="grid grid-cols-[1.3fr_.8fr_.8fr_.8fr] gap-3 bg-background/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span>Modelo</span>
                      <span>Tokens</span>
                      <span>Custo</span>
                      <span>Chamadas</span>
                    </div>
                    {(custo?.por_modelo ?? []).slice(0, 5).map((m: any) => (
                      <div key={`${m.provedor}-${m.modelo}`} className="grid grid-cols-[1.3fr_.8fr_.8fr_.8fr] gap-3 border-t border-border/40 px-3 py-2 text-sm">
                        <span className="min-w-0 truncate font-medium">{m.provedor} / {m.modelo}</span>
                        <span>{fmt(Number(m.total_tokens ?? 0))}</span>
                        <span>{fmtR(Number(m.custo_brl ?? 0))}</span>
                        <span>{fmt(Number(m.chamadas ?? 0))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Historico de tokens */}
          <div className="rounded-xl border border-border/50 bg-card/50 p-5">
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> Historico de tokens
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Tokens usados por dia (barras) e custo real em reais (linha), somente da sua conta.
            </p>
            {!tokenTemDados ? (
              <div className="text-sm text-muted-foreground py-6">
                Ainda não há tokens no histórico desta conta. Assim que os agentes usarem IA, o historico aparece aqui.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={tokenChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="dia" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fill: '#9CA3AF', fontSize: 11 }} allowDecimals={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: '#9CA3AF', fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#F9FAFB' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#9CA3AF' }} />
                  <Bar yAxisId="left" dataKey="tokens" name="Tokens no dia" fill="#5C6BC0" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="custo" name="Custo real (R$)" stroke="#10B981" strokeWidth={2} dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            )}
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
