-- Fair queue claim for mass-send campaigns.
-- When an old campaign has many overdue rows, it must not monopolize the whole
-- sender and block newer campaigns. Claim at most one ready row per campaign
-- per processor invocation, while still using SKIP LOCKED.

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
  WITH ranked_ready AS (
    SELECT
      inner_q.id,
      row_number() OVER (
        PARTITION BY coalesce(inner_q.campaign_id::text, 'no-campaign:' || inner_q.user_id::text)
        ORDER BY inner_q.scheduled_for ASC, inner_q.created_at ASC
      ) AS rn
    FROM public.wa_queue inner_q
    WHERE inner_q.status = 'pending'
      AND inner_q.scheduled_for <= now()
      AND NOT EXISTS (
        SELECT 1
        FROM public.wa_campaigns c
        WHERE c.id = inner_q.campaign_id
          AND c.status IN ('paused', 'cancelled', 'completed')
      )
  ),
  candidates AS (
    SELECT q.id
    FROM public.wa_queue q
    JOIN ranked_ready r ON r.id = q.id
    WHERE r.rn = 1
    ORDER BY q.scheduled_for ASC, q.created_at ASC
    LIMIT p_limit
    FOR UPDATE OF q SKIP LOCKED
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
  'Atomically claims one ready wa_queue row per campaign per run, avoiding duplicate sends and campaign starvation.';
