import { useAuth } from '@/hooks/useAuth';

const ADMIN_EMAIL = 'wandercarvalho31@gmail.com';

/**
 * Hook que verifica se o usuário logado é o administrador da plataforma.
 * Usa o campo is_superadmin do perfil OU o e-mail diretamente.
 */
export function useIsAdmin() {
  const { user, profile, loading } = useAuth();
  const isAdmin =
    profile?.is_superadmin === true ||
    user?.email === ADMIN_EMAIL;

  return { isAdmin, loading };
}
