import { ReactNode, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
  skipQuizCheck?: boolean;
}

// Paths that bypass the organization check
const ORG_EXEMPT_PATHS  = ['/niche-quiz', '/briefing', '/onboarding', '/auth'];
// Paths that bypass the quiz-completed check
const QUIZ_EXEMPT_PATHS = ['/niche-quiz', '/briefing', '/onboarding', '/auth'];

// ── Trava de pagamento (paywall) ─────────────────────────────────────────────
// So vale pra CONTAS NOVAS. Contas criadas ANTES desta data de corte sao
// "grandfathered": entram normalmente, sem checagem de pagamento. As 18 contas
// atuais (criadas ate 28/05/2026) ficam protegidas por essa data. Funcionarios
// (sellers) tambem sao isentos: usam o plano do patrao, nao pagam.
// O cliente novo (owner) so passa daqui se tiver assinatura status='active'
// — o que so acontece depois do webhook da Asaas confirmar o pagamento.
const LOCK_CUTOFF = Date.parse('2026-06-03T00:00:00Z');

type ProfileState = 'ok' | 'no_org' | 'no_quiz' | 'no_payment';

// ── Module-level cache ────────────────────────────────────────────────────────
// Survives React Fast Refresh (HMR) re-renders because it lives in module scope.
// Key: `userId:pathname` → cached profile state.
// This prevents ProtectedRoute from firing a DB round-trip (and showing a
// full-page spinner that remounts children) after every file save.
const profileCache = new Map<string, ProfileState>();

export function ProtectedRoute({ children, skipQuizCheck = false }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [profileState, setProfileState] = useState<'loading' | ProfileState>('loading');
  // Track in-flight request so we never update state on an unmounted component
  const abortRef = useRef<AbortController | null>(null);

  const isOrgExempt  = ORG_EXEMPT_PATHS.some(p  => location.pathname.startsWith(p));
  const isQuizExempt = skipQuizCheck || QUIZ_EXEMPT_PATHS.some(p => location.pathname.startsWith(p));

  useEffect(() => {
    if (!user) {
      setProfileState('loading');
      return;
    }

    // Paths exempt from BOTH checks → go straight in, no DB call needed
    if (isOrgExempt && isQuizExempt) {
      setProfileState('ok');
      return;
    }

    const cacheKey = `${user.id}:${location.pathname}`;

    // ── Cache hit: apply instantly, NO spinner, NO remount ──────────────────
    const cached = profileCache.get(cacheKey);
    if (cached) {
      setProfileState(cached);
      return;
    }

    // ── Cache miss: show spinner and query DB ────────────────────────────────
    setProfileState('loading');

    // Cancel any previous in-flight request
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('organization_id, quiz_completed, role')
          .eq('id', user.id)
          .single();

        if (ac.signal.aborted) return;

        // Sellers (funcionários) nunca precisam de org própria, quiz nem pagamento
        const isSeller = !error && !!data && (data as any).role === 'seller';

        let next: ProfileState;
        if (error || !data) {
          // FIX: erro de REDE (ex.: Failed to fetch ao voltar o foco da aba)
          // NAO deve expulsar um usuario logado pra /onboarding. So trata como
          // "sem org" se a query realmente respondeu sem dados. Em falha de
          // rede, mantem a tela (fail-open) e recheca na proxima navegacao.
          const emsg = String((error as any)?.message || '');
          const isNetworkErr = (typeof navigator !== 'undefined' && navigator.onLine === false)
            || /failed to fetch|networkerror|load failed|err_/i.test(emsg);
          if (isNetworkErr) {
            if (!ac.signal.aborted) setProfileState('ok');
            return;
          }
          next = 'no_org';
        } else if (isSeller) {
          next = 'ok';
        } else {
          const hasOrg   = !!data.organization_id;
          const doneQuiz = !!(data as any).quiz_completed
            || localStorage.getItem(`quiz_completed_${user.id}`) === 'true';

          if (!hasOrg && !isOrgExempt) {
            next = 'no_org';
          } else if (!doneQuiz && !isQuizExempt) {
            next = 'no_quiz';
          } else {
            next = 'ok';
          }
        }

        // ── Trava de pagamento: só pra cliente novo (owner criado a partir da
        // data de corte). Sellers e contas antigas nunca caem aqui. Se a
        // assinatura não estiver 'active', manda pro checkout pra pagar.
        const createdMs = user.created_at ? Date.parse(user.created_at) : NaN;
        const isNewAccount = Number.isFinite(createdMs) && createdMs >= LOCK_CUTOFF;
        if (next === 'ok' && !isSeller && isNewAccount) {
          const { data: sub, error: subErr } = await supabase
            .from('user_subscriptions')
            .select('status')
            .eq('user_id', user.id)
            .maybeSingle();
          if (ac.signal.aborted) return;
          // FIX: so manda pro checkout se a query VOLTOU certo e nao ha
          // assinatura ativa. Erro de rede NAO trava o usuario no /checkout.
          if (!subErr && (sub as any)?.status !== 'active') {
            next = 'no_payment';
          }
        }

        profileCache.set(cacheKey, next);
        setProfileState(next);
      } catch {
        // FIX: excecao (tipicamente rede ao voltar o foco) NAO deve expulsar o
        // usuario logado pra /onboarding. Mantem a tela; recheca na proxima
        // navegacao (nao cacheia este resultado).
        if (!ac.signal.aborted) {
          setProfileState('ok');
        }
      }
    })();

    return () => {
      ac.abort();
    };
  }, [user?.id, location.pathname]);

  if (loading || (user && profileState === 'loading')) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    // Preserva URL original (path + query) pra Auth voltar após login.
    // Ex: /pedro?tab=agente → /auth?redirect=%2Fpedro%3Ftab%3Dagente
    const fullPath = `${location.pathname}${location.search}`;
    const redirectQs = fullPath !== '/' ? `?redirect=${encodeURIComponent(fullPath)}` : '';
    return <Navigate to={`/auth${redirectQs}`} replace />;
  }

  if (profileState === 'no_org' && !isOrgExempt) {
    return <Navigate to="/onboarding" replace />;
  }

  if (profileState === 'no_quiz' && !isQuizExempt) {
    return <Navigate to="/niche-quiz" replace />;
  }

  // Cliente novo sem pagamento confirmado → manda pagar antes de liberar.
  if (profileState === 'no_payment') {
    return <Navigate to="/checkout?plano=pro&ciclo=mensal" replace />;
  }

  return <>{children}</>;
}
