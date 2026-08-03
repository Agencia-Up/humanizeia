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

/**
 * Cache VISUAL apenas. A fonte oficial da conta ativa do José é o servidor
 * (apollo_cron_config.selected_ad_account_id, lido por get_jose_selected_account).
 * Nunca decida nada a partir desta chave.
 */
const SELECTED_ACCOUNT_KEY = 'logosia_selected_meta_account_id';

/** Estados do contrato de conexão — os mesmos que o backend devolve. */
export type MetaConnectionEstado =
  | 'connected' | 'expired' | 'reconnect_required'
  | 'no_account_selected' | 'configuration_error' | 'unknown';

export interface JoseConnectionState {
  estado: MetaConnectionEstado;
  podeAlterar: boolean;
  erroCode: number | null;
  erroSubcode: number | null;
  validadoEm: string | null;
}

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
  // Só o ID da sessão. O access_token nunca chega ao navegador.
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [joseState, setJoseState] = useState<JoseConnectionState>({
    estado: 'no_account_selected', podeAlterar: false,
    erroCode: null, erroSubcode: null, validadoEm: null,
  });

  const fetchConnectedAccount = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      // Tenant efetivo: dono vê as próprias contas; vendedor/parceiro herda as da
      // MASTER (RPC get_effective_ad_accounts, SECURITY DEFINER, SEM o token). Antes
      // era .eq('user_id', user.id) — o parceiro via vazio e era forçado a reconectar
      // o Facebook, que precisa ficar na master pro tracking/CAPI.
      // "Contas encontradas na Meta" (integradas neste tenant).
      const { data, error } = await supabase.rpc('get_effective_ad_accounts');
      const lista = (!error && data ? data : []) as ConnectedAccount[];
      setConnectedAccounts(lista);

      // "Conta ativa no José" — vem do SERVIDOR, não do navegador.
      // Antes era localStorage com fallback `data[0]`: em outro navegador, ou
      // depois de um logout, a tela apontava para uma conta que ninguém havia
      // escolhido — e o José usava outra ainda. Agora há uma só resposta.
      const { data: sel } = await supabase.rpc('get_jose_selected_account');
      const selecionadaId = (sel as any)?.ad_account_id ?? null;

      setJoseState({
        estado: (sel as any)?.estado ?? 'no_account_selected',
        podeAlterar: (sel as any)?.pode_alterar === true,
        erroCode: (sel as any)?.erro_code ?? null,
        erroSubcode: (sel as any)?.erro_subcode ?? null,
        validadoEm: (sel as any)?.credencial_validada_em ?? null,
      });

      const ativa = selecionadaId ? lista.find(a => a.id === selecionadaId) ?? null : null;
      setConnectedAccount(ativa);

      // localStorage vira só cache visual, espelhando o servidor.
      if (selecionadaId) localStorage.setItem(SELECTED_ACCOUNT_KEY, selecionadaId);
      else localStorage.removeItem(SELECTED_ACCOUNT_KEY);
    } catch {
      setConnectedAccounts([]);
      setConnectedAccount(null);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  /**
   * Troca a conta ativa do José. A verdade é do servidor: só consideramos
   * trocado depois que o banco confirma. Antes isto era um setState local +
   * localStorage — o José nunca ficava sabendo.
   */
  const selectConnectedAccount = useCallback(async (accountId: string) => {
    setIsConnecting(true);
    try {
      const { data, error } = await supabase.rpc('set_jose_selected_account', {
        p_ad_account_id: accountId,
      });
      if (error) throw error;

      const res = data as any;
      if (!res?.ok) {
        const motivo = res?.erro === 'credencial_nao_saudavel'
          ? 'A conexão com a Meta precisa ser validada (ou reconectada) antes de escolher esta conta.'
          : res?.erro === 'sem_permissao_para_alterar_integracao'
            ? 'Seu perfil pode visualizar, mas não alterar a integração Meta.'
            : res?.erro === 'conta_nao_pertence_ao_tenant'
              ? 'Esta conta não pertence a este cliente.'
              : res?.erro ?? 'Não foi possível salvar a seleção.';
        toast({ title: 'Seleção não aplicada', description: motivo, variant: 'destructive' });
        return { success: false };
      }

      // Relê do servidor: o que vale é o que o banco devolveu.
      await fetchConnectedAccount();
      toast({ title: 'Conta do José atualizada', description: `${res.account_name} agora alimenta o José.` });
      return { success: true };
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
      return { success: false };
    } finally {
      setIsConnecting(false);
    }
  }, [fetchConnectedAccount, toast]);

  /** Validação REAL da conexão (Graph API), sob demanda. Nunca recebe token. */
  const testConnection = useCallback(async () => {
    setIsCheckingHealth(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-connection-health', { body: {} });
      if (error) throw error;
      const res = data as any;
      setJoseState(prev => ({ ...prev, estado: res?.estado ?? 'unknown',
                              erroCode: res?.error_code ?? null, erroSubcode: res?.error_subcode ?? null,
                              validadoEm: res?.validado_em ?? new Date().toISOString() }));
      return res;
    } catch (err: any) {
      toast({ title: 'Erro ao testar conexão', description: err.message, variant: 'destructive' });
      return null;
    } finally {
      setIsCheckingHealth(false);
    }
  }, [toast]);

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
    // A edge não devolve mais `token`. Guardamos apenas a referência da sessão.
    if (data?.session_id) setPendingSessionId(data.session_id);
  };

  const consumeOAuthSession = async (sessionId: string) => {
    setIsConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-oauth', {
        body: {
          action: 'consume_session',
          session_id: sessionId,
        },
      });

      if (error) throw error;
      processResponse(data);

      const count = (data?.ad_accounts || data?.accounts || []).length;
      toast({
        title: 'Autenticação concluída!',
        description: `${count} conta(s), ${data?.pixels?.length || 0} pixel(s), ${data?.pages?.length || 0} página(s) encontrada(s).`,
      });

      return { success: true };
    } catch (err: any) {
      toast({
        title: 'Erro no OAuth da Meta',
        description: err.message || 'Falha ao carregar as contas encontradas.',
        variant: 'destructive',
      });
      return { success: false };
    } finally {
      setIsConnecting(false);
    }
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
      if (!user?.id) throw new Error('Usuário não autenticado.');

      const origin = window.location.origin;
      const loginUrl = new URL('/api/meta/login', origin);
      loginUrl.searchParams.set('user_id', user.id);
      // Volta pra MESMA página de onde o usuário clicou — é onde o
      // MetaAdsSettingsTab está montado e consome a sessão OAuth (lê
      // ?meta_oauth_session=). Antes ia fixo p/ /settings, onde esse
      // componente não existe, então a sessão nunca era consumida e as
      // contas não apareciam pra selecionar.
      loginUrl.searchParams.set('return_to', `${origin}${window.location.pathname}`);
      window.location.href = loginUrl.toString();
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
      const productionOrigin = 'https://logosiabrasil.com';
      const redirectUri = `${productionOrigin}/settings?meta_callback=true`;
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
    if (!pendingSessionId) return;
    setIsConnecting(true);
    try {
      // Caminho de conta única passa pelo MESMO fluxo do multi: sessão no
      // servidor, sem token no navegador.
      const { data, error } = await supabase.functions.invoke('meta-oauth', {
        body: {
          action: 'save_selected',
          session_id: pendingSessionId,
          account_ids: [String(account.account_id ?? account.id).replace(/^act_/, '')],
        },
      });

      if (error) throw error;
      if ((data as any)?.ok !== true) {
        throw new Error((data as any)?.error ?? 'Falha ao integrar a conta');
      }

      setPendingSessionId(null);
      setAvailableAccounts([]);
      setPixels([]);
      setPages([]);
      setBusinesses([]);
      await fetchConnectedAccount();
      // Rede de seguranca do selo: a edge JA devolve a conta salva (data.account). Se a
      // releitura (RPC get_effective_ad_accounts) voltar vazia/lenta, refletimos
      // "Conectado" com o dado do backend em vez de deixar o selo em "Nao conectado".
      const saved = (data as any)?.account as ConnectedAccount | undefined;
      if (saved) {
        setConnectedAccount((prev) => prev ?? saved);
        setConnectedAccounts((prev) => (prev.length ? prev : [saved]));
      }

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

  // Fix 2: salva de uma vez as contas/pixels/paginas SELECIONADOS (checkboxes).
  const saveSelectedAssets = async (sel: { accounts: any[]; pixels: MetaPixel[]; pages: MetaPage[] }) => {
    if (!pendingSessionId) return { success: false };
    setIsConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-oauth', {
        body: {
          action: 'save_selected',
          // Só a referência da sessão e os IDs escolhidos. O backend recupera o
          // token da sessão e confere que cada ID veio DESSA autorização.
          session_id: pendingSessionId,
          account_ids: sel.accounts.map((a: any) => String(a.account_id ?? a.id).replace(/^act_/, '')),
          pixels: sel.pixels,
          pages: sel.pages,
        },
      });
      if (error) throw error;
      // Erro parcial NÃO é sucesso: a edge devolve ok:false com a lista.
      if ((data as any)?.ok !== true) {
        const errs = (data as any)?.errors ?? [];
        throw new Error((data as any)?.error ?? errs[0] ?? 'Falha ao integrar');
      }

      setPendingSessionId(null);
      setAvailableAccounts([]);
      setPixels([]);
      setPages([]);
      setBusinesses([]);

      // selo vira na hora com a conta que a edge devolve
      const saved = (data as any)?.account as ConnectedAccount | undefined;
      if (saved) {
        setConnectedAccount((prev) => prev ?? saved);
        setConnectedAccounts((prev) => (prev.length ? prev : [saved]));
      }
      await fetchConnectedAccount();

      const s = (data as any)?.saved || {};
      toast({
        title: 'Integrado com sucesso!',
        description: `${s.accounts || 0} conta(s), ${s.pixels || 0} pixel(s) e ${s.pages || 0} página(s) conectados.`,
      });
      return { success: true };
    } catch (err: any) {
      toast({
        title: 'Erro ao integrar',
        description: err.message || 'Não foi possível salvar a seleção.',
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

  // Remove UMA conta específica (multi-conta): desativa e recarrega a lista. Se a conta
  // removida era a ativa, o fetchConnectedAccount reelege a próxima que sobrar (ou null).
  const disconnectAccount = async (accountId: string) => {
    try {
      const { error } = await supabase
        .from('ad_accounts')
        .update({ is_active: false })
        .eq('id', accountId);
      if (error) throw error;
      if (localStorage.getItem(SELECTED_ACCOUNT_KEY) === accountId) {
        localStorage.removeItem(SELECTED_ACCOUNT_KEY);
      }
      await fetchConnectedAccount();
      toast({ title: 'Conta removida', description: 'A conta Meta foi desconectada.' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  return {
    isConnecting,
    isLoading,
    isCheckingHealth,
    /** Estado REAL da conexão do José (servidor). Não derive de is_active. */
    joseState,
    testConnection,
    /** A conta ativa no José, confirmada pelo servidor. */
    connectedAccount,
    /** Contas encontradas/integradas neste tenant — conceito SEPARADO da ativa. */
    connectedAccounts,
    availableAccounts,
    pixels,
    pages,
    businesses,
    startOAuth,
    handleCallback,
    consumeOAuthSession,
    selectAccount,
    saveSelectedAssets,
    selectConnectedAccount,
    disconnect,
    connectWithToken,
    refresh: fetchConnectedAccount,
  };
}
