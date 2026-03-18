
CREATE OR REPLACE FUNCTION public.invalidate_invite_on_member_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.organization_invites
  SET status = 'declined', updated_at = now()
  WHERE organization_id = OLD.organization_id
    AND lower(email) = lower(public.get_user_email(OLD.user_id))
    AND status IN ('accepted', 'pending');
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_invalidate_invite_on_member_removal
  AFTER DELETE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.invalidate_invite_on_member_removal();
