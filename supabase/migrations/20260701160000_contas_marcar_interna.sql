-- ============================================================================
-- Contas: marcar conta como INTERNA (ADM/teste/vendedor) e tirar da margem
-- ----------------------------------------------------------------------------
-- Contas internas da Logos nunca pagam. Ganham a flag clientes_receita.interna.
-- interna=true => NÃO é cliente: pagante=false, sem próximo vencimento e FORA
-- dos totais de receita/margem. O frontend esconde as internas (com switch pra
-- mostrar/gerenciar). Aditivo/idempotente; mantém guard de superadmin.
-- ============================================================================

ALTER TABLE public.clientes_receita ADD COLUMN IF NOT EXISTS interna boolean NOT NULL DEFAULT false;

-- ── overview: interna por conta; pagante/venc/totais desconsideram interna ──
CREATE OR REPLACE FUNCTION public.admin_margem_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cambio      numeric;
  v_month_start timestamptz := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo';
  v_result      jsonb;
BEGIN
  IF NOT public._is_caller_superadmin() THEN
    RAISE EXCEPTION 'forbidden: only platform admins';
  END IF;

  SELECT cambio_usd_brl INTO v_cambio FROM public.config_cobranca WHERE id = 1;
  v_cambio := coalesce(v_cambio, 5.40);

  SELECT jsonb_build_object(
    'mes_inicio', v_month_start,
    'cambio_usd_brl', v_cambio,
    'custos_fixos', coalesce((
      SELECT jsonb_agg(row_to_json(c) ORDER BY c.nome) FROM (
        SELECT id, nome, valor_brl, ativo, dia_vencimento FROM public.custos_fixos
      ) c), '[]'::jsonb),
    'contas', coalesce((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.pagante DESC, t.receita_brl DESC, t.custo_jose_brl DESC) FROM (
        SELECT a.user_id,
               coalesce(p.company_name, p.full_name, '—')                     AS nome,
               coalesce(cr.interna, false)                                    AS interna,
               cp.recurrence_value                                            AS mensalidade_site,
               cp.setup_value                                                 AS implementacao_site,
               -- vencimento SÓ para cliente real (pagante e não interna)
               CASE WHEN (NOT coalesce(cr.interna, false)
                          AND (cp.recurrence_value IS NOT NULL OR coalesce(cr.ativo, false)))
                    THEN (us.renewal_date AT TIME ZONE 'America/Sao_Paulo')::date
               END                                                            AS proximo_venc,
               us.plan_id                                                     AS plano,
               coalesce(cp.recurrence_value, cr.receita_brl_mensal, 0)        AS receita_brl,
               (NOT coalesce(cr.interna, false)
                AND (cp.recurrence_value IS NOT NULL OR coalesce(cr.ativo, false))) AS pagante,
               coalesce(j.custo_brl, 0)                                       AS custo_jose_brl
        FROM (SELECT DISTINCT user_id FROM public.wa_ai_agents WHERE user_id IS NOT NULL) a
        LEFT JOIN public.profiles p ON p.id = a.user_id
        LEFT JOIN public.clientes_receita cr ON cr.user_id = a.user_id
        LEFT JOIN LATERAL (
          SELECT cpx.recurrence_value, cpx.setup_value
          FROM public.checkout_pending cpx
          WHERE cpx.user_id = a.user_id AND cpx.status = 'paid'
          ORDER BY cpx.created_at DESC LIMIT 1
        ) cp ON true
        LEFT JOIN LATERAL (
          SELECT usx.renewal_date, usx.plan_id
          FROM public.user_subscriptions usx
          WHERE usx.user_id = a.user_id
          ORDER BY usx.updated_at DESC LIMIT 1
        ) us ON true
        LEFT JOIN (
          SELECT user_id, round(sum(custo_usd) * v_cambio, 2) AS custo_brl
          FROM public.ai_call_log
          WHERE disparo_tipo = 'jose_apollo' AND created_at >= v_month_start
          GROUP BY user_id
        ) j ON j.user_id = a.user_id
      ) t), '[]'::jsonb),
    'totais', jsonb_build_object(
      'receita_brl', coalesce((
        SELECT sum(coalesce(cp.recurrence_value, cr.receita_brl_mensal, 0))
        FROM (SELECT DISTINCT user_id FROM public.wa_ai_agents WHERE user_id IS NOT NULL) a
        LEFT JOIN public.clientes_receita cr ON cr.user_id = a.user_id
        LEFT JOIN LATERAL (
          SELECT cpx.recurrence_value
          FROM public.checkout_pending cpx
          WHERE cpx.user_id = a.user_id AND cpx.status = 'paid'
          ORDER BY cpx.created_at DESC LIMIT 1
        ) cp ON true
        WHERE NOT coalesce(cr.interna, false)
          AND (cp.recurrence_value IS NOT NULL OR coalesce(cr.ativo, false))
      ), 0),
      'custos_fixos_brl', coalesce((SELECT sum(valor_brl) FROM public.custos_fixos WHERE ativo), 0),
      'custo_jose_brl',   round(coalesce((SELECT sum(custo_usd) FROM public.ai_call_log
                                          WHERE disparo_tipo = 'jose_apollo' AND created_at >= v_month_start), 0) * v_cambio, 2)
    ),
    'gerado_em', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_margem_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_margem_overview() TO authenticated;

-- ── set_cliente: + p_interna (preserva quando não enviado) ──────────────────
DROP FUNCTION IF EXISTS public.admin_margem_set_cliente(uuid, numeric, boolean);
CREATE OR REPLACE FUNCTION public.admin_margem_set_cliente(
  p_user_id uuid, p_receita numeric, p_ativo boolean, p_interna boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_caller_superadmin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.clientes_receita (user_id, receita_brl_mensal, ativo, interna)
  VALUES (p_user_id, coalesce(p_receita, 0), coalesce(p_ativo, true), coalesce(p_interna, false))
  ON CONFLICT (user_id) DO UPDATE
    SET receita_brl_mensal = excluded.receita_brl_mensal,
        ativo             = excluded.ativo,
        interna           = coalesce(p_interna, public.clientes_receita.interna),
        atualizado_em     = now();
  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.admin_margem_set_cliente(uuid, numeric, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_margem_set_cliente(uuid, numeric, boolean, boolean) TO authenticated;
