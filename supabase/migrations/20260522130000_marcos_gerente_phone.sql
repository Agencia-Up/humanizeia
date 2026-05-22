-- =============================================================================
-- Marcos CRM: gerente_phone separado do Pedro
-- =============================================================================
-- Pedro guarda gerente_phone em wa_ai_agents (per-agente IA).
-- Marcos não tem agente IA, então gerente_phone vai em manager_feedback_config
-- (per-master). Coluna opcional, idempotente.

ALTER TABLE public.manager_feedback_config
  ADD COLUMN IF NOT EXISTS gerente_phone_marcos text NULL;

COMMENT ON COLUMN public.manager_feedback_config.gerente_phone_marcos IS
  'Telefone (apenas dígitos) do gerente que recebe feedbacks do CRM do Marcos via WhatsApp. NULL = não envia.';

DO $$
DECLARE v_check int;
BEGIN
  SELECT COUNT(*) INTO v_check
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name='manager_feedback_config'
    AND column_name='gerente_phone_marcos';
  RAISE NOTICE '[Marcos Gerente] coluna gerente_phone_marcos criada: %', v_check;
END $$;
