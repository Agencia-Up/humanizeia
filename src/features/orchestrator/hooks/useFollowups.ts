import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface FollowupTask {
  id: string;
  lead_id: string;
  user_id: string;
  scheduled_for: string;
  status: 'pending' | 'completed' | 'cancelled';
  message_content: string | null;
  created_at: string;
}

export const useFollowups = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: followups = [], isLoading } = useQuery({
    queryKey: ['followup-queue', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('followup_queue' as any)
        .select(`
          *,
          crm_leads (
            name,
            company,
            phone
          )
        `)
        .eq('user_id', user.id)
        .order('scheduled_for', { ascending: true });

      if (error) throw error;
      return data as any[];
    },
    enabled: !!user,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string, status: string }) => {
      const { error } = await supabase
        .from('followup_queue')
        .update({ status } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['followup-queue'] });
      toast.success('Status do follow-up atualizado!');
    },
  });

  const overdue = followups.filter(f => f.status === 'pending' && new Date(f.scheduled_for) < new Date());
  const today = followups.filter(f => {
    const d = new Date(f.scheduled_for);
    const now = new Date();
    return f.status === 'pending' && 
           d.getDate() === now.getDate() && 
           d.getMonth() === now.getMonth() && 
           d.getFullYear() === now.getFullYear();
  });
  const upcoming = followups.filter(f => f.status === 'pending' && new Date(f.scheduled_for) > new Date() && !today.includes(f));

  return {
    followups,
    overdue,
    today,
    upcoming,
    isLoading,
    updateStatus: updateStatusMutation.mutate,
  };
};
