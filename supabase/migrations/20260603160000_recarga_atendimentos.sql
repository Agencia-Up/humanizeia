-- ============================================================================
-- RECARGA DE ATENDIMENTOS (credito avulso) — cartao salvo + credito idempotente
-- ----------------------------------------------------------------------------
-- Contexto: o plano e medido em ATENDIMENTOS (1 = 1 lead/ciclo). Quando os
-- atendimentos do plano acabam, o cliente pode comprar pacotes avulsos pelo
-- painel (Meu Plano -> Recarregar). O pagamento vai pra Asaas (mesma logica do
-- checkout de assinatura). Se o cliente ja tiver cartao salvo, a recarga e
-- 1-clique (usa o token do cartao guardado aqui).
--
-- Este arquivo:
--   1) Guarda o cartao tokenizado da Asaas no profile do DONO da conta.
--   2) Cria a RPC credit_atendimentos_recarga(): credita atendimentos avulsos
--      em user_subscriptions.tokens_purchased e registra a transacao, de forma
--      IDEMPOTENTE (nao credita 2x o mesmo pagamento — webhook da Asaas reenvia).
-- Reversivel: dropar a funcao + colunas.
-- ============================================================================

-- 1) Cartao salvo (one-click) — fica junto do asaas_customer_id, no dono.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS asaas_card_token text,
  ADD COLUMN IF NOT EXISTS asaas_card_last4 text,
  ADD COLUMN IF NOT EXISTS asaas_card_brand text;

-- 2) Credita atendimentos avulsos (recarga), idempotente por payment_id.
--    Retorna jsonb { ok, balance_after, already_processed? }.
CREATE OR REPLACE FUNCTION public.credit_atendimentos_recarga(
  p_user_id      uuid,
  p_atendimentos integer,
  p_payment_id   text,
  p_product_id   text,
  p_price_paid   numeric,
  p_description  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing uuid;
  v_balance  integer;
  v_desc     text;
BEGIN
  IF p_atendimentos IS NULL OR p_atendimentos <= 0 THEN
    RAISE EXCEPTION 'p_atendimentos invalido: %', p_atendimentos;
  END IF;

  -- Idempotencia: se esse pagamento ja foi creditado, nao repete.
  IF p_payment_id IS NOT NULL THEN
    SELECT id INTO v_existing
      FROM public.token_transactions
     WHERE payment_id = p_payment_id
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      SELECT COALESCE(tokens_included,0) + COALESCE(tokens_purchased,0) - COALESCE(tokens_used,0)
        INTO v_balance
        FROM public.user_subscriptions
       WHERE user_id = p_user_id;
      RETURN jsonb_build_object('ok', true, 'already_processed', true, 'balance_after', v_balance);
    END IF;
  END IF;

  -- Credita os atendimentos avulsos na assinatura do dono.
  UPDATE public.user_subscriptions
     SET tokens_purchased = COALESCE(tokens_purchased,0) + p_atendimentos,
         updated_at = now()
   WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assinatura nao encontrada para user %', p_user_id;
  END IF;

  -- Saldo apos o credito (incluido + avulso - usado).
  SELECT COALESCE(tokens_included,0) + COALESCE(tokens_purchased,0) - COALESCE(tokens_used,0)
    INTO v_balance
    FROM public.user_subscriptions
   WHERE user_id = p_user_id;

  v_desc := COALESCE(p_description, 'Recarga avulsa — ' || p_atendimentos || ' atendimentos');

  INSERT INTO public.token_transactions
    (user_id, type, amount, description, agent, balance_after, payment_id, tokens_added, product_id, price_paid)
  VALUES
    (p_user_id, 'purchase', p_atendimentos, v_desc, NULL, v_balance, p_payment_id, p_atendimentos, p_product_id, p_price_paid);

  RETURN jsonb_build_object('ok', true, 'balance_after', v_balance);
END;
$function$;

COMMENT ON FUNCTION public.credit_atendimentos_recarga(uuid, integer, text, text, numeric, text)
  IS 'Credita atendimentos avulsos (recarga) de forma idempotente por payment_id. Usado pelo webhook/edge da Asaas.';
