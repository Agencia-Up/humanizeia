-- ============================================================================
-- Conserto do contador de ATENDIMENTOS (Meu Plano): tokens crus do Pedro
-- ----------------------------------------------------------------------------
-- PROBLEMA (Wander, 03/06/2026 — producao):
--   O painel "Meu Plano" mostra "Atendimentos utilizados" gigante (ex.: 76.013
--   / 150) enquanto o cliente teve so 3 conversas reais. Diagnostico no banco:
--     - bill_pedro_lead cobra CERTO: 1 por conversa (token_transactions com
--       descricao "Pedro SDR — conversa (...)", amount = -1). Sao 3.
--     - MAS o Pedro IMPLANTADO em prod (versao antiga, restaurada no incidente
--       de pedro-webhook-v2 e fora do nosso controle nesta frente) AINDA chama
--       consume_user_tokens com TOKENS CRUS de LLM a cada turno (descricao
--       "Pedro SDR v2 — resposta no WhatsApp", amount de -7.000 a -18.000).
--       Esse caminho cru NAO existe mais no codigo-fonte atual do orquestrador
--       (que so usa bill_pedro_lead), mas continua vivo no bundle implantado.
--   Resultado: tokens_used = (conversas reais) + (lixo de tokens crus) e cresce
--   sem parar. A coluna tokens_* hoje mede ATENDIMENTOS (1 = 1 conversa/ciclo).
--
-- POR QUE A CORRECAO E NO BANCO (e NAO no Pedro):
--   Outra pessoa e dona do agente Pedro; nao podemos tocar/realocar o deploy
--   dele aqui. consume_user_tokens e a funcao de cobranca COMPARTILHADA (fora do
--   Pedro), entao isolamos o estrago nela: passa a IGNORAR o consumo cru do
--   agente 'pedro'. O caminho correto (bill_pedro_lead, amount = 1) continua
--   passando normalmente. Quando o Pedro atual (sem o caminho cru) for
--   reimplantado, nada quebra — esta funcao so deixa de receber esses raws.
--
-- O QUE ESTA MIGRATION FAZ (idempotente; NAO toca no Pedro):
--   (a) Reescreve consume_user_tokens: GUARD no topo — se p_agent = 'pedro' e
--       p_amount > 1, e o caminho cru DEPRECADO: NAO debita a cota, NAO insere
--       transacao, NAO dispara alerta de "acabando/acabou". Devolve ok=true com
--       o saldo atual (real, de atendimentos) pra logica de aviso do Pedro
--       implantado seguir funcionando sem erro. amount = 1 (conversa) passa
--       direto, com TODO o comportamento atual preservado (ciclo, alertas).
--   (b) Recompute SEGURO e idempotente do contador: baixa tokens_used para a
--       contagem REAL de conversas do ciclo (SUM(charges) em pedro_billed_leads)
--       SOMENTE em contas (1) comprovadamente poluidas por esse bug (tem
--       token_transactions de consume do agente 'pedro' com amount < -1) E
--       (2) onde tokens_used hoje esta ACIMA da contagem real. So abaixa, nunca
--       sobe -> nunca cobra a mais do cliente. Contas saudaveis nao sao tocadas.
--
-- NAO altera bill_pedro_lead, ensure_subscription_cycle nem nada do Pedro.
-- ============================================================================

-- (a) consume_user_tokens — copia fiel de 20260602120000 + GUARD do raw 'pedro'
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

  -- GUARD (03/06/2026): o Pedro IMPLANTADO (versao antiga, fora do nosso
  -- controle) ainda chama esta RPC com TOKENS CRUS por turno (milhares). No
  -- modelo de ATENDIMENTOS o Pedro cobra EXATAMENTE 1 por conversa via
  -- bill_pedro_lead. Logo, qualquer consume do agente 'pedro' com amount > 1 e
  -- o caminho cru DEPRECADO: NAO debita a cota e NAO registra transacao. So
  -- devolve o saldo atual (sem alerta de transicao), pra logica do Pedro nao
  -- quebrar. bill_pedro_lead chama com amount = 1 -> cai fora deste guard.
  IF p_agent = 'pedro' AND p_amount > 1 THEN
    PERFORM ensure_subscription_cycle(p_user_id);
    SELECT * INTO v_sub FROM user_subscriptions WHERE user_id = p_user_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'pedro_raw_ignored');
    END IF;
    v_total         := COALESCE(v_sub.tokens_included, 0) + COALESCE(v_sub.tokens_purchased, 0);
    v_balance_after := GREATEST(0, v_total - COALESCE(v_sub.tokens_used, 0));
    RETURN jsonb_build_object(
      'ok',            true,
      'skipped',       true,
      'reason',        'pedro_raw_ignored',
      'consumed',      0,
      'balance_after', v_balance_after,
      'total',         v_total,
      'just_depleted', false,
      'just_low',      false
    );
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

-- (b) Recompute SEGURO do contador para as contas poluidas por esse bug --------
--     So abaixa tokens_used ate a contagem real de conversas do ciclo. Nunca
--     sobe. So toca contas com lixo de raw 'pedro' E com tokens_used inflado.
UPDATE public.user_subscriptions us
SET tokens_used = COALESCE((
      SELECT SUM(p.charges)
      FROM public.pedro_billed_leads p
      WHERE p.user_id = us.user_id
        AND p.cycle_tag = us.renewal_date::date
    ), 0),
    updated_at = now()
WHERE EXISTS (
        SELECT 1 FROM public.token_transactions t
        WHERE t.user_id = us.user_id
          AND t.type   = 'consume'
          AND t.agent  = 'pedro'
          AND t.amount < -1
      )
  AND us.tokens_used > COALESCE((
        SELECT SUM(p.charges)
        FROM public.pedro_billed_leads p
        WHERE p.user_id = us.user_id
          AND p.cycle_tag = us.renewal_date::date
      ), 0);
