-- ──────────────────────────────────────────────────────────────
-- consume_user_tokens: desconta tokens do usuário e registra
-- a transação em token_transactions.
-- Chamada pelas edge functions após cada resposta de IA.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.consume_user_tokens(
  p_user_id     UUID,
  p_amount      INT,
  p_agent       TEXT    DEFAULT NULL,
  p_description TEXT    DEFAULT 'Uso de IA'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub          user_subscriptions%ROWTYPE;
  v_total        INT;
  v_balance_after INT;
BEGIN
  -- Sem tokens a descontar, sai imediatamente
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  -- Bloqueia a linha para atualização atômica
  SELECT * INTO v_sub
  FROM user_subscriptions
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- Usuário sem assinatura (não bloqueia o uso, apenas loga)
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_subscription');
  END IF;

  v_total        := COALESCE(v_sub.tokens_included, 0) + COALESCE(v_sub.tokens_purchased, 0);
  v_balance_after := v_total - COALESCE(v_sub.tokens_used, 0) - p_amount;

  -- Incrementa tokens_used
  UPDATE user_subscriptions
  SET tokens_used = tokens_used + p_amount,
      updated_at  = now()
  WHERE user_id = p_user_id;

  -- Registra a transação
  INSERT INTO token_transactions (user_id, type, amount, description, agent, balance_after)
  VALUES (p_user_id, 'consume', -p_amount, p_description, p_agent, GREATEST(0, v_balance_after));

  RETURN jsonb_build_object(
    'ok',            true,
    'consumed',      p_amount,
    'balance_after', GREATEST(0, v_balance_after)
  );
END;
$$;

-- Permite que a service_role (edge functions) execute a função
GRANT EXECUTE ON FUNCTION public.consume_user_tokens TO service_role;
