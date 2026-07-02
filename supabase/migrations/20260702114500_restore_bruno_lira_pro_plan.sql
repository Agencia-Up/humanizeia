-- Emergency correction: restore Bruno Lira account to PRO.
-- This is intentionally scoped to a single email and preserves usage/recharge
-- counters. It only fixes the entitlement fields that may have been downgraded.

DO $$
DECLARE
  v_user_id uuid;
  v_rows integer;
BEGIN
  SELECT u.id
    INTO v_user_id
  FROM auth.users u
  WHERE lower(u.email) = lower('brunolira0312@icloud.com')
  ORDER BY u.created_at ASC
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE '[restore-bruno-pro] user not found for brunolira0312@icloud.com';
    RETURN;
  END IF;

  UPDATE public.user_subscriptions
  SET
    plan_id = 'pro',
    status = 'active',
    tokens_included = 999999,
    updated_at = now()
  WHERE user_id = v_user_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    INSERT INTO public.user_subscriptions (
      user_id,
      plan_id,
      status,
      tokens_included,
      tokens_used,
      tokens_purchased,
      renewal_date,
      created_at,
      updated_at
    )
    VALUES (
      v_user_id,
      'pro',
      'active',
      999999,
      0,
      0,
      now() + interval '30 days',
      now(),
      now()
    );
  END IF;

  RAISE NOTICE '[restore-bruno-pro] restored user % to plan pro', v_user_id;
END $$;
