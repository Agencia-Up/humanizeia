-- ============================================================================
-- Manager feedback scheduling: 2 modos (auto vs scheduled batch)
-- ============================================================================
-- AUTO (default): cada feedback vira uma mensagem WhatsApp imediata pro gerente
-- SCHEDULED: feedbacks acumulam (pending_send=true) e são enviados todos juntos
--   no horário configurado, com delay aleatório entre 27-54s pra não parecer spam.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.manager_feedback_config (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'scheduled')),
  -- Janela de horário (timezone America/Sao_Paulo) em que o batch é processado
  schedule_time_start time NOT NULL DEFAULT '09:00',
  schedule_time_end   time NOT NULL DEFAULT '09:30',
  delay_min_seconds   int  NOT NULL DEFAULT 27,
  delay_max_seconds   int  NOT NULL DEFAULT 54,
  last_flushed_at     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delay_range CHECK (delay_min_seconds > 0 AND delay_max_seconds >= delay_min_seconds AND delay_max_seconds < 600)
);

COMMENT ON TABLE public.manager_feedback_config IS
  'Config por master: modo de entrega de feedbacks pro gerente (auto/scheduled) + janela horária + delays.';

ALTER TABLE public.manager_feedback_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_manage_feedback_config" ON public.manager_feedback_config;
CREATE POLICY "owner_manage_feedback_config" ON public.manager_feedback_config
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Trigger updated_at (reaproveita função existente tg_set_updated_at)
DROP TRIGGER IF EXISTS trg_manager_feedback_config_updated_at ON public.manager_feedback_config;
CREATE TRIGGER trg_manager_feedback_config_updated_at
  BEFORE UPDATE ON public.manager_feedback_config
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ── Coluna pending_send em pedro_manager_feedback ──────────────────────────
-- TRUE quando o feedback ainda não foi enviado pro WhatsApp do gerente
-- (modo scheduled enquanto não chegou o horário, OU modo auto que falhou)
ALTER TABLE public.pedro_manager_feedback
  ADD COLUMN IF NOT EXISTS pending_send boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sent_to_manager_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_pedro_feedback_pending
  ON public.pedro_manager_feedback(user_id, pending_send)
  WHERE pending_send = true;

COMMENT ON COLUMN public.pedro_manager_feedback.pending_send IS
  'TRUE = feedback ainda aguardando envio pro WhatsApp do gerente. cron-flush-manager-feedbacks processa.';
COMMENT ON COLUMN public.pedro_manager_feedback.sent_to_manager_at IS
  'Timestamp do envio efetivo pro WhatsApp do gerente.';
