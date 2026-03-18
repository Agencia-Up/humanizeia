
-- 1. Fix org rejoin bypass: prevent removed members from re-joining via old accepted invites
DROP POLICY IF EXISTS "Users can join organizations from accepted invite" ON public.organization_members;
CREATE POLICY "Users can join organizations from accepted invite"
ON public.organization_members
FOR INSERT
TO authenticated
WITH CHECK (
  (auth.uid() = user_id)
  AND (role = 'member'::org_role)
  AND (EXISTS (
    SELECT 1 FROM organization_invites oi
    WHERE oi.organization_id = organization_members.organization_id
      AND lower(oi.email) = lower(get_user_email(auth.uid()))
      AND oi.status = 'accepted'::invite_status
  ))
  AND (NOT EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = organization_members.organization_id
  ))
);

-- 2. Fix org invites email exposure: restrict to owners + own invites only
DROP POLICY IF EXISTS "Members can view org invites" ON public.organization_invites;
CREATE POLICY "Owners and invitees can view invites"
ON public.organization_invites
FOR SELECT
TO authenticated
USING (
  is_org_owner(auth.uid(), organization_id)
  OR (lower(email) = lower(get_user_email(auth.uid())))
);

-- 3. Fix copy formulas unauthenticated read: restrict to authenticated users
DROP POLICY IF EXISTS "Anyone can view default formulas" ON public.copy_formulas;
DROP POLICY IF EXISTS "Users can view own and default formulas" ON public.copy_formulas;
CREATE POLICY "Authenticated users can view own and default formulas"
ON public.copy_formulas
FOR SELECT
TO authenticated
USING ((user_id = auth.uid()) OR (is_default = true));
