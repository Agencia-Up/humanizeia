-- =============================================================================
-- BUG-NOVO-06 — Follow-ups com retry exponencial (Pedro + Marcos)
-- =============================================================================
-- Hoje: ao falhar envio (UazAPI timeout, instância offline, etc.), status vira
-- 'failed' direto. claim_pedro_followup_schedules e claim_marcos_followup_
-- schedules só pegam 'pending', então o lead nunca recebe o follow-up.
--
-- Esta migration adiciona retry exponencial:
--   - Coluna attempt_count (int default 0) em ambas tabelas.
--   - Ao falhar: edge function incrementa attempt_count e reagenda
--     (scheduled_at += backoff baseado em attempt). Status fica 'pending'.
--   - Após 3 tentativas, edge function marca 'failed' definitivamente.
--   - Coluna last_failed_at registra última tentativa falha (debug).
--
-- Idempotente.
-- =============================================================================

-- Pedro
ALTER TABLE public.pedro_followup_schedules
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.pedro_followup_schedules
  ADD COLUMN IF NOT EXISTS last_failed_at timestamptz NULL;

ALTER TABLE public.pedro_followup_schedules
  ADD COLUMN IF NOT EXISTS last_error text NULL;

COMMENT ON COLUMN public.pedro_followup_schedules.attempt_count IS
  'Quantas vezes a edge function tentou enviar. Backoff exponencial até 3 tentativas, depois marca failed.';

-- Marcos (mesma estrutura)
ALTER TABLE public.marcos_followup_schedules
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.marcos_followup_schedules
  ADD COLUMN IF NOT EXISTS last_failed_at timestamptz NULL;

ALTER TABLE public.marcos_followup_schedules
  ADD COLUMN IF NOT EXISTS last_error text NULL;

COMMENT ON COLUMN public.marcos_followup_schedules.attempt_count IS
  'Quantas vezes a edge function tentou enviar. Backoff exponencial até 3 tentativas, depois marca failed.';

-- Index pra dashboard filtrar followups que falharam definitivamente
CREATE INDEX IF NOT EXISTS idx_pedro_followup_failed
  ON public.pedro_followup_schedules (user_id, last_failed_at DESC)
  WHERE status = 'failed' AND attempt_count >= 3;

CREATE INDEX IF NOT EXISTS idx_marcos_followup_failed
  ON public.marcos_followup_schedules (user_id, last_failed_at DESC)
  WHERE status = 'failed' AND attempt_count >= 3;

DO $$
DECLARE v_check int;
BEGIN
  SELECT COUNT(*) INTO v_check
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name IN ('pedro_followup_schedules', 'marcos_followup_schedules')
    AND column_name IN ('attempt_count', 'last_failed_at', 'last_error');
  RAISE NOTICE '[BUG-NOVO-06] colunas retry criadas: % de 6 (3 Pedro + 3 Marcos)', v_check;
END $$;
