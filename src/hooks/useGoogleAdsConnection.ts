import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface GoogleAdAccount {
  id: string;
  name: string;
  currency: string;
  timezone: string;
}

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
  const [availableAccounts, setAvailableAccounts] = useState<GoogleAdAccount[]>([]);
  const [pendingToken, setPendingToken] = useState<string | null>(null);

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

  const getOAuthRedirectUri = () => {
    // Keep OAuth callback on the same origin to preserve the authenticated session.
    return `${window.location.origin}/settings?google_callback=true`;
  };

  const startOAuth = async () => {
    setIsConnecting(true);
    try {
      const redirectUri = getOAuthRedirectUri();
      const { data, error } = await supabase.functions.invoke('google-ads-oauth', {
        body: {
          action: 'authorize',
          redirect_uri: redirectUri,
          state: crypto.randomUUID(),
        },
      });

      if (error) throw error;

      // Handle not_configured error from edge function
      if (data?.error === 'not_configured') {
        toast({
          title: 'Google Ads ainda não disponível',
          description: 'A integração com o Google Ads está sendo configurada. Entre em contato com o suporte para mais informações.',
          variant: 'destructive',
        });
        setIsConnecting(false);
        return;
      }

      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err: any) {
      toast({
        title: 'Erro ao conectar',
        description: err.message || 'Não foi possível iniciar a autenticação com o Google. Tente novamente em alguns minutos.',
        variant: 'destructive',
      });
      setIsConnecting(false);
    }
  };

  const handleCallback = async (code: string) => {
    setIsConnecting(true);
    try {
      const redirectUri = getOAuthRedirectUri();
      const { data, error } = await supabase.functions.invoke('google-ads-oauth', {
        body: {
          action: 'callback',
          code,
          redirect_uri: redirectUri,
        },
      });

      if (error) throw error;
      if (data?.accounts) {
        setAvailableAccounts(data.accounts);
        setPendingToken(data.token);

        if (data.accounts.length === 1) {
          // Auto-select single account
          await saveAccount(data.accounts[0], data.token);
        } else {
          toast({
            title: 'Autenticação concluída!',
            description: `${data.accounts.length} conta(s) encontrada(s). Selecione a que deseja usar.`,
          });
        }
      }
    } catch (err: any) {
      toast({
        title: 'Erro no callback',
        description: err.message || 'Falha ao processar autenticação.',
        variant: 'destructive',
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const saveAccount = async (account: GoogleAdAccount, token?: string) => {
    const accessToken = token || pendingToken;
    if (!accessToken) return;
    setIsConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-ads-oauth', {
        body: {
          action: 'save_account',
          account_id: account.id,
          account_name: account.name,
          currency: account.currency,
          timezone: account.timezone,
          access_token: accessToken,
        },
      });

      if (error) throw error;

      setPendingToken(null);
      setAvailableAccounts([]);
      await fetchConnectedAccount();

      toast({
        title: 'Google Ads conectado!',
        description: `${account.name} foi conectada com sucesso.`,
      });
    } catch (err: any) {
      toast({
        title: 'Erro ao salvar',
        description: err.message || 'Não foi possível salvar a conta.',
        variant: 'destructive',
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const selectAccount = async (account: GoogleAdAccount) => {
    await saveAccount(account);
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
    availableAccounts,
    startOAuth,
    handleCallback,
    selectAccount,
    disconnect,
    refresh: fetchConnectedAccount,
  };
}
