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
  currency: string | null;
  timezone: string | null;
}

export function useGoogleAdsConnection() {
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
        .from('ad_accounts')
        .select('*')
        .eq('user_id', user.id)
        .eq('platform', 'google')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        setConnectedAccount(data as ConnectedAccount);
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

  const connect = async (credentials: {
    developer_token: string;
    client_id: string;
    client_secret: string;
    refresh_token: string;
    customer_id: string;
  }) => {
    setIsConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-ads-api', {
        body: {
          action: 'connect',
          ...credentials,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      await fetchConnectedAccount();
      toast({
        title: 'Google Ads conectado!',
        description: `${data.account?.account_name || 'Conta'} conectada com sucesso.`,
      });
      return { success: true };
    } catch (err: any) {
      toast({
        title: 'Erro ao conectar',
        description: err.message || 'Credenciais inválidas.',
        variant: 'destructive',
      });
      return { success: false };
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!connectedAccount) return;
    try {
      const { error } = await supabase
        .from('ad_accounts')
        .update({ is_active: false })
        .eq('id', connectedAccount.id);

      if (error) throw error;
      setConnectedAccount(null);
      toast({
        title: 'Conta desconectada',
        description: 'Sua conta Google Ads foi desconectada.',
      });
    } catch (err: any) {
      toast({
        title: 'Erro',
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  return {
    isConnecting,
    isLoading,
    connectedAccount,
    connect,
    disconnect,
    refresh: fetchConnectedAccount,
  };
}
