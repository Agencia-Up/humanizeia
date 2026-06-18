-- ============================================================================
-- AUDITORIA — deteccao de anomalia de consumo (SO-REGISTRO, sem corte).
-- ----------------------------------------------------------------------------
-- A logica e pura agregacao sobre ai_call_log -> roda em SQL e o cron chama
-- DIRETO (mesmo padrao do cron_cleanup_completed_campaigns; sem edge/net.http).
--
-- 3 regras (limiares ajustaveis nas consts no topo da funcao):
--   spike_vs_7d_avg     : tokens/24h do cliente > N x a media diaria dos 7d
--   subcall_loop        : um turno com n_subcalls alto = provavel loop de tools
--   absolute_daily_cap  : teto absoluto de tokens/dia por cliente (backstop)
--
-- Dedup: no maximo 1 flag por (regra, cliente[, trace]) por DIA. So grava (a
-- menos de p_dry_run=true, que so CONTA o que flagaria — preview do painel).
-- SECURITY DEFINER: le ai_call_log (RLS sem policy) e grava ai_anomaly_flags.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.detect_ai_anomalies(
  p_window  text DEFAULT 'hourly',
  p_dry_run boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- limiares (heuristicas iniciais; ajuste aqui sem mexer no resto) -----------
  c_spike_mult   numeric := 5;         -- hoje > 5x a media diaria de 7d
  c_spike_floor  bigint  := 200000;    -- so flaga spike se hoje passou disto (evita ruido de cliente pequeno)
  c_subcall_loop integer := 8;         -- n_subcalls >= 8 num turno (Pedro normal <= 4) = provavel loop
  c_daily_cap    bigint  := 5000000;   -- teto absoluto de tokens/dia por cliente (abuso)
  ----------------------------------------------------------------------------
  v_window text := CASE WHEN p_window = 'daily' THEN 'daily' ELSE 'hourly' END;
  v_spike int := 0; v_loop int := 0; v_cap int := 0;
  r record;
BEGIN
  -- ── Regra 1: SPIKE vs media de 7 dias (por cliente) ──────────────────────
  FOR r IN
    WITH hoje AS (
      SELECT user_id, sum(total_tokens)::bigint AS tok
      FROM public.ai_call_log
      WHERE created_at >= now() - interval '24 hours'
      GROUP BY user_id
    ),
    base AS (
      SELECT user_id, sum(total_tokens)::numeric / 7.0 AS avg_dia
      FROM public.ai_call_log
      WHERE created_at >= now() - interval '8 days'
        AND created_at <  now() - interval '24 hours'
      GROUP BY user_id
    )
    SELECT h.user_id, h.tok, COALESCE(b.avg_dia, 0) AS avg_dia
    FROM hoje h
    LEFT JOIN base b USING (user_id)
    WHERE h.tok >= c_spike_floor
      AND COALESCE(b.avg_dia, 0) > 0           -- precisa de base; cliente novo cai no cap
      AND h.tok > c_spike_mult * b.avg_dia
  LOOP
    IF NOT p_dry_run AND NOT EXISTS (
      SELECT 1 FROM public.ai_anomaly_flags f
      WHERE f.rule = 'spike_vs_7d_avg' AND f.user_id = r.user_id
        AND f.created_at >= date_trunc('day', now())
    ) THEN
      INSERT INTO public.ai_anomaly_flags
        (window_label, rule, severity, user_id, metric_value, threshold_value, details)
      VALUES (v_window, 'spike_vs_7d_avg',
              CASE WHEN r.tok > 10 * r.avg_dia THEN 'critical' ELSE 'warn' END,
              r.user_id, r.tok, round(c_spike_mult * r.avg_dia),
              jsonb_build_object('avg_7d', round(r.avg_dia),
                                 'ratio', round(r.tok / NULLIF(r.avg_dia, 0), 2)));
    END IF;
    v_spike := v_spike + 1;
  END LOOP;

  -- ── Regra 2: LOOP de sub-chamadas (por turno/trace) ──────────────────────
  FOR r IN
    SELECT user_id, agent_id, trace_id, max(n_subcalls) AS n_subcalls, sum(total_tokens) AS tok
    FROM public.ai_call_log
    WHERE created_at >= now() - interval '24 hours'
      AND n_subcalls >= c_subcall_loop
    GROUP BY user_id, agent_id, trace_id
  LOOP
    IF NOT p_dry_run AND NOT EXISTS (
      SELECT 1 FROM public.ai_anomaly_flags f
      WHERE f.rule = 'subcall_loop'
        AND COALESCE(f.trace_id, '') = COALESCE(r.trace_id, '')
        AND f.user_id IS NOT DISTINCT FROM r.user_id
        AND f.created_at >= date_trunc('day', now())
    ) THEN
      INSERT INTO public.ai_anomaly_flags
        (window_label, rule, severity, user_id, agent_id, trace_id, metric_value, threshold_value, details)
      VALUES (v_window, 'subcall_loop', 'warn', r.user_id, r.agent_id, r.trace_id,
              r.n_subcalls, c_subcall_loop, jsonb_build_object('total_tokens', r.tok));
    END IF;
    v_loop := v_loop + 1;
  END LOOP;

  -- ── Regra 3: TETO ABSOLUTO de tokens/dia (por cliente) ───────────────────
  FOR r IN
    SELECT user_id, sum(total_tokens)::bigint AS tok
    FROM public.ai_call_log
    WHERE created_at >= now() - interval '24 hours'
    GROUP BY user_id
    HAVING sum(total_tokens) >= c_daily_cap
  LOOP
    IF NOT p_dry_run AND NOT EXISTS (
      SELECT 1 FROM public.ai_anomaly_flags f
      WHERE f.rule = 'absolute_daily_cap' AND f.user_id = r.user_id
        AND f.created_at >= date_trunc('day', now())
    ) THEN
      INSERT INTO public.ai_anomaly_flags
        (window_label, rule, severity, user_id, metric_value, threshold_value, details)
      VALUES (v_window, 'absolute_daily_cap', 'critical', r.user_id, r.tok, c_daily_cap, '{}'::jsonb);
    END IF;
    v_cap := v_cap + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'window', v_window,
    'dry_run', p_dry_run,
    'flags', jsonb_build_object('spike_vs_7d_avg', v_spike,
                                'subcall_loop', v_loop,
                                'absolute_daily_cap', v_cap),
    'gerado_em', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_ai_anomalies(text, boolean) TO service_role;
-- NUNCA exposta a anon/authenticated diretamente; a UI dispara via RPC
-- admin_run_ai_anomaly (gated por superadmin), criada na migration das RPCs.
REVOKE EXECUTE ON FUNCTION public.detect_ai_anomalies(text, boolean) FROM public, anon, authenticated;

-- Cron HORARIO: chama a funcao SQL direto (idempotente). Roda as 3 regras na
-- janela de 24h; o dedup garante no maximo 1 flag por cliente/regra por dia.
DO $$ BEGIN
  PERFORM cron.unschedule('ai-audit-anomaly-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'ai-audit-anomaly-hourly',
  '0 * * * *',
  $$SELECT public.detect_ai_anomalies('hourly', false)$$
);
