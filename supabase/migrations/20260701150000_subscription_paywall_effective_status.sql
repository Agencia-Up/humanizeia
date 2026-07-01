-- ============================================================================
-- Paywall de assinatura: status efetivo da conta pagante
-- ----------------------------------------------------------------------------
-- Objetivo:
--   1) Master/owner e vendedores usam a mesma conta pagante.
--   2) Vendedor herda o status do master via ai_team_members.user_id.
--   3) Atraso tem carencia de 3 dias uteis antes do bloqueio.
--   4) Cron diario suspende somente assinaturas ja marcadas como overdue e fora
--      da carencia, reduzindo risco de travar conta ativa por dado antigo.
--
-- Observacao: dias uteis aqui consideram segunda a sexta, sem feriados.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.add_business_days(
  p_start timestamptz,
  p_days integer
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_cursor timestamptz := p_start;
  v_added integer := 0;
BEGIN
  IF p_start IS NULL THEN
    RETURN NULL;
  END IF;

  IF COALESCE(p_days, 0) <= 0 THEN
    RETURN p_start;
  END IF;

  WHILE v_added < p_days LOOP
    v_cursor := v_cursor + interval '1 day';
    IF EXTRACT(ISODOW FROM v_cursor) BETWEEN 1 AND 5 THEN
      v_added := v_added + 1;
    END IF;
  END LOOP;

  RETURN v_cursor;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_billing_owner_user_id(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_manager_id uuid;
  v_team_master_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF auth.role() <> 'service_role' AND auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'resolve_billing_owner_user_id: acesso negado';
  END IF;

  SELECT role, manager_id
    INTO v_role, v_manager_id
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_role = 'seller' THEN
    SELECT user_id
      INTO v_team_master_id
    FROM public.ai_team_members
    WHERE auth_user_id = p_user_id
    ORDER BY COALESCE(is_active, true) DESC, created_at DESC NULLS LAST
    LIMIT 1;

    RETURN COALESCE(v_team_master_id, v_manager_id, p_user_id);
  END IF;

  RETURN p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_effective_subscription_status(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_owner_id uuid;
  v_sub public.user_subscriptions%ROWTYPE;
  v_status text;
  v_grace_until timestamptz;
  v_blocked boolean := false;
  v_reason text := null;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'is_blocked', true,
      'block_reason', 'not_authenticated'
    );
  END IF;

  IF auth.role() <> 'service_role' AND auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'is_blocked', false,
      'block_reason', 'forbidden'
    );
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = p_user_id;

  v_owner_id := public.resolve_billing_owner_user_id(p_user_id);

  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'role', COALESCE(v_role, 'owner'),
      'owner_user_id', null,
      'status', 'missing_owner',
      'is_blocked', true,
      'block_reason', 'missing_billing_owner'
    );
  END IF;

  SELECT *
    INTO v_sub
  FROM public.user_subscriptions
  WHERE user_id = v_owner_id
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'role', COALESCE(v_role, 'owner'),
      'owner_user_id', v_owner_id,
      'status', 'missing',
      'is_blocked', true,
      'block_reason', 'missing_subscription',
      'checkout_path', '/checkout?plano=pro&ciclo=mensal'
    );
  END IF;

  v_status := lower(COALESCE(v_sub.status, 'missing'));
  v_grace_until := public.add_business_days(v_sub.renewal_date, 3);

  IF v_status = 'cancelled' THEN
    v_blocked := true;
    v_reason := 'subscription_cancelled';
  ELSIF v_status = 'pending' THEN
    v_blocked := true;
    v_reason := 'payment_pending';
  ELSIF v_status IN ('active', 'overdue', 'suspended') THEN
    IF v_sub.renewal_date IS NOT NULL AND v_grace_until IS NOT NULL AND now() > v_grace_until THEN
      v_blocked := true;
      v_reason := 'payment_overdue_grace_expired';
    ELSE
      v_blocked := false;
    END IF;
  ELSE
    v_blocked := true;
    v_reason := 'subscription_not_active';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'role', COALESCE(v_role, 'owner'),
    'owner_user_id', v_owner_id,
    'status', v_status,
    'plan_id', v_sub.plan_id,
    'renewal_date', v_sub.renewal_date,
    'grace_until', v_grace_until,
    'is_blocked', v_blocked,
    'block_reason', v_reason,
    'checkout_path', '/checkout?plano=' || COALESCE(NULLIF(v_sub.plan_id, ''), 'pro') || '&ciclo=mensal'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cron_subscription_paywall_suspend_overdue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.user_subscriptions
  SET status = 'suspended',
      updated_at = now()
  WHERE lower(COALESCE(status, '')) = 'overdue'
    AND renewal_date IS NOT NULL
    AND now() > public.add_business_days(renewal_date, 3);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE '[subscription-paywall] % assinatura(s) overdue suspensa(s) apos carencia', v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_business_days(timestamptz, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_billing_owner_user_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_effective_subscription_status(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cron_subscription_paywall_suspend_overdue() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('subscription-paywall-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'subscription-paywall-daily',
  '15 8 * * *',
  $$SELECT public.cron_subscription_paywall_suspend_overdue()$$
);
