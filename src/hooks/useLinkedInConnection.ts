import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface ConnectedAccount {
  id: string;
  account_id: string;
  account_name: string;
  platform: string;
  is_active: boolean;
  last_sync_at: string | null;
}

export function useLinkedInConnection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedAccount, setConnectedAccount] = useState<ConnectedAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchConnectedAccount = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('connected_accounts' as any)
        .select('*')
        .eq('user_id', user.id)
        .eq('platform', 'linkedin')
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        setConnectedAccount(data as unknown as ConnectedAccount);
      } else {
        setConnectedAccount(null);
      }
    } catch {
      setConnectedAccount(null);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchConnectedAccount();
  }, [fetchConnectedAccount]);

  const startOAuth = async () => {
    if (!user) return;
    setIsConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('linkedin-ads-oauth', {
        body: { action: 'authorize', user_id: user.id },
      });

      if (error) throw error;
      if (data?.auth_url) {
        // Open OAuth in popup
        const popup = window.open(data.auth_url, 'linkedin_oauth', 'width=600,height=700,scrollbars=yes');

        // Listen for popup message
        const handler = (event: MessageEvent) => {
          if (event.data?.type === 'LINKEDIN_AUTH_SUCCESS') {
            window.removeEventListener('message', handler);
            popup?.close();
            fetchConnectedAccount();
            toast({ title: 'LinkedIn conectado!', description: `Conta ${event.data.accountName} conectada.` });
            setIsConnecting(false);
          } else if (event.data?.type === 'LINKEDIN_AUTH_ERROR') {
            window.removeEventListener('message', handler);
            popup?.close();
            toast({ title: 'Erro LinkedIn', description: event.data.error, variant: 'destructive' });
            setIsConnecting(false);
          }
        };

        window.addEventListener('message', handler);

        // Fallback: if popup closes without message
        const checkClosed = setInterval(() => {
          if (popup?.closed) {
            clearInterval(checkClosed);
            window.removeEventListener('message', handler);
            fetchConnectedAccount();
            setIsConnecting(false);
          }
        }, 1000);
      }
    } catch (err: any) {
      toast({
        title: 'Erro ao conectar LinkedIn',
        description: err.message || 'Não foi possível iniciar autenticação.',
        variant: 'destructive',
      });
      setIsConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!connectedAccount || !user) return;
    try {
      await supabase
        .from('connected_accounts' as any)
        .delete()
        .eq('user_id', user.id)
        .eq('platform', 'linkedin');

      setConnectedAccount(null);
      toast({ title: 'LinkedIn desconectado' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  return {
    isConnecting,
    isLoading,
    connectedAccount,
    startOAuth,
    disconnect,
    refresh: fetchConnectedAccount,
  };
}
