import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { useMetaDashboard, MetaDatePreset } from '@/hooks/useMetaDashboard';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import { useCampaignNotifications } from '@/hooks/useCampaignNotifications';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Sparkles, MessageCircle, Loader2, Plug, ArrowRight,
  Target, PenTool, Palette, Send, Mail, Brain,
  TrendingUp, TrendingDown, Minus, RefreshCw, Bot,
  Megaphone, ChevronRight,
} from 'lucide-react';

/* ── Atalhos para os agentes ──────────────────────────────────── */
import type { VisibleFeatures } from '@/hooks/useSellerProfile';
import { isAgentReleased, COMING_SOON_LABEL } from '@/config/releasedAgents';
import { FEATURES } from '@/config/features';

const AGENTS: Array<{
  key: keyof VisibleFeatures;
  emoji: string;
  name: string;
  role: string;
  desc: string;
  url: string;
  color: string;
  badge: string;
}> = [
  {
    key: 'agent_pedro',
    emoji: '💬', name: 'Pedro', role: 'Atendimento',
    desc: 'Configure respostas automáticas no WhatsApp',
    url: '/pedro', color: 'border-teal-500/30 hover:border-teal-400/60',
    badge: 'bg-teal-500/10 text-teal-400',
  },
  {
    key: 'agent_marcos',
    emoji: '👥', name: 'Marcos', role: 'Leads & WhatsApp',
    desc: 'CRM, formulários, disparo em massa e inbox',
    url: '/crm', color: 'border-purple-500/30 hover:border-purple-400/60',
    badge: 'bg-purple-500/10 text-purple-400',
  },
  {
    key: 'agent_jose',
    emoji: '🎯', name: 'José', role: 'Anúncios',
    desc: 'Veja o desempenho das suas campanhas de anúncios',
    url: '/jose', color: 'border-orange-500/30 hover:border-orange-400/60',
    badge: 'bg-orange-500/10 text-orange-400',
  },
  {
    key: 'agent_paulo',
    emoji: '✍️', name: 'Paulo', role: 'Textos e anúncios',
    desc: 'Crie textos persuasivos para vender mais',
    url: '/copywriter', color: 'border-violet-500/30 hover:border-violet-400/60',
    badge: 'bg-violet-500/10 text-violet-400',
  },
  {
    key: 'agent_maria',
    emoji: '🎨', name: 'Maria', role: 'Imagens e artes',
    desc: 'Gere imagens e criativos para suas campanhas',
    url: '/creative-studio', color: 'border-pink-500/30 hover:border-pink-400/60',
    badge: 'bg-pink-500/10 text-pink-400',
  },
  {
    key: 'agent_davi',
    emoji: '📱', name: 'Davi', role: 'Redes sociais',
    desc: 'Crie posts e legendas para Instagram e Facebook',
    url: '/davi', color: 'border-cyan-500/30 hover:border-cyan-400/60',
    badge: 'bg-cyan-500/10 text-cyan-400',
  },
  {
    key: 'agent_joao',
    emoji: '📧', name: 'João', role: 'E-mail marketing',
    desc: 'Monte sequências de e-mails para seus clientes',
    url: '/joao', color: 'border-emerald-500/30 hover:border-emerald-400/60',
    badge: 'bg-emerald-500/10 text-emerald-400',
  },
  {
    key: 'agent_daniel',
    emoji: '🧠', name: 'Daniel', role: 'Estratégia',
    desc: 'Monte um plano de marketing para o seu negócio',
    url: '/daniel', color: 'border-indigo-500/30 hover:border-indigo-400/60',
    badge: 'bg-indigo-500/10 text-indigo-400',
  },
];

/* ── Traduz valores de tendência para linguagem simples ─────────── */
function TrendBadge({ delta }: { delta?: number }) {
  if (delta === undefined || delta === null) return null;
  if (delta > 5) return (
    <span className="flex items-center gap-0.5 text-xs font-medium text-green-400">
      <TrendingUp className="h-3 w-3" /> subindo
    </span>
  );
  if (delta < -5) return (
    <span className="flex items-center gap-0.5 text-xs font-medium text-red-400">
      <TrendingDown className="h-3 w-3" /> caindo
    </span>
  );
  return (
    <span className="flex items-center gap-0.5 text-xs font-medium text-muted-foreground">
      <Minus className="h-3 w-3" /> estável
    </span>
  );
}

export default function Dashboard() {
  const { user, profile } = useAuth();
  const { isSeller, visibleFeatures } = useSellerProfile(user?.id);
  const { toast } = useToast();
  const navigate = useNavigate();
  // Nome completo do Perfil (profiles.full_name), igual ao Topbar — sem cortar
  // pra primeira palavra.
  const firstName = profile?.full_name
    || user?.user_metadata?.full_name
    || user?.email?.split('@')[0]
    || 'Usuário';

  /* Filtra agentes baseado em permissões (master ve tudo, seller ve só os liberados) */
  const visibleAgents = isSeller
    ? AGENTS.filter(a => visibleFeatures[a.key])
    : AGENTS;

  const [isSending, setIsSending] = useState(false);
  const [isRefreshingManual, setIsRefreshingManual] = useState(false);

  const { connectedAccount } = useMetaConnection();

  const {
    isConnected, isLoading, kpis, anomalies,
    isRefreshing, lastUpdated, refreshAll,
    performanceSummary,
  } = useMetaDashboard('last_7d', connectedAccount?.account_id, connectedAccount?.currency ?? undefined);

  const { processAnomalies } = useCampaignNotifications();

  useEffect(() => {
    if (anomalies.length > 0) processAnomalies(anomalies);
  }, [anomalies, processAnomalies]);

  const currencySymbol = connectedAccount?.currency === 'USD' ? 'US$' : 'R$';

  /* ── Extrai KPIs chave em linguagem humana ── */
  const spend   = kpis.find(k => k.id === 'gasto')?.value || 0;
  const clicks  = kpis.find(k => k.id === 'cliques')?.value || 0;
  const ctr     = kpis.find(k => k.id === 'ctr')?.value || 0;
  const cpc     = kpis.find(k => k.id === 'cpc')?.value || 0;
  const reach   = performanceSummary?.totalReach || 0;

  /* ── Saúde geral (simples) ── */
  const healthScore = anomalies.length === 0 ? 'good' : anomalies.some(a => a.type === 'danger') ? 'bad' : 'warn';
  const healthConfig = {
    good: { label: 'Tudo funcionando bem', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20', dot: 'bg-green-400', emoji: '🟢' },
    warn: { label: 'Há pontos de atenção', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20', dot: 'bg-yellow-400', emoji: '🟡' },
    bad:  { label: 'Precisa de atenção agora', color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20',    dot: 'bg-red-400',    emoji: '🔴' },
  }[healthScore];

  /* ── Enviar relatório WhatsApp ── */
  const handleSendWhatsApp = async () => {
    setIsSending(true);
    try {
      const reportContent = `📊 *Relatório da semana*\n\n💰 Investimento: ${currencySymbol} ${spend.toLocaleString('pt-BR')}\n👁️ Pessoas alcançadas: ${reach.toLocaleString('pt-BR')}\n🖱️ Cliques: ${clicks.toLocaleString('pt-BR')}\n📈 Taxa de cliques: ${ctr.toFixed(2)}%\n💵 Custo por clique: ${currencySymbol} ${cpc.toFixed(2)}\n\n✅ Gerado por LogosIA`;
      const { data, error } = await supabase.functions.invoke('send-whatsapp-report', {
        body: { action: 'send_report', reportContent },
      });
      if (error) throw error;
      if (data?.success) {
        toast({ title: 'Relatório enviado! 🎉', description: 'Confira seu WhatsApp.' });
      } else {
        throw new Error(data?.error || 'Falha ao enviar');
      }
    } catch (err: any) {
      toast({ title: 'Erro ao enviar', description: 'Verifique se o WhatsApp está conectado.', variant: 'destructive' });
    } finally {
      setIsSending(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshingManual(true);
    await refreshAll();
    setIsRefreshingManual(false);
  };

  /* ═══ TELA SEM CONTA CONECTADA ════════════════════════════════ */
  if (!isConnected && !isLoading) {
    return (
      <MainLayout>
        <div className="logos-dashboard-shell flex flex-1 items-center justify-center py-10 px-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
            <Card className="logos-dashboard-card border overflow-hidden">
              <div className="h-1.5 w-full bg-gradient-to-r from-primary to-yellow-500" />
              <CardContent className="flex flex-col items-center gap-6 p-8 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 text-4xl">
                  📊
                </div>
                <div>
                  <h2 className="text-2xl font-bold mb-2">Olá, {firstName}! 👋</h2>
                  <p className="text-muted-foreground leading-relaxed">
                    Para ver seus resultados aqui, você precisa conectar sua conta de anúncios do Meta (Facebook/Instagram).
                    É rápido e seguro!
                  </p>
                </div>
                <div className="w-full space-y-3 text-left">
                  {[
                    { emoji: '⚡', text: 'Leva menos de 2 minutos' },
                    { emoji: '🔒', text: 'Seus dados ficam 100% seguros' },
                    { emoji: '📈', text: 'Você vê tudo num só lugar' },
                  ].map(item => (
                    <div key={item.text} className="logos-dashboard-action flex items-center gap-3 rounded-xl border px-4 py-3">
                      <span className="text-xl">{item.emoji}</span>
                      <span className="text-sm font-medium">{item.text}</span>
                    </div>
                  ))}
                </div>
                <Button onClick={() => navigate('/connect-accounts')} className="w-full h-12 text-base bg-primary hover:bg-primary/90">
                  <Plug className="mr-2 h-5 w-5" />
                  Conectar minha conta de anúncios
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </MainLayout>
    );
  }

  /* ═══ DASHBOARD PRINCIPAL ══════════════════════════════════════ */
  return (
    <MainLayout>
      <div className="logos-dashboard-shell space-y-8 max-w-5xl mx-auto">

        {/* ── Saudação ─────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="logos-dashboard-title text-2xl md:text-3xl font-bold">
            Oi, <span className="bg-gradient-to-r from-primary to-yellow-400 bg-clip-text text-transparent">{firstName}</span>! 👋
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Aqui está um resumo do que está acontecendo com seus anúncios esta semana.
          </p>
        </motion.div>

        {/* ── Status geral ─────────────────────────────────────── */}
        {/* FEATURE FLAG campaignSection: quando false, secao inteira de
            saude/anomalies das campanhas nao renderiza. */}
        {FEATURES.campaignSection && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <div className={`logos-dashboard-status rounded-2xl border p-4 flex items-center justify-between gap-4 ${healthConfig.bg}`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{healthConfig.emoji}</span>
              <div>
                <p className={`font-semibold ${healthConfig.color}`}>{healthConfig.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {anomalies.length === 0
                    ? 'Nenhum problema detectado nas suas campanhas'
                    : `${anomalies.length} ponto(s) de atenção detectado(s) pelo JOSÉ`}
                </p>
              </div>
            </div>
            {anomalies.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => navigate('/jose')} className="shrink-0 text-xs h-8">
                Ver detalhes <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
        </motion.div>
        )}{/* ── fim FEATURES.campaignSection (Status geral) ── */}

        {/* ── Números da semana ────────────────────────────────── */}
        {/* FEATURE FLAG campaignSection: idem, esconde resultados de anuncios. */}
        {FEATURES.campaignSection && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold">Resultados desta semana</h2>
              <p className="text-xs text-muted-foreground">Últimos 7 dias dos seus anúncios</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRefresh}
                disabled={isRefreshing || isRefreshingManual}
                className="logos-dashboard-action flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${(isRefreshing || isRefreshingManual) ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
              {lastUpdated && (
                <span className="text-[10px] text-muted-foreground/60 hidden sm:inline">
                  Atualizado {new Date(lastUpdated).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-28 rounded-2xl bg-muted/40 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                {
                  emoji: '💰',
                  label: 'Quanto você investiu',
                  value: `${currencySymbol} ${spend.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                  hint: 'Total gasto em anúncios',
                  delta: kpis.find(k => k.id === 'gasto')?.change,
                },
                {
                  emoji: '👁️',
                  label: 'Pessoas alcançadas',
                  value: reach >= 1000 ? `${(reach / 1000).toFixed(1)}k` : reach.toLocaleString('pt-BR'),
                  hint: 'Viram seu anúncio',
                  delta: undefined,
                },
                {
                  emoji: '🖱️',
                  label: 'Cliques recebidos',
                  value: clicks.toLocaleString('pt-BR'),
                  hint: 'Pessoas que clicaram',
                  delta: kpis.find(k => k.id === 'cliques')?.change,
                },
                {
                  emoji: '💵',
                  label: 'Custo por clique',
                  value: `${currencySymbol} ${cpc.toFixed(2)}`,
                  hint: 'Quanto pagou por clique',
                  delta: kpis.find(k => k.id === 'cpc')?.change !== undefined ? -(kpis.find(k => k.id === 'cpc')?.change ?? 0) : undefined,
                },
              ].map((card, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12 + i * 0.05 }}
                  className="logos-dashboard-card rounded-2xl border p-4 flex flex-col gap-2 transition-all duration-200"
                >
                  <span className="logos-dashboard-kpi-icon flex h-10 w-10 items-center justify-center rounded-xl text-2xl">{card.emoji}</span>
                  <div>
                    <p className="text-[11px] text-muted-foreground leading-tight">{card.label}</p>
                    <p className="text-xl font-bold mt-0.5 leading-tight">{card.value}</p>
                  </div>
                  <TrendBadge delta={card.delta} />
                </motion.div>
              ))}
            </div>
          )}

          {/* Botão enviar WhatsApp */}
          <div className="mt-4 flex justify-end">
            <Button
              onClick={handleSendWhatsApp}
              disabled={isSending || isLoading || !spend}
              size="sm"
              className="h-9 gap-2 bg-green-600 hover:bg-green-700 text-white rounded-xl"
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
              Receber resumo no WhatsApp
            </Button>
          </div>
        </motion.div>
        )}{/* ── fim FEATURES.campaignSection (Resultados semana) ── */}

        {/* ── O que você quer fazer hoje? ──────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <h2 className="text-base font-semibold mb-1">O que você quer fazer hoje?</h2>
          <p className="text-xs text-muted-foreground mb-4">Escolha um agente e comece agora</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {visibleAgents.map((agent, i) => {
              // Decisão de produto: só Pedro e Marcos estão liberados pra todas
              // as contas. Demais ficam visíveis com badge "Em breve",
              // não-clicáveis, opacidade reduzida.
              const released = isAgentReleased(agent.name);
              return (
                <motion.button
                  key={agent.name}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.22 + i * 0.04 }}
                  onClick={released ? () => navigate(agent.url) : undefined}
                  disabled={!released}
                  aria-disabled={!released}
                  title={released ? undefined : 'Agente em breve disponível'}
                  className={`logos-dashboard-card group relative rounded-2xl border p-4 text-left transition-all duration-200 ${agent.color} ${
                    released
                      ? 'cursor-pointer'
                      : 'opacity-55 cursor-not-allowed grayscale-[40%]'
                  }`}
                >
                  {!released && (
                    <span className="absolute top-2 right-2 inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-amber-400 border border-amber-500/30 lowercase">
                      {COMING_SOON_LABEL}
                    </span>
                  )}
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-2xl">{agent.emoji}</span>
                    {released && (
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors mt-0.5" />
                    )}
                  </div>
                  <p className="font-semibold text-sm leading-tight">{agent.name}</p>
                  <p className={`text-[10px] font-medium mt-0.5 mb-2 ${agent.badge.split(' ')[1]}`}>{agent.role}</p>
                  <p className="text-xs text-muted-foreground leading-snug">{agent.desc}</p>
                </motion.button>
              );
            })}
          </div>
        </motion.div>

      </div>
    </MainLayout>
  );
}
