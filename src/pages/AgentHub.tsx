import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { PLANS, useSubscription, type PlanId } from '@/hooks/useSubscription';
import { useSellerProfile, type VisibleFeatures } from '@/hooks/useSellerProfile';
import { supabase } from '@/integrations/supabase/client';
import { motion } from 'framer-motion';
import {
  Bot,
  Brain,
  CalendarDays,
  CheckCircle2,
  Crown,
  Lock,
  Mail,
  MessageCircle,
  PenTool,
  Palette,
  Radar,
  Sparkles,
  Users,
  Zap,
  ArrowRight,
  Instagram,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { isAgentReleased, COMING_SOON_LABEL } from '@/config/releasedAgents';

const allAgentsList: Array<{
  name: string;
  role: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  url: string;
  tier: PlanId;
  featureKey: keyof VisibleFeatures;
}> = [
  { name: 'Pedro', role: 'SDR & Agente IA', icon: Bot, color: '#34d399', url: '/pedro', tier: 'basico', featureKey: 'agent_pedro' },
  { name: 'Marcos', role: 'CRM & WhatsApp', icon: Users, color: '#a855f7', url: '/marcos', tier: 'pro', featureKey: 'agent_marcos' },
  { name: 'José', role: 'Tráfego Pago', icon: Radar, color: '#f97316', url: '/jose', tier: 'pro', featureKey: 'agent_jose' },
  { name: 'Paulo', role: 'Copywriter', icon: PenTool, color: '#22d3a0', url: '/copywriter', tier: 'enterprise', featureKey: 'agent_paulo' },
  { name: 'Maria', role: 'Design', icon: Palette, color: '#f472b6', url: '/creative-studio', tier: 'enterprise', featureKey: 'agent_maria' },
  { name: 'Davi', role: 'Social Media', icon: Instagram, color: '#60a5fa', url: '/davi', tier: 'enterprise', featureKey: 'agent_davi' },
  { name: 'João', role: 'Email', icon: Mail, color: '#a78bfa', url: '/joao', tier: 'enterprise', featureKey: 'agent_joao' },
  { name: 'Daniel', role: 'Estratégia', icon: Brain, color: '#f87171', url: '/daniel', tier: 'enterprise', featureKey: 'agent_daniel' },
];

const TIER_ORDER: Record<PlanId, number> = { basico: 0, pro: 1, enterprise: 2 };
const BRUNO_LIRA_USER_ID = 'f49fd48a-4386-4009-95f3-26a5100b84f7';
const UNLIMITED_AT = 999999;

function hasManualAgentRelease(userId: string | undefined, featureKey: keyof VisibleFeatures) {
  return userId === BRUNO_LIRA_USER_ID && (
    featureKey === 'agent_pedro' ||
    featureKey === 'agent_marcos' ||
    featureKey === 'agent_jose'
  );
}

function daysUntil(dateIso?: string) {
  if (!dateIso) return 0;
  const target = new Date(dateIso).getTime();
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, Math.ceil((target - Date.now()) / 86_400_000));
}

function fmt(n: number) {
  return n.toLocaleString('pt-BR');
}

function useSaldoOpenAI(enabled: boolean) {
  const [saldo, setSaldo] = useState<any>(null);

  useEffect(() => {
    if (!enabled) {
      setSaldo(null);
      return;
    }

    let alive = true;
    (async () => {
      try {
        const { data } = await (supabase as any).rpc('cliente_saldo_ia');
        if (alive) setSaldo(data || null);
      } catch {
        if (alive) setSaldo(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [enabled]);

  return saldo;
}

export default function AgentHub() {
  const { user, profile } = useAuth();
  const { isAdmin } = useIsAdmin();
  const { subscription, tokensAvailable, tokensTotal } = useSubscription();
  const { isSeller, visibleFeatures, loading: sellerLoading } = useSellerProfile(user?.id);
  const navigate = useNavigate();

  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Usuário';
  const userTier = (isAdmin ? 'enterprise' : (subscription?.plan_id || 'basico')) as PlanId;
  const userTierLevel = TIER_ORDER[userTier] ?? 0;
  const planInfo = PLANS[userTier] ?? PLANS.basico;
  const renewalDays = daysUntil(subscription?.renewal_date);
  const safeTokensAvailable = Math.max(0, tokensAvailable || 0);
  const saldo = useSaldoOpenAI(!sellerLoading && !isSeller && !!subscription);
  const hasSaldo = !!saldo?.tem_saldo;
  const conversasRestantes = hasSaldo ? Math.max(0, Number(saldo.conversas_restantes ?? 0)) : 0;
  const conversasTotal = hasSaldo ? Math.max(0, Number(saldo.conversas_total ?? 0)) : 0;
  const isUnlimited = (subscription?.tokens_included ?? 0) >= UNLIMITED_AT;
  const conversationDisplay = hasSaldo
    ? fmt(conversasRestantes)
    : isUnlimited
    ? 'Ilimitado'
    : fmt(safeTokensAvailable);
  const conversationHint = hasSaldo
    ? `${fmt(conversasTotal)} adicionadas pelo saldo`
    : isUnlimited
    ? 'sua chave de IA'
    : 'no ciclo atual';
  const tokenPercent = hasSaldo
    ? (conversasTotal > 0 ? Math.max(4, Math.min(100, Math.round((conversasRestantes / conversasTotal) * 100))) : 100)
    : isUnlimited
    ? 100
    : tokensTotal > 0
    ? Math.max(4, Math.min(100, Math.round((safeTokensAvailable / tokensTotal) * 100)))
    : 100;

  const agentsAfterSellerFilter = isSeller
    ? allAgentsList.filter(agent => visibleFeatures[agent.featureKey])
    : allAgentsList;

  const hasAgentAccess = (agent: typeof allAgentsList[number]) => {
    if (!isAgentReleased(agent.name)) return false;
    if (hasManualAgentRelease(user?.id, agent.featureKey)) return true;
    if (isSeller && visibleFeatures[agent.featureKey]) return true;
    return userTierLevel >= TIER_ORDER[agent.tier];
  };

  const unlockedAgents = agentsAfterSellerFilter.filter(hasAgentAccess);
  const lockedAgents = agentsAfterSellerFilter.filter(agent => !hasAgentAccess(agent));

  const quickActions = [
    {
      label: 'Disparar mensagem no WhatsApp',
      desc: 'Envie campanha em massa para sua lista de contatos.',
      icon: MessageCircle,
      url: '/whatsapp/broadcast',
      tone: 'green',
      allowed: userTierLevel >= TIER_ORDER.pro || (isSeller && visibleFeatures.marcos_disparo),
    },
    {
      label: 'Ver leads e pipeline de vendas',
      desc: 'Acompanhe cada lead do primeiro contato ao fechamento.',
      icon: Users,
      url: '/marcos',
      tone: 'gold',
      allowed: userTierLevel >= TIER_ORDER.pro || hasManualAgentRelease(user?.id, 'agent_marcos') || (isSeller && visibleFeatures.agent_marcos),
    },
  ].filter(action => action.allowed);

  const todayText = new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  return (
    <MainLayout>
      <section className="logos-home mx-auto flex w-full max-w-[1360px] flex-col gap-10">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_430px] xl:items-start">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3 pt-3"
          >
            <h1 className="logos-home-title text-4xl font-black tracking-normal text-foreground md:text-5xl">
              Oi, <span>{displayName}</span>! <span aria-hidden="true">👋</span>
            </h1>
            <p className="max-w-2xl text-base text-muted-foreground">
              Pronto para acelerar seus resultados? Escolha uma ação ou um agente abaixo.
            </p>
          </motion.div>

          <motion.aside
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 }}
            className="logos-home-plan-card"
          >
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4 text-primary" />
              <span>Hoje, {todayText}</span>
            </div>
            <div className="mt-5 grid grid-cols-3 divide-x divide-border/50">
              <div className="pr-5">
                <Crown className="mb-2 h-5 w-5 text-[var(--brand-gold)]" />
                <p className="text-xs text-muted-foreground">Plano</p>
                <p className="mt-1 text-xl font-bold text-foreground">{planInfo.name}</p>
              </div>
              <div className="px-5">
                <p className="text-xs text-muted-foreground">Conversas restantes</p>
                <p className="mt-2 text-xl font-bold text-emerald-400">{conversationDisplay}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{conversationHint}</p>
                <div className="mt-2 h-1.5 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-emerald-400" style={{ width: `${tokenPercent}%` }} />
                </div>
              </div>
              <div className="pl-5">
                <p className="text-xs text-muted-foreground">Renovação em</p>
                <p className="mt-2 text-xl font-bold text-primary">{renewalDays} dias</p>
              </div>
            </div>
          </motion.aside>
        </div>

        <section className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
              <Zap className="h-5 w-5 text-primary" />
              Ações rápidas
            </h2>
            <span className="rounded-full border border-border/70 bg-card/70 px-3 py-1 text-xs text-muted-foreground">
              Escolha uma ação para começar
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {quickActions.map((action, index) => (
              <motion.button
                key={action.url}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => navigate(action.url)}
                className={`logos-home-action logos-home-action-${action.tone}`}
              >
                <span className="logos-home-action-icon">
                  <action.icon className="h-7 w-7" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-bold text-foreground">{action.label}</span>
                  <span className="mt-1 block max-w-md text-sm leading-5 text-muted-foreground">{action.desc}</span>
                </span>
                <span className="logos-home-action-arrow">
                  <ArrowRight className="h-5 w-5" />
                </span>
              </motion.button>
            ))}
          </div>
        </section>

        <section className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
              <Sparkles className="h-5 w-5 text-violet-400" />
              Seus agentes
            </h2>
            <span className="rounded-full border border-border/70 bg-card/70 px-3 py-1 text-xs text-muted-foreground">
              Selecione um agente para acessar
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {unlockedAgents.map((agent, index) => (
              <motion.button
                key={agent.name}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
                onClick={() => navigate(agent.url)}
                className="logos-home-agent-card group text-left"
              >
                <span
                  className="logos-home-agent-icon"
                  style={{
                    background: `linear-gradient(135deg, ${agent.color}, ${agent.color}cc)`,
                    boxShadow: `0 18px 42px ${agent.color}24`,
                  }}
                >
                  <agent.icon className="h-8 w-8 text-white" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-bold text-foreground">{agent.name}</span>
                  <span className="block text-sm text-muted-foreground">{agent.role}</span>
                </span>
                <span className="flex w-full items-center justify-between">
                  <Badge className="border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Ativo
                  </Badge>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                </span>
              </motion.button>
            ))}

            {lockedAgents.map((agent, index) => (
              <motion.div
                key={agent.name}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: (unlockedAgents.length + index) * 0.04 }}
                className="logos-home-agent-card logos-home-agent-card-locked"
                aria-disabled="true"
              >
                <Badge className="absolute right-4 top-4 border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold lowercase text-amber-300 hover:bg-amber-400/10">
                  {COMING_SOON_LABEL}
                </Badge>
                <span className="logos-home-lock">
                  <Lock className="h-6 w-6" />
                </span>
                <span className="min-w-0">
                  <span className="block text-lg font-bold text-muted-foreground/75">{agent.name}</span>
                  <span className="block text-sm text-muted-foreground/55">{agent.role}</span>
                </span>
              </motion.div>
            ))}
          </div>
        </section>
      </section>
    </MainLayout>
  );
}
