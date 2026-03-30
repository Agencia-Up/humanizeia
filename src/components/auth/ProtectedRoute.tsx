import { ReactNode, useEffect, useState } from 'react';
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

export function ProtectedRoute({ children, skipQuizCheck = false }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [profileState, setProfileState] = useState<'loading' | 'ok' | 'no_org' | 'no_quiz'>('loading');

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

    // Reset to loading on each path/user change so spinner shows correctly
    setProfileState('loading');

    supabase
      .from('profiles')
      .select('organization_id, quiz_completed')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          // Query failed – redirect to onboarding as safest fallback (no looping to quiz)
          setProfileState('no_org');
          return;
        }

        const hasOrg   = !!data.organization_id;
        const doneQuiz = !!data.quiz_completed;

        if (!hasOrg && !isOrgExempt) {
          setProfileState('no_org');
        } else if (!doneQuiz && !isQuizExempt) {
          setProfileState('no_quiz');
        } else {
          setProfileState('ok');
        }
      });
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
