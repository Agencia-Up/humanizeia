-- fix: cliente_saldo_ia conta "conversas usadas" por NÚMERO de conversas (R$0,50/conversa)
--
-- Bug: a função calculava "conversas usadas" a partir do custo em TOKENS
-- (vw_custo_pedro_lead -> pedro_billed_leads.raw_tokens). Mas raw_tokens está 0 (o
-- motor do Pedro não grava os tokens reais), então o consumo zerava na tela "Meu
-- Plano" (0/205, "Já consumiu R$0,00"), mesmo com conversas acontecendo.
--
-- Correção: o gasto BRL = nº de conversas COBRADAS desde o saldo × R$0,50/conversa.
-- É o modelo "R$0,50 por conversa" que a própria tela descreve, robusto e
-- independente do raw_tokens. (O custo REAL em tokens segue sendo um tema à parte,
-- pra margem — depende de instrumentar o motor pra gravar raw_tokens.)
CREATE OR REPLACE FUNCTION public.cliente_saldo_ia()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_cambio numeric;
  v_bal    numeric;
  v_set_at timestamptz;
  v_gasto  numeric := 0;
  v_saldo  numeric;
  v_cpc    numeric := 0.50;   -- preço por conversa (R$), modelo simples da tela
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao autenticado'; END IF;

  SELECT cambio_usd_brl INTO v_cambio FROM public.config_cobranca WHERE id = 1;

  SELECT openai_balance_usd, openai_balance_set_at
    INTO v_bal, v_set_at
    FROM public.profiles WHERE id = v_uid;

  IF v_bal IS NULL THEN
    RETURN jsonb_build_object('tem_saldo', false, 'cambio', v_cambio, 'custo_conversa', v_cpc);
  END IF;

  -- gasto (BRL) = nº de conversas COBRADAS desde o saldo × R$0,50/conversa.
  SELECT COALESCE(sum(pbl.charges), 0) * v_cpc INTO v_gasto
    FROM public.pedro_billed_leads pbl
   WHERE pbl.user_id = v_uid
     AND pbl.first_billed_at IS NOT NULL
     AND (v_set_at IS NULL OR pbl.first_billed_at >= v_set_at);

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
$function$;
