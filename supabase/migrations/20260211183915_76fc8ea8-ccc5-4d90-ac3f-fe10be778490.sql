
-- Fix organizations INSERT policy
DROP POLICY IF EXISTS "Authenticated users can create organizations" ON public.organizations;
CREATE POLICY "Authenticated users can create organizations"
ON public.organizations FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

-- Fix invites SELECT: replace auth.users reference with security definer function
CREATE OR REPLACE FUNCTION public.get_user_email(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM auth.users WHERE id = _user_id
$$;

DROP POLICY IF EXISTS "Members can view org invites" ON public.organization_invites;
CREATE POLICY "Members can view org invites"
ON public.organization_invites FOR SELECT
TO authenticated
USING (
  public.is_org_member(auth.uid(), organization_id)
  OR email = public.get_user_email(auth.uid())
);

-- Fix invites UPDATE policy
DROP POLICY IF EXISTS "Invited users can respond to invites" ON public.organization_invites;
CREATE POLICY "Invited users can respond to invites"
ON public.organization_invites FOR UPDATE
TO authenticated
USING (email = public.get_user_email(auth.uid()));

-- Fix invites INSERT policy
DROP POLICY IF EXISTS "Admins can create invites" ON public.organization_invites;
CREATE POLICY "Admins can create invites"
ON public.organization_invites FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = invited_by
  AND public.is_org_owner(auth.uid(), organization_id)
);

-- Fix organization_members INSERT policy
DROP POLICY IF EXISTS "Users can join organizations" ON public.organization_members;
CREATE POLICY "Users can join organizations"
ON public.organization_members FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);
