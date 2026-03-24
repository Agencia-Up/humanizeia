import { useState, useEffect } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

// ID do projeto Supabase atual — sessões de outros projetos são inválidas
const CURRENT_PROJECT_ID = 'qrxsiixufdiemwwyhxvd';

/**
 * Remove do localStorage qualquer sessão Supabase que não seja do projeto atual.
 * Isso impede que tokens de projetos antigos (ex: Lovable) causem "Invalid JWT".
 * Roda uma única vez no boot do app.
 */
function clearStaleSupabaseSessions() {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      // Remove qualquer chave sb-* que NÃO seja do projeto atual
      if (key.startsWith('sb-') && !key.includes(CURRENT_PROJECT_ID)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => {
      console.log('[Auth] Removendo sessão de projeto antigo:', k);
      localStorage.removeItem(k);
    });
  } catch { /* ignora erros de localStorage em alguns browsers */ }
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Limpa sessões de projetos antigos ANTES de qualquer coisa
    clearStaleSupabaseSessions();

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, fullName?: string) => {
    const redirectUrl = `${window.location.origin}/`;
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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  return { user, session, loading, signUp, signIn, signOut };
}
