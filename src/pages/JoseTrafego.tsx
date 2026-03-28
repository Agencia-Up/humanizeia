import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import { useGoogleAdsConnection } from '@/hooks/useGoogleAdsConnection';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Target, Zap, CheckCircle, XCircle, ExternalLink,
  TrendingUp, DollarSign, MousePointer, BarChart3,
  Plug, Brain, AlertCircle, ArrowRight,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function JoseTrafego() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const meta = useMetaConnection();
  const google = useGoogleAdsConnection();

  const { data: tiktokAccounts = [] } = useQuery({
    queryKey: ['tiktok-accounts-jose', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('ad_accounts')
        .select('*')
        .eq('platform', 'tiktok')
        .eq('is_active', true);
      return data || [];
    },
    enabled: !!user,
  });

  const { data: linkedinAccount } = useQuery({
    queryKey: ['linkedin-account-jose', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('connected_accounts' as any)
        .select('*')
        .eq('platform', 'linkedin')
        .eq('user_id', user?.id)
        .maybeSingle();
      return data as { account_name: string } | null;
    },
    enabled: !!user,
  });

  const platforms = [
    {
      id: 'meta',
      name: 'Meta Ads',
      description: 'Facebook, Instagram & Messenger',
      color: 'text-blue-400',
      bg: 'bg-blue-500/10 border-blue-500/20',
      emoji: '📘',
      isConnected: !!meta.connectedAccount,
      accountName: meta.connectedAccount?.account_name,
      viewUrl: null as string | null,
    },
    {
      id: 'google',
      name: 'Google Ads',
      description: 'Pesquisa, Display, YouTube & Shopping',
      color: 'text-red-400',
      bg: 'bg-red-500/10 border-red-500/20',
      emoji: '🔍',
      isConnected: !!google.connectedAccount,
      accountName: google.connectedAccount?.account_name,
      viewUrl: '/google-ads',
    },
    {
      id: 'tiktok',
      name: 'TikTok Ads',
      description: 'Vídeos curtos — audiência jovem',
      color: 'text-foreground',
      bg: 'bg-muted/30 border-border/40',
      emoji: '🎵',
      isConnected: tiktokAccounts.length > 0,
      accountName: (tiktokAccounts[0] as any)?.account_name,
      viewUrl: null as string | null,
    },
    {
      id: 'linkedin',
      name: 'LinkedIn Ads',
      description: 'B2B para profissionais e empresas',
      color: 'text-blue-500',
      bg: 'bg-blue-700/10 border-blue-700/20',
      emoji: '💼',
      isConnected: !!linkedinAccount,
      accountName: linkedinAccount?.account_name,
      viewUrl: '/linkedin-ads',
    },
  ];

  const connectedCount = platforms.filter((p) => p.isConnected).length;

  const optimizationItems = [
    { emoji: '🎯', text: 'Pausar anúncios com CTR abaixo do benchmark do setor' },
    { emoji: '💰', text: 'Redistribuir budget automaticamente para campanhas vencedoras' },
    { emoji: '🔄', text: 'Sugerir novas audiências lookalike com base em conversões' },
    { emoji: '📊', text: 'Gerar relatórios de performance semanais automáticos' },
    { emoji: '⚡', text: 'Aumentar lance em horários e dias de maior conversão' },
    { emoji: '🛑', text: 'Alertar sobre anomalias de gasto e quedas de performance' },
  ];

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-6xl mx-auto">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/10 border border-orange-500/20">
              <Target className="h-7 w-7 text-orange-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold">JOSÉ</h1>
                <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse mr-1.5 inline-block" />
                  Tráfego Pago
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Gestão autônoma de campanhas em todas as plataformas de anúncios
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge
              variant="outline"
              className={connectedCount > 0 ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-muted-foreground'}
            >
              {connectedCount}/{platforms.length} plataformas
            </Badge>
            <Button size="sm" variant="outline" onClick={() => navigate('/integrations')}>
              <Plug className="h-3.5 w-3.5 mr-1.5" />
              Gerenciar Conexões
            </Button>
          </div>
        </div>

        {/* ── Alert when nothing connected ───────────────────────── */}
        {connectedCount === 0 && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-amber-400">Nenhuma plataforma de anúncios conectada</p>
              <p className="text-xs text-muted-foreground mt-1">
                Conecte pelo menos uma conta de anúncios para o José começar a gerenciar suas campanhas de forma autônoma.
              </p>
              <Button
                size="sm"
                className="mt-2 gradient-primary text-primary-foreground"
                onClick={() => navigate('/integrations')}
              >
                Conectar plataformas <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Platform cards ─────────────────────────────────────── */}
        <div>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Plataformas de Anúncios
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {platforms.map((p) => (
              <Card key={p.id} className={`border transition-all duration-200 ${p.bg} ${!p.isConnected ? 'opacity-75' : ''}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <span className="text-2xl">{p.emoji}</span>
                    {p.isConnected ? (
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Conectado
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        <XCircle className="h-3 w-3 mr-1" />
                        Desconectado
                      </Badge>
                    )}
                  </div>
                  <div>
                    <p className={`font-semibold text-sm ${p.color}`}>{p.name}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{p.description}</p>
                    {p.isConnected && p.accountName && (
                      <p className="text-[10px] text-emerald-400 mt-1 truncate font-medium">✅ {p.accountName}</p>
                    )}
                  </div>
                  {p.isConnected && p.viewUrl ? (
                    <Button
                      size="sm"
                      className="w-full text-xs gradient-primary text-primary-foreground"
                      onClick={() => navigate(p.viewUrl!)}
                    >
                      Abrir Dashboard
                      <ExternalLink className="h-3 w-3 ml-1.5" />
                    </Button>
                  ) : p.isConnected ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full text-xs"
                      onClick={() =>
                        toast({
                          title: 'Dashboard em desenvolvimento',
                          description: `Dashboard específico do ${p.name} chegando em breve.`,
                        })
                      }
                    >
                      Ver métricas (em breve)
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="w-full text-xs gradient-primary text-primary-foreground"
                      onClick={() => navigate('/integrations')}
                    >
                      Conectar
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* ── Quick metrics — only when something is connected ────── */}
        {connectedCount > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Performance Consolidada
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Gasto Total (30d)', icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-500/10', note: 'Ver dashboard de cada plataforma' },
                { label: 'Impressões Totais', icon: BarChart3, color: 'text-blue-400', bg: 'bg-blue-500/10', note: 'Consolidado multi-plataforma' },
                { label: 'Cliques', icon: MousePointer, color: 'text-violet-400', bg: 'bg-violet-500/10', note: 'Soma de todas as plataformas' },
                { label: 'ROAS Médio', icon: TrendingUp, color: 'text-orange-400', bg: 'bg-orange-500/10', note: 'Retorno sobre investimento' },
              ].map((metric) => {
                const Icon = metric.icon;
                return (
                  <Card key={metric.label} className="border-border/50 bg-card/50">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className={`h-9 w-9 rounded-lg ${metric.bg} flex items-center justify-center shrink-0`}>
                        <Icon className={`h-4 w-4 ${metric.color}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{metric.label}</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">{metric.note}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 justify-center">
              {google.connectedAccount && (
                <button onClick={() => navigate('/google-ads')} className="text-xs text-red-400 hover:underline">
                  → Dashboard Google Ads
                </button>
              )}
              {linkedinAccount && (
                <button onClick={() => navigate('/linkedin-ads')} className="text-xs text-blue-400 hover:underline">
                  → Dashboard LinkedIn Ads
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── AI Optimization card ────────────────────────────────── */}
        <Card className="border-orange-500/20 bg-orange-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Brain className="h-4 w-4 text-orange-400" />
              Otimização Autônoma com IA
              <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-[10px] ml-auto">
                Em desenvolvimento
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              O José vai analisar e otimizar suas campanhas em tempo real, sem precisar de intervenção manual:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {optimizationItems.map((item) => (
                <div key={item.text} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="shrink-0 text-base leading-none mt-0.5">{item.emoji}</span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
            <Button
              size="sm"
              className="gradient-primary text-primary-foreground"
              onClick={() => navigate('/integrations')}
              disabled={connectedCount === 0}
            >
              <Zap className="h-3.5 w-3.5 mr-1.5" />
              {connectedCount === 0 ? 'Conecte uma plataforma primeiro' : 'Ativar Otimização Automática'}
            </Button>
          </CardContent>
        </Card>

      </div>
    </MainLayout>
  );
}
