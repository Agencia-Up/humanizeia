import { useState } from 'react';
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
import { DateRangeFilter } from '@/components/dashboard/DateRangeFilter';
import { useMetaDashboard, MetaDatePreset } from '@/hooks/useMetaDashboard';
import { useAuth } from '@/hooks/useAuth';
import { Sparkles, MessageCircle, Loader2, LinkIcon } from 'lucide-react';
import { MetaRefreshIndicator } from '@/components/dashboard/MetaRefreshIndicator';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

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

      const reportContent = `📊 *RELATÓRIO META ADS*\n\n💰 *MÉTRICAS*\n\nInvestimento: R$ ${spend.toLocaleString('pt-BR')}\nImpressões: ${impressions.toLocaleString('pt-BR')}\nCliques: ${clicks.toLocaleString('pt-BR')}\nCTR: ${ctr.toFixed(2)}%\nCPC: R$ ${cpc.toFixed(2)}\nAlcance: ${(performanceSummary?.totalReach || 0).toLocaleString('pt-BR')}\nCPM: R$ ${(performanceSummary?.avgCPM || 0).toFixed(2)}\n\n✅ Relatório gerado por MIDAS AI`;

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

  if (!isConnected && !isLoading) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <LinkIcon className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Conecte seu Meta Ads</h2>
          <p className="text-muted-foreground text-center max-w-md">
            Para ver seus dados reais, conecte sua conta do Meta Ads nas configurações.
          </p>
          <Button onClick={() => navigate('/settings')} className="gradient-primary">
            Ir para Configurações
          </Button>
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
              <span>Dashboard de Performance — Meta Ads</span>
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

        {/* KPI Cards — 8 cards in responsive grid */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8">
          {isLoading ? (
            Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)
          ) : (
            kpis.map((kpi, index) => <DashboardKPICard key={kpi.id} kpi={kpi} index={index} />)
          )}
        </div>

        {/* Performance Summary */}
        {performanceSummary && (
          <PerformanceSummary {...performanceSummary} />
        )}

        {/* Trend Chart — full width */}
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

        {/* Campaign Table — full width */}
        <FunnelTable data={campaignData} isLoading={isCampaignLoading} />

        {/* Daily Spend + Creative Alerts */}
        <DailySpendChart data={dailySpendData} isLoading={isSpendLoading} />
        <CreativeAlertsWidget bestCreatives={bestCreatives} worstCreatives={worstCreatives} isLoading={isAdLoading} />
      </div>
    </MainLayout>
  );
}
