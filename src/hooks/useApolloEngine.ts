import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

export interface HealthScore {
  id: string;
  score: number;
  stage: string;
  trend: string | null;
  previous_score: number | null;
  metrics: Record<string, number> | null;
  campaign_id: string | null;
  calculated_at: string;
}

export interface Diagnostic {
  id: string;
  stage: string;
  severity: string;
  category: string | null;
  problem: string;
  cause: string;
  diagnosis: string;
  evidence: any;
  is_resolved: boolean;
  campaign_id: string | null;
  created_at: string;
}

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  action_type: string;
  impact_estimate: string | null;
  priority: number | null;
  status: string | null;
  campaign_id: string | null;
  created_at: string;
}

export interface ApolloAlert {
  id: string;
  level: string;
  title: string;
  description: string;
  metric: string | null;
  current_value: string | null;
  benchmark_value: string | null;
  deviation: string | null;
  actions: string[] | null;
  is_read: boolean | null;
  is_dismissed: boolean | null;
  campaign_id: string | null;
  created_at: string;
}

export interface DiagnosticResult {
  health_score: { score: number; stage: string; trend: string; previous_score: number | null };
  diagnostics: Diagnostic[];
  recommendations: Recommendation[];
  alerts: ApolloAlert[];
  metrics: Record<string, number>;
  benchmarks: Record<string, number>;
}

export interface ApolloDashboardData {
  health_scores: HealthScore[];
  diagnostics: Diagnostic[];
  recommendations: Recommendation[];
  alerts: ApolloAlert[];
}

export function useApolloEngine() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [dashboardData, setDashboardData] = useState<ApolloDashboardData | null>(null);

  const runDiagnostic = useCallback(async (
    campaignId?: string,
    metrics?: Record<string, number>
  ): Promise<DiagnosticResult | null> => {
    if (!user) return null;
    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('apollo-analyze', {
        body: { user_id: user.id, campaign_id: campaignId || null, metrics: metrics || null, action: 'diagnose' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const diagCount = data.diagnostics?.length || 0;
      if (diagCount > 0) {
        toast({ title: `Diagnóstico concluído`, description: `${diagCount} problema(s) encontrado(s). Health Score: ${data.health_score?.score}` });
      } else {
        toast({ title: 'Tudo saudável! ✅', description: `Health Score: ${data.health_score?.score}` });
      }
      return data;
    } catch (err: any) {
      toast({ title: 'Erro no diagnóstico', description: err.message, variant: 'destructive' });
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, [user, toast]);

  const loadDashboard = useCallback(async (): Promise<ApolloDashboardData | null> => {
    if (!user) return null;
    try {
      const { data, error } = await supabase.functions.invoke('apollo-analyze', {
        body: { user_id: user.id, action: 'summary' },
      });
      if (error) throw error;
      setDashboardData(data);
      return data;
    } catch (err: any) {
      console.error('Apollo dashboard error:', err);
      return null;
    }
  }, [user]);

  const executeRecommendation = useCallback(async (recommendationId: string) => {
    if (!user) return false;
    try {
      const { data, error } = await supabase.functions.invoke('apollo-analyze', {
        body: { user_id: user.id, action: 'execute_recommendation', recommendation_id: recommendationId },
      });
      if (error) throw error;
      toast({ title: 'Ação executada!', description: 'Recomendação marcada como aplicada.' });
      await loadDashboard();
      return true;
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
      return false;
    }
  }, [user, toast, loadDashboard]);

  const dismissAlert = useCallback(async (alertId: string) => {
    if (!user) return;
    try {
      const { error } = await supabase.functions.invoke('apollo-analyze', {
        body: { user_id: user.id, action: 'dismiss_alert', alert_id: alertId },
      });
      if (error) throw error;
      await loadDashboard();
    } catch (err: any) {
      console.error('Dismiss alert error:', err);
    }
  }, [user, loadDashboard]);

  const getUnreadAlertCount = useCallback(async (): Promise<number> => {
    if (!user) return 0;
    const { count, error } = await supabase
      .from('apollo_alerts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_dismissed', false)
      .eq('is_read', false);
    if (error) return 0;
    return count || 0;
  }, [user]);

  const markAlertsRead = useCallback(async () => {
    if (!user) return;
    await supabase
      .from('apollo_alerts')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false);
  }, [user]);

  return {
    isAnalyzing,
    dashboardData,
    runDiagnostic,
    loadDashboard,
    executeRecommendation,
    dismissAlert,
    getUnreadAlertCount,
    markAlertsRead,
  };
}
