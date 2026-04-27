import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { useEffect, useState } from 'react';
import type { FunnelStage } from '@/components/apollo/FunnelHealthCard';
import type { SmartAlert } from '@/components/apollo/SmartAlertCard';
import type { DiagnosticNode } from '@/components/apollo/DiagnosticTreeCard';

export function useApolloAnalyze() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (campaignId?: string) => {
      const { data, error } = await supabase.functions.invoke('apollo-analyze', {
        body: { campaign_id: campaignId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['apollo-health'] });
      queryClient.invalidateQueries({ queryKey: ['apollo-diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['apollo-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['apollo-recommendations'] });
      if (data.status === 'no_data') {
        toast.info('Nenhuma campanha ativa encontrada para análise');
      } else {
        toast.success(`Análise concluída: ${data.diagnostics_count} diagnósticos, ${data.recommendations_count} recomendações`);
      }
    },
    onError: (err: any) => toast.error(err.message),
  });
}

export function useApolloHealthScores() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['apollo-health', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('apollo_health_scores' as any)
        .select('*')
        .order('calculated_at', { ascending: false })
        .limit(4);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!user,
  });
}

export function useApolloDiagnostics() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['apollo-diagnostics', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('apollo_diagnostics' as any)
        .select('*')
        .eq('is_resolved', false)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!user,
  });
}

export function useApolloAlerts() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['apollo-alerts', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('apollo_alerts' as any)
        .select('*')
        .eq('is_dismissed', false)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!user,
  });

  // Realtime subscription for new alerts — filtrado pelo user para não receber eventos de outros usuários
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`apollo-alerts-realtime-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'apollo_alerts',
        filter: `user_id=eq.${user.id}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['apollo-alerts'] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, queryClient]);

  return query;
}

export function useApolloRecommendations() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['apollo-recommendations', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('apollo_recommendations' as any)
        .select('*')
        .in('status', ['pending', 'approved'])
        .order('priority', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!user,
  });
}

export function useApproveRecommendation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (recommendationId: string) => {
      const { data, error } = await supabase.functions.invoke('apollo-analyze', {
        body: { action: 'approve_recommendation', recommendation_id: recommendationId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apollo-recommendations'] });
      toast.success('Recomendação aprovada');
    },
  });
}

export function useDismissAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (alertId: string) => {
      const { data, error } = await supabase.functions.invoke('apollo-analyze', {
        body: { action: 'dismiss_alert', alert_id: alertId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apollo-alerts'] });
    },
  });
}

// Transform DB data to component props
export function useApolloSidebarData() {
  const { data: healthData } = useApolloHealthScores();
  const { data: diagData } = useApolloDiagnostics();
  const { data: alertData } = useApolloAlerts();

  const stageIconMap: Record<string, FunnelStage['icon']> = {
    topo: 'impressions',
    meio: 'clicks',
    fundo: 'sales',
    pos_venda: 'retention',
  };

  const stageNameMap: Record<string, string> = {
    topo: 'Topo de Funil',
    meio: 'Meio de Funil',
    fundo: 'Fundo de Funil',
    pos_venda: 'Pós-Venda',
  };

  const funnelStages: FunnelStage[] = (healthData || []).map((h: any) => ({
    name: stageNameMap[h.stage] || h.stage,
    score: h.score,
    metric: h.stage === 'topo' ? 'CTR' : h.stage === 'meio' ? 'CPC' : h.stage === 'fundo' ? 'ROAS' : 'LTV',
    value: h.metrics?.ctr ? `${h.metrics.ctr.toFixed(2)}%`
      : h.metrics?.cpc ? `R$ ${h.metrics.cpc.toFixed(2)}`
      : h.metrics?.roas ? `${h.metrics.roas.toFixed(2)}x`
      : '-',
    benchmark: '-',
    icon: stageIconMap[h.stage] || 'impressions',
  }));

  const diagnostics: DiagnosticNode[] = (diagData || []).map((d: any) => ({
    problem: d.problem,
    diagnosis: d.diagnosis,
    cause: d.cause,
    severity: d.severity === 'critical' ? 'high' : d.severity as any,
    recommendations: [],
    resolved: d.is_resolved,
  }));

  const alerts: SmartAlert[] = (alertData || []).map((a: any) => ({
    id: a.id,
    level: a.level as any,
    title: a.title,
    description: a.description,
    metric: a.metric,
    currentValue: a.current_value,
    benchmark: a.benchmark_value,
    deviation: a.deviation,
    actions: a.actions || [],
    timestamp: new Date(a.created_at),
  }));

  return {
    funnelStages,
    diagnostics,
    alerts,
    unreadCount: alerts.filter((a) => !a.id).length || alerts.length,
  };
}
