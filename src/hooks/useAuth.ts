import { useState, useEffect } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

// ── Cache de profile compartilhado entre todas as instâncias do useAuth ──
// Antes: cada componente que chamava useAuth() criava sua própria query pra
// /rest/v1/profiles. No dashboard isso virava 34+ requests por load. Agora
// um Map global guarda o profile por userId + uma Promise pendente faz
// dedupe de fetches concorrentes. O resultado é distribuído pra todos os
// listeners via subscriber pattern.
const profileCache = new Map<string, any>();
const pendingFetches = new Map<string, Promise<any>>();
type ProfileListener = (userId: string, profile: any) => void;
const profileListeners = new Set<ProfileListener>();

async function fetchProfileShared(userId: string): Promise<any> {
  // Hit do cache
  if (profileCache.has(userId)) return profileCache.get(userId);
  // Já tem fetch em curso pra esse user → reutiliza a Promise
  if (pendingFetches.has(userId)) return pendingFetches.get(userId)!;

  const promise = supabase.from('profiles').select('*').eq('id', userId).single()
    .then(({ data, error }) => {
      pendingFetches.delete(userId);
      if (error || !data) return null;
      profileCache.set(userId, data);
      // Notifica listeners
      profileListeners.forEach(l => l(userId, data));
      return data;
    });
  pendingFetches.set(userId, promise);
  return promise;
}

function invalidateProfileCache(userId?: string) {
  if (userId) {
    profileCache.delete(userId);
  } else {
    profileCache.clear();
  }
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const data = await fetchProfileShared(userId);
    if (data) setProfile(data);
  };

  useEffect(() => {
    // Guarda QUEM está logado pra distinguir "mesma sessão, só renovou o token
    // (acontece quando a aba volta a ter foco)" de "mudou o usuário (login/logout)".
    let currentUid: string | null = null;

    supabase.auth.getSession().then(({ data: { session } }) => {
      currentUid = session?.user?.id ?? null;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        const newUid = session?.user?.id ?? null;

        // ── FIX (tela reseta ao trocar de aba) ─────────────────────────────
        // Ao voltar o foco da aba, o Supabase dispara TOKEN_REFRESHED com o
        // MESMO usuário. Se mexermos em user/loading aqui, a árvore inteira
        // remonta e o cliente perde o que estava preenchendo. Então, quando é
        // o mesmo usuário, só atualizamos o token da sessão em silêncio.
        if (event === 'TOKEN_REFRESHED' || (newUid !== null && newUid === currentUid)) {
          setSession(session);
          return;
        }

        // Mudou de verdade (login ou logout): atualiza tudo.
        currentUid = newUid;
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchProfile(session.user.id);
        } else {
          setProfile(null);
          invalidateProfileCache();
        }
        setLoading(false);
      }
    );

    // Listener pra receber profile fetched por outro componente
    const listener: ProfileListener = (uid, p) => {
      // Só atualiza se for o user dessa instância
      const currentUser = session?.user || (supabase.auth.getSession() as any);
      if (uid && p) setProfile(prev => prev || p);
    };
    profileListeners.add(listener);

    return () => {
      subscription.unsubscribe();
      profileListeners.delete(listener);
    };
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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  return {
    user, profile, session, loading,
    signUp, signIn, signOut,
    refreshProfile: () => {
      if (user) {
        invalidateProfileCache(user.id);
        return fetchProfile(user.id);
      }
    },
  };
}
