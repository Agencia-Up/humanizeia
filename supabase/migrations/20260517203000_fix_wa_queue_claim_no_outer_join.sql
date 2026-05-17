-- Fix claim_wa_queue_items after the anti-duplication change.
-- PostgreSQL does not allow FOR UPDATE on the nullable side of an outer join.
-- Use NOT EXISTS instead, keeping SKIP LOCKED so concurrent cron executions
-- cannot claim the same queue row.

CREATE OR REPLACE FUNCTION public.claim_wa_queue_items(
  p_limit INTEGER DEFAULT 1,
  p_stale_after INTERVAL DEFAULT INTERVAL '10 minutes'
)
RETURNS SETOF public.wa_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.wa_queue
  SET status = 'pending',
      scheduled_for = now()
  WHERE status = 'processing'
    AND scheduled_for < now() - p_stale_after;

  RETURN QUERY
  WITH candidates AS (
    SELECT inner_q.id
    FROM public.wa_queue inner_q
    WHERE inner_q.status = 'pending'
      AND inner_q.scheduled_for <= now()
      AND NOT EXISTS (
        SELECT 1
        FROM public.wa_campaigns c
        WHERE c.id = inner_q.campaign_id
          AND c.status IN ('paused', 'cancelled', 'completed')
      )
    ORDER BY inner_q.scheduled_for ASC, inner_q.created_at ASC
    LIMIT p_limit
    FOR UPDATE OF inner_q SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.wa_queue q
    SET status = 'processing',
        scheduled_for = now()
    FROM candidates
    WHERE q.id = candidates.id
    RETURNING q.*
  )
  SELECT * FROM claimed;
END;
$$;

COMMENT ON FUNCTION public.claim_wa_queue_items IS
  'Atomically claims ready wa_queue rows without outer joins, preventing duplicate sends under concurrent workers.';
