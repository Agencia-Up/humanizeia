import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface Pipeline {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface PipelineStage {
  id: string;
  user_id: string;
  pipeline_id: string | null;
  name: string;
  color: string;
  position: number;
  is_default: boolean;
}

export interface CRMLead {
  id: string;
  user_id: string;
  stage_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  value: number;
  currency: string;
  source: string | null;
  tags: string[];
  notes: string | null;
  position: number;
  priority: string;
  expected_close_date: string | null;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const DEFAULT_STAGES = [
  { name: 'Novo Lead', color: '#6366f1', position: 0 },
  { name: 'Qualificado', color: '#f59e0b', position: 1 },
  { name: 'Proposta', color: '#3b82f6', position: 2 },
  { name: 'Negociação', color: '#8b5cf6', position: 3 },
  { name: 'Fechado', color: '#10b981', position: 4 },
];

export function useFluxCRM() {
  const { user } = useAuth();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [leads, setLeads] = useState<CRMLead[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch pipelines
  const fetchPipelines = useCallback(async () => {
    if (!user) return [];
    const { data } = await supabase
      .from('crm_pipelines')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('sort_order') as { data: Pipeline[] | null };

    let result = data || [];

    // Seed default pipeline if none exist
    if (result.length === 0) {
      const { data: newPipeline } = await supabase
        .from('crm_pipelines')
        .insert({ user_id: user.id, name: 'Pipeline Principal', is_default: true } as never)
        .select()
        .single();
      if (newPipeline) {
        result = [newPipeline as unknown as Pipeline];
      }
    }

    setPipelines(result);
    return result;
  }, [user]);

  // Fetch stages and leads for active pipeline
  const fetchData = useCallback(async (pipelineId: string | null) => {
    if (!user || !pipelineId) return;
    setLoading(true);
    try {
      const [stagesRes, leadsRes] = await Promise.all([
        supabase
          .from('crm_pipeline_stages')
          .select('*')
          .eq('user_id', user.id)
          .eq('pipeline_id', pipelineId)
          .order('position'),
        supabase.from('crm_leads').select('*').eq('user_id', user.id).order('position'),
      ]);

      let stagesData = (stagesRes.data || []) as unknown as PipelineStage[];

      // Seed default stages if none exist for this pipeline
      if (stagesData.length === 0) {
        const toInsert = DEFAULT_STAGES.map((s) => ({
          ...s,
          user_id: user.id,
          pipeline_id: pipelineId,
          is_default: true,
        }));
        const { data } = await supabase.from('crm_pipeline_stages').insert(toInsert as never[]).select();
        stagesData = (data || []) as unknown as PipelineStage[];
      }

      setStages(stagesData);

      // Filter leads by stage ids belonging to this pipeline
      const stageIds = new Set(stagesData.map((s) => s.id));
      const allLeads = (leadsRes.data || []) as unknown as CRMLead[];
      setLeads(allLeads.filter((l) => l.stage_id && stageIds.has(l.stage_id)));
    } catch {
      toast.error('Erro ao carregar CRM');
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Initialize: fetch pipelines then select active
  useEffect(() => {
    if (!user) return;
    fetchPipelines().then((pips) => {
      if (pips.length > 0) {
        const defaultPip = pips.find((p) => p.is_default) || pips[0];
        setActivePipelineId(defaultPip.id);
      }
    });
  }, [user, fetchPipelines]);

  // When activePipelineId changes, fetch its data
  useEffect(() => {
    if (activePipelineId) {
      fetchData(activePipelineId);
    }
  }, [activePipelineId, fetchData]);

  // Pipeline CRUD
  const addPipeline = async (pipeline: { name: string; description?: string; color?: string }) => {
    if (!user) return;
    const { error, data } = await supabase
      .from('crm_pipelines')
      .insert({ user_id: user.id, ...pipeline } as never)
      .select()
      .single();
    if (error) { toast.error('Erro ao criar pipeline'); return; }
    toast.success('Pipeline criado!');
    await fetchPipelines();
    if (data) setActivePipelineId((data as unknown as Pipeline).id);
  };

  const updatePipeline = async (id: string, updates: Partial<Pipeline>) => {
    const { error } = await supabase.from('crm_pipelines').update(updates as never).eq('id', id);
    if (error) { toast.error('Erro ao atualizar pipeline'); return; }
    fetchPipelines();
  };

  const deletePipeline = async (id: string) => {
    const { error } = await supabase.from('crm_pipelines').update({ is_active: false } as never).eq('id', id);
    if (error) { toast.error('Erro ao excluir pipeline'); return; }
    toast.success('Pipeline removido');
    const pips = await fetchPipelines();
    if (pips.length > 0) setActivePipelineId(pips[0].id);
  };

  // Lead CRUD (same as before)
  const addLead = async (lead: Partial<CRMLead>) => {
    if (!user) return;
    const { error } = await supabase.from('crm_leads').insert({ ...lead, user_id: user.id } as never);
    if (error) { toast.error('Erro ao criar lead'); return; }
    toast.success('Lead criado!');
    fetchData(activePipelineId);
  };

  const updateLead = async (id: string, updates: Partial<CRMLead>) => {
    const { error } = await supabase.from('crm_leads').update(updates as never).eq('id', id);
    if (error) { toast.error('Erro ao atualizar lead'); return; }
    fetchData(activePipelineId);
  };

  const deleteLead = async (id: string) => {
    const { error } = await supabase.from('crm_leads').delete().eq('id', id);
    if (error) { toast.error('Erro ao excluir lead'); return; }
    toast.success('Lead excluído');
    fetchData(activePipelineId);
  };

  const moveLead = async (leadId: string, newStageId: string, newPosition: number) => {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, stage_id: newStageId, position: newPosition } : l))
    );
    const { error } = await supabase
      .from('crm_leads')
      .update({ stage_id: newStageId, position: newPosition } as never)
      .eq('id', leadId);
    if (error) { toast.error('Erro ao mover lead'); fetchData(activePipelineId); }
  };

  const getLeadsByStage = (stageId: string) =>
    leads.filter((l) => l.stage_id === stageId).sort((a, b) => a.position - b.position);

  const totalValue = leads.reduce((sum, l) => sum + (l.value || 0), 0);

  return {
    pipelines,
    activePipelineId,
    setActivePipelineId,
    stages,
    leads,
    loading,
    addPipeline,
    updatePipeline,
    deletePipeline,
    addLead,
    updateLead,
    deleteLead,
    moveLead,
    getLeadsByStage,
    totalValue,
    refetch: () => fetchData(activePipelineId),
  };
}
