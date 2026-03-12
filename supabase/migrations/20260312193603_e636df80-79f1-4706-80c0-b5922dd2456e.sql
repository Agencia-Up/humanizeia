
-- 1. Corrigir get_user_email: restringir para que só possa ser chamada internamente
-- Revogar acesso direto de usuários autenticados e anônimos
REVOKE EXECUTE ON FUNCTION public.get_user_email FROM authenticated, anon;

-- 2. Corrigir bypass de re-entrada: criar trigger que invalida convite quando membro entra
CREATE OR REPLACE FUNCTION public.invalidate_accepted_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.organization_invites
  SET status = 'declined', updated_at = now()
  WHERE organization_id = NEW.organization_id
    AND lower(email) = lower(public.get_user_email(NEW.user_id))
    AND status = 'accepted';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invalidate_invite_on_join
  AFTER INSERT ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.invalidate_accepted_invite();
