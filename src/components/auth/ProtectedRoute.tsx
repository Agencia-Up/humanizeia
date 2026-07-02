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
// O status real fica no banco: master paga; vendedor herda a conta do master.
// Em falha de rede/RPC, esta rota permanece fail-open para nao travar cliente
// indevidamente por instabilidade temporaria.
type ProfileState = 'ok' | 'no_org' | 'no_quiz' | 'no_payment' | 'seller_payment_blocked';

// ── Module-level cache ────────────────────────────────────────────────────────
// Survives React Fast Refresh (HMR) re-renders because it lives in module scope.
// Key: `userId:pathname` → cached profile state.
// This prevents ProtectedRoute from firing a DB round-trip (and showing a
// full-page spinner that remounts children) after every file save.
// TTL curto porque pagamento pode mudar a qualquer momento.
const PROFILE_CACHE_TTL_MS = 60_000;
const profileCache = new Map<string, { state: ProfileState; ts: number }>();

export function ProtectedRoute({ children, skipQuizCheck = false }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [profileState, setProfileState] = useState<'loading' | ProfileState>('loading');
  // Track in-flight request so we never update state on an unmounted component
  const abortRef = useRef<AbortController | null>(null);
  // ── FIX (tela "recarrega"/perde o que estava preenchido ao trocar de aba) ──
  // O spinner de tela cheia DESMONTA os filhos (a pagina + qualquer modal aberto,
  // ex.: "Novo Agente" com prompt/QR digitados). Se uma piscada transitoria de
  // loading (token renovando ao voltar o foco, recheck de profile) reativasse o
  // spinner, a pagina inteira remontava e o usuario perdia tudo. Uma vez que ja
  // mostramos o conteudo pra um usuario AUTENTICADO, NUNCA mais voltamos pro
  // spinner de tela cheia — mantemos os filhos montados durante qualquer recheck.
  // (Logout real continua tratado abaixo via !user -> redireciona; e os redirects
  // de org/quiz/pagamento seguem valendo.)
  const renderedAuthedRef = useRef(false);

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
    if (cached && Date.now() - cached.ts < PROFILE_CACHE_TTL_MS) {
      setProfileState(cached.state);
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
          const hasOrg = !!data.organization_id;
          // Quiz de nicho REMOVIDO (02/07/2026): segmentamos so loja de veiculo,
          // entao o usuario cai DIRETO no painel. Resta apenas o gate de
          // organizacao (a tela rapida do nome da empresa).
          if (!hasOrg && !isOrgExempt) {
            next = 'no_org';
          } else {
            next = 'ok';
          }
        }

        // ── Trava de pagamento: vale para todo master e para vendedor herdando
        // o status do master. A regra fina (carencia, owner efetivo e status)
        // fica no banco. Erro de rede/RPC = fail-open.
        if (next === 'ok') {
          const { data: paywall, error: paywallErr } = await (supabase as any).rpc(
            'get_effective_subscription_status',
            { p_user_id: user.id },
          );
          if (ac.signal.aborted) return;
          if (!paywallErr && paywall?.is_blocked) {
            next = (isSeller || paywall?.role === 'seller') ? 'seller_payment_blocked' : 'no_payment';
          }
        }

        profileCache.set(cacheKey, { state: next, ts: Date.now() });
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

  // So mostra o spinner de tela cheia na PRIMEIRA carga (antes de termos exibido o
  // conteudo a um usuario autenticado). Depois disso, recheck transitorio NUNCA
  // desmonta a pagina/modal — evita o "reload" que apagava o que o usuario digitou.
  if ((loading || (user && profileState === 'loading')) && !renderedAuthedRef.current) {
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

  if (profileState === 'seller_payment_blocked') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            !
          </div>
          <h1 className="mb-2 text-xl font-semibold">Conta da empresa suspensa</h1>
          <p className="text-sm text-muted-foreground">
            O acesso desta equipe esta temporariamente bloqueado por pendencia de pagamento.
            Fale com o gestor da conta para regularizar o plano.
          </p>
        </div>
      </div>
    );
  }

  // Master sem pagamento regularizado -> envia para o checkout.
  if (profileState === 'no_payment') {
    return <Navigate to="/checkout?plano=pro&ciclo=mensal" replace />;
  }

  // Chegamos aqui com usuario autenticado e sem redirect: marca que ja exibimos o
  // conteudo, pra que rechecks futuros nunca voltem ao spinner que desmonta a pagina.
  if (user) renderedAuthedRef.current = true;
  return <>{children}</>;
}
