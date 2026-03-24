import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CreativeWithScore {
  id: string;
  name: string;
  file_url: string;
  thumbnail_url: string | null;
  file_type: string;
  category: string;
  nicho: string | null;
  tags: string[];
  style: string | null;
  description: string | null;
  dimensions: string | null;
  // Performance
  performance_score: number;
  total_impressions: number;
  total_clicks: number;
  total_spend: number;
  total_conversions: number;
  avg_ctr: number;
  avg_roas: number;
  times_used: number;
  fatigue_score: number;
  best_audience: string | null;
  best_objective: string | null;
  created_by: string;
  ai_score: number | null;
  is_favorite: boolean;
  created_at: string;
}

export interface CreativePerformance {
  id: string;
  creative_id: string;
  campaign_id_meta: string;
  ad_id_meta: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  cpc: number;
  roas: number;
  performance_score: number;
  status: string;
  first_served_at: string | null;
  last_metric_update: string | null;
}

export interface ABTest {
  id: string;
  campaign_id_meta: string;
  test_name: string | null;
  variant_a_id: string | null;
  variant_b_id: string | null;
  status: string;
  winner: string | null;
  winner_creative_id: string | null;
  confidence_level: number | null;
  improvement_pct: number | null;
  started_at: string;
  concluded_at: string | null;
}

export interface SelectionLogEntry {
  id: string;
  creative_id: string;
  campaign_id_meta: string | null;
  action: string;
  reason: string | null;
  score_at_selection: number | null;
  created_at: string;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useCreativeIntelligence() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  // ── Get ranked creatives (for JOSÉ to pick from) ──
  const getRankedCreatives = useCallback(async (opts?: {
    category?: string;
    nicho?: string;
    fileType?: string;
    objective?: string;
    limit?: number;
    excludeExhausted?: boolean;
  }) => {
    if (!user?.id) return [];
    setIsLoading(true);
    try {
      let query = supabase
        .from('creative_uploads')
        .select('*')
        .eq('user_id', user.id)
        .order('performance_score', { ascending: false })
        .order('ai_score', { ascending: false, nullsFirst: false })
        .limit(opts?.limit || 20);

      if (opts?.category) query = query.eq('category', opts.category);
      if (opts?.nicho) query = query.eq('nicho', opts.nicho);
      if (opts?.fileType) query = query.eq('file_type', opts.fileType);
      if (opts?.excludeExhausted) query = query.lt('fatigue_score', 70);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as CreativeWithScore[];
    } catch (err: any) {
      console.error('Error fetching ranked creatives:', err);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  // ── Get creative performance history ──
  const getCreativePerformance = useCallback(async (creativeId: string) => {
    if (!user?.id) return [];
    try {
      const { data, error } = await supabase
        .from('creative_performance')
        .select('*')
        .eq('user_id', user.id)
        .eq('creative_id', creativeId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as unknown as CreativePerformance[];
    } catch (err: any) {
      console.error('Error fetching performance:', err);
      return [];
    }
  }, [user?.id]);

  // ── Get active AB tests ──
  const getABTests = useCallback(async (status?: string) => {
    if (!user?.id) return [];
    try {
      let query = supabase
        .from('creative_ab_tests' as any)
        .select('*')
        .eq('user_id', user.id)
        .order('started_at', { ascending: false });

      if (status) query = query.eq('status', status);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as ABTest[];
    } catch (err: any) {
      console.error('Error fetching AB tests:', err);
      return [];
    }
  }, [user?.id]);

  // ── Get selection log ──
  const getSelectionLog = useCallback(async (limit = 50) => {
    if (!user?.id) return [];
    try {
      const { data, error } = await supabase
        .from('creative_selection_log' as any)
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data || []) as unknown as SelectionLogEntry[];
    } catch (err: any) {
      console.error('Error fetching selection log:', err);
      return [];
    }
  }, [user?.id]);

  // ── Smart select best creatives for a campaign ──
  const smartSelect = useCallback(async (opts: {
    campaignObjective?: string;
    targetAudience?: string;
    nicho?: string;
    count?: number;
  }) => {
    if (!user?.id) return [];
    try {
      const { data, error } = await supabase.functions.invoke('apollo-agent', {
        body: {
          action: 'smart_select_creatives',
          objective: opts.campaignObjective,
          audience: opts.targetAudience,
          nicho: opts.nicho,
          count: opts.count || 3,
        },
      });
      if (error) throw error;
      return data?.selected || [];
    } catch (err: any) {
      toast({ title: 'Erro na seleção inteligente', description: err.message, variant: 'destructive' });
      return [];
    }
  }, [user?.id, toast]);

  // ── Request creative variation from MARIA ──
  const requestVariation = useCallback(async (creativeId: string, instructions?: string) => {
    if (!user?.id) return null;
    try {
      const { data, error } = await supabase.functions.invoke('generate-creative', {
        body: {
          action: 'generate_variation',
          source_creative_id: creativeId,
          instructions: instructions || 'Gere uma variação visual mantendo a mesma mensagem',
        },
      });
      if (error) throw error;
      toast({ title: 'Variação solicitada', description: 'MARIA está gerando uma nova variação do criativo.' });
      return data;
    } catch (err: any) {
      toast({ title: 'Erro ao gerar variação', description: err.message, variant: 'destructive' });
      return null;
    }
  }, [user?.id, toast]);

  // ── Get dashboard stats ──
  const getStats = useCallback(async () => {
    if (!user?.id) return null;
    try {
      const [uploads, performances, tests] = await Promise.all([
        supabase.from('creative_uploads').select('id, performance_score, fatigue_score, times_used, total_impressions, avg_ctr, avg_roas, file_type, created_by').eq('user_id', user.id),
        supabase.from('creative_performance').select('id, status, performance_score').eq('user_id', user.id),
        supabase.from('creative_ab_tests' as any).select('id, status, winner').eq('user_id', user.id),
      ]);

      const creatives = (uploads.data || []) as any[];
      const perfs = (performances.data || []) as any[];
      const abTests = (tests.data || []) as any[];

      const totalCreatives = creatives.length;
      const avgScore = totalCreatives > 0
        ? Math.round(creatives.reduce((s, c) => s + (c.performance_score || 50), 0) / totalCreatives)
        : 0;
      const exhausted = creatives.filter(c => (c.fatigue_score || 0) >= 70).length;
      const topPerformers = creatives.filter(c => (c.performance_score || 0) >= 75).length;
      const activeInAds = perfs.filter(p => p.status === 'active').length;
      const runningTests = abTests.filter(t => t.status === 'running').length;
      const byBezalel = creatives.filter(c => c.created_by === 'miriam').length;
      const byUser = creatives.filter(c => c.created_by === 'usuario').length;

      return {
        totalCreatives,
        avgScore,
        exhausted,
        topPerformers,
        activeInAds,
        runningTests,
        completedTests: abTests.filter(t => t.status === 'concluded').length,
        byBezalel,
        byUser,
      };
    } catch {
      return null;
    }
  }, [user?.id]);

  return {
    isLoading,
    getRankedCreatives,
    getCreativePerformance,
    getABTests,
    getSelectionLog,
    smartSelect,
    requestVariation,
    getStats,
  };
}
