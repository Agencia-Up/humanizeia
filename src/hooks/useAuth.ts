import { useState, useEffect } from 'react';
import { User, Session } from '@supabase/supabase-js';
import {
  HAS_SUPABASE_CONFIG,
  SUPABASE_AUTH_STORAGE_KEY,
  SUPABASE_PUBLIC_KEY,
  SUPABASE_URL,
  supabase,
} from '@/integrations/supabase/client';

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const readStoredSession = (): Session | null => {
  try {
    const raw = localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (!raw) return null;

    const session = JSON.parse(raw) as Session;
    if (!session?.access_token || !session?.refresh_token || !session?.user) return null;

    const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
    if (expiresAt && expiresAt <= Date.now()) return null;

    return session;
  } catch {
    return null;
  }
};

const clearStoredSession = () => {
  localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
  localStorage.removeItem(`${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`);
  localStorage.removeItem(`${SUPABASE_AUTH_STORAGE_KEY}-user`);
};

const passwordSignInDirect = async (email: string, password: string): Promise<{ session: Session | null; error: Error | null }> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLIC_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLIC_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        session: null,
        error: new Error(payload.error_description || payload.msg || payload.message || 'Nao foi possivel fazer login.'),
      };
    }

    if (!payload?.access_token || !payload?.refresh_token || !payload?.user) {
      return { session: null, error: new Error('Resposta invalida do servidor de autenticacao.') };
    }

    const session = {
      ...payload,
      token_type: payload.token_type || 'bearer',
      expires_at: payload.expires_at || Math.round(Date.now() / 1000) + Number(payload.expires_in || 3600),
    } as Session;

    localStorage.setItem(SUPABASE_AUTH_STORAGE_KEY, JSON.stringify(session));
    return { session, error: null };
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'Tempo esgotado ao tentar entrar. Verifique conexao com o Supabase e tente novamente.'
        : error instanceof Error
          ? error.message
          : 'Falha ao comunicar com o servidor de autenticacao.';

    return { session: null, error: new Error(message) };
  } finally {
    clearTimeout(timeoutId);
  }
};

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (!error) {
      setProfile(data);
    }
  };

  useEffect(() => {
    const storedSession = readStoredSession();
    if (storedSession) {
      setSession(storedSession);
      setUser(storedSession.user);
      fetchProfile(storedSession.user.id);
      setLoading(false);
      return;
    }

    withTimeout(
      supabase.auth.getSession(),
      7000,
      'Tempo esgotado ao carregar a sessao'
    )
      .then(({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchProfile(session.user.id);
        }
      })
      .catch((error) => {
        console.error('[Auth] Falha ao carregar sessao:', error);
        setSession(null);
        setUser(null);
        setProfile(null);
      })
      .finally(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchProfile(session.user.id);
        } else {
          setProfile(null);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, fullName?: string) => {
    const redirectUrl = `${window.location.origin}/auth/confirm`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: { full_name: fullName },
      },
    });
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    if (!HAS_SUPABASE_CONFIG) {
      return { error: new Error('Configuracao do Supabase ausente no ambiente de producao') };
    }

    clearStoredSession();

    const { session, error } = await passwordSignInDirect(email, password);
    if (session) {
      setSession(session);
      setUser(session.user);
      fetchProfile(session.user.id);
    }

    return { error };
  };

  const signOut = async () => {
    clearStoredSession();
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  return { user, profile, session, loading, signUp, signIn, signOut, refreshProfile: () => user && fetchProfile(user.id) };
}
