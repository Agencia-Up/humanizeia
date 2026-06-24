-- ============================================================================
-- AUDITORIA — overview v3: serie diaria POR AGENTE (pro grafico filtravel).
-- Acrescenta `serie_dia_agente` (dia x agente: tokens + custo_brl) sem mexer em
-- nada que ja existia. O frontend usa pra filtrar o grafico "Tokens por dia" por
-- agente (dropdown). `serie_dia` (global) segue pro "Todos os agentes".
-- CREATE OR REPLACE — idempotente.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_ai_audit_overview(p_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days   int := greatest(1, least(coalesce(p_days, 30), 365));
  v_since  timestamptz := now() - (v_days * interval '1 day');
  v_cambio numeric;
  v_result jsonb;
BEGIN
  IF NOT public._is_caller_superadmin() THEN
    RAISE EXCEPTION 'forbidden: only platform admins';
  END IF;

  SELECT cambio_usd_brl INTO v_cambio FROM public.config_cobranca WHERE id = 1;
  v_cambio := coalesce(v_cambio, 5.40);

  SELECT jsonb_build_object(
    'periodo_dias', v_days,
    'config', jsonb_build_object(
      'cambio_usd_brl', v_cambio,
      'gpt4o_usd_in',  (SELECT usd_por_1m_input  FROM public.preco_modelo WHERE provedor='openai' AND modelo='gpt-4o'),
      'gpt4o_usd_out', (SELECT usd_por_1m_output FROM public.preco_modelo WHERE provedor='openai' AND modelo='gpt-4o')
    ),
    'totais', (
      SELECT jsonb_build_object(
        'operacoes',     coalesce(count(*), 0),
        'turnos',        coalesce(count(*), 0),
        'chamadas',      coalesce(sum(n_subcalls), 0),
        'tokens',        coalesce(sum(total_tokens), 0),
        'input_tokens',  coalesce(sum(input_tokens), 0),
        'output_tokens', coalesce(sum(output_tokens), 0),
        'custo_usd',     coalesce(sum(custo_usd), 0),
        'custo_brl',     round(coalesce(sum(custo_usd), 0) * v_cambio, 4),
        'n_clientes',    count(DISTINCT user_id),
        'n_agentes',     count(DISTINCT agent_id)
      )
      FROM public.ai_call_log WHERE created_at >= v_since
    ),
    'por_agente', coalesce((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.tokens DESC) FROM (
        SELECT l.agent_id,
               coalesce(max(l.agent_name), '—')                     AS agente,
               coalesce(max(p.company_name), max(p.full_name), '—') AS cliente_nome,
               count(*)                              AS turnos,
               coalesce(sum(l.n_subcalls), 0)        AS chamadas,
               round(avg(l.n_subcalls)::numeric, 1)  AS chamadas_por_turno,
               sum(l.total_tokens)                   AS tokens,
               sum(l.input_tokens)                   AS input_tokens,
               sum(l.output_tokens)                  AS output_tokens,
               round(sum(l.custo_usd) * v_cambio, 4) AS custo_brl
        FROM public.ai_call_log l
        LEFT JOIN public.profiles p ON p.id = l.user_id
        WHERE l.created_at >= v_since
        GROUP BY l.agent_id
        ORDER BY tokens DESC
        LIMIT 50
      ) t
    ), '[]'::jsonb),
    'por_cliente', coalesce((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.tokens DESC) FROM (
        SELECT l.user_id,
               coalesce(p.company_name, p.full_name, '—') AS cliente_nome,
               count(*)            AS operacoes,
               sum(l.total_tokens) AS tokens,
               sum(l.custo_usd)    AS custo_usd,
               round(sum(l.custo_usd) * v_cambio, 4) AS custo_brl
        FROM public.ai_call_log l
        LEFT JOIN public.profiles p ON p.id = l.user_id
        WHERE l.created_at >= v_since
        GROUP BY l.user_id, p.company_name, p.full_name
        ORDER BY tokens DESC
        LIMIT 50
      ) t
    ), '[]'::jsonb),
    'por_disparo', coalesce((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.tokens DESC) FROM (
        SELECT disparo_tipo,
               count(*)          AS operacoes,
               sum(total_tokens) AS tokens,
               sum(custo_usd)    AS custo_usd,
               round(sum(custo_usd) * v_cambio, 4) AS custo_brl
        FROM public.ai_call_log
        WHERE created_at >= v_since
        GROUP BY disparo_tipo
      ) t
    ), '[]'::jsonb),
    'por_modelo', coalesce((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.tokens DESC) FROM (
        SELECT provedor, modelo,
               coalesce(sum(n_subcalls), 0) AS chamadas,
               sum(total_tokens)  AS tokens,
               sum(input_tokens)  AS input_tokens,
               sum(output_tokens) AS output_tokens,
               round(sum(custo_usd) * v_cambio, 4) AS custo_brl
        FROM public.ai_call_log
        WHERE created_at >= v_since
        GROUP BY provedor, modelo
      ) t
    ), '[]'::jsonb),
    'serie_dia', coalesce((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.dia) FROM (
        SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
               count(*)          AS operacoes,
               sum(total_tokens) AS tokens,
               round(sum(custo_usd) * v_cambio, 4) AS custo_brl
        FROM public.ai_call_log
        WHERE created_at >= v_since
        GROUP BY 1
      ) t
    ), '[]'::jsonb),
    -- NOVO: serie diaria QUEBRADA POR AGENTE (pro grafico filtravel por agente).
    'serie_dia_agente', coalesce((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.dia, t.tokens DESC) FROM (
        SELECT (l.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
               l.agent_id,
               coalesce(max(l.agent_name), '—') AS agente,
               sum(l.total_tokens) AS tokens,
               round(sum(l.custo_usd) * v_cambio, 4) AS custo_brl
        FROM public.ai_call_log l
        WHERE l.created_at >= v_since
        GROUP BY 1, l.agent_id
      ) t
    ), '[]'::jsonb),
    'gerado_em', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ai_audit_overview(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_ai_audit_overview(int) TO authenticated;
