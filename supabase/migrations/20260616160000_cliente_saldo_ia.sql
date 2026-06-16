-- ============================================================================
-- Saldo da chave OpenAI do cliente (BYOK) -> conversas restantes
-- ----------------------------------------------------------------------------
-- A OpenAI NAO expoe o saldo da conta via API. Entao o cliente INFORMA o saldo
-- (em USD) que colocou na OpenAI; o sistema converte pra BRL (config_cobranca.
-- cambio_usd_brl) e calcula quantas conversas ele tem (media ~R$0,50/conversa),
-- descontando o gasto REAL de IA desde que informou (vw_custo_pedro_lead).
-- So leitura/derivacao do custo ja existente: nao toca no Pedro, nao debita.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS openai_balance_usd    numeric,
  ADD COLUMN IF NOT EXISTS openai_balance_set_at timestamptz;

-- Cliente salva o saldo que informou (escopo auth.uid()).
CREATE OR REPLACE FUNCTION public.set_my_openai_balance(p_usd numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'nao autenticado'; END IF;
  UPDATE public.profiles
     SET openai_balance_usd    = GREATEST(COALESCE(p_usd, 0), 0),
         openai_balance_set_at = now()
   WHERE id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_openai_balance(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_openai_balance(numeric) TO authenticated;

-- Saldo + conversas restantes do PROPRIO cliente. SECURITY DEFINER, escopo
-- auth.uid(); o custo real fica no servidor (so devolve os numeros do cliente).
CREATE OR REPLACE FUNCTION public.cliente_saldo_ia()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_cambio numeric;
  v_markup numeric;
  v_bal    numeric;
  v_set_at timestamptz;
  v_gasto  numeric := 0;
  v_saldo  numeric;
  v_cpc    numeric := 0.50;            -- media por conversa (R$), informada pelo dono
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao autenticado'; END IF;

  SELECT cambio_usd_brl, COALESCE(markup, 1)
    INTO v_cambio, v_markup
    FROM public.config_cobranca WHERE id = 1;

  SELECT openai_balance_usd, openai_balance_set_at
    INTO v_bal, v_set_at
    FROM public.profiles WHERE id = v_uid;

  IF v_bal IS NULL THEN
    RETURN jsonb_build_object('tem_saldo', false, 'cambio', v_cambio, 'custo_conversa', v_cpc);
  END IF;

  -- gasto REAL (BRL) desde que informou o saldo
  SELECT COALESCE(sum(l.custo_brl) * v_markup, 0) INTO v_gasto
    FROM public.vw_custo_pedro_lead l
   WHERE l.cliente_id = v_uid
     AND l.first_billed_at IS NOT NULL
     AND (v_set_at IS NULL OR l.first_billed_at >= v_set_at);

  v_saldo := v_bal * v_cambio;

  RETURN jsonb_build_object(
    'tem_saldo',           true,
    'balance_usd',         v_bal,
    'set_at',              v_set_at,
    'cambio',              v_cambio,
    'custo_conversa',      v_cpc,
    'saldo_brl',           round(v_saldo, 2),
    'gasto_brl',           round(v_gasto, 2),
    'restante_brl',        round(GREATEST(v_saldo - v_gasto, 0), 2),
    'conversas_total',     floor(v_saldo / v_cpc),
    'conversas_restantes', floor(GREATEST(v_saldo - v_gasto, 0) / v_cpc),
    'conversas_usadas',    floor(v_gasto / v_cpc)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.cliente_saldo_ia() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_saldo_ia() TO authenticated;
