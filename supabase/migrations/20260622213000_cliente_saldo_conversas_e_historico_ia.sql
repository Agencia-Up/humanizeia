-- ============================================================================
-- Cliente: historico completo de gasto IA + saldo convertido em conversas
-- ----------------------------------------------------------------------------
-- Ajusta a UX pedida pelo dono:
--   1) grafico mostra historico real de gasto IA da propria conta;
--   2) saldo informado da chave OpenAI vira conversas usando R$0,50/conversa;
--   3) valores em USD ficam como referencia, nao como metrica principal.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cliente_meu_custo_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_cambio      numeric;
  v_por_dia     jsonb;
  v_por_modelo  jsonb;
  v_por_agente  jsonb;
  v_totais      jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao autenticado';
  END IF;

  SELECT cambio_usd_brl INTO v_cambio
    FROM public.config_cobranca
   WHERE id = 1;
  v_cambio := COALESCE(v_cambio, 5.40);

  -- Historico completo disponivel no log da conta, nao apenas ciclo atual.
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.dia), '[]'::jsonb)
    INTO v_por_dia
    FROM (
      SELECT
        (l.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
        count(*)::int AS operacoes,
        COALESCE(sum(l.n_subcalls), 0)::int AS chamadas,
        COALESCE(sum(l.input_tokens), 0)::int AS input_tokens,
        COALESCE(sum(l.output_tokens), 0)::int AS output_tokens,
        COALESCE(sum(l.total_tokens), 0)::int AS total_tokens,
        round(COALESCE(sum(l.custo_usd), 0), 8) AS custo_usd,
        round(COALESCE(sum(l.custo_usd), 0) * v_cambio, 4) AS custo_brl
      FROM public.ai_call_log l
      WHERE l.user_id = v_uid
      GROUP BY 1
    ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.custo_brl DESC, t.total_tokens DESC), '[]'::jsonb)
    INTO v_por_modelo
    FROM (
      SELECT
        l.provedor,
        l.modelo,
        count(*)::int AS operacoes,
        COALESCE(sum(l.n_subcalls), 0)::int AS chamadas,
        COALESCE(sum(l.input_tokens), 0)::int AS input_tokens,
        COALESCE(sum(l.output_tokens), 0)::int AS output_tokens,
        COALESCE(sum(l.total_tokens), 0)::int AS total_tokens,
        round(COALESCE(sum(l.custo_usd), 0), 8) AS custo_usd,
        round(COALESCE(sum(l.custo_usd), 0) * v_cambio, 4) AS custo_brl
      FROM public.ai_call_log l
      WHERE l.user_id = v_uid
      GROUP BY l.provedor, l.modelo
      ORDER BY round(COALESCE(sum(l.custo_usd), 0) * v_cambio, 4) DESC,
               COALESCE(sum(l.total_tokens), 0) DESC
      LIMIT 12
    ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.custo_brl DESC, t.total_tokens DESC), '[]'::jsonb)
    INTO v_por_agente
    FROM (
      SELECT
        l.agent_id,
        COALESCE(max(l.agent_name), 'Sem agente') AS agente,
        count(*)::int AS operacoes,
        COALESCE(sum(l.n_subcalls), 0)::int AS chamadas,
        COALESCE(sum(l.total_tokens), 0)::int AS total_tokens,
        round(COALESCE(sum(l.custo_usd), 0), 8) AS custo_usd,
        round(COALESCE(sum(l.custo_usd), 0) * v_cambio, 4) AS custo_brl
      FROM public.ai_call_log l
      WHERE l.user_id = v_uid
      GROUP BY l.agent_id
      ORDER BY round(COALESCE(sum(l.custo_usd), 0) * v_cambio, 4) DESC,
               COALESCE(sum(l.total_tokens), 0) DESC
      LIMIT 12
    ) t;

  SELECT jsonb_build_object(
    'operacoes', COALESCE(count(*), 0),
    'chamadas', COALESCE(sum(n_subcalls), 0),
    'input_tokens', COALESCE(sum(input_tokens), 0),
    'output_tokens', COALESCE(sum(output_tokens), 0),
    'total_tokens', COALESCE(sum(total_tokens), 0),
    'custo_usd', round(COALESCE(sum(custo_usd), 0), 8),
    'custo_brl', round(COALESCE(sum(custo_usd), 0) * v_cambio, 4),
    'custo_medio_chamada_brl',
      CASE WHEN COALESCE(sum(n_subcalls), 0) > 0
           THEN round((COALESCE(sum(custo_usd), 0) * v_cambio) / COALESCE(sum(n_subcalls), 0), 4)
           ELSE 0 END,
    'dia_maior',
      (SELECT e->>'dia' FROM jsonb_array_elements(v_por_dia) e
        ORDER BY (e->>'custo_brl')::numeric DESC, e->>'dia' LIMIT 1),
    'dia_maior_valor',
      COALESCE((SELECT (e->>'custo_brl')::numeric FROM jsonb_array_elements(v_por_dia) e
        ORDER BY (e->>'custo_brl')::numeric DESC, e->>'dia' LIMIT 1), 0)
  ) INTO v_totais
  FROM public.ai_call_log
  WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'periodo', 'historico_completo',
    'cambio', v_cambio,
    'fonte', 'ai_call_log',
    'por_dia', v_por_dia,
    'por_modelo', v_por_modelo,
    'por_agente', v_por_agente,
    'totais', COALESCE(v_totais, '{}'::jsonb),
    'gerado_em', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cliente_meu_custo_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_meu_custo_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.cliente_saldo_ia()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_cambio numeric;
  v_bal    numeric;
  v_set_at timestamptz;
  v_gasto_usd numeric := 0;
  v_input_tokens integer := 0;
  v_output_tokens integer := 0;
  v_total_tokens integer := 0;
  v_chamadas integer := 0;
  v_saldo_brl numeric;
  v_gasto_brl numeric;
  v_restante_brl numeric;
  v_cpc numeric := 0.50;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao autenticado';
  END IF;

  SELECT cambio_usd_brl INTO v_cambio
    FROM public.config_cobranca
   WHERE id = 1;
  v_cambio := COALESCE(v_cambio, 5.40);

  SELECT openai_balance_usd, openai_balance_set_at
    INTO v_bal, v_set_at
    FROM public.profiles
   WHERE id = v_uid;

  IF v_bal IS NULL THEN
    RETURN jsonb_build_object(
      'tem_saldo', false,
      'cambio', v_cambio,
      'custo_conversa', v_cpc,
      'fonte', 'ai_call_log',
      'observacao', 'A OpenAI nao expoe saldo via API; o valor precisa ser informado pelo cliente.'
    );
  END IF;

  SELECT
    round(COALESCE(sum(l.custo_usd), 0), 8),
    COALESCE(sum(l.input_tokens), 0)::int,
    COALESCE(sum(l.output_tokens), 0)::int,
    COALESCE(sum(l.total_tokens), 0)::int,
    COALESCE(sum(l.n_subcalls), 0)::int
  INTO v_gasto_usd, v_input_tokens, v_output_tokens, v_total_tokens, v_chamadas
  FROM public.ai_call_log l
  WHERE l.user_id = v_uid
    AND lower(l.provedor) = 'openai'
    AND (v_set_at IS NULL OR l.created_at >= v_set_at);

  v_saldo_brl := v_bal * v_cambio;
  v_gasto_brl := v_gasto_usd * v_cambio;
  v_restante_brl := GREATEST(v_saldo_brl - v_gasto_brl, 0);

  RETURN jsonb_build_object(
    'tem_saldo', true,
    'fonte', 'ai_call_log',
    'balance_usd', round(v_bal, 2),
    'set_at', v_set_at,
    'cambio', v_cambio,
    'custo_conversa', v_cpc,
    'saldo_brl', round(v_saldo_brl, 2),
    'gasto_usd', round(v_gasto_usd, 8),
    'gasto_brl', round(v_gasto_brl, 4),
    'restante_brl', round(v_restante_brl, 4),
    'conversas_total', floor(v_saldo_brl / v_cpc),
    'conversas_usadas', floor(v_gasto_brl / v_cpc),
    'conversas_restantes', floor(v_restante_brl / v_cpc),
    'input_tokens', v_input_tokens,
    'output_tokens', v_output_tokens,
    'total_tokens', v_total_tokens,
    'chamadas', v_chamadas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cliente_saldo_ia() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_saldo_ia() TO authenticated;
