-- ============================================================================
-- Saude executiva do Feedback — RPC de LEITURA para a tela de saude.
--
-- public.feedback_operational_health(p_user uuid default null) -> jsonb
--   Seguranca IDENTICA a capi_quality_status:
--     * authenticated: enxerga SOMENTE a propria conta (billing owner via
--       resolve_billing_owner_user_id(auth.uid())); p_user e IGNORADO.
--     * service_role: consulta explicitamente qualquer conta via p_user.
--     * anon: sem EXECUTE.
--   Conteudo (janela de 7 dias, exceto onde indicado):
--     * relatorio: ultimo envio, enviados 7d, falhas 7d + ultima falha (job log)
--     * analises: concluidas/falharam/processando/ultima + pendentes (estimativa)
--     * custo: soma custo_usd + tokens das analises 7d (quando registrados)
--     * confianca: breakdown baixa/media/alta das analises concluidas 7d
--     * alertas: pendentes (enviado_em IS NULL), enviados 7d, ultima falha
--   NAO altera nada (STABLE, so leitura). CAPI fica na RPC capi_quality_status.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.feedback_operational_health(p_user uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target uuid;
  v_result jsonb;
BEGIN
  -- usuario logado -> sempre a PROPRIA conta (ignora p_user);
  -- service_role (sem auth.uid) -> exige p_user explicito.
  IF v_uid IS NOT NULL THEN
    v_target := public.resolve_billing_owner_user_id(v_uid);
  ELSIF auth.role() = 'service_role' OR current_user IN ('postgres', 'service_role') THEN
    v_target := p_user;
  END IF;
  IF v_target IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem conta alvo');
  END IF;

  WITH janela AS (SELECT now() - interval '7 days' AS ini),
  an AS (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE status = 'concluido') AS concluidas,
      count(*) FILTER (WHERE status = 'falhou') AS falharam,
      count(*) FILTER (WHERE status = 'processando') AS processando,
      max(analisado_em) AS ultima,
      COALESCE(sum(custo_usd), 0) AS custo_usd,
      COALESCE(sum(tokens), 0) AS tokens,
      count(*) FILTER (WHERE status = 'concluido' AND confianca_analise = 'baixa') AS conf_baixa,
      count(*) FILTER (WHERE status = 'concluido' AND confianca_analise = 'media') AS conf_media,
      count(*) FILTER (WHERE status = 'concluido' AND confianca_analise = 'alta') AS conf_alta
    FROM public.feedback_conversas fc, janela j
    WHERE fc.tenant_id = v_target AND fc.created_at >= j.ini
  ),
  pend AS (
    SELECT count(*) AS total
    FROM public.feedback_leads_pendentes(1000, 6)
    WHERE tenant_id = v_target
  ),
  rel AS (
    SELECT
      count(*) FILTER (WHERE fr.enviado_em IS NOT NULL AND fr.enviado_em >= j.ini) AS enviados_7d,
      max(fr.enviado_em) AS ultimo_envio
    FROM public.feedback_relatorios fr, janela j
    WHERE fr.tenant_id = v_target
  ),
  rel_falhas AS (
    SELECT count(*) AS falhas_7d, max(jl.created_at) AS ultima_falha_em,
           (SELECT jl2.erro FROM public.feedback_job_log jl2, janela j2
             WHERE jl2.tenant_id = v_target AND jl2.funcao = 'feedback-relatorio-enviar'
               AND jl2.status = 'falhou' AND jl2.created_at >= j2.ini
             ORDER BY jl2.created_at DESC LIMIT 1) AS ultima_falha_erro
    FROM public.feedback_job_log jl, janela j
    WHERE jl.tenant_id = v_target AND jl.funcao = 'feedback-relatorio-enviar'
      AND jl.status = 'falhou' AND jl.created_at >= j.ini
  ),
  al AS (
    SELECT
      count(*) FILTER (WHERE fa.enviado_em IS NULL) AS pendentes,
      count(*) FILTER (WHERE fa.enviado_em IS NOT NULL AND fa.enviado_em >= j.ini) AS enviados_7d,
      max(fa.enviado_em) AS ultimo_envio
    FROM public.feedback_alertas fa, janela j
    WHERE fa.tenant_id = v_target
  ),
  al_falhas AS (
    SELECT max(jl.created_at) AS ultima_falha_em,
           (SELECT jl2.erro FROM public.feedback_job_log jl2, janela j2
             WHERE jl2.tenant_id = v_target AND jl2.funcao ILIKE 'feedback-alertas%'
               AND jl2.status = 'falhou' AND jl2.created_at >= j2.ini
             ORDER BY jl2.created_at DESC LIMIT 1) AS ultima_falha_erro
    FROM public.feedback_job_log jl, janela j
    WHERE jl.tenant_id = v_target AND jl.funcao ILIKE 'feedback-alertas%'
      AND jl.status = 'falhou' AND jl.created_at >= j.ini
  )
  SELECT jsonb_build_object(
    'ok', true,
    'user_id', v_target,
    'janela_dias', 7,
    'relatorio', jsonb_build_object(
      'ultimo_envio', (SELECT ultimo_envio FROM rel),
      'enviados_7d', (SELECT enviados_7d FROM rel),
      'falhas_7d', (SELECT falhas_7d FROM rel_falhas),
      'ultima_falha_em', (SELECT ultima_falha_em FROM rel_falhas),
      'ultima_falha_erro', (SELECT ultima_falha_erro FROM rel_falhas)
    ),
    'analises', jsonb_build_object(
      'total_7d', (SELECT total FROM an),
      'concluidas', (SELECT concluidas FROM an),
      'falharam', (SELECT falharam FROM an),
      'processando', (SELECT processando FROM an),
      'pendentes', (SELECT total FROM pend),
      'ultima', (SELECT ultima FROM an)
    ),
    'custo', jsonb_build_object(
      'custo_usd_7d', (SELECT round(custo_usd, 4) FROM an),
      'tokens_7d', (SELECT tokens FROM an)
    ),
    'confianca', jsonb_build_object(
      'baixa', (SELECT conf_baixa FROM an),
      'media', (SELECT conf_media FROM an),
      'alta', (SELECT conf_alta FROM an)
    ),
    'alertas', jsonb_build_object(
      'pendentes', (SELECT pendentes FROM al),
      'enviados_7d', (SELECT enviados_7d FROM al),
      'ultimo_envio', (SELECT ultimo_envio FROM al),
      'ultima_falha_em', (SELECT ultima_falha_em FROM al_falhas),
      'ultima_falha_erro', (SELECT ultima_falha_erro FROM al_falhas)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.feedback_operational_health(uuid) IS
  'Saude executiva do Feedback (somente leitura, janela 7d): relatorio (ultimo envio/falhas), analises (concluidas/pendentes/falhas), custo/tokens, confianca (baixa/media/alta) e alertas (pendentes/enviados/ultima falha). Authenticated ve so a propria conta (p_user ignorado); service_role consulta via p_user. CAPI: usar capi_quality_status.';

REVOKE ALL ON FUNCTION public.feedback_operational_health(uuid) FROM public;
REVOKE ALL ON FUNCTION public.feedback_operational_health(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.feedback_operational_health(uuid) TO authenticated;

-- Janela "desde a chegada de cada lead" saiu de "reservado" para IMPLEMENTADA
-- (relatorio-enviar traduz para p_dias=30 na RPC de dados, que ja agrupa cada
-- lead pela data de CHEGADA — nenhuma migration antiga foi editada).
COMMENT ON COLUMN public.conta_automacao_regras.relatorio_janela_tipo IS
  'Janela de analise do relatorio. padrao_atual = comportamento historico (7 dias). desde_chegada_lead = janela real por chegada do lead, teto de 30 dias (p_dias=30 na RPC de dados, que agrupa por data de chegada).';
