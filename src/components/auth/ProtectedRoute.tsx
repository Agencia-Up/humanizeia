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

// ── Module-level cache ────────────────────────────────────────────────────────
// Survives React Fast Refresh (HMR) re-renders because it lives in module scope.
// Key: `userId:pathname` → cached profile state.
// This prevents ProtectedRoute from firing a DB round-trip (and showing a
// full-page spinner that remounts children) after every file save.
const profileCache = new Map<string, 'ok' | 'no_org' | 'no_quiz'>();

export function ProtectedRoute({ children, skipQuizCheck = false }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [profileState, setProfileState] = useState<'loading' | 'ok' | 'no_org' | 'no_quiz'>('loading');
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
    abortRef.current = new AbortController();

    supabase
      .from('profiles')
      .select('organization_id, quiz_completed, role')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (abortRef.current?.signal.aborted) return;

        let next: 'ok' | 'no_org' | 'no_quiz';
        if (error || !data) {
          next = 'no_org';
        } else {
          // Sellers (funcionários) nunca precisam de org própria nem quiz
          const isSeller = (data as any).role === 'seller';
          if (isSeller) {
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
        }

        profileCache.set(cacheKey, next);
        setProfileState(next);
      })
      .catch(() => {
        if (!abortRef.current?.signal.aborted) {
          setProfileState('no_org');
        }
      });

    return () => {
      abortRef.current?.abort();
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
    return <Navigate to="/auth" replace />;
  }

  if (profileState === 'no_org' && !isOrgExempt) {
    return <Navigate to="/onboarding" replace />;
  }

  if (profileState === 'no_quiz' && !isQuizExempt) {
    return <Navigate to="/niche-quiz" replace />;
  }

  return <>{children}</>;
}
