-- =============================================================================
-- Marcos Manager Feedback — reusa a tabela pedro_manager_feedback
-- =============================================================================
-- ADD COLUMN crm_lead_id pra feedbacks de leads do Marcos (crm_leads).
-- Torna lead_id (ai_crm_leads) NULLABLE pra aceitar feedbacks que apontam só
-- pra crm_leads. CHECK garante que EXATAMENTE 1 dos 2 IDs está preenchido.

ALTER TABLE public.pedro_manager_feedback
  ADD COLUMN IF NOT EXISTS crm_lead_id uuid NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE;

-- lead_id agora pode ser NULL (quando feedback é sobre Marcos lead)
ALTER TABLE public.pedro_manager_feedback
  ALTER COLUMN lead_id DROP NOT NULL;

-- CHECK: exatamente 1 dos 2 IDs preenchido (não pode 0, não pode 2)
ALTER TABLE public.pedro_manager_feedback
  DROP CONSTRAINT IF EXISTS pedro_manager_feedback_lead_xor_check;
ALTER TABLE public.pedro_manager_feedback
  ADD CONSTRAINT pedro_manager_feedback_lead_xor_check
  CHECK (
    (lead_id IS NOT NULL AND crm_lead_id IS NULL)
    OR (lead_id IS NULL AND crm_lead_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_pmf_crm_lead_id
  ON public.pedro_manager_feedback (crm_lead_id)
  WHERE crm_lead_id IS NOT NULL;

DO $$
DECLARE v_check int;
BEGIN
  SELECT COUNT(*) INTO v_check
  FROM pg_constraint WHERE conname = 'pedro_manager_feedback_lead_xor_check';
  RAISE NOTICE '[Marcos Feedback] CHECK xor criado: %', v_check;
END $$;
