-- ============================================================================
-- Metrificacao de CUSTO REAL de IA — FASE 3 (calculo do custo + margem)
-- ----------------------------------------------------------------------------
-- Calcula o custo real do PEDRO sem tocar no codigo dele: le o total de tokens
-- que o Pedro JA grava por lead/ciclo (pedro_billed_leads.raw_tokens), aplica o
-- preco do modelo gpt-4o (preco_modelo) e o cambio (config_cobranca), e agrega
-- por cliente e por ciclo. Compara com a receita do plano -> MARGEM.
--
-- APROXIMACAO (consequencia de "nao tocar no Pedro"):
--   - raw_tokens e um TOTAL (sem split input/output). Dividimos pelo
--     config_cobranca.pedro_split_input (ex.: 0.8 => 80% input / 20% output).
--   - raw_tokens cobre o cerebro gpt-4o (planner+reply). As chamadas auxiliares
--     (gpt-4o-mini, embeddings) NAO entram, entao o custo aqui e um PISO real.
--   Tudo configuravel e auditavel; nenhum float binario (NUMERIC em todo lugar).
--
-- So leitura/derivacao. NAO desconta saldo de ninguem. Painel INTERNO.
-- Idempotente: CREATE OR REPLACE VIEW + CREATE TABLE IF NOT EXISTS.
-- ============================================================================

-- Preco do plano (receita) — editavel. Necessario para calcular margem. --------
CREATE TABLE IF NOT EXISTS public.plano_preco (
  plan_id        text PRIMARY KEY,            -- 'basico' | 'pro' | 'enterprise'
  preco_brl_mes  numeric(12,2) NOT NULL,      -- receita mensal do plano
  atualizado_em  timestamptz DEFAULT now()
);
ALTER TABLE public.plano_preco ENABLE ROW LEVEL SECURITY;

INSERT INTO public.plano_preco (plan_id, preco_brl_mes) VALUES
  ('basico',      497.00),
  ('pro',         997.00),
  ('enterprise', 2497.00)
ON CONFLICT (plan_id) DO NOTHING;

-- (FASE 3a) Custo por LEAD do Pedro -------------------------------------------
-- Uma linha por lead/ciclo ja cobrado, com tokens aproximados e custo em USD/BRL
-- calculado com o preco e o cambio VIGENTES (bom para "margem a preco de hoje").
CREATE OR REPLACE VIEW public.vw_custo_pedro_lead AS
SELECT
  pbl.user_id                                   AS cliente_id,
  pbl.lead_key,
  pbl.cycle_tag,
  pbl.raw_tokens                                AS total_tokens,
  -- split aproximado input/output
  round(pbl.raw_tokens * cfg.pedro_split_input)::int                   AS input_tokens,
  (pbl.raw_tokens - round(pbl.raw_tokens * cfg.pedro_split_input))::int AS output_tokens,
  -- custo em USD (NUMERIC, sub-centavo)
  ( round(pbl.raw_tokens * cfg.pedro_split_input)::numeric / 1000000 * pm.usd_por_1m_input
    + (pbl.raw_tokens - round(pbl.raw_tokens * cfg.pedro_split_input))::numeric / 1000000 * pm.usd_por_1m_output
  )                                              AS custo_usd,
  -- custo em BRL = custo_usd * cambio
  ( ( round(pbl.raw_tokens * cfg.pedro_split_input)::numeric / 1000000 * pm.usd_por_1m_input
    + (pbl.raw_tokens - round(pbl.raw_tokens * cfg.pedro_split_input))::numeric / 1000000 * pm.usd_por_1m_output
    ) * cfg.cambio_usd_brl
  )                                              AS custo_brl
FROM public.pedro_billed_leads pbl
CROSS JOIN public.config_cobranca cfg
JOIN public.preco_modelo pm
  ON pm.provedor = 'openai' AND pm.modelo = 'gpt-4o'
WHERE cfg.id = 1;

-- (FASE 3b) Custo por CLIENTE por CICLO + margem ------------------------------
CREATE OR REPLACE VIEW public.vw_custo_pedro_cliente_ciclo AS
SELECT
  v.cliente_id,
  v.cycle_tag,
  count(*)                       AS leads_atendidos,
  sum(v.total_tokens)            AS total_tokens,
  sum(v.custo_usd)               AS custo_usd,
  sum(v.custo_brl)               AS custo_brl
FROM public.vw_custo_pedro_lead v
GROUP BY v.cliente_id, v.cycle_tag;

-- (FASE 3c) Resumo por CLIENTE (ciclo ATUAL) com receita e margem -------------
-- cycle_tag atual = renewal_date::date da assinatura (mesma chave do Pedro).
CREATE OR REPLACE VIEW public.vw_margem_cliente_atual AS
SELECT
  us.user_id                                            AS cliente_id,
  us.plan_id,
  pp.preco_brl_mes                                      AS receita_brl,
  COALESCE(c.leads_atendidos, 0)                        AS leads_atendidos,
  COALESCE(c.total_tokens, 0)                           AS total_tokens,
  COALESCE(c.custo_usd, 0)                              AS custo_usd,
  COALESCE(c.custo_brl, 0)                              AS custo_brl,
  (COALESCE(pp.preco_brl_mes,0) - COALESCE(c.custo_brl,0)) AS margem_brl,
  CASE WHEN COALESCE(c.leads_atendidos,0) > 0
       THEN round(COALESCE(c.custo_brl,0) / c.leads_atendidos, 6)
       ELSE 0 END                                       AS custo_brl_por_atendimento
FROM public.user_subscriptions us
LEFT JOIN public.plano_preco pp ON pp.plan_id = us.plan_id
LEFT JOIN public.vw_custo_pedro_cliente_ciclo c
       ON c.cliente_id = us.user_id
      AND c.cycle_tag  = us.renewal_date::date;

-- Acesso: views NAO recebem GRANT para authenticated/anon (dado interno). So o
-- service_role (e o owner) leem. A FASE 4 expoe ao gestor via RPC/edge gated.
REVOKE ALL ON public.vw_custo_pedro_lead          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.vw_custo_pedro_cliente_ciclo FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.vw_margem_cliente_atual      FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_custo_pedro_lead          TO service_role;
GRANT SELECT ON public.vw_custo_pedro_cliente_ciclo TO service_role;
GRANT SELECT ON public.vw_margem_cliente_atual      TO service_role;

COMMENT ON VIEW public.vw_margem_cliente_atual IS
  'Resumo por cliente no ciclo atual: receita do plano vs custo real de IA (Pedro, aproximado de raw_tokens) -> margem. Painel interno; nao debita ninguem.';
