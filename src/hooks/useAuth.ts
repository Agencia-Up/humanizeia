import { useState, useEffect } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { HAS_SUPABASE_CONFIG, supabase } from '@/integrations/supabase/client';

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
    withTimeout(
      supabase.auth.getSession(),
      15000,
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

    const { error } = await withTimeout(
      supabase.auth.signInWithPassword({ email, password }),
      20000,
      'Tempo esgotado ao tentar entrar. Recarregue a pagina e tente novamente.'
    );
    return { error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  return { user, profile, session, loading, signUp, signIn, signOut, refreshProfile: () => user && fetchProfile(user.id) };
}
