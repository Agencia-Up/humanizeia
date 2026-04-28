-- Re-cria consume_user_tokens com SET LOCAL row_security = off para garantir
-- que a função consiga ler/escrever user_subscriptions mesmo quando
-- auth.uid() é NULL (contexto service_role sem token JWT de usuário).
-- Sem isso a função retorna 'no_subscription' silenciosamente e tokens
-- nunca são descontados.

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
  -- Bypass RLS dentro da função: em contextos service_role o auth.uid() é
  -- NULL, então as policies "auth.uid() = user_id" bloqueiam silenciosamente.
  SET LOCAL row_security = off;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  SELECT * INTO v_sub
  FROM user_subscriptions
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_subscription');
  END IF;

  v_total         := COALESCE(v_sub.tokens_included, 0) + COALESCE(v_sub.tokens_purchased, 0);
  v_balance_after := v_total - COALESCE(v_sub.tokens_used, 0) - p_amount;

  UPDATE user_subscriptions
  SET tokens_used = tokens_used + p_amount,
      updated_at  = now()
  WHERE user_id = p_user_id;

  INSERT INTO token_transactions (user_id, type, amount, description, agent, balance_after)
  VALUES (p_user_id, 'consume', -p_amount, p_description, p_agent, GREATEST(0, v_balance_after));

  RETURN jsonb_build_object(
    'ok',            true,
    'consumed',      p_amount,
    'balance_after', GREATEST(0, v_balance_after)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_user_tokens TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_user_tokens TO authenticated;
