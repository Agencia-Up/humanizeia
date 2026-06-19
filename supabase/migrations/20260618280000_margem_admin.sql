-- ============================================================================
-- MARGEM (Administrativo) — substitui o painel antigo que pegava custo do
-- pedro_billed_leads (zerado). Agora: Receita (clientes pagantes) − Custos
-- fixos editaveis − Custo de IA do Jose (real, do ai_call_log). Tudo editavel.
-- So superadmin (RPCs gated). Idempotente.
-- ============================================================================

-- Custos fixos mensais de infra (editaveis) -----------------------------------
CREATE TABLE IF NOT EXISTS public.custos_fixos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL UNIQUE,
  valor_brl     numeric(12,2) NOT NULL DEFAULT 0,
  ativo         boolean NOT NULL DEFAULT true,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.custos_fixos ENABLE ROW LEVEL SECURITY;
INSERT INTO public.custos_fixos (nome, valor_brl) VALUES
  ('Hostinger', 100.00),
  ('Supabase',  130.00),
  ('UAZAPI',    150.00)
ON CONFLICT (nome) DO NOTHING;

-- Receita mensal por conta (quem e cliente pagante e quanto paga) -------------
CREATE TABLE IF NOT EXISTS public.clientes_receita (
  user_id            uuid PRIMARY KEY,
  receita_brl_mensal numeric(12,2) NOT NULL DEFAULT 0,
  ativo              boolean NOT NULL DEFAULT true,  -- e cliente pagante?
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.clientes_receita ENABLE ROW LEVEL SECURITY;

-- ── RPC: visao geral da margem ──────────────────────────────────────────────
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
        SELECT id, nome, valor_brl, ativo FROM public.custos_fixos
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

-- ── RPC: criar/editar custo fixo ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_margem_set_custo(
  p_id uuid, p_nome text, p_valor numeric, p_ativo boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public._is_caller_superadmin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.custos_fixos (nome, valor_brl, ativo)
    VALUES (p_nome, coalesce(p_valor, 0), coalesce(p_ativo, true))
    ON CONFLICT (nome) DO UPDATE SET valor_brl = excluded.valor_brl, ativo = excluded.ativo, atualizado_em = now()
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.custos_fixos
      SET nome = coalesce(p_nome, nome), valor_brl = coalesce(p_valor, valor_brl),
          ativo = coalesce(p_ativo, ativo), atualizado_em = now()
      WHERE id = p_id RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $$;
REVOKE ALL ON FUNCTION public.admin_margem_set_custo(uuid, text, numeric, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_margem_set_custo(uuid, text, numeric, boolean) TO authenticated;

-- ── RPC: excluir custo fixo ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_margem_del_custo(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_caller_superadmin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.custos_fixos WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.admin_margem_del_custo(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_margem_del_custo(uuid) TO authenticated;

-- ── RPC: definir receita/pagante de uma conta ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_margem_set_cliente(
  p_user_id uuid, p_receita numeric, p_ativo boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_caller_superadmin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.clientes_receita (user_id, receita_brl_mensal, ativo)
  VALUES (p_user_id, coalesce(p_receita, 0), coalesce(p_ativo, true))
  ON CONFLICT (user_id) DO UPDATE
    SET receita_brl_mensal = excluded.receita_brl_mensal, ativo = excluded.ativo, atualizado_em = now();
  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.admin_margem_set_cliente(uuid, numeric, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_margem_set_cliente(uuid, numeric, boolean) TO authenticated;
