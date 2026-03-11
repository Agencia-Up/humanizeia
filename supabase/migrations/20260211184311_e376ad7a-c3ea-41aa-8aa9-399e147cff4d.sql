
-- Allow creators to SELECT their own organization (needed for insert...returning)
DROP POLICY IF EXISTS "Members can view their organization" ON public.organizations;
CREATE POLICY "Members or creators can view their organization"
ON public.organizations FOR SELECT
TO authenticated
USING (
  public.is_org_member(auth.uid(), id)
  OR created_by = auth.uid()
);
