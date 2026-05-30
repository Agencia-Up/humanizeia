-- ============================================================================
-- Token tracking REAL + aviso de "acabando / acabou"
-- ----------------------------------------------------------------------------
-- Objetivo (pedido do cliente):
--   1) O contador de tokens precisa ser REAL — descontar de verdade o que os
--      agentes (principalmente o Pedro) consomem a cada resposta.
--   2) Quando os tokens acabarem (ou estiverem acabando), disparar UM aviso
--      por ciclo — sem spam — para o painel e para o WhatsApp do dono.
--
-- Esta migration cuida da BASE de dados:
--   (a) duas colunas de controle em user_subscriptions para marcar que o aviso
--       já foi enviado neste ciclo (evita repetir a cada mensagem do Pedro);
--   (b) reescreve consume_user_tokens para detectar a "virada" de estado
--       (saudável → acabando → acabou) e devolver flags just_low / just_depleted
--       que as edge functions usam pra decidir se mandam o aviso AGORA.
--
-- Comportamento de reset: assim que o saldo volta a ficar > 10% (recarga ou
-- renovação do plano), as duas flags são zeradas — então o próximo ciclo
-- avisa de novo normalmente.
-- ============================================================================

-- (a) Colunas de controle de notificação (idempotente)
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS depleted_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS low_notified_at      timestamptz;

-- (b) Reescreve consume_user_tokens com detecção de virada de estado.
--     Base: 20260428000000_fix_consume_tokens_rls.sql (mantém SET LOCAL
--     row_security = off para funcionar em contexto service_role).
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
  v_sub             user_subscriptions%ROWTYPE;
  v_total           INT;
  v_balance_after   INT;
  v_low_threshold   INT;
  v_just_depleted   BOOLEAN := false;
  v_just_low        BOOLEAN := false;
  v_new_depleted_at TIMESTAMPTZ;
  v_new_low_at      TIMESTAMPTZ;
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
  -- Limite de "acabando" = 10% do total (mínimo 1 pra planos pequenos).
  v_low_threshold := GREATEST(1, (v_total * 0.10)::INT);

  -- Parte do estado atual das flags; só muda se houver virada de estado.
  v_new_depleted_at := v_sub.depleted_notified_at;
  v_new_low_at      := v_sub.low_notified_at;

  IF v_balance_after <= 0 THEN
    -- ACABOU: avisa só se ainda não avisou neste ciclo.
    IF v_sub.depleted_notified_at IS NULL THEN
      v_just_depleted   := true;
      v_new_depleted_at := now();
    END IF;
  ELSIF v_balance_after <= v_low_threshold THEN
    -- ACABANDO (<= 10%): avisa só se ainda não avisou neste ciclo.
    IF v_sub.low_notified_at IS NULL THEN
      v_just_low   := true;
      v_new_low_at := now();
    END IF;
  ELSE
    -- SAUDÁVEL (> 10%): zera as flags pra permitir novo aviso após recarga/renovação.
    v_new_depleted_at := NULL;
    v_new_low_at      := NULL;
  END IF;

  UPDATE user_subscriptions
  SET tokens_used          = tokens_used + p_amount,
      depleted_notified_at = v_new_depleted_at,
      low_notified_at      = v_new_low_at,
      updated_at           = now()
  WHERE user_id = p_user_id;

  INSERT INTO token_transactions (user_id, type, amount, description, agent, balance_after)
  VALUES (p_user_id, 'consume', -p_amount, p_description, p_agent, GREATEST(0, v_balance_after));

  RETURN jsonb_build_object(
    'ok',            true,
    'consumed',      p_amount,
    'balance_after', GREATEST(0, v_balance_after),
    'total',         v_total,
    'just_depleted', v_just_depleted,
    'just_low',      v_just_low
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_user_tokens TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_user_tokens TO authenticated;
