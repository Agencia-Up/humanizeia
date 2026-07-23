-- ============================================================================
-- Billing: isenção exclusiva da conta master da Logos
--
-- Bruno/Icom (f49fd48a-...) é cliente pagante e NÃO deve ser isento.
-- A conta interna/master é douglasaloan@gmail.com.
--
-- Esta migration corrige o dado criado anteriormente para a conta errada e
-- mantém a decisão no RPC do banco, onde o paywall realmente é autorizado.
-- Aplicar no SQL Editor do Supabase; não usar `supabase db push` neste projeto.
-- ============================================================================

ALTER TABLE public.clientes_receita
  ADD COLUMN IF NOT EXISTS interna boolean NOT NULL DEFAULT false;

ALTER TABLE public.clientes_receita
  ADD COLUMN IF NOT EXISTS administrativa boolean NOT NULL DEFAULT false;

DO $$
DECLARE
  v_douglas_id uuid;
BEGIN
  SELECT id INTO v_douglas_id
  FROM auth.users
  WHERE lower(email) = 'douglasaloan@gmail.com'
  LIMIT 1;

  IF v_douglas_id IS NULL THEN
    RAISE EXCEPTION 'Conta master douglasaloan@gmail.com não encontrada em auth.users';
  END IF;

  -- O cliente Bruno/Icom continua sujeito ao pagamento.
  UPDATE public.clientes_receita
  SET administrativa = false,
      atualizado_em = now()
  WHERE user_id = 'f49fd48a-4386-4009-95f3-26a5100b84f7'::uuid;

  -- A conta da Logos é interna/administrativa: não deve cair no checkout.
  INSERT INTO public.clientes_receita
    (user_id, receita_brl_mensal, ativo, interna, administrativa, dia_vencimento)
  VALUES
    (v_douglas_id, 0, true, true, true, NULL)
  ON CONFLICT (user_id) DO UPDATE SET
    ativo = true,
    interna = true,
    administrativa = true,
    atualizado_em = now();
END $$;

-- O paywall consulta este RPC; a exceção precisa estar nele, não apenas na UI.
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
  v_interna boolean := false;
  v_administrativa boolean := false;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'is_blocked', true, 'block_reason', 'not_authenticated');
  END IF;

  IF auth.role() <> 'service_role'
     AND auth.uid() IS NOT NULL
     AND p_user_id <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'is_blocked', false, 'block_reason', 'forbidden');
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = p_user_id;

  v_owner_id := public.resolve_billing_owner_user_id(p_user_id);

  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'role', coalesce(v_role, 'owner'),
      'owner_user_id', null,
      'status', 'missing_owner',
      'is_blocked', true,
      'block_reason', 'missing_billing_owner'
    );
  END IF;

  SELECT coalesce(cr.interna, false), coalesce(cr.administrativa, false)
    INTO v_interna, v_administrativa
  FROM public.clientes_receita cr
  WHERE cr.user_id = v_owner_id;

  -- Isenção de cobrança é decidida no owner efetivo, portanto vendedores da
  -- conta master também não são redirecionados para o checkout.
  IF v_interna OR v_administrativa THEN
    RETURN jsonb_build_object(
      'ok', true,
      'role', coalesce(v_role, 'owner'),
      'owner_user_id', v_owner_id,
      'status', CASE WHEN v_administrativa THEN 'administrativa' ELSE 'interna' END,
      'is_blocked', false,
      'billing_exempt', true,
      'block_reason', 'conta_interna'
    );
  END IF;

  SELECT * INTO v_sub
  FROM public.user_subscriptions
  WHERE user_id = v_owner_id
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'role', coalesce(v_role, 'owner'),
      'owner_user_id', v_owner_id,
      'status', 'missing',
      'is_blocked', true,
      'block_reason', 'missing_subscription',
      'checkout_path', '/checkout?plano=pro&ciclo=mensal'
    );
  END IF;

  v_status := lower(coalesce(v_sub.status, 'missing'));
  v_grace_until := public.add_business_days(v_sub.renewal_date, 3);

  IF v_status = 'cancelled' THEN
    v_blocked := true;
    v_reason := 'subscription_cancelled';
  ELSIF v_status = 'pending' THEN
    v_blocked := true;
    v_reason := 'payment_pending';
  ELSIF v_status IN ('active', 'overdue', 'suspended') THEN
    IF v_sub.renewal_date IS NOT NULL
       AND v_grace_until IS NOT NULL
       AND now() > v_grace_until THEN
      v_blocked := true;
      v_reason := 'payment_overdue_grace_expired';
    END IF;
  ELSE
    v_blocked := true;
    v_reason := 'subscription_not_active';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'role', coalesce(v_role, 'owner'),
    'owner_user_id', v_owner_id,
    'status', v_status,
    'plan_id', v_sub.plan_id,
    'renewal_date', v_sub.renewal_date,
    'grace_until', v_grace_until,
    'is_blocked', v_blocked,
    'block_reason', v_reason,
    'checkout_path', '/checkout?plano=' || coalesce(nullif(v_sub.plan_id, ''), 'pro') || '&ciclo=mensal'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_effective_subscription_status(uuid)
  TO authenticated, service_role;

-- Self-check: Douglas is exempt; Bruno remains a paying customer.
DO $$
DECLARE
  v_douglas_id uuid;
BEGIN
  SELECT id INTO v_douglas_id
  FROM auth.users
  WHERE lower(email) = 'douglasaloan@gmail.com'
  LIMIT 1;

  IF NOT EXISTS (
    SELECT 1 FROM public.clientes_receita
    WHERE user_id = v_douglas_id AND interna = true AND administrativa = true
  ) THEN
    RAISE EXCEPTION 'Conta master Douglas não ficou isenta';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.clientes_receita
    WHERE user_id = 'f49fd48a-4386-4009-95f3-26a5100b84f7'::uuid
      AND administrativa = true
  ) THEN
    RAISE EXCEPTION 'Conta pagante do Bruno continua marcada como administrativa';
  END IF;
END $$;
