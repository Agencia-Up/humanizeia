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

// UID conhecido COMPARTILHADO entre TODAS as instancias do useAuth. Critico pro fix do
// "site recarrega ao trocar de aba": ao focar a aba o Supabase dispara SIGNED_IN/INITIAL_SESSION
// (nao TOKEN_REFRESHED). O guard antigo usava um currentUid POR-INSTANCIA que fica null numa
// instancia recem-montada (getSession ainda pendente) -> o evento escapava o guard e mexia em
// user/loading -> remontava a arvore -> perdia o que o usuario preenchia. Com um uid GLOBAL,
// qualquer instancia reconhece "e o mesmo usuario que ja conheciamos" e NAO remonta nada.
let lastKnownUidGlobal: string | null = null;

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
    // currentUid por-instancia, SEMEADO pelo uid GLOBAL pra ja nascer sabendo quem
    // esta logado (mesmo antes do getSession resolver) — assim uma instancia recem
    // montada nao trata um SIGNED_IN do mesmo usuario como "login novo".
    let currentUid: string | null = lastKnownUidGlobal;

    supabase.auth.getSession().then(({ data: { session } }) => {
      currentUid = session?.user?.id ?? null;
      lastKnownUidGlobal = currentUid;
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

        // ── Definir/Redefinir senha pelo link do email ─────────────────────
        // Ao clicar no link de "definir senha", o GoTrue cria a sessao e o
        // client dispara PASSWORD_RECOVERY. Se o redirect cair numa pagina que
        // NAO trata isso (ex.: home/dashboard, quando o /auth/confirm nao esta
        // na allowlist de Redirect URLs do Supabase), o vendedor so logava e ia
        // pro dashboard — NUNCA via a tela de criar senha. Aqui garantimos, de
        // forma GLOBAL e independente da allowlist, que ele caia em /reset-password.
        // As paginas que ja tratam senha (/auth/confirm, /criar-senha,
        // /reset-password) sao excluidas pra nao brigar com o fluxo delas.
        if (event === 'PASSWORD_RECOVERY') {
          const path = window.location.pathname;
          if (path !== '/reset-password' && path !== '/criar-senha' && path !== '/auth/confirm') {
            window.location.replace('/reset-password');
            return;
          }
          // ja esta numa pagina de senha: deixa o fluxo normal seguir (seta sessao).
        }

        // ── MESMO usuario que JA conheciamos ───────────────────────────────
        // Ao focar a aba / abrir outra guia, o Supabase dispara SIGNED_IN e
        // INITIAL_SESSION (NAO so TOKEN_REFRESHED) com o MESMO usuario. Mexer em
        // user/loading aqui REMONTA a arvore inteira e o cliente PERDE o que
        // estava preenchendo (QR/prompt/campos). Reconhece pelo uid GLOBAL (o
        // currentUid por-instancia fica null numa instancia recem-montada e
        // deixava o evento escapar) e so atualiza a sessao em silencio.
        if (newUid !== null && (newUid === currentUid || newUid === lastKnownUidGlobal)) {
          currentUid = newUid;
          lastKnownUidGlobal = newUid;
          setSession(session);
          return;
        }
        // Eventos que NUNCA sao login de um NOVO usuario: havendo sessao, so atualiza.
        if ((event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED') && session?.user) {
          currentUid = newUid;
          lastKnownUidGlobal = newUid;
          setSession(session);
          return;
        }

        // ── Evento SEM sessao mas TINHAMOS usuario (piscada de rede ao focar) ──
        if (newUid === null && (currentUid !== null || lastKnownUidGlobal !== null)) {
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return; // offline: piscada de rede, mantem o usuario na tela
          }
          supabase.auth.getSession().then(({ data: { session: live } }) => {
            if (live?.user) {
              setSession(live); // sessao ainda valida: foi so a rede
              return;
            }
            // Sessao sumiu de verdade (expirou/deslogou): derruba a UI.
            currentUid = null;
            lastKnownUidGlobal = null;
            setSession(null);
            setUser(null);
            setProfile(null);
            invalidateProfileCache();
            setLoading(false);
          }).catch(() => { /* nao derruba a sessao por erro de getSession */ });
          return;
        }

        // Login real de um NOVO usuario: atualiza tudo.
        currentUid = newUid;
        lastKnownUidGlobal = newUid;
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
