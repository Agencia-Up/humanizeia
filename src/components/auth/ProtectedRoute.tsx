import { ReactNode, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const [orgCheck, setOrgCheck] = useState<'loading' | 'has_org' | 'no_org'>('loading');

  useEffect(() => {
    if (!user) {
      setOrgCheck('loading');
      return;
    }

    supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        setOrgCheck(data?.organization_id ? 'has_org' : 'no_org');
      });
  }, [user]);

  if (loading || (user && orgCheck === 'loading')) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (orgCheck === 'no_org') {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
