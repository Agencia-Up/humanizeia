-- ============================================================================
-- Custo por conversa PARA O CLIENTE (com markup) — FASE C
-- ----------------------------------------------------------------------------
-- O cliente passa a ver, na tela "Meu Plano", quanto cada conversa "custou"
-- para ELE = custo REAL de IA da conversa x markup (config_cobranca.markup).
-- O custo real e a margem NUNCA saem do servidor: a RPC e SECURITY DEFINER e
-- so devolve o numero FINAL (ja multiplicado) do PROPRIO cliente (auth.uid()).
--
-- Tambem agrega por DIA (first_billed_at, fuso America/Sao_Paulo) para o
-- grafico "dia que mais/menos gastou". So leitura/derivacao: nao toca no Pedro,
-- nao debita ninguem. Dinheiro em NUMERIC (sub-centavo no calculo, 2 casas no
-- que vai pro cliente). Idempotente: UPDATE + CREATE OR REPLACE.
-- ============================================================================

-- 1) Margem (markup) que o cliente enxerga. Fica num lugar so, editavel depois.
UPDATE public.config_cobranca SET markup = 10.000 WHERE id = 1;

-- 2) Acrescenta a data da conversa (first_billed_at) na view interna de custo
--    por lead. Necessaria para o grafico por dia. Append de coluna: nao quebra
--    vw_custo_pedro_cliente_ciclo (que seleciona colunas nomeadas). Continua
--    service_role-only (dado sensivel: custo real).
-- (first_billed_at vai no FIM da lista: CREATE OR REPLACE VIEW so permite
--  ACRESCENTAR coluna no final, nunca inserir no meio/renomear.)
CREATE OR REPLACE VIEW public.vw_custo_pedro_lead AS
SELECT
  pbl.user_id                                   AS cliente_id,
  pbl.lead_key,
  pbl.cycle_tag,
  pbl.raw_tokens                                AS total_tokens,
  round(pbl.raw_tokens * cfg.pedro_split_input)::int                   AS input_tokens,
  (pbl.raw_tokens - round(pbl.raw_tokens * cfg.pedro_split_input))::int AS output_tokens,
  ( round(pbl.raw_tokens * cfg.pedro_split_input)::numeric / 1000000 * pm.usd_por_1m_input
    + (pbl.raw_tokens - round(pbl.raw_tokens * cfg.pedro_split_input))::numeric / 1000000 * pm.usd_por_1m_output
  )                                              AS custo_usd,
  ( ( round(pbl.raw_tokens * cfg.pedro_split_input)::numeric / 1000000 * pm.usd_por_1m_input
    + (pbl.raw_tokens - round(pbl.raw_tokens * cfg.pedro_split_input))::numeric / 1000000 * pm.usd_por_1m_output
    ) * cfg.cambio_usd_brl
  )                                              AS custo_brl,
  pbl.first_billed_at
FROM public.pedro_billed_leads pbl
CROSS JOIN public.config_cobranca cfg
JOIN public.preco_modelo pm
  ON pm.provedor = 'openai' AND pm.modelo = 'gpt-4o'
WHERE cfg.id = 1;

REVOKE ALL ON public.vw_custo_pedro_lead FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_custo_pedro_lead TO service_role;

-- 3) RPC do CLIENTE: custo das proprias conversas, JA com markup, por dia.
--    Escopo travado em auth.uid(): cada um so ve o que e seu. Nunca devolve
--    custo real (custo_brl/custo_usd) nem o markup -> sem vazamento de margem.
CREATE OR REPLACE FUNCTION public.cliente_meu_custo_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_markup  numeric;
  v_cycle   date;
  v_por_dia jsonb;
  v_totais  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao autenticado';
  END IF;

  SELECT COALESCE(markup, 1) INTO v_markup FROM public.config_cobranca WHERE id = 1;

  -- ciclo atual do cliente (mesma chave do Pedro/plano)
  SELECT renewal_date::date INTO v_cycle
  FROM public.user_subscriptions WHERE user_id = v_uid;

  -- agrega por dia: custo do cliente = custo_brl real (somado no dia) x markup
  SELECT COALESCE(jsonb_agg(to_jsonb(agg) ORDER BY agg.dia), '[]'::jsonb) INTO v_por_dia
  FROM (
    SELECT
      (l.first_billed_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
      count(*)::int                              AS n_conversas,
      round(sum(l.custo_brl) * v_markup, 2)      AS custo_cliente_brl
    FROM public.vw_custo_pedro_lead l
    WHERE l.cliente_id = v_uid
      AND l.cycle_tag = v_cycle
      AND l.first_billed_at IS NOT NULL
    GROUP BY 1
  ) agg;

  -- totais + dia que mais/menos gastou (derivados do por_dia ja calculado)
  SELECT to_jsonb(s) INTO v_totais
  FROM (
    SELECT
      COALESCE(sum((e->>'custo_cliente_brl')::numeric), 0) AS custo_cliente_brl,
      COALESCE(sum((e->>'n_conversas')::int), 0)           AS n_conversas,
      (SELECT e2->>'dia' FROM jsonb_array_elements(v_por_dia) e2
         ORDER BY (e2->>'custo_cliente_brl')::numeric DESC, e2->>'dia' LIMIT 1) AS dia_maior,
      (SELECT (e2->>'custo_cliente_brl')::numeric FROM jsonb_array_elements(v_por_dia) e2
         ORDER BY (e2->>'custo_cliente_brl')::numeric DESC, e2->>'dia' LIMIT 1) AS dia_maior_valor,
      (SELECT e2->>'dia' FROM jsonb_array_elements(v_por_dia) e2
         ORDER BY (e2->>'custo_cliente_brl')::numeric ASC, e2->>'dia' LIMIT 1) AS dia_menor,
      (SELECT (e2->>'custo_cliente_brl')::numeric FROM jsonb_array_elements(v_por_dia) e2
         ORDER BY (e2->>'custo_cliente_brl')::numeric ASC, e2->>'dia' LIMIT 1) AS dia_menor_valor
    FROM jsonb_array_elements(v_por_dia) e
  ) s;

  RETURN jsonb_build_object(
    'ciclo',     v_cycle,
    'por_dia',   v_por_dia,
    'totais',    COALESCE(v_totais, '{}'::jsonb),
    'gerado_em', now()
  );
END;
$$;

-- Acesso: NUNCA anon. authenticated pode chamar; auth.uid() garante que so
-- recebe os PROPRIOS dados.
REVOKE ALL ON FUNCTION public.cliente_meu_custo_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_meu_custo_overview() TO authenticated;

COMMENT ON FUNCTION public.cliente_meu_custo_overview() IS
  'Cliente ve o custo das PROPRIAS conversas (custo real de IA * markup do config_cobranca), agregado por dia, para a tela Meu Plano. SECURITY DEFINER escopo auth.uid(); nunca expoe custo real nem margem; nao debita ninguem; Pedro intocado.';
