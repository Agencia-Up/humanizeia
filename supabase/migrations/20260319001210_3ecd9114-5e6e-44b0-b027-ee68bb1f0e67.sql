-- Fix 1: Restrict capture_form_submissions INSERT to valid active forms only
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'capture_form_submissions') THEN
    DROP POLICY IF EXISTS "Anyone can submit forms" ON public.capture_form_submissions;

    EXECUTE 'CREATE POLICY "Anyone can submit to active forms"
    ON public.capture_form_submissions
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.capture_forms cf
        WHERE cf.id = form_id
          AND cf.is_active = true
      )
    )';
  END IF;
END $$;

-- Fix 2: Add DELETE policy on organization_invites so org owners can revoke invites
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'organization_invites') THEN
    EXECUTE 'CREATE POLICY "Org owners can delete invites"
    ON public.organization_invites
    FOR DELETE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = organization_invites.organization_id
          AND om.user_id = auth.uid()
          AND om.role = ''owner''
      )
    )';
  END IF;
END $$;
