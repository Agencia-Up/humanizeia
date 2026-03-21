import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface PipelineStage {
  id: string;
  user_id: string;
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
  follow_up_date: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
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
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [leads, setLeads] = useState<CRMLead[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [stagesRes, leadsRes] = await Promise.all([
        supabase.from('crm_pipeline_stages').select('*').eq('user_id', user.id).order('position'),
        supabase.from('crm_leads').select('*').eq('user_id', user.id).order('position'),
      ]);

      let stagesData = (stagesRes.data || []) as unknown as PipelineStage[];

      // Seed default stages if none exist
      if (stagesData.length === 0) {
        const toInsert = DEFAULT_STAGES.map((s) => ({ ...s, user_id: user.id, is_default: true }));
        const { data } = await supabase.from('crm_pipeline_stages').insert(toInsert).select();
        stagesData = (data || []) as unknown as PipelineStage[];
      }

      setStages(stagesData);
      setLeads((leadsRes.data || []) as unknown as CRMLead[]);
    } catch {
      toast.error('Erro ao carregar CRM');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const addLead = async (lead: Partial<CRMLead>) => {
    if (!user) return;
    const { data: insertedLead, error } = await supabase.from('crm_leads').insert({ ...lead, user_id: user.id } as never).select().single();
    if (error) { toast.error('Erro ao criar lead'); return; }
    toast.success('Lead criado!');
    
    // Dispara webhook de Novo Lead se houver automação
    try {
      const { data: automations } = await supabase
        .from('wa_automations')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .eq('trigger_event', 'new_lead')
        .eq('action_type', 'notify_webhook');
        
      if (automations && automations.length > 0) {
        automations.forEach(async (auto) => {
          const config = auto.action_config as Record<string, any>;
          if (config?.webhook_url) {
            fetch(config.webhook_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lead: insertedLead, event: 'new_lead' })
            }).catch(console.error);
          }
        });
      }
    } catch (err) {
      console.warn('Erro ao disparar webhook:', err);
    }
    
    fetchData();
  };

  const updateLead = async (id: string, updates: Partial<CRMLead>) => {
    const { error } = await supabase.from('crm_leads').update(updates as never).eq('id', id);
    if (error) { toast.error('Erro ao atualizar lead'); return; }
    fetchData();
  };

  const deleteLead = async (id: string) => {
    const { error } = await supabase.from('crm_leads').delete().eq('id', id);
    if (error) { toast.error('Erro ao excluir lead'); return; }
    toast.success('Lead excluído');
    fetchData();
  };

  const moveLead = async (leadId: string, newStageId: string, newPosition: number) => {
    // Optimistic update
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, stage_id: newStageId, position: newPosition } : l))
    );
    const { error } = await supabase
      .from('crm_leads')
      .update({ stage_id: newStageId, position: newPosition } as never)
      .eq('id', leadId);
    if (error) { toast.error('Erro ao mover lead'); fetchData(); }
  };

  const getLeadsByStage = (stageId: string) =>
    leads.filter((l) => l.stage_id === stageId).sort((a, b) => a.position - b.position);

  const totalValue = leads.reduce((sum, l) => sum + (l.value || 0), 0);

  return {
    stages, leads, loading,
    addLead, updateLead, deleteLead, moveLead,
    getLeadsByStage, totalValue, refetch: fetchData,
  };
}
