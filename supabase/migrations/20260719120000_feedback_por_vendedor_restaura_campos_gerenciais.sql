-- ============================================================================
-- FIX: 20260714150000_feedback_exclui_conversa_interna.sql redefiniu
-- feedback_relatorio_por_vendedor() e PERDEU:
--   1) os campos gerenciais extraidos de feedback_conversas.resultado
--      (resumo_executivo, evidencia_principal, risco_perda, acao_gestor,
--       acao_vendedor, proxima_pergunta_ideal) — a UI (FeedbackResumoExecutivoTab
--      e FeedbackPorVendedorTab) depende deles;
--   2) o suporte a leads do Marcos (lead_source + join em crm_leads) e os
--      fallbacks de produto (produto_interesse / vehicle_interest / consignado).
--
-- Esta migration REUNE tudo:
--   - base completa da 20260712100000 (Pedro + Marcos + campos gerenciais + produto)
--   - confianca_analise / motivo_confianca (20260713200000)
--   - exclusao de conversa interna is_internal = false (20260714150000)
--   - tenant via resolve_billing_owner_user_id(auth.uid())
-- Nenhuma migration antiga foi editada.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.feedback_relatorio_por_vendedor()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_inicio_mes timestamptz;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  v_tenant := public.resolve_billing_owner_user_id(auth.uid());
  IF v_tenant IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  v_inicio_mes := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo';

  WITH base AS (
    SELECT
      fc.id AS fc_id,
      fc.lead_source,
      fc.lead_id,
      fc.vendedor_id,
      coalesce(tm.name, '(vendedor)') AS vendedor_nome,
      coalesce(p.lead_name, m.name, 'Lead') AS lead_name,
      fc.score_atendimento::numeric AS score,
      coalesce(fc.qualidade_lead::text, fc.resultado->>'qualidade_lead') AS qualidade_lead,
      fc.resultado->>'potencial_compra' AS potencial_compra,
      p.temperature::text AS temperature,
      nullif(fc.resultado->>'frase_coaching', '') AS frase_coaching,
      nullif(fc.resultado->>'resumo_executivo', '') AS resumo_executivo,
      nullif(fc.resultado->>'evidencia_principal', '') AS evidencia_principal,
      nullif(fc.resultado->>'risco_perda', '') AS risco_perda,
      nullif(fc.resultado->>'acao_gestor', '') AS acao_gestor,
      nullif(fc.resultado->>'acao_vendedor', '') AS acao_vendedor,
      nullif(fc.resultado->>'proxima_pergunta_ideal', '') AS proxima_pergunta_ideal,
      fc.resultado->'oportunidades_perdidas' AS oportunidades_raw,
      CASE
        WHEN lower(coalesce(fc.resultado->>'houve_venda', 'false')) IN ('true', 'sim', '1') THEN 'true'
        ELSE 'false'
      END AS houve_venda,
      coalesce(
        nullif(trim(fc.produto_interesse), ''),
        nullif(trim(p.vehicle_interest), ''),
        nullif(trim(m.vehicle_interest), ''),
        nullif(trim(m.consignado_modelo), '')
      ) AS vehicle_interest,
      fc.confianca_analise AS confianca_analise,
      nullif(fc.resultado->>'motivo_confianca', '') AS motivo_confianca,
      coalesce(fc.analisado_em, fc.created_at) AS analisado_em,
      CASE
        WHEN nullif(fc.resultado->>'tempo_primeira_resposta_min', '') ~ '^[0-9]+(\.[0-9]+)?$'
          THEN (fc.resultado->>'tempo_primeira_resposta_min')::numeric
        ELSE NULL
      END AS tempo_resposta_min
    FROM public.feedback_conversas fc
    LEFT JOIN public.ai_crm_leads p
      ON fc.lead_source = 'pedro' AND p.id = fc.lead_id
    LEFT JOIN public.crm_leads m
      ON fc.lead_source = 'marcos' AND m.id = fc.lead_id
    LEFT JOIN public.ai_team_members tm
      ON tm.id = fc.vendedor_id
    WHERE fc.tenant_id = v_tenant
      AND fc.status = 'concluido'
      AND coalesce(fc.is_internal, false) = false   -- nunca conversa interna
      AND fc.vendedor_id IS NOT NULL
      AND coalesce(fc.analisado_em, fc.created_at) >= v_inicio_mes
  ),
  normalizado AS (
    SELECT
      b.*,
      coalesce((
        SELECT jsonb_agg(
          coalesce(
            nullif(x.item->>'texto', ''),
            nullif(x.item->>'trecho', ''),
            nullif(x.item->>'resumo', ''),
            trim(both '"' from x.item::text)
          )
        )
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(b.oportunidades_raw) = 'array' THEN b.oportunidades_raw
            ELSE '[]'::jsonb
          END
        ) AS x(item)
      ), '[]'::jsonb) AS oportunidades_perdidas
    FROM base b
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'fc_id', n.fc_id,
    'lead_source', n.lead_source,
    'lead_id', n.lead_id,
    'vendedor_id', n.vendedor_id,
    'vendedor_nome', n.vendedor_nome,
    'lead_name', n.lead_name,
    'score', n.score,
    'qualidade_lead', n.qualidade_lead,
    'potencial_compra', n.potencial_compra,
    'temperature', n.temperature,
    'frase_coaching', n.frase_coaching,
    'resumo_executivo', n.resumo_executivo,
    'evidencia_principal', n.evidencia_principal,
    'risco_perda', n.risco_perda,
    'acao_gestor', n.acao_gestor,
    'acao_vendedor', n.acao_vendedor,
    'proxima_pergunta_ideal', n.proxima_pergunta_ideal,
    'oportunidades_perdidas', n.oportunidades_perdidas,
    'tempo_resposta_min', n.tempo_resposta_min,
    'houve_venda', n.houve_venda,
    'vehicle_interest', n.vehicle_interest,
    'confianca_analise', n.confianca_analise,
    'motivo_confianca', n.motivo_confianca
  ) ORDER BY n.vendedor_nome ASC, n.score ASC NULLS LAST, n.analisado_em DESC), '[]'::jsonb)
  INTO v_result
  FROM normalizado n;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.feedback_relatorio_por_vendedor() IS
  'Feedbacks > Por vendedor. Resumo mensal por conversa (Pedro + Marcos), com campos gerenciais (resumo_executivo, evidencia_principal, risco_perda, acao_gestor, acao_vendedor, proxima_pergunta_ideal), confianca da analise e exclusao de conversa interna.';

REVOKE ALL ON FUNCTION public.feedback_relatorio_por_vendedor() FROM public;
REVOKE ALL ON FUNCTION public.feedback_relatorio_por_vendedor() FROM anon;
GRANT EXECUTE ON FUNCTION public.feedback_relatorio_por_vendedor() TO authenticated;
