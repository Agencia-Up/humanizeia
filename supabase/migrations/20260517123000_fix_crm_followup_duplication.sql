-- Fix: evita follow-ups duplicados no Pedro e no Marcos.
--
-- Causa: pedro-trigger-followup selecionava status='pending' e enviava antes
-- de marcar como enviado. Se o cron e uma chamada manual rodavam juntos, ambos
-- podiam enviar o mesmo agendamento.

CREATE OR REPLACE FUNCTION public.claim_pedro_followup_schedules(
  p_limit INTEGER DEFAULT 30,
  p_stale_after INTERVAL DEFAULT INTERVAL '10 minutes'
)
RETURNS SETOF public.pedro_followup_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pedro_followup_schedules
  SET status = 'pending'
  WHERE status = 'processing'
    AND scheduled_at < now() - p_stale_after;

  RETURN QUERY
  WITH claimed AS (
    UPDATE public.pedro_followup_schedules s
    SET status = 'processing',
        scheduled_at = now()
    WHERE s.id IN (
      SELECT inner_s.id
      FROM public.pedro_followup_schedules inner_s
      WHERE inner_s.status = 'pending'
        AND inner_s.scheduled_at <= now()
      ORDER BY inner_s.scheduled_at ASC, inner_s.created_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING s.*
  )
  SELECT * FROM claimed;
END;
$$;

COMMENT ON FUNCTION public.claim_pedro_followup_schedules IS
  'Reivindica atomicamente follow-ups do Pedro para evitar envio duplicado em execucoes concorrentes.';

CREATE OR REPLACE FUNCTION public.claim_marcos_followup_schedules(
  p_limit INTEGER DEFAULT 30,
  p_stale_after INTERVAL DEFAULT INTERVAL '10 minutes'
)
RETURNS SETOF public.marcos_followup_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.marcos_followup_schedules
  SET status = 'pending'
  WHERE status = 'processing'
    AND scheduled_at < now() - p_stale_after;

  RETURN QUERY
  WITH claimed AS (
    UPDATE public.marcos_followup_schedules s
    SET status = 'processing',
        scheduled_at = now()
    WHERE s.id IN (
      SELECT inner_s.id
      FROM public.marcos_followup_schedules inner_s
      WHERE inner_s.status = 'pending'
        AND inner_s.scheduled_at <= now()
      ORDER BY inner_s.scheduled_at ASC, inner_s.created_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING s.*
  )
  SELECT * FROM claimed;
END;
$$;

COMMENT ON FUNCTION public.claim_marcos_followup_schedules IS
  'Reivindica atomicamente follow-ups do Marcos para evitar envio duplicado em execucoes concorrentes.';
