-- Feedback: corrige fontes incompletas do painel.
--
-- Problemas corrigidos:
-- 1) feedback_produtos_qualidade era chamada pelo front com p_ini/p_fim, mas no
--    banco existia apenas a assinatura (p_dias). Isso quebrava resumo/produtos.
-- 2) feedback_relatorio_por_vendedor hidratava nome/produto apenas em
--    ai_crm_leads. Analises vindas do Marcos podiam aparecer como "Lead" e sem
--    produto, deixando o feedback incorreto/incompleto.
--
-- Escopo: somente leitura/relatorio. Nao altera transferencia, CRM, fila,
-- follow-up, vendas nem disparos.
--
-- Remove a assinatura antiga (p_dias) para evitar ambiguidade no PostgREST.
-- A nova assinatura mantem p_dias como primeiro parametro com default, entao
-- chamadas antigas com apenas { p_dias } continuam funcionando.
DROP FUNCTION IF EXISTS public.feedback_produtos_qualidade(int);

CREATE OR REPLACE FUNCTION public.feedback_produtos_qualidade(
  p_dias int DEFAULT 30,
  p_ini date DEFAULT NULL,
  p_fim date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_res jsonb;
  v_ini date;
  v_fim date;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  v_tenant := public.resolve_billing_owner_user_id(auth.uid());
  IF v_tenant IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  v_fim := COALESCE(p_fim, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_ini := COALESCE(
    p_ini,
    v_fim - greatest(coalesce(p_dias, 30), 1) + 1
  );

  WITH base AS (
    SELECT
      coalesce(fc.qualidade_lead::text, fc.resultado->>'qualidade_lead') AS q,
      lower(trim(coalesce(
        nullif(trim(fc.produto_interesse), ''),
        nullif(trim(p.vehicle_interest), ''),
        nullif(trim(m.vehicle_interest), ''),
        nullif(trim(m.consignado_modelo), '')
      ))) AS pkey,
      coalesce(
        nullif(trim(fc.produto_interesse), ''),
        nullif(trim(p.vehicle_interest), ''),
        nullif(trim(m.vehicle_interest), ''),
        nullif(trim(m.consignado_modelo), '')
      ) AS plabel
    FROM public.feedback_conversas fc
    LEFT JOIN public.ai_crm_leads p
      ON fc.lead_source = 'pedro' AND p.id = fc.lead_id
    LEFT JOIN public.crm_leads m
      ON fc.lead_source = 'marcos' AND m.id = fc.lead_id
    WHERE fc.tenant_id = v_tenant
      AND fc.status = 'concluido'
      AND coalesce(fc.analisado_em, fc.created_at)::date BETWEEN v_ini AND v_fim
  ),
  agg AS (
    SELECT
      coalesce(pkey, '(nao identificado)') AS pkey,
      coalesce(max(plabel), '(nao identificado)') AS produto,
      count(*) AS total,
      count(*) FILTER (WHERE q = '1_alto') AS qualificados,
      count(*) FILTER (WHERE q = '2_medio') AS pouco,
      count(*) FILTER (WHERE q = '3_baixo') AS ruins,
      count(*) FILTER (WHERE q = '4_nao_lead') AS nao_lead,
      count(*) FILTER (WHERE q IS NULL) AS sem_classe
    FROM base
    GROUP BY coalesce(pkey, '(nao identificado)')
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'produto', produto,
    'total', total,
    'qualificados', qualificados,
    'pouco_qualificados', pouco,
    'ruins', ruins,
    'nao_lead', nao_lead,
    'sem_classe', sem_classe,
    'pct_qualificado', CASE WHEN total > 0 THEN round(100.0 * qualificados / total) ELSE 0 END
  ) ORDER BY total DESC, qualificados DESC), '[]'::jsonb)
  INTO v_res
  FROM agg;

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.feedback_produtos_qualidade(int, date, date) FROM public;
REVOKE ALL ON FUNCTION public.feedback_produtos_qualidade(int, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.feedback_produtos_qualidade(int, date, date) TO authenticated;

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
    'vehicle_interest', n.vehicle_interest
  ) ORDER BY n.vendedor_nome ASC, n.score ASC NULLS LAST, n.analisado_em DESC), '[]'::jsonb)
  INTO v_result
  FROM normalizado n;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.feedback_relatorio_por_vendedor() IS
  'Feedbacks > Por vendedor. Retorna resumo mensal por conversa, hidratando Pedro e Marcos.';

REVOKE ALL ON FUNCTION public.feedback_relatorio_por_vendedor() FROM public;
REVOKE ALL ON FUNCTION public.feedback_relatorio_por_vendedor() FROM anon;
GRANT EXECUTE ON FUNCTION public.feedback_relatorio_por_vendedor() TO authenticated;
