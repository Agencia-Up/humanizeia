-- 1. Add UPDATE policy for organization_members (only owners can update roles)
CREATE POLICY "Owners can update member roles"
ON public.organization_members
FOR UPDATE
TO authenticated
USING (is_org_owner(auth.uid(), organization_id))
WITH CHECK (is_org_owner(auth.uid(), organization_id));

-- 2. Drop the overly permissive profile viewing policy and replace with restricted one
DROP POLICY IF EXISTS "Org members can view fellow member profiles" ON public.profiles;

CREATE POLICY "Org members can view limited fellow profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  auth.uid() = id
  OR EXISTS (
    SELECT 1
    FROM organization_members om1
    JOIN organization_members om2 ON om1.organization_id = om2.organization_id
    WHERE om1.user_id = auth.uid() AND om2.user_id = profiles.id
  )
);