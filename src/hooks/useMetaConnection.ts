import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

export interface MetaAdAccount {
  id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
  business_name?: string | null;
  amount_spent?: string;
}

export interface MetaPixel {
  id: string;
  name: string;
  last_fired_time: string | null;
  is_unavailable: boolean;
  ad_account_id: string;
  ad_account_name: string;
}

export interface MetaPage {
  id: string;
  name: string;
  category: string | null;
  fan_count: number;
  picture_url: string | null;
}

export interface MetaBusiness {
  id: string;
  name: string;
  picture_url: string | null;
  verification_status: string | null;
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

const SELECTED_ACCOUNT_KEY = 'logosia_selected_meta_account_id';

export function useMetaConnection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedAccount, setConnectedAccount] = useState<ConnectedAccount | null>(null);
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [availableAccounts, setAvailableAccounts] = useState<MetaAdAccount[]>([]);
  const [pixels, setPixels] = useState<MetaPixel[]>([]);
  const [pages, setPages] = useState<MetaPage[]>([]);
  const [businesses, setBusinesses] = useState<MetaBusiness[]>([]);
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
        .order('created_at', { ascending: true });

      if (!error && data && data.length > 0) {
        setConnectedAccounts(data as ConnectedAccount[]);
        // Restore previously selected account from localStorage, else use first
        const savedId = localStorage.getItem(SELECTED_ACCOUNT_KEY);
        const savedAccount = savedId ? data.find(a => a.id === savedId) : null;
        setConnectedAccount(savedAccount ?? (data[0] as ConnectedAccount));
      } else {
        setConnectedAccounts([]);
        setConnectedAccount(null);
      }
    } catch {
      setConnectedAccounts([]);
      setConnectedAccount(null);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const selectConnectedAccount = useCallback((accountId: string) => {
    setConnectedAccounts(prev => {
      const found = prev.find(a => a.id === accountId);
      if (found) {
        // Persist the selection so it survives page navigation
        localStorage.setItem(SELECTED_ACCOUNT_KEY, accountId);
        setConnectedAccount(found);
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    fetchConnectedAccount();
  }, [fetchConnectedAccount]);

  const processResponse = (data: any) => {
    if (data?.ad_accounts || data?.accounts) {
      setAvailableAccounts(data.ad_accounts || data.accounts || []);
    }
    if (data?.pixels) setPixels(data.pixels);
    if (data?.pages) setPages(data.pages);
    if (data?.businesses) setBusinesses(data.businesses);
    if (data?.token) setPendingToken(data.token);
  };

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
        await fetchConnectedAccount();
        toast({
          title: 'Conta conectada!',
          description: `${data.account?.account_name || 'Conta Meta'} conectada com sucesso.`,
        });
        return { success: true, needsSelection: false };
      }

      if (data?.needs_selection) {
        processResponse(data);
        const count = (data.ad_accounts || data.accounts || []).length;
        toast({
          title: 'Token validado!',
          description: `${count} conta(s) encontrada(s). Selecione a que deseja usar.`,
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
      const productionOrigin = 'https://humanizeia.lovable.app';
      const redirectUri = `${productionOrigin}/settings?meta_callback=true`;
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
      processResponse(data);

      const count = (data?.ad_accounts || data?.accounts || []).length;
      toast({
        title: 'Autenticação concluída!',
        description: `${count} conta(s), ${data?.pixels?.length || 0} pixel(s), ${data?.pages?.length || 0} página(s) encontrada(s).`,
      });
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

  const selectAccount = async (account: any) => {
    if (!pendingToken) return;
    setIsConnecting(true);
    try {
      const { error } = await supabase.functions.invoke('meta-oauth', {
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
      setPixels([]);
      setPages([]);
      setBusinesses([]);
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
      localStorage.removeItem(SELECTED_ACCOUNT_KEY);
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
    connectedAccounts,
    availableAccounts,
    pixels,
    pages,
    businesses,
    startOAuth,
    handleCallback,
    selectAccount,
    selectConnectedAccount,
    disconnect,
    connectWithToken,
    refresh: fetchConnectedAccount,
  };
}
