-- ============================================================================
-- RPC do painel INTERNO de margem de IA — FASE 4 (acesso restrito ao superadmin)
-- ----------------------------------------------------------------------------
-- As views de custo (vw_margem_cliente_atual etc.) sao service_role-only: o
-- frontend roda como usuario 'authenticated' e NAO le elas direto (dado
-- sensivel). Esta RPC e a PORTA controlada: SECURITY DEFINER, checa que quem
-- chama e superadmin (mesma regra do hook useIsAdmin: profiles.is_superadmin OU
-- e-mail wandercarvalho31@gmail.com) e so entao devolve os numeros agregados.
--
-- Devolve UM jsonb (1 ida e volta): { config, totais, clientes[], gerado_em }.
-- So leitura/derivacao. Nao debita ninguem. Nao toca no Pedro.
-- Idempotente: CREATE OR REPLACE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_ia_margem_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_email    text;
  v_config   jsonb;
  v_clientes jsonb;
  v_totais   jsonb;
BEGIN
  -- 1. Autorizacao — espelha o useIsAdmin do frontend ------------------------
  v_email := COALESCE(auth.jwt() ->> 'email', '');
  SELECT COALESCE(p.is_superadmin, false) INTO v_is_admin
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF NOT (COALESCE(v_is_admin, false) OR v_email = 'wandercarvalho31@gmail.com') THEN
    RAISE EXCEPTION 'forbidden: painel de margem e exclusivo do superadmin';
  END IF;

  -- 2. Config vigente: cambio (com fonte+data) + markup + split + preco gpt-4o
  SELECT to_jsonb(c) INTO v_config
  FROM (
    SELECT
      cc.cambio_usd_brl,
      cc.cambio_fonte,
      cc.cambio_atualizado_em,
      cc.markup,
      cc.pedro_split_input,
      pm.usd_por_1m_input  AS gpt4o_usd_in,
      pm.usd_por_1m_output AS gpt4o_usd_out
    FROM public.config_cobranca cc
    LEFT JOIN public.preco_modelo pm
      ON pm.provedor = 'openai' AND pm.modelo = 'gpt-4o'
    WHERE cc.id = 1
  ) c;

  -- 3. Por cliente (ciclo atual), com nome/empresa do profiles --------------
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.custo_brl DESC) INTO v_clientes
  FROM (
    SELECT
      m.cliente_id,
      COALESCE(NULLIF(p.company_name, ''), NULLIF(p.full_name, ''), left(m.cliente_id::text, 8)) AS cliente_nome,
      p.phone AS cliente_phone,
      m.plan_id,
      m.receita_brl,
      m.leads_atendidos,
      m.total_tokens,
      m.custo_usd,
      m.custo_brl,
      m.margem_brl,
      m.custo_brl_por_atendimento
    FROM public.vw_margem_cliente_atual m
    LEFT JOIN public.profiles p ON p.id = m.cliente_id
  ) t;

  -- 4. Totais da operacao ---------------------------------------------------
  SELECT to_jsonb(s) INTO v_totais
  FROM (
    SELECT
      count(*)                                AS n_clientes,
      count(*) FILTER (WHERE custo_brl > 0)   AS n_clientes_com_custo,
      COALESCE(sum(leads_atendidos), 0)       AS leads_atendidos,
      COALESCE(sum(total_tokens), 0)          AS total_tokens,
      COALESCE(sum(custo_usd), 0)             AS custo_usd,
      COALESCE(sum(custo_brl), 0)             AS custo_brl,
      COALESCE(sum(receita_brl), 0)           AS receita_brl,
      COALESCE(sum(margem_brl), 0)            AS margem_brl
    FROM public.vw_margem_cliente_atual
  ) s;

  RETURN jsonb_build_object(
    'config',   COALESCE(v_config,   '{}'::jsonb),
    'totais',   COALESCE(v_totais,   '{}'::jsonb),
    'clientes', COALESCE(v_clientes, '[]'::jsonb),
    'gerado_em', now()
  );
END;
$$;

-- Acesso: NUNCA anon. authenticated pode CHAMAR, mas a checagem interna so
-- libera o superadmin (qualquer outro recebe excecao 'forbidden').
REVOKE ALL ON FUNCTION public.admin_ia_margem_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_ia_margem_overview() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_ia_margem_overview() TO authenticated;

COMMENT ON FUNCTION public.admin_ia_margem_overview() IS
  'Painel interno de margem (FASE 4): retorna config de cobranca + totais + custo/receita/margem por cliente. SECURITY DEFINER gated ao superadmin (is_superadmin OU email do operador). So leitura; nao debita ninguem; Pedro intocado.';
