-- ============================================================================
-- Renovacao mensal do ciclo de atendimentos COM ACUMULO (rollover)
-- ----------------------------------------------------------------------------
-- REGRA DO CLIENTE (Wander): o ciclo renova no ANIVERSARIO de cada cliente
-- (data de aquisicao) e os atendimentos NAO USADOS se ACUMULAM para os meses
-- seguintes (o saldo que sobra NAO expira; vira credito do proximo ciclo).
--
-- O QUE MUDA vs a versao anterior (ensure_subscription_cycle de
-- 20260601120000_subscription_cycle_renewal.sql, que ZERAVA o saldo nao usado:
-- tokens_used=0 E tokens_purchased=0): agora, na virada do ciclo, o saldo que
-- sobrou (tokens_included + tokens_purchased - tokens_used) ROLA para
-- tokens_purchased do novo ciclo. O novo grant do plano (tokens_included) e
-- mantido. Assim o disponivel do novo ciclo = grant do plano + saldo acumulado.
--
-- Tambem (re)define consume_user_tokens e bill_pedro_lead para chamarem
-- ensure_subscription_cycle no topo (mesma cadeia da versao anterior), de modo
-- que o ciclo se renova SOZINHO no instante em que o Pedro atende. Esta
-- migration e a fonte UNICA e autoritativa das 3 funcoes (supera as versoes de
-- 20260530120000, 20260530140000 e 20260601120000).
--
-- Idempotente: CREATE OR REPLACE; pode rodar varias vezes sem efeito colateral.
-- Blast radius minimo: so toca a conta que esta sendo atendida naquele instante.
-- ============================================================================

-- (a) Renovacao idempotente do ciclo, agora COM ACUMULO -----------------------
CREATE OR REPLACE FUNCTION public.ensure_subscription_cycle(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub          user_subscriptions%ROWTYPE;
  v_new_renewal  TIMESTAMPTZ;
  v_grant        INT;
  v_leftover     INT;
  v_cycles       INT := 0;
BEGIN
  -- Bypass RLS (em contexto service_role o auth.uid() e NULL).
  SET LOCAL row_security = off;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_args');
  END IF;

  -- Seguranca: um usuario autenticado so pode renovar a PROPRIA assinatura.
  -- service_role (auth.uid() NULL) pode renovar qualquer um (cron/edge).
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_sub
  FROM user_subscriptions
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_subscription');
  END IF;

  -- Ainda dentro do ciclo? Caso mais comum: nada a fazer.
  IF v_sub.renewal_date IS NOT NULL AND now() < v_sub.renewal_date THEN
    RETURN jsonb_build_object('ok', true, 'renewed', false, 'renewal_date', v_sub.renewal_date);
  END IF;

  -- Ciclo venceu: avanca a renewal_date em passos de 1 mes (aniversario do
  -- cliente, mantendo o mesmo dia) ate cair no futuro. Se ficou varios meses
  -- sem renovar, colapsa tudo em UM unico reset que cai na proxima data valida.
  v_new_renewal := COALESCE(v_sub.renewal_date, now());
  WHILE v_new_renewal <= now() LOOP
    v_new_renewal := v_new_renewal + interval '1 month';
    v_cycles := v_cycles + 1;
  END LOOP;

  v_grant := COALESCE(v_sub.tokens_included, 0);

  -- ACUMULO: o saldo que SOBROU do ciclo que esta encerrando rola para o
  -- proximo ciclo (vai para tokens_purchased). Nunca negativo.
  v_leftover := GREATEST(0,
    COALESCE(v_sub.tokens_included, 0)
    + COALESCE(v_sub.tokens_purchased, 0)
    - COALESCE(v_sub.tokens_used, 0)
  );

  UPDATE user_subscriptions
  SET tokens_used          = 0,
      tokens_purchased     = v_leftover,   -- saldo nao usado ACUMULA pro novo ciclo
      depleted_notified_at = NULL,         -- volta a poder avisar no novo ciclo
      low_notified_at      = NULL,
      renewal_date         = v_new_renewal,
      updated_at           = now()
  WHERE user_id = p_user_id;

  INSERT INTO token_transactions (user_id, type, amount, description, agent, balance_after)
  VALUES (
    p_user_id,
    'renewal',
    v_grant,
    'Renovacao mensal do plano (+' || v_leftover || ' atendimentos acumulados do ciclo anterior)',
    NULL,
    v_grant + v_leftover
  );

  RETURN jsonb_build_object(
    'ok',              true,
    'renewed',         true,
    'cycles_advanced', v_cycles,
    'renewal_date',    v_new_renewal,
    'granted',         v_grant,
    'rolled_over',     v_leftover
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_subscription_cycle TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_subscription_cycle TO authenticated;

-- (b1) consume_user_tokens — renova o ciclo ANTES de medir --------------------
--      (copia fiel de 20260601120000 + 1 chamada de ensure_subscription_cycle)
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
  SET LOCAL row_security = off;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  -- Garante o ciclo vigente (renova sozinho, com acumulo, se a data ja venceu).
  PERFORM ensure_subscription_cycle(p_user_id);

  SELECT * INTO v_sub
  FROM user_subscriptions
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_subscription');
  END IF;

  v_total         := COALESCE(v_sub.tokens_included, 0) + COALESCE(v_sub.tokens_purchased, 0);
  v_balance_after := v_total - COALESCE(v_sub.tokens_used, 0) - p_amount;
  -- Limite de "acabando" = 10% do total (minimo 1 pra planos pequenos).
  v_low_threshold := GREATEST(1, (v_total * 0.10)::INT);

  v_new_depleted_at := v_sub.depleted_notified_at;
  v_new_low_at      := v_sub.low_notified_at;

  IF v_balance_after <= 0 THEN
    IF v_sub.depleted_notified_at IS NULL THEN
      v_just_depleted   := true;
      v_new_depleted_at := now();
    END IF;
  ELSIF v_balance_after <= v_low_threshold THEN
    IF v_sub.low_notified_at IS NULL THEN
      v_just_low   := true;
      v_new_low_at := now();
    END IF;
  ELSE
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

-- (b2) bill_pedro_lead — renova o ciclo ANTES de calcular o cycle_tag ---------
--      (copia fiel de 20260601120000 + 1 chamada de ensure_subscription_cycle)
CREATE OR REPLACE FUNCTION public.bill_pedro_lead(
  p_user_id    UUID,
  p_lead_key   TEXT,
  p_raw_tokens INT  DEFAULT 0,
  p_agent      TEXT DEFAULT 'pedro'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_renewal    TIMESTAMPTZ;
  v_cycle_tag  DATE;
  v_inserted   INT;
  v_raw        INT := GREATEST(0, COALESCE(p_raw_tokens, 0));
  v_consume    JSONB;
BEGIN
  SET LOCAL row_security = off;

  IF p_user_id IS NULL OR p_lead_key IS NULL OR length(trim(p_lead_key)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_args');
  END IF;

  -- Renova o ciclo do cliente se ja venceu (com acumulo), ANTES de ler a
  -- renewal_date (assim o cycle_tag ja reflete o ciclo novo e os leads voltam
  -- a contar a partir da virada).
  PERFORM ensure_subscription_cycle(p_user_id);

  -- Ciclo atual da assinatura. Sem assinatura -> nao cobra (nada a fazer).
  SELECT renewal_date INTO v_renewal
  FROM user_subscriptions
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_subscription');
  END IF;

  v_cycle_tag := COALESCE(v_renewal, now())::date;

  INSERT INTO pedro_billed_leads (user_id, lead_key, cycle_tag, raw_tokens, charges)
  VALUES (p_user_id, p_lead_key, v_cycle_tag, v_raw, 1)
  ON CONFLICT (user_id, lead_key, cycle_tag) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 1 THEN
    -- 1a vez do lead neste ciclo -> cobra 1 atendimento (com aviso embutido).
    v_consume := consume_user_tokens(
      p_user_id,
      1,
      p_agent,
      'Pedro SDR — atendimento (lead …' || right(regexp_replace(p_lead_key, '\D', '', 'g'), 4) || ')'
    );
    RETURN v_consume || jsonb_build_object('billed', true, 'cycle_tag', v_cycle_tag, 'raw_tokens', v_raw);
  ELSE
    -- Lead ja cobrado neste ciclo -> nao desconta de novo, so acumula custo real.
    UPDATE pedro_billed_leads
       SET raw_tokens       = raw_tokens + v_raw,
           last_activity_at = now()
     WHERE user_id = p_user_id AND lead_key = p_lead_key AND cycle_tag = v_cycle_tag;
    RETURN jsonb_build_object('ok', true, 'billed', false, 'cycle_tag', v_cycle_tag, 'raw_tokens', v_raw);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bill_pedro_lead TO service_role;
