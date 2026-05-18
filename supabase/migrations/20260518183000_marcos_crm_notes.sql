-- ============================================================================
-- Marcos CRM: manual lead notes
-- ============================================================================
-- Marcos uses crm_leads, while Pedro uses ai_crm_leads. Keeping notes in a
-- separate table avoids foreign key conflicts when the shared lead detail screen
-- saves annotations for Marcos leads.

CREATE TABLE IF NOT EXISTS public.marcos_crm_notes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    UUID        NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id  UUID        REFERENCES public.ai_team_members(id) ON DELETE SET NULL,
  content    TEXT        NOT NULL,
  is_pinned  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.marcos_crm_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_manage_marcos_notes" ON public.marcos_crm_notes;
CREATE POLICY "owner_manage_marcos_notes" ON public.marcos_crm_notes
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "seller_manage_own_marcos_notes" ON public.marcos_crm_notes;
CREATE POLICY "seller_manage_own_marcos_notes" ON public.marcos_crm_notes
  FOR ALL
  TO authenticated
  USING (
    user_id = public.get_seller_master_user_id()
    AND member_id IN (SELECT public.get_my_member_ids())
  )
  WITH CHECK (
    user_id = public.get_seller_master_user_id()
    AND member_id IN (SELECT public.get_my_member_ids())
  );

DROP POLICY IF EXISTS "seller_view_assigned_marcos_notes" ON public.marcos_crm_notes;
CREATE POLICY "seller_view_assigned_marcos_notes" ON public.marcos_crm_notes
  FOR SELECT
  TO authenticated
  USING (
    user_id = public.get_seller_master_user_id()
    AND EXISTS (
      SELECT 1
      FROM public.crm_leads lead
      WHERE lead.id = marcos_crm_notes.lead_id
        AND lead.assigned_to = ANY(public.get_seller_member_ids_text())
    )
  );

CREATE INDEX IF NOT EXISTS marcos_crm_notes_lead_id_idx    ON public.marcos_crm_notes(lead_id);
CREATE INDEX IF NOT EXISTS marcos_crm_notes_user_id_idx    ON public.marcos_crm_notes(user_id);
CREATE INDEX IF NOT EXISTS marcos_crm_notes_member_id_idx  ON public.marcos_crm_notes(member_id);
CREATE INDEX IF NOT EXISTS marcos_crm_notes_created_at_idx ON public.marcos_crm_notes(created_at DESC);
CREATE INDEX IF NOT EXISTS marcos_crm_notes_pinned_idx     ON public.marcos_crm_notes(is_pinned) WHERE is_pinned = TRUE;
