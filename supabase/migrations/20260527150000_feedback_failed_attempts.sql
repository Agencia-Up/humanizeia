-- =============================================================================
-- pedro_manager_feedback: contador de tentativas falhas (BUG-10 / FASE 4)
-- =============================================================================
-- Hoje feedbacks que falham no envio (ex: vendedor sem agent_id válido, UazAPI
-- offline, gerente_phone removido) ficam ETERNAMENTE com pending_send=true.
-- O cron-flush-manager-feedbacks tenta enviar e silenciosamente falha; na
-- próxima rodada tenta de novo; loop infinito sem feedback ao usuário.
--
-- Solução: contar tentativas. Após N falhas (definido na lógica do cron),
-- marcar como pending_send=false + failed_at=now() pra parar de tentar e
-- permitir investigação manual via dashboard.
--
-- Idempotente — ADD COLUMN IF NOT EXISTS. Sem default explícito em failed_at
-- (NULL = nunca falhou). failed_attempts começa em 0 pra rows existentes.
-- =============================================================================

ALTER TABLE public.pedro_manager_feedback
  ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.pedro_manager_feedback
  ADD COLUMN IF NOT EXISTS failed_at timestamptz NULL;

COMMENT ON COLUMN public.pedro_manager_feedback.failed_attempts IS
  'Contador de tentativas falhas de envio ao gerente. Cron incrementa a cada erro. Quando atinge limite (3), feedback é marcado pending_send=false + failed_at=now() pra parar de tentar.';

COMMENT ON COLUMN public.pedro_manager_feedback.failed_at IS
  'Timestamp em que feedback foi descartado por exceder limite de tentativas. NULL = nunca falhou definitivamente.';

-- Index pra dashboard/relatórios poderem filtrar feedbacks que precisam de
-- atenção humana (falharam definitivamente). Parcial pra ser pequeno.
CREATE INDEX IF NOT EXISTS idx_pedro_manager_feedback_failed_at
  ON public.pedro_manager_feedback (failed_at DESC NULLS LAST)
  WHERE failed_at IS NOT NULL;

-- Confirmação via RAISE NOTICE
DO $$
DECLARE v_check int;
BEGIN
  SELECT COUNT(*) INTO v_check
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'pedro_manager_feedback'
    AND column_name IN ('failed_attempts', 'failed_at');
  RAISE NOTICE '[Fase 0 — Feedback Retry] colunas failed_attempts/failed_at criadas: % de 2', v_check;
END $$;
