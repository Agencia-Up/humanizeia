import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { Loader2 } from 'lucide-react';

/**
 * Protege rotas que apenas o admin (wandercarvalho31@gmail.com) pode acessar.
 * Redireciona para /tela-inicial se o usuario nao for admin.
 */
export function AdminRoute({ children }: { children: ReactNode }) {
  const { isAdmin, loading } = useIsAdmin();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/tela-inicial" replace />;
  }

  return <>{children}</>;
}
