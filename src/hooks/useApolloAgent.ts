import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface ApolloAction {
  campaign_id: string;
  adset_id?: string | null;
  campaign_name: string;
  action_type: 'pause' | 'activate' | 'increase_budget' | 'decrease_budget' | 'pause_adset' | 'activate_adset' | 'clone_campaign' | 'rotate_creative' | 'reallocate_budget' | 'notify';
  priority: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  impact: string;
  params?: Record<string, any>;
  auto_safe: boolean;
  confidence?: number;
}

export interface ApolloAdSet {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  reach: number;
  frequency: number;
  optimization_goal?: string;
}

export interface ApolloEnrichedCampaign {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective: string;
  daily_budget: number | null;
  lifetime_budget: number | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  reach: number;
  frequency: number;
  cpa: number;
  roas: number;
  conversions: number;
  health_score: number;
  adsets?: ApolloAdSet[];
}

export interface MetricSnapshot {
  snapshot_date: string;
  overall_health_score: number;
  avg_roas: number;
  avg_ctr: number;
  avg_cpc: number;
  avg_frequency: number;
  total_spend: number;
  wow_roas_delta: number | null;
  wow_ctr_delta: number | null;
  wow_cpc_delta: number | null;
  wow_health_delta: number | null;
  wow_spend_delta: number | null;
}

export interface ApolloSession {
  account: { id: string; name: string; currency: string; currencySymbol: string };
  campaigns: ApolloEnrichedCampaign[];
  health_score: number | null;
  summary: string | null;
  ai_analysis: string | null;
  actions: ApolloAction[];
  execution_log: any[];
  date_preset: string;
  analyzed_at: string;
  trend_context?: string;
  learning_context?: string;
  seasonal_context?: string;
  portfolio_context?: string;
  level?: number;
}

export interface ApolloCronConfig {
  is_enabled: boolean;
  run_hour: number;
  run_minute: number;
  timezone: string;
  date_preset: string;
  auto_execute: boolean;
  send_whatsapp_on_critical: boolean;
  whatsapp_report_number: string | null;
  send_daily_report: boolean;
  active_segment_slug: string | null;
  last_run_at?: string | null;
  next_run_at?: string | null;
}

export type ApolloDatePreset = 'today' | 'yesterday' | 'last_7d' | 'last_14d' | 'last_30d';

// ── Extrai a mensagem real de um erro de Edge Function ────────────
async function extractFnError(error: unknown): Promise<string> {
  try {
    // Supabase FunctionsHttpError: error.context é um Response object
    const ctx = (error as any)?.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json();
      if (body?.error) return body.error;
      if (body?.message) return body.message;
    }
    if (ctx && typeof ctx.text === 'function') {
      const text = await ctx.text();
      if (text) {
        try { const j = JSON.parse(text); return j?.error || j?.message || text; } catch { return text; }
      }
    }
  } catch { /* ignora */ }
  return (error as any)?.message || 'Erro desconhecido na Edge Function';
}

export function useApolloAgent() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<ApolloSession | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [pendingActions, setPendingActions] = useState<ApolloAction[]>([]);
  const [executedActions, setExecutedActions] = useState<any[]>([]);

  // ── Load last saved session (persists across page reloads) ──
  const loadSavedSession = useCallback(async (targetAccountId?: string) => {
    setIsLoadingSession(true);
    try {
      const { data, error } = await supabase.functions.invoke('apollo-agent', {
        body: { action: 'load_session', targetAccountId },
      });
      if (error || !data?.session) return null;

      const saved = data.session as ApolloSession;
      setSession(saved);
      setPendingActions(saved.actions || []);
      setExecutedActions(saved.execution_log || []);
      return saved;
    } catch {
      return null;
    } finally {
      setIsLoadingSession(false);
    }
  }, []);

  // ── Main analysis ──
  const analyze = useCallback(async (opts: {
    targetAccountId?: string;
    datePreset?: ApolloDatePreset;
    auto_execute?: boolean;
    viewMode?: 'simplified' | 'expert';
  } = {}) => {
    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('apollo-agent', {
        body: {
          action: 'analyze',
          targetAccountId: opts.targetAccountId,
          datePreset: opts.datePreset || 'last_30d',
          auto_execute: opts.auto_execute || false,
          viewMode: opts.viewMode || 'simplified',
        },
      });

      if (error) {
        const realMsg = await extractFnError(error);
        throw new Error(realMsg);
      }
      if (data?.error) throw new Error(data.error);

      setSession(data);
      const autoExecutedIds = new Set(
        (data.execution_log || []).map((e: any) => `${e.campaign_id}-${e.action_type}`)
      );
      const pending = (data.actions || []).filter((a: ApolloAction) =>
        !autoExecutedIds.has(`${a.campaign_id}-${a.action_type}`)
      );
      setPendingActions(pending);
      if (data.execution_log?.length) {
        setExecutedActions(prev => [...data.execution_log, ...prev]);
      }
      return data as ApolloSession;
    } catch (err: any) {
      toast({ title: 'JOSÉ — Erro na análise', description: err.message, variant: 'destructive' });
      throw err;
    } finally {
      setIsAnalyzing(false);
    }
  }, [toast]);

  // ── Execute action ──
  const executeAction = useMutation({
    mutationFn: async (action: ApolloAction & { targetAccountId?: string }) => {
      if (action.action_type === 'clone_campaign') {
        const { data, error } = await supabase.functions.invoke('apollo-agent', {
          body: {
            action: 'clone_campaign',
            targetAccountId: action.targetAccountId,
            campaignId: action.campaign_id,
            actionParams: {
              source_name: action.campaign_name,
              source_roas: action.params?.source_roas,
              source_spend: action.params?.source_spend,
            },
          },
        });
        if (error) {
          const realMsg = await extractFnError(error);
          throw new Error(realMsg);
        }
        if (data?.error) throw new Error(data.error);
        return data;
      }

      const { data, error } = await supabase.functions.invoke('apollo-agent', {
        body: {
          action: 'execute_action',
          targetAccountId: action.targetAccountId,
          campaignId: action.campaign_id,
          actionType: action.action_type,
          actionParams: action.params,
        },
      });
      if (error) {
        const realMsg = await extractFnError(error);
        throw new Error(realMsg);
      }
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data, variables) => {
      setPendingActions(prev => prev.filter(a =>
        !(a.campaign_id === variables.campaign_id && a.action_type === variables.action_type)
      ));
      setExecutedActions(prev => [{
        ...variables,
        result: data,
        executed_at: new Date().toISOString(),
        executed_by: 'user',
      }, ...prev]);
      const labels: Record<string, string> = {
        pause: 'Campanha pausada',
        activate: 'Campanha ativada',
        increase_budget: 'Orçamento aumentado',
        decrease_budget: 'Orçamento reduzido',
        pause_adset: 'Ad Set pausado',
        activate_adset: 'Ad Set ativado',
        clone_campaign: 'Campanha clonada com sucesso! Verifique no Meta Ads Manager.',
        rotate_creative: 'Rotação de criativo solicitada',
        reallocate_budget: 'Realocação de verba agendada',
      };
      toast({ title: labels[variables.action_type] || 'Ação executada!', description: variables.campaign_name });
      queryClient.invalidateQueries({ queryKey: ['jose-history'] });
    },
    onError: (err: any) => {
      toast({ title: 'Erro ao executar ação', description: err.message, variant: 'destructive' });
    },
  });

  // ── Get ad sets for a campaign ──
  const getAdSets = useMutation({
    mutationFn: async ({ campaignId, targetAccountId, datePreset }: { campaignId: string; targetAccountId?: string; datePreset?: string }) => {
      const { data, error } = await supabase.functions.invoke('apollo-agent', {
        body: { action: 'get_adsets', campaignId, targetAccountId, datePreset: datePreset || 'last_30d' },
      });
      if (error) throw error;
      return data?.adsets || [];
    },
  });

  const dismissAction = useCallback((action: ApolloAction) => {
    setPendingActions(prev => prev.filter(a =>
      !(a.campaign_id === action.campaign_id && a.action_type === action.action_type)
    ));
  }, []);

  // ── Test connection / diagnose ──
  const testConnection = useCallback(async (targetAccountId?: string) => {
    const { data, error } = await supabase.functions.invoke('apollo-agent', {
      body: { action: 'debug', targetAccountId },
    });
    if (error) {
      const realMsg = await extractFnError(error);
      throw new Error(realMsg);
    }
    return data as { user_id: string; accounts: any[]; timestamp: string };
  }, []);

  return {
    session,
    isAnalyzing,
    isLoadingSession,
    pendingActions,
    executedActions,
    analyze,
    loadSavedSession,
    executeAction,
    getAdSets,
    dismissAction,
    testConnection,
  };
}

// ── History hook ──
export function useApolloHistory(targetAccountId?: string) {
  return useQuery({
    queryKey: ['jose-history', targetAccountId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('apollo-agent', {
        body: { action: 'get_history', targetAccountId },
      });
      if (error) throw error;
      return data as { snapshots: MetricSnapshot[]; outcomes: any[]; clones: any[] };
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ── Cron config hook ──
export function useApolloCronConfig() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ['jose-cron-config'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('apollo-agent', {
        body: { action: 'get_cron_config' },
      });
      if (error) throw error;
      return data as ApolloCronConfig | null;
    },
    staleTime: 30 * 1000,
  });

  const saveConfig = useMutation({
    mutationFn: async (newConfig: Partial<ApolloCronConfig>) => {
      const { data, error } = await supabase.functions.invoke('apollo-agent', {
        body: { action: 'save_cron_config', ...newConfig },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['jose-cron-config'] });
      toast({
        title: vars.is_enabled ? '⏰ Auto-piloto ativado!' : 'Auto-piloto desativado',
        description: vars.is_enabled ? `JOSÉ analisará suas campanhas automaticamente às ${String(vars.run_hour ?? 8).padStart(2, '0')}:${String(vars.run_minute ?? 0).padStart(2, '0')} todos os dias.` : '',
      });
    },
    onError: (err: any) => {
      toast({ title: 'Erro ao salvar configuração', description: err.message, variant: 'destructive' });
    },
  });

  return { config, isLoading, saveConfig };
}
