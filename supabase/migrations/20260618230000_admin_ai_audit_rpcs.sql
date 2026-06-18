-- ============================================================================
-- AUDITORIA — RPCs do painel superadmin (god-view). Todas gated por
-- _is_caller_superadmin(); BRL derivado on-the-fly do config_cobranca (USD na
-- tabela). O cliente NUNCA chama isto. Mesmo padrao de admin_ia_margem_overview.
-- ============================================================================

-- (1) Visao geral: totais, por cliente, por tipo de disparo, serie por dia -----
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
        'operacoes',  coalesce(count(*), 0),
        'tokens',     coalesce(sum(total_tokens), 0),
        'custo_usd',  coalesce(sum(custo_usd), 0),
        'custo_brl',  round(coalesce(sum(custo_usd), 0) * v_cambio, 4),
        'n_clientes', count(DISTINCT user_id)
      )
      FROM public.ai_call_log WHERE created_at >= v_since
    ),
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
    'gerado_em', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ai_audit_overview(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_ai_audit_overview(int) TO authenticated;

-- (2) Traces suspeitos de loop (muitas sub-chamadas no mesmo turno) ------------
CREATE OR REPLACE FUNCTION public.admin_ai_audit_loops(p_days int DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int := greatest(1, least(coalesce(p_days, 7), 90));
BEGIN
  IF NOT public._is_caller_superadmin() THEN
    RAISE EXCEPTION 'forbidden: only platform admins';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.n_subcalls DESC, t.tokens DESC) FROM (
      SELECT l.trace_id,
             l.user_id,
             coalesce(p.company_name, p.full_name, '—') AS cliente_nome,
             max(l.agent_name)    AS agente,
             max(l.n_subcalls)    AS n_subcalls,
             count(*)             AS linhas,
             sum(l.total_tokens)  AS tokens,
             max(l.created_at)    AS ultima
      FROM public.ai_call_log l
      LEFT JOIN public.profiles p ON p.id = l.user_id
      WHERE l.created_at >= now() - (v_days * interval '1 day')
        AND l.trace_id IS NOT NULL
      GROUP BY l.trace_id, l.user_id, p.company_name, p.full_name
      HAVING max(l.n_subcalls) >= 6 OR count(*) >= 6
      ORDER BY n_subcalls DESC, tokens DESC
      LIMIT 100
    ) t
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ai_audit_loops(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_ai_audit_loops(int) TO authenticated;

-- (3) Flags de anomalia recentes ----------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ai_anomaly_flags(p_days int DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int := greatest(1, least(coalesce(p_days, 7), 90));
BEGIN
  IF NOT public._is_caller_superadmin() THEN
    RAISE EXCEPTION 'forbidden: only platform admins';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC) FROM (
      SELECT f.id, f.created_at, f.rule, f.severity, f.user_id,
             coalesce(p.company_name, p.full_name, '—') AS cliente_nome,
             f.agent_id, f.trace_id, f.metric_value, f.threshold_value, f.details
      FROM public.ai_anomaly_flags f
      LEFT JOIN public.profiles p ON p.id = f.user_id
      WHERE f.created_at >= now() - (v_days * interval '1 day')
      ORDER BY f.created_at DESC
      LIMIT 200
    ) t
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ai_anomaly_flags(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_ai_anomaly_flags(int) TO authenticated;

-- (4) Disparo manual da deteccao (botao do painel; default = dry_run) ----------
CREATE OR REPLACE FUNCTION public.admin_run_ai_anomaly(
  p_window text DEFAULT 'hourly', p_dry_run boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._is_caller_superadmin() THEN
    RAISE EXCEPTION 'forbidden: only platform admins';
  END IF;
  RETURN public.detect_ai_anomalies(coalesce(p_window, 'hourly'), coalesce(p_dry_run, true));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_run_ai_anomaly(text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_run_ai_anomaly(text, boolean) TO authenticated;
