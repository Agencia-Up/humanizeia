-- ============================================================================
-- Contas — puxar as vendas do site (implementação + mensalidade + vencimento)
-- ----------------------------------------------------------------------------
-- Enriquece admin_margem_overview: cada conta passa a trazer, automático:
--   mensalidade_site   = recurrence_value do último checkout PAGO (checkout_pending status='paid')
--   implementacao_site = setup_value do mesmo checkout pago (receita ÚNICA, exibida à parte)
--   proximo_venc       = user_subscriptions.renewal_date (próximo vencimento)
-- Regra da receita efetiva: COALESCE(mensalidade_site, clientes_receita manual, 0)
--   -> auto do site quando há venda paga; senão o valor manual (ex.: Icom founder).
-- pagante = tem venda paga OU clientes_receita.ativo.
-- Implementação NÃO entra em nenhum total (é receita única, não recorrente).
-- Idempotente (CREATE OR REPLACE), mantém SECURITY DEFINER + guard de superadmin.
-- ============================================================================

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
               cp.recurrence_value                                            AS mensalidade_site,
               cp.setup_value                                                 AS implementacao_site,
               (us.renewal_date AT TIME ZONE 'America/Sao_Paulo')::date       AS proximo_venc,
               us.plan_id                                                     AS plano,
               coalesce(cp.recurrence_value, cr.receita_brl_mensal, 0)        AS receita_brl,
               (cp.recurrence_value IS NOT NULL OR coalesce(cr.ativo, false)) AS pagante,
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
      -- Receita efetiva (auto do site OU manual), só das contas pagantes.
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
        WHERE cp.recurrence_value IS NOT NULL OR coalesce(cr.ativo, false)
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
