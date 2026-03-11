DROP POLICY IF EXISTS "Users can join organizations" ON public.organization_members;

CREATE POLICY "Users can join organizations from accepted invite"
ON public.organization_members
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND role = 'member'::org_role
  AND EXISTS (
    SELECT 1
    FROM public.organization_invites oi
    WHERE oi.organization_id = organization_members.organization_id
      AND lower(oi.email) = lower(public.get_user_email(auth.uid()))
      AND oi.status = 'accepted'::invite_status
  )
);

DROP POLICY IF EXISTS "Invited users can respond to invites" ON public.organization_invites;

CREATE POLICY "Invited users can respond to invites"
ON public.organization_invites
FOR UPDATE
TO authenticated
USING (
  lower(email) = lower(public.get_user_email(auth.uid()))
  AND status = 'pending'::invite_status
)
WITH CHECK (
  lower(email) = lower(public.get_user_email(auth.uid()))
  AND organization_id = (
    SELECT oi.organization_id
    FROM public.organization_invites oi
    WHERE oi.id = organization_invites.id
  )
  AND invited_by = (
    SELECT oi.invited_by
    FROM public.organization_invites oi
    WHERE oi.id = organization_invites.id
  )
  AND status IN ('pending'::invite_status, 'accepted'::invite_status, 'declined'::invite_status)
);