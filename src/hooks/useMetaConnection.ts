import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface MetaAdAccount {
  id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
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

export function useMetaConnection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedAccount, setConnectedAccount] = useState<ConnectedAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [availableAccounts, setAvailableAccounts] = useState<MetaAdAccount[]>([]);
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  const fetchConnectedAccount = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('ad_accounts')
        .select('*')
        .eq('user_id', user.id)
        .eq('platform', 'meta')
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

  const connectWithToken = async (accessToken: string, accountId?: string) => {
    setIsConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-oauth', {
        body: {
          action: 'connect_with_token',
          access_token: accessToken,
          account_id: accountId || undefined,
        },
      });

      if (error) throw error;

      if (data?.saved) {
        // Account was saved directly
        await fetchConnectedAccount();
        toast({
          title: 'Conta conectada!',
          description: `${data.account?.account_name || 'Conta Meta'} conectada com sucesso.`,
        });
        return { success: true, needsSelection: false };
      }

      if (data?.needs_selection && data?.accounts) {
        setAvailableAccounts(data.accounts);
        setPendingToken(data.token);
        toast({
          title: 'Token validado!',
          description: `${data.accounts.length} conta(s) encontrada(s). Selecione a que deseja usar.`,
        });
        return { success: true, needsSelection: true };
      }

      throw new Error('Resposta inesperada do servidor');
    } catch (err: any) {
      toast({
        title: 'Erro ao conectar',
        description: err.message || 'Token inválido ou expirado.',
        variant: 'destructive',
      });
      return { success: false, needsSelection: false };
    } finally {
      setIsConnecting(false);
    }
  };

  const startOAuth = async () => {
    setIsConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/settings?meta_callback=true`;
      const { data, error } = await supabase.functions.invoke('meta-oauth', {
        body: {
          action: 'authorize',
          redirect_uri: redirectUri,
          state: crypto.randomUUID(),
        },
      });

      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err: any) {
      toast({
        title: 'Erro ao conectar',
        description: err.message || 'Não foi possível iniciar a autenticação com a Meta.',
        variant: 'destructive',
      });
      setIsConnecting(false);
    }
  };

  const handleCallback = async (code: string) => {
    setIsConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/settings?meta_callback=true`;
      const { data, error } = await supabase.functions.invoke('meta-oauth', {
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
        toast({
          title: 'Autenticação concluída!',
          description: `${data.accounts.length} conta(s) encontrada(s). Selecione a que deseja usar.`,
        });
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

  const selectAccount = async (account: MetaAdAccount) => {
    if (!pendingToken) return;
    setIsConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-oauth', {
        body: {
          action: 'save_account',
          account_id: account.id,
          account_name: account.name,
          currency: account.currency,
          timezone: account.timezone_name,
          access_token: pendingToken,
        },
      });

      if (error) throw error;
      
      setPendingToken(null);
      setAvailableAccounts([]);
      await fetchConnectedAccount();
      
      toast({
        title: 'Conta conectada!',
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
        description: 'Sua conta Meta Ads foi desconectada.',
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
    connectWithToken,
    refresh: fetchConnectedAccount,
  };
}
