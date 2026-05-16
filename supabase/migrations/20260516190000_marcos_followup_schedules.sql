-- ============================================================================
-- Marcos CRM: follow-ups manuais/agendados, somente envio
-- ============================================================================
-- Diferente do Pedro, isto NAO aciona agente conversacional. A fila abaixo
-- apenas guarda mensagens que devem ser enviadas por uma instancia WhatsApp
-- conectada pelo vendedor/gerente.

CREATE OR REPLACE FUNCTION public.get_my_member_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id FROM public.ai_team_members WHERE auth_user_id = auth.uid();
$$;

CREATE TABLE IF NOT EXISTS public.marcos_followup_schedules (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID        NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id        UUID        REFERENCES public.ai_team_members(id) ON DELETE SET NULL,
  scheduled_at     TIMESTAMPTZ NOT NULL,
  message_template TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending',
  sent_at          TIMESTAMPTZ,
  instance_id      UUID        REFERENCES public.wa_instances(id) ON DELETE SET NULL,
  media_url        TEXT,
  media_type       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.marcos_followup_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_manage_marcos_followups" ON public.marcos_followup_schedules;
CREATE POLICY "owner_manage_marcos_followups" ON public.marcos_followup_schedules
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "seller_manage_own_marcos_followups" ON public.marcos_followup_schedules;
CREATE POLICY "seller_manage_own_marcos_followups" ON public.marcos_followup_schedules
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

CREATE INDEX IF NOT EXISTS marcos_followup_lead_idx   ON public.marcos_followup_schedules(lead_id);
CREATE INDEX IF NOT EXISTS marcos_followup_user_idx   ON public.marcos_followup_schedules(user_id);
CREATE INDEX IF NOT EXISTS marcos_followup_member_idx ON public.marcos_followup_schedules(member_id);
CREATE INDEX IF NOT EXISTS marcos_followup_status_idx ON public.marcos_followup_schedules(status);
CREATE INDEX IF NOT EXISTS marcos_followup_sched_idx  ON public.marcos_followup_schedules(scheduled_at);
