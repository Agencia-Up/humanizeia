
-- Function to increment consecutive_undelivered and detect shadow ban
CREATE OR REPLACE FUNCTION public.increment_consecutive_undelivered(iid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  UPDATE wa_instances
  SET consecutive_undelivered = COALESCE(consecutive_undelivered, 0) + 1,
      updated_at = now()
  WHERE id = iid
  RETURNING consecutive_undelivered INTO new_count;

  -- If 10+ consecutive messages without delivery confirmation, flag as shadow banned
  IF new_count IS NOT NULL AND new_count >= 10 THEN
    UPDATE wa_instances
    SET shadow_ban_suspect = true,
        is_active = false,
        health_score = GREATEST(0, health_score - 50)
    WHERE id = iid AND shadow_ban_suspect = false;
  END IF;
END;
$$;
