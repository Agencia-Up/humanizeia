-- ============================================================================
-- Separa o ciclo de COTA DE IA da data de COBRANCA (renewal_date).
-- APLICADA em prod (seyljsqmhlopkcauhlor) em 17/07/2026; versionada aqui.
--
-- BUG (achado 17/07, caso Avant Motors): ensure_subscription_cycle — o rollover
-- mensal da cota de IA, chamado a CADA lead que o Pedro atende (via
-- consume_user_tokens / bill_pedro_lead) — empurrava user_subscriptions.
-- renewal_date +1 mes quando a data passava, SEM checar pagamento. Como
-- renewal_date e a MESMA coluna que o paywall (get_effective_subscription_status)
-- usa pra bloquear (now > renewal_date + 3 dias uteis), usar o Pedro renovava a
-- mensalidade sozinho e a trava NUNCA disparava. Provado: Avant recebeu 1 lead
-- as 15:43 de 17/07 e a renewal_date pulou de 16/07 -> 16/08 as 15:44, sem pagar.
--
-- FIX DEFINITIVO: coluna propria token_cycle_at pro ciclo de cota. A partir de
-- agora renewal_date so e movida por PAGAMENTO (checkout-asaas-webhook). O uso do
-- Pedro so mexe em token_cycle_at. As duas coisas ficam 100% independentes.
-- Verificado: nenhuma FUNCAO do banco escreve renewal_date depois deste patch.
-- ============================================================================

ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS token_cycle_at timestamptz;

COMMENT ON COLUMN public.user_subscriptions.token_cycle_at IS
  'Ancora do ciclo MENSAL DE COTA DE IA (reset de tokens_used). Movida pelo uso (ensure_subscription_cycle). NAO e a data de cobranca — cobranca e renewal_date, movida so por pagamento.';

-- backfill: o ciclo de cota continua exatamente de onde estava
UPDATE public.user_subscriptions SET token_cycle_at = renewal_date WHERE token_cycle_at IS NULL;

CREATE OR REPLACE FUNCTION public.ensure_subscription_cycle(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sub        user_subscriptions%ROWTYPE;
  v_new_cycle  TIMESTAMPTZ;
  v_grant      INT;
  v_leftover   INT;
  v_cycles     INT := 0;
BEGIN
  SET LOCAL row_security = off;
  IF p_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_args'); END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_sub FROM user_subscriptions WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'no_subscription'); END IF;

  -- Ancora do ciclo de COTA (nao da cobranca). Fallback p/ renewal_date/now se
  -- token_cycle_at nunca setada (belt-and-suspenders; o backfill ja preencheu).
  v_new_cycle := COALESCE(v_sub.token_cycle_at, v_sub.renewal_date, now());

  IF now() < v_new_cycle THEN
    RETURN jsonb_build_object('ok', true, 'renewed', false, 'token_cycle_at', v_new_cycle);
  END IF;

  WHILE v_new_cycle <= now() LOOP
    v_new_cycle := v_new_cycle + interval '1 month';
    v_cycles := v_cycles + 1;
  END LOOP;

  v_grant := COALESCE(v_sub.tokens_included, 0);
  v_leftover := GREATEST(0,
    COALESCE(v_sub.tokens_included, 0) + COALESCE(v_sub.tokens_purchased, 0) - COALESCE(v_sub.tokens_used, 0));

  UPDATE user_subscriptions
  SET tokens_used = 0, tokens_purchased = v_leftover,
      depleted_notified_at = NULL, low_notified_at = NULL,
      token_cycle_at = v_new_cycle,           -- ciclo de COTA (NAO mexe em renewal_date)
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO token_transactions (user_id, type, amount, description, agent, balance_after)
  VALUES (p_user_id, 'renewal', v_grant,
    'Renovacao mensal do plano (+' || v_leftover || ' atendimentos acumulados do ciclo anterior)',
    NULL, v_grant + v_leftover);

  RETURN jsonb_build_object('ok', true, 'renewed', true, 'cycles_advanced', v_cycles,
    'token_cycle_at', v_new_cycle, 'granted', v_grant, 'rolled_over', v_leftover);
END;
$function$;

-- bill_pedro_lead: cycle_tag (marca do ciclo p/ cobrar cada lead 1x por mes) segue
-- o ciclo de COTA (token_cycle_at), nao a cobranca. Preserva o comportamento atual.
CREATE OR REPLACE FUNCTION public.bill_pedro_lead(p_user_id uuid, p_lead_key text, p_raw_tokens integer DEFAULT 0, p_agent text DEFAULT 'pedro'::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_cycle_src   TIMESTAMPTZ;
  v_cycle_tag   DATE;
  v_last        TIMESTAMPTZ;
  v_last_cycle  DATE;
  v_inserted    INT;
  v_reengage    CONSTANT INTERVAL := interval '60 days';
  v_raw         INT := GREATEST(0, COALESCE(p_raw_tokens, 0));
  v_consume     JSONB;
  v_is_new      BOOLEAN;
  v_is_reengage BOOLEAN;
  v_reason      TEXT;
  v_tail        TEXT := right(regexp_replace(p_lead_key, '\D', '', 'g'), 4);
BEGIN
  SET LOCAL row_security = off;
  IF p_user_id IS NULL OR p_lead_key IS NULL OR length(trim(p_lead_key)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_args');
  END IF;

  -- Renova o ciclo de COTA do cliente se venceu (zera tokens_used no aniversario).
  PERFORM ensure_subscription_cycle(p_user_id);

  -- cycle_tag = ciclo de COTA (token_cycle_at), NAO a cobranca. Fallback seguro.
  SELECT COALESCE(token_cycle_at, renewal_date) INTO v_cycle_src
  FROM user_subscriptions WHERE user_id = p_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'no_subscription'); END IF;
  v_cycle_tag := COALESCE(v_cycle_src, now())::date;

  SELECT last_activity_at, cycle_tag INTO v_last, v_last_cycle
  FROM pedro_billed_leads
  WHERE user_id = p_user_id AND lead_key = p_lead_key
  ORDER BY last_activity_at DESC NULLS LAST LIMIT 1 FOR UPDATE;

  v_is_new := (v_last IS NULL);
  v_is_reengage := (v_last IS NOT NULL AND (now() - v_last) >= v_reengage);

  IF v_is_new OR v_is_reengage THEN
    INSERT INTO pedro_billed_leads (user_id, lead_key, cycle_tag, raw_tokens, charges)
    VALUES (p_user_id, p_lead_key, v_cycle_tag, v_raw, 1)
    ON CONFLICT (user_id, lead_key, cycle_tag) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted = 1 THEN
      v_reason := CASE WHEN v_is_new THEN 'new_lead' ELSE 'reengage_60d' END;
      v_consume := consume_user_tokens(p_user_id, 1, p_agent,
        'Pedro SDR - conversa (' || CASE WHEN v_is_new THEN 'lead novo' ELSE 'retorno 60d+' END || ' ...' || v_tail || ')');
      RETURN v_consume || jsonb_build_object('billed', true, 'cycle_tag', v_cycle_tag, 'raw_tokens', v_raw, 'reason', v_reason);
    ELSE
      UPDATE pedro_billed_leads SET raw_tokens = raw_tokens + v_raw, last_activity_at = now()
      WHERE user_id = p_user_id AND lead_key = p_lead_key AND cycle_tag = v_cycle_tag;
      RETURN jsonb_build_object('ok', true, 'billed', false, 'cycle_tag', v_cycle_tag, 'raw_tokens', v_raw, 'reason', 'already_billed_cycle');
    END IF;
  ELSE
    UPDATE pedro_billed_leads SET raw_tokens = raw_tokens + v_raw, last_activity_at = now()
    WHERE user_id = p_user_id AND lead_key = p_lead_key AND cycle_tag = v_last_cycle;
    RETURN jsonb_build_object('ok', true, 'billed', false, 'cycle_tag', v_last_cycle, 'raw_tokens', v_raw, 'reason', 'follow_up');
  END IF;
END;
$function$;
