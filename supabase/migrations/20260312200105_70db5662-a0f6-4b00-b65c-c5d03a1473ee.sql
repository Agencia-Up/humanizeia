
-- Function to atomically increment sent_count on a campaign
CREATE OR REPLACE FUNCTION public.increment_campaign_sent(cid uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE wa_campaigns
  SET sent_count = sent_count + 1,
      updated_at = now()
  WHERE id = cid;
$$;
