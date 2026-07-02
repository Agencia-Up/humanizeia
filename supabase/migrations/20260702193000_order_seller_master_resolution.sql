-- Ensure seller accounts resolve their master account deterministically.
--
-- Some production sellers have historical duplicate rows in ai_team_members.
-- Without an ORDER BY, Postgres could return any matching row and point the
-- seller to the wrong master/account depending on query plan changes.

CREATE OR REPLACE FUNCTION public.get_seller_master_user_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT user_id
  FROM public.ai_team_members
  WHERE auth_user_id = auth.uid()
  ORDER BY
    COALESCE(is_active, true) DESC,
    COALESCE(active_in_system, true) DESC,
    updated_at DESC NULLS LAST,
    created_at DESC NULLS LAST
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_seller_master_user_id() TO authenticated, service_role;
