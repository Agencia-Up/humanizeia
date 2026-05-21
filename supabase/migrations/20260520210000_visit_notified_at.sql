-- Fase 6: coluna pra evitar duplicar notificação de visita agendada
ALTER TABLE public.ai_crm_leads
  ADD COLUMN IF NOT EXISTS visit_notified_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_ai_crm_leads_visit_scheduled
  ON public.ai_crm_leads (visit_scheduled)
  WHERE visit_scheduled IS NOT NULL AND visit_notified_at IS NULL;
