-- ============================================================
-- Pedro CRM Upgrade — Fase 2
-- Anotações de vendedores, agendamento de follow-ups e
-- feedback para gerentes.
-- ============================================================

-- ── 1. Novos campos em ai_crm_leads ─────────────────────────────────────────
ALTER TABLE public.ai_crm_leads
  ADD COLUMN IF NOT EXISTS status_crm         TEXT DEFAULT 'novo',
  ADD COLUMN IF NOT EXISTS next_followup_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_followup_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS seller_notes_count INT  DEFAULT 0;

-- ── 2. Notas de vendedores ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedro_crm_notes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID        NOT NULL REFERENCES public.ai_crm_leads(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id     UUID        REFERENCES public.ai_team_members(id) ON DELETE SET NULL,
  content       TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pedro_crm_notes ENABLE ROW LEVEL SECURITY;

-- Dono (gerente) vê todas as notas dos seus leads
CREATE POLICY "owner_manage_notes" ON public.pedro_crm_notes
  FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Vendedor vê/cria notas dos leads atribuídos a ele
CREATE POLICY "seller_manage_own_notes" ON public.pedro_crm_notes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_team_members atm
      WHERE atm.auth_user_id = auth.uid()
        AND atm.id = pedro_crm_notes.member_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ai_team_members atm
      WHERE atm.auth_user_id = auth.uid()
        AND atm.id = pedro_crm_notes.member_id
    )
  );

-- Índices
CREATE INDEX IF NOT EXISTS pedro_crm_notes_lead_id_idx    ON public.pedro_crm_notes(lead_id);
CREATE INDEX IF NOT EXISTS pedro_crm_notes_user_id_idx    ON public.pedro_crm_notes(user_id);
CREATE INDEX IF NOT EXISTS pedro_crm_notes_member_id_idx  ON public.pedro_crm_notes(member_id);
CREATE INDEX IF NOT EXISTS pedro_crm_notes_created_at_idx ON public.pedro_crm_notes(created_at DESC);

-- Trigger: mantém seller_notes_count em ai_crm_leads sincronizado
CREATE OR REPLACE FUNCTION public.sync_pedro_notes_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.ai_crm_leads SET seller_notes_count = seller_notes_count + 1
    WHERE id = NEW.lead_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.ai_crm_leads SET seller_notes_count = GREATEST(seller_notes_count - 1, 0)
    WHERE id = OLD.lead_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedro_notes_count ON public.pedro_crm_notes;
CREATE TRIGGER trg_pedro_notes_count
  AFTER INSERT OR DELETE ON public.pedro_crm_notes
  FOR EACH ROW EXECUTE FUNCTION public.sync_pedro_notes_count();

-- ── 3. Agendamentos de follow-up (vendedor agenda manualmente) ───────────────
CREATE TABLE IF NOT EXISTS public.pedro_followup_schedules (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID        NOT NULL REFERENCES public.ai_crm_leads(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id        UUID        REFERENCES public.ai_team_members(id) ON DELETE SET NULL,
  scheduled_at     TIMESTAMPTZ NOT NULL,
  message_template TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending',  -- pending | sent | cancelled
  sent_at          TIMESTAMPTZ,
  instance_id      UUID        REFERENCES public.wa_instances(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pedro_followup_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_manage_followups" ON public.pedro_followup_schedules
  FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "seller_manage_own_followups" ON public.pedro_followup_schedules
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_team_members atm
      WHERE atm.auth_user_id = auth.uid()
        AND atm.id = pedro_followup_schedules.member_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ai_team_members atm
      WHERE atm.auth_user_id = auth.uid()
        AND atm.id = pedro_followup_schedules.member_id
    )
  );

CREATE INDEX IF NOT EXISTS pedro_followup_lead_idx    ON public.pedro_followup_schedules(lead_id);
CREATE INDEX IF NOT EXISTS pedro_followup_user_idx    ON public.pedro_followup_schedules(user_id);
CREATE INDEX IF NOT EXISTS pedro_followup_status_idx  ON public.pedro_followup_schedules(status);
CREATE INDEX IF NOT EXISTS pedro_followup_sched_idx   ON public.pedro_followup_schedules(scheduled_at);

-- ── 4. Feedback de vendedor para gerente ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedro_manager_feedback (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID        NOT NULL REFERENCES public.ai_crm_leads(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id        UUID        REFERENCES public.ai_team_members(id) ON DELETE SET NULL,
  content          TEXT        NOT NULL,
  priority         TEXT        NOT NULL DEFAULT 'normal',  -- low | normal | high | urgent
  read_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pedro_manager_feedback ENABLE ROW LEVEL SECURITY;

-- Gerente lê todos os feedbacks dos seus vendedores
CREATE POLICY "owner_read_feedback" ON public.pedro_manager_feedback
  FOR SELECT
  USING (user_id = auth.uid());

-- Vendedor cria e vê seus próprios feedbacks
CREATE POLICY "seller_manage_feedback" ON public.pedro_manager_feedback
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_team_members atm
      WHERE atm.auth_user_id = auth.uid()
        AND atm.id = pedro_manager_feedback.member_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ai_team_members atm
      WHERE atm.auth_user_id = auth.uid()
        AND atm.id = pedro_manager_feedback.member_id
    )
  );

CREATE INDEX IF NOT EXISTS pedro_feedback_user_idx    ON public.pedro_manager_feedback(user_id);
CREATE INDEX IF NOT EXISTS pedro_feedback_lead_idx    ON public.pedro_manager_feedback(lead_id);
CREATE INDEX IF NOT EXISTS pedro_feedback_read_idx    ON public.pedro_manager_feedback(read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS pedro_feedback_created_idx ON public.pedro_manager_feedback(created_at DESC);
