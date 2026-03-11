
-- Create security definer function to check org membership
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _organization_id
  )
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(_user_id uuid, _organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _organization_id AND role = 'owner'
  )
$$;

-- Fix organization_members policies
DROP POLICY IF EXISTS "Members can view org members" ON public.organization_members;
CREATE POLICY "Members can view org members"
ON public.organization_members FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Owners can remove members" ON public.organization_members;
CREATE POLICY "Owners can remove members"
ON public.organization_members FOR DELETE
USING (public.is_org_owner(auth.uid(), organization_id));

-- Fix organizations policies that also reference organization_members
DROP POLICY IF EXISTS "Members can view their organization" ON public.organizations;
CREATE POLICY "Members can view their organization"
ON public.organizations FOR SELECT
USING (public.is_org_member(auth.uid(), id));

DROP POLICY IF EXISTS "Owners can update organization" ON public.organizations;
CREATE POLICY "Owners can update organization"
ON public.organizations FOR UPDATE
USING (public.is_org_owner(auth.uid(), id));

-- Fix invites policies
DROP POLICY IF EXISTS "Members can view org invites" ON public.organization_invites;
CREATE POLICY "Members can view org invites"
ON public.organization_invites FOR SELECT
USING (
  public.is_org_member(auth.uid(), organization_id)
  OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Admins can create invites" ON public.organization_invites;
CREATE POLICY "Admins can create invites"
ON public.organization_invites FOR INSERT
WITH CHECK (
  auth.uid() = invited_by
  AND public.is_org_owner(auth.uid(), organization_id)
);
