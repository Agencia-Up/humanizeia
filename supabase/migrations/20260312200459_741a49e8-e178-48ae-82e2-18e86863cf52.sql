
-- Replace overly permissive anon policy with a more targeted one
-- The webhook edge function will use service_role_key, so we can drop the anon policy
DROP POLICY IF EXISTS "Service can insert inbox" ON public.wa_inbox;
