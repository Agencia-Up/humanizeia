import { useAuth } from '@/hooks/useAuth';

// Donos da plataforma (acesso de administração). Wander + Douglas.
const ADMIN_EMAILS = ['wandercarvalho31@gmail.com', 'douglasaloan@gmail.com'];

/**
 * Hook que verifica se o usuário logado é administrador (dono) da plataforma.
 * Usa o campo is_superadmin do perfil OU o e-mail estar na lista de donos.
 */
export function useIsAdmin() {
  const { user, profile, loading } = useAuth();
  const email = (user?.email || '').toLowerCase();
  const isAdmin =
    profile?.is_superadmin === true ||
    ADMIN_EMAILS.includes(email);

  return { isAdmin, loading };
}
