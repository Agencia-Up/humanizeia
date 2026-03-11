import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { DashboardKPICard } from '@/components/dashboard/DashboardKPICard';
import { TrendChart } from '@/components/dashboard/TrendChart';
import { FunnelTable } from '@/components/dashboard/FunnelTable';
import { DailySpendChart } from '@/components/dashboard/ChannelRevenueChart';
import { CreativeAlertsWidget } from '@/components/dashboard/CreativeAlertsWidget';
import { PerformanceSummary } from '@/components/dashboard/RevenueProjection';
import { SpendDistributionChart } from '@/components/dashboard/SpendDistributionChart';
import { EfficiencyScatterChart } from '@/components/dashboard/EfficiencyScatterChart';
import { WeekdayHeatmap } from '@/components/dashboard/WeekdayHeatmap';
import { AIInsightsCard } from '@/components/dashboard/AIInsightsCard';
import { AnomalyAlertsWidget } from '@/components/dashboard/AnomalyAlertsWidget';
import { DateRangeFilter } from '@/components/dashboard/DateRangeFilter';
import { useMetaDashboard, MetaDatePreset } from '@/hooks/useMetaDashboard';
import { useCampaignNotifications } from '@/hooks/useCampaignNotifications';
import { useAuth } from '@/hooks/useAuth';
import { Sparkles, MessageCircle, Loader2, Plug, ShieldCheck, BarChart3, TrendingUp, ArrowRight } from 'lucide-react';
import { MetaRefreshIndicator } from '@/components/dashboard/MetaRefreshIndicator';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'Usuário';
  const [dateRange, setDateRange] = useState<MetaDatePreset>('last_7d');
  const [isSending, setIsSending] = useState(false);

  const {
    isConnected, isLoading, kpis, trendData, campaignData,
    dailySpendData, bestCreatives, worstCreatives, performanceSummary,
    anomalies,
    isTrendLoading, isCampaignLoading, isAdLoading, isSpendLoading,
    isRefreshing, lastUpdated, refreshAll,
  } = useMetaDashboard(dateRange);

  const handleSendWhatsApp = async () => {
    setIsSending(true);
    try {
      const spend = kpis.find(k => k.id === 'gasto')?.value || 0;
      const impressions = kpis.find(k => k.id === 'impressoes')?.value || 0;
      const clicks = kpis.find(k => k.id === 'cliques')?.value || 0;
      const ctr = kpis.find(k => k.id === 'ctr')?.value || 0;
      const cpc = kpis.find(k => k.id === 'cpc')?.value || 0;

      const reportContent = `📊 *RELATÓRIO META ADS*\n\n💰 *MÉTRICAS*\n\nInvestimento: R$ ${spend.toLocaleString('pt-BR')}\nImpressões: ${impressions.toLocaleString('pt-BR')}\nCliques: ${clicks.toLocaleString('pt-BR')}\nCTR: ${ctr.toFixed(2)}%\nCPC: R$ ${cpc.toFixed(2)}\nAlcance: ${(performanceSummary?.totalReach || 0).toLocaleString('pt-BR')}\nCPM: R$ ${(performanceSummary?.avgCPM || 0).toFixed(2)}\n\n✅ Relatório gerado por HumanizeAI`;

      const { data, error } = await supabase.functions.invoke('send-whatsapp-report', {
        body: { action: 'send_report', reportContent },
      });

      if (error) throw error;
      if (data?.success) {
        toast({ title: 'Relatório enviado! 🎉', description: 'Confira seu WhatsApp.' });
      } else {
        throw new Error(data?.error || 'Falha ao enviar relatório');
      }
    } catch (err: any) {
      console.error('Error sending WhatsApp report:', err);
      toast({
        title: 'Erro ao enviar',
        description: err.message || 'Verifique a configuração em Settings > WhatsApp.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  // Empty State
  if (!isConnected && !isLoading) {
    return (
      <MainLayout>
        <div className="flex flex-1 items-center justify-center py-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg"
          >
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden">
              {/* Decorative top gradient */}
              <div className="h-2 w-full gradient-primary" />
              <CardContent className="flex flex-col items-center gap-6 p-8 text-center">
                {/* Illustration */}
                <div className="relative">
                  <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-primary/10">
                    <BarChart3 className="h-12 w-12 text-primary" />
                  </div>
                  <motion.div
                    animate={{ y: [0, -5, 0] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="absolute -right-2 -top-2 flex h-10 w-10 items-center justify-center rounded-full bg-warning/20"
                  >
                    <TrendingUp className="h-5 w-5 text-warning" />
                  </motion.div>
                </div>

                <div className="space-y-2">
                  <h2 className="text-2xl font-bold text-foreground">
                    Seus dados estão esperando! 📊
                  </h2>
                  <p className="text-muted-foreground leading-relaxed">
                    Conecte sua conta de anúncios para ver seus resultados em tempo real, 
                    com gráficos, métricas e dicas da nossa IA.
                  </p>
                </div>

                {/* Benefits */}
                <div className="w-full space-y-2">
                  {[
                    { icon: BarChart3, text: 'Métricas atualizadas automaticamente' },
                    { icon: Sparkles, text: 'Insights inteligentes com IA' },
                    { icon: ShieldCheck, text: 'Seus dados 100% seguros' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg bg-muted/50 p-3 text-left">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <item.icon className="h-4 w-4 text-primary" />
                      </div>
                      <span className="text-sm text-foreground">{item.text}</span>
                    </div>
                  ))}
                </div>

                <div className="flex w-full flex-col gap-2 sm:flex-row">
                  <Button
                    onClick={() => navigate('/connect-accounts')}
                    className="flex-1 gradient-primary text-primary-foreground h-12 text-base"
                  >
                    <Plug className="mr-2 h-5 w-5" />
                    Conectar minha conta
                  </Button>
                  <Button
                    onClick={() => navigate('/settings')}
                    variant="outline"
                    className="flex-1"
                  >
                    Configurações
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  ✦ Leva menos de 2 minutos para configurar ✦
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </MainLayout>
    );
  }

  const defaultInsights = [
    { id: '1', type: 'opportunity' as const, title: 'Análise de Performance Disponível', description: 'Clique no botão de atualizar para gerar insights automáticos com IA sobre suas campanhas.', impact: 'Recomendado' },
    { id: '2', type: 'info' as const, title: 'Otimização de Orçamento', description: 'A IA analisa a distribuição do seu investimento e sugere realocações para maximizar resultados.' },
    { id: '3', type: 'warning' as const, title: 'Monitoramento Contínuo', description: 'Insights são gerados com base nos últimos 7 dias de dados da sua conta Meta Ads.', impact: 'Automático' },
    { id: '4', type: 'success' as const, title: 'Benchmarks do Setor', description: 'Compare seus KPIs com médias do mercado e identifique oportunidades de crescimento.' },
  ];

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold lg:text-3xl">Olá, {firstName}! 👋</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              <span>Painel de Performance — seus anúncios em tempo real</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <MetaRefreshIndicator
              isRefreshing={isRefreshing}
              lastUpdated={lastUpdated}
              onRefresh={refreshAll}
            />
            <DateRangeFilter value={dateRange} onChange={setDateRange} />
            <Button onClick={handleSendWhatsApp} disabled={isSending} size="sm"
              className="h-8 gap-1.5 bg-success hover:bg-success/90 text-success-foreground">
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
              <span className="hidden sm:inline">Enviar WhatsApp</span>
            </Button>
          </div>
        </motion.div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8">
          {isLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[100px] rounded-lg" />
            ))
          ) : (
            kpis.map((kpi, index) => <DashboardKPICard key={kpi.id} kpi={kpi} index={index} />)
          )}
        </div>

        {/* Anomaly Alerts */}
        <AnomalyAlertsWidget anomalies={anomalies} />

        {/* Performance Summary */}
        {performanceSummary && (
          <PerformanceSummary {...performanceSummary} />
        )}

        {/* Trend Chart */}
        <TrendChart data={trendData} isLoading={isTrendLoading} />

        {/* 2-column grid: Donut + Efficiency Scatter */}
        <div className="grid gap-6 lg:grid-cols-2">
          <SpendDistributionChart data={campaignData} isLoading={isCampaignLoading} />
          <EfficiencyScatterChart data={campaignData} isLoading={isCampaignLoading} />
        </div>

        {/* 2-column grid: Weekday Heatmap + AI Insights */}
        <div className="grid gap-6 lg:grid-cols-2">
          <WeekdayHeatmap data={trendData} isLoading={isTrendLoading} />
          <AIInsightsCard insights={defaultInsights} />
        </div>

        {/* Campaign Table */}
        <FunnelTable data={campaignData} isLoading={isCampaignLoading} />

        {/* Daily Spend + Creative Alerts */}
        <DailySpendChart data={dailySpendData} isLoading={isSpendLoading} />
        <CreativeAlertsWidget bestCreatives={bestCreatives} worstCreatives={worstCreatives} isLoading={isAdLoading} />
      </div>
    </MainLayout>
  );
}
