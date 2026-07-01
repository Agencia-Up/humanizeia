-- ============================================================================
-- Vencimento (dia do mês) dos custos fixos mensais — aba Margem do Administrativo
-- ----------------------------------------------------------------------------
-- Adiciona custos_fixos.dia_vencimento (1..31, opcional/nullable): o dia em que
-- o custo vence todo mês (recorrente). Atualiza as RPCs do painel para ler e
-- gravar o campo. Aditivo e idempotente; custos existentes ficam sem vencimento
-- até serem preenchidos.
-- ============================================================================

-- 1) Coluna + validação (nullable, 1..31)
ALTER TABLE public.custos_fixos ADD COLUMN IF NOT EXISTS dia_vencimento smallint;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custos_fixos_dia_vencimento_chk') THEN
    ALTER TABLE public.custos_fixos
      ADD CONSTRAINT custos_fixos_dia_vencimento_chk
      CHECK (dia_vencimento IS NULL OR dia_vencimento BETWEEN 1 AND 31);
  END IF;
END $$;

-- 2) Overview: incluir dia_vencimento no JSON de custos_fixos
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
               coalesce(p.company_name, p.full_name, '—') AS nome,
               coalesce(cr.receita_brl_mensal, 0)         AS receita_brl,
               coalesce(cr.ativo, false)                  AS pagante,
               coalesce(j.custo_brl, 0)                   AS custo_jose_brl
        FROM (SELECT DISTINCT user_id FROM public.wa_ai_agents WHERE user_id IS NOT NULL) a
        LEFT JOIN public.profiles p ON p.id = a.user_id
        LEFT JOIN public.clientes_receita cr ON cr.user_id = a.user_id
        LEFT JOIN (
          SELECT user_id, round(sum(custo_usd) * v_cambio, 2) AS custo_brl
          FROM public.ai_call_log
          WHERE disparo_tipo = 'jose_apollo' AND created_at >= v_month_start
          GROUP BY user_id
        ) j ON j.user_id = a.user_id
      ) t), '[]'::jsonb),
    'totais', jsonb_build_object(
      'receita_brl',      coalesce((SELECT sum(receita_brl_mensal) FROM public.clientes_receita WHERE ativo), 0),
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

-- 3) set_custo: nova assinatura com p_dia_vencimento (grava/limpa o dia).
--    DROP da assinatura antiga (4 args) para não deixar overload ambíguo.
DROP FUNCTION IF EXISTS public.admin_margem_set_custo(uuid, text, numeric, boolean);
CREATE OR REPLACE FUNCTION public.admin_margem_set_custo(
  p_id uuid, p_nome text, p_valor numeric, p_ativo boolean, p_dia_vencimento smallint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public._is_caller_superadmin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.custos_fixos (nome, valor_brl, ativo, dia_vencimento)
    VALUES (p_nome, coalesce(p_valor, 0), coalesce(p_ativo, true), p_dia_vencimento)
    ON CONFLICT (nome) DO UPDATE SET valor_brl = excluded.valor_brl, ativo = excluded.ativo,
        dia_vencimento = excluded.dia_vencimento, atualizado_em = now()
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.custos_fixos
      SET nome = coalesce(p_nome, nome), valor_brl = coalesce(p_valor, valor_brl),
          ativo = coalesce(p_ativo, ativo), dia_vencimento = p_dia_vencimento, atualizado_em = now()
      WHERE id = p_id RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $$;
REVOKE ALL ON FUNCTION public.admin_margem_set_custo(uuid, text, numeric, boolean, smallint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_margem_set_custo(uuid, text, numeric, boolean, smallint) TO authenticated;
