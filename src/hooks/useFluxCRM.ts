import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

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
  const { isSeller, seller, loading: sellerLoading } = useSellerProfile(user?.id);
  const effectiveUserId = useMemo(() => {
    if (sellerLoading) return null;
    if (isSeller && seller?.user_id) return seller.user_id;
    return user?.id || null;
  }, [sellerLoading, isSeller, seller, user]);
  const queryClient = useQueryClient();

  // Load Stages
  const { data: stages = [], isLoading: loadingStages } = useQuery({
    queryKey: ['crm-stages', effectiveUserId],
    queryFn: async () => {
      if (!effectiveUserId) return [];
      const { data, error } = await supabase
        .from('crm_pipeline_stages')
        .select('*')
        .eq('user_id', effectiveUserId)
        .order('position');

      if (error) throw error;

      let stagesData = (data || []) as unknown as PipelineStage[];

      // Seed default stages if none exist
      if (stagesData.length === 0) {
        const toInsert = DEFAULT_STAGES.map((s) => ({ ...s, user_id: effectiveUserId, is_default: true }));
        await supabase
          .from('crm_pipeline_stages')
          .upsert(toInsert, { onConflict: 'user_id,name', ignoreDuplicates: true });

        const { data: fresh } = await supabase
          .from('crm_pipeline_stages')
          .select('*')
          .eq('user_id', effectiveUserId)
          .order('position');

        stagesData = (fresh || []) as unknown as PipelineStage[];
      }
      return stagesData;
    },
    enabled: !!effectiveUserId,
  });

  // Load Leads
  const { data: leads = [], isLoading: loadingLeads, refetch: refetchLeads } = useQuery({
    queryKey: ['crm-leads', effectiveUserId],
    queryFn: async () => {
      if (!effectiveUserId) return [];
      const { data, error } = await supabase
        .from('crm_leads')
        .select('*')
        .eq('user_id', effectiveUserId)
        .order('position');

      if (error) throw error;
      return (data || []) as unknown as CRMLead[];
    },
    enabled: !!effectiveUserId,
  });

  // Mutations
  const addLeadMutation = useMutation({
    mutationFn: async (lead: Partial<CRMLead>) => {
      if (!effectiveUserId) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('crm_leads')
        .insert({ ...lead, user_id: effectiveUserId } as never)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (insertedLead) => {
      toast.success('Lead criado!');
      queryClient.invalidateQueries({ queryKey: ['crm-leads', effectiveUserId] });
      triggerWebhook(insertedLead);
    },
    onError: () => toast.error('Erro ao criar lead'),
  });

  const moveLeadMutation = useMutation({
    mutationFn: async ({ leadId, stageId, position }: { leadId: string, stageId: string, position: number }) => {
      const { error } = await supabase
        .from('crm_leads')
        .update({ stage_id: stageId, position } as never)
        .eq('id', leadId);
      if (error) throw error;
    },
    // ── Optimistic update: move card instantly, rollback on failure ──────────
    onMutate: async ({ leadId, stageId, position }) => {
      await queryClient.cancelQueries({ queryKey: ['crm-leads', effectiveUserId] });
      const previousLeads = queryClient.getQueryData<CRMLead[]>(['crm-leads', effectiveUserId]);
      queryClient.setQueryData<CRMLead[]>(['crm-leads', effectiveUserId], (old = []) =>
        old.map((l) => l.id === leadId ? { ...l, stage_id: stageId, position } : l)
      );
      return { previousLeads };
    },
    onError: (err, _, context) => {
      if (context?.previousLeads) {
        queryClient.setQueryData(['crm-leads', effectiveUserId], context.previousLeads);
      }
      console.error(err);
      toast.error('Erro ao mover lead');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-leads', effectiveUserId] });
    },
  });

  const updateLeadMutation = useMutation({
    mutationFn: async ({ leadId, data }: { leadId: string, data: Partial<CRMLead> }) => {
      const { error } = await supabase
        .from('crm_leads')
        .update(data as never)
        .eq('id', leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-leads', effectiveUserId] });
      toast.success('Lead atualizado!');
    },
    onError: () => toast.error('Erro ao atualizar lead'),
  });

  const triggerWebhook = async (lead: any) => {
    if (!effectiveUserId) return;
    try {
      const { data: automations } = await supabase
        .from('wa_automations')
        .select('*')
        .eq('user_id', effectiveUserId)
        .eq('is_active', true)
        .eq('trigger_event', 'new_lead')
        .eq('action_type', 'notify_webhook');

      if (automations && automations.length > 0) {
        // Usar Promise.all para aguardar todos os disparos (evita forEach+async com promises perdidas)
        await Promise.all(
          automations.map(async (auto) => {
            const config = auto.action_config as Record<string, any>;
            if (!config?.webhook_url) return;
            try {
              const res = await fetch(config.webhook_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lead, event: 'new_lead' }),
              });
              if (!res.ok) {
                console.warn(`Webhook retornou ${res.status} para ${config.webhook_url}`);
              }
            } catch (fetchErr) {
              console.error(`Falha ao chamar webhook ${config.webhook_url}:`, fetchErr);
            }
          })
        );
      }
    } catch (err) {
      console.warn('Erro ao disparar webhook:', err);
    }
  };

  const deleteLead = async (id: string) => {
    const { error } = await supabase.from('crm_leads').delete().eq('id', id);
    if (error) { toast.error('Erro ao excluir lead'); return; }
    toast.success('Lead excluído');
    queryClient.invalidateQueries({ queryKey: ['crm-leads', effectiveUserId] });
  };

  const updateLead = async (id: string, updates: Partial<CRMLead>) => {
    const { error } = await supabase
      .from('crm_leads')
      .update(updates as never)
      .eq('id', id);
    if (error) { toast.error('Erro ao atualizar lead'); return; }
    toast.success('Lead atualizado!');
    queryClient.invalidateQueries({ queryKey: ['crm-leads', effectiveUserId] });
  };

  const totalValue = leads.reduce((sum, l) => sum + (l.value || 0), 0);

  return {
    stages,
    leads,
    loading: loadingStages || loadingLeads,
    addLead: addLeadMutation.mutateAsync,
    updateLead: (leadId: string, data: Partial<CRMLead>) => updateLeadMutation.mutate({ leadId, data }),
    deleteLead,
    moveLead: (leadId: string, newStageId: string, newPosition: number) => 
      moveLeadMutation.mutate({ leadId, stageId: newStageId, position: newPosition }),
    getLeadsByStage: (stageId: string) =>
      leads.filter((l) => l.stage_id === stageId).sort((a, b) => a.position - b.position),
    totalValue,
    refetch: refetchLeads,
  };
}

