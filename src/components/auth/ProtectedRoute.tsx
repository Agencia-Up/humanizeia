import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
  skipQuizCheck?: boolean;
}

// These routes bypass the quiz check
const QUIZ_EXEMPT_PATHS = ['/niche-quiz', '/briefing', '/onboarding', '/auth'];

export function ProtectedRoute({ children, skipQuizCheck = false }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [profileState, setProfileState] = useState<'loading' | 'ok' | 'no_org' | 'no_quiz'>('loading');

  useEffect(() => {
    if (!user) {
      setProfileState('loading');
      return;
    }

    supabase
      .from('profiles')
      .select('organization_id, quiz_completed')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (!data?.organization_id) {
          setProfileState('no_org');
        } else if (!data?.quiz_completed) {
          setProfileState('no_quiz');
        } else {
          setProfileState('ok');
        }
      });
  }, [user]);

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

  if (profileState === 'no_org') {
    return <Navigate to="/onboarding" replace />;
  }

  // Redirect to quiz if not completed and not on exempt pages
  const isExempt = skipQuizCheck || QUIZ_EXEMPT_PATHS.some(p => location.pathname.startsWith(p));
  if (profileState === 'no_quiz' && !isExempt) {
    return <Navigate to="/niche-quiz" replace />;
  }

  return <>{children}</>;
}
