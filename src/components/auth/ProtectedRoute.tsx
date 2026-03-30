import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
  skipQuizCheck?: boolean;
}

// Paths that bypass the org check (user is creating org or doing quiz)
const ORG_EXEMPT_PATHS = ['/niche-quiz', '/briefing', '/onboarding', '/auth'];

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

    // If this route is exempt from both checks, skip the DB round-trip
    if (isOrgExempt && isQuizExempt) {
      setProfileState('ok');
      return;
    }

    // Safety timeout: never show spinner forever
    const timeout = setTimeout(() => setProfileState('ok'), 4000);

    supabase
      .from('profiles')
      .select('organization_id, quiz_completed')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        clearTimeout(timeout);
        if (error || !data) {
          // On query error, let the user through rather than looping
          setProfileState('ok');
          return;
        }
        if (!data.organization_id && !isOrgExempt) {
          setProfileState('no_org');
        } else if (!data.quiz_completed && !isQuizExempt) {
          setProfileState('no_quiz');
        } else {
          setProfileState('ok');
        }
      });

    return () => clearTimeout(timeout);
  }, [user, location.pathname]);

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
