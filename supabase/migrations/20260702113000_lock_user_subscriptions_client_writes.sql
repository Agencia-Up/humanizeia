-- Prevent the web client from changing paid subscription entitlements.
-- Plan/status/quota changes must come from service_role Edge Functions or
-- SECURITY DEFINER database functions, never from browser-side RLS updates.

DROP POLICY IF EXISTS users_own_subscription ON public.user_subscriptions;
DROP POLICY IF EXISTS users_read_own_subscription ON public.user_subscriptions;
DROP POLICY IF EXISTS users_insert_own_pending_subscription ON public.user_subscriptions;

CREATE POLICY users_read_own_subscription
  ON public.user_subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY users_insert_own_pending_subscription
  ON public.user_subscriptions
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND plan_id = 'basico'
    AND status = 'pending'
    AND tokens_included = 0
    AND tokens_used = 0
    AND tokens_purchased = 0
  );

COMMENT ON POLICY users_read_own_subscription ON public.user_subscriptions IS
  'Authenticated users can read only their own subscription.';

COMMENT ON POLICY users_insert_own_pending_subscription ON public.user_subscriptions IS
  'Browser fallback may create only a locked pending baseline subscription; it cannot overwrite paid plans.';
