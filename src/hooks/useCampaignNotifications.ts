import { useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useMetaDashboard, type Anomaly } from '@/hooks/useMetaDashboard';

export interface CampaignNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
  reference_type?: string;
  reference_id?: string;
  action_url?: string;
  action_label?: string;
}

export function useCampaignNotifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const shownAnomaliesRef = useRef<Set<string>>(new Set());

  // Fetch existing notifications
  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as CampaignNotification[];
    },
    enabled: !!user,
    refetchInterval: 60_000, // Refetch every minute
  });

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // Create notification from anomaly
  const createNotification = useCallback(async (anomaly: Anomaly) => {
    if (!user) return;

    const typeMap: Record<string, string> = {
      danger: 'alert',
      warning: 'warning',
      info: 'info',
    };

    await supabase.from('notifications').insert({
      user_id: user.id,
      title: anomaly.title,
      message: anomaly.description,
      type: typeMap[anomaly.type] || 'info',
      reference_type: 'anomaly',
      reference_id: anomaly.id,
      action_url: '/',
      action_label: 'Ver Dashboard',
    });

    queryClient.invalidateQueries({ queryKey: ['notifications', user.id] });
  }, [user, queryClient]);

  // Process anomalies and create notifications + toasts
  const processAnomalies = useCallback((anomalies: Anomaly[]) => {
    for (const anomaly of anomalies) {
      if (shownAnomaliesRef.current.has(anomaly.id)) continue;
      shownAnomaliesRef.current.add(anomaly.id);

      // Show toast
      const variant = anomaly.type === 'danger' ? 'destructive' as const : 'default' as const;
      toast({
        title: anomaly.type === 'info' ? `✨ ${anomaly.title}` : `⚠️ ${anomaly.title}`,
        description: anomaly.description,
        variant,
      });

      // Persist notification
      createNotification(anomaly);
    }
  }, [toast, createNotification]);

  // Mark as read
  const markAsRead = useCallback(async (notificationId: string) => {
    if (!user) return;
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);
    queryClient.invalidateQueries({ queryKey: ['notifications', user.id] });
  }, [user, queryClient]);

  // Mark all as read
  const markAllAsRead = useCallback(async () => {
    if (!user) return;
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false);
    queryClient.invalidateQueries({ queryKey: ['notifications', user.id] });
  }, [user, queryClient]);

  return {
    notifications,
    unreadCount,
    isLoading,
    processAnomalies,
    markAsRead,
    markAllAsRead,
  };
}
