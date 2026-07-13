-- Corrige a base do relatorio diario:
-- "chegaram" precisa contar os leads reais do CRM, nao apenas feedback_conversas ja analisadas.
CREATE OR REPLACE FUNCTION public.feedback_relatorio_diario_dados(
  p_tenant uuid,
  p_dias integer DEFAULT 7,
  p_ref date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET statement_timeout TO '30s'
AS $function$
WITH ref AS (
  SELECT
    COALESCE(p_ref, ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 1)) AS d,
    GREATEST(COALESCE(p_dias, 7), 1) AS dias
),
leads AS (
  SELECT
    'pedro'::text AS lead_source,
    p.id AS lead_id,
    p.user_id AS tenant_id,
    (COALESCE(p.arrived_at::timestamptz, p.created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
    p.assigned_to_id AS vendedor_id,
    lower(COALESCE(p.status_crm, p.status, '')) AS status_crm,
    false AS venceu_marcos
  FROM public.ai_crm_leads p
  WHERE p.user_id = p_tenant

  UNION ALL

  SELECT
    'marcos'::text AS lead_source,
    m.id AS lead_id,
    m.user_id AS tenant_id,
    (COALESCE(m.arrived_at::timestamptz, m.created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
    CASE
      WHEN COALESCE(m.assigned_to, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN m.assigned_to::uuid
      ELSE NULL::uuid
    END AS vendedor_id,
    ''::text AS status_crm,
    m.won_at IS NOT NULL AS venceu_marcos
  FROM public.crm_leads m
  WHERE m.user_id = p_tenant
),
base AS (
  SELECT
    l.dia,
    COALESCE(tm.name, '(sem vendedor)') AS vendedor,
    fc.score_atendimento AS score,
    fc.id IS NOT NULL AS analisado,
    (
      COALESCE(((fc.resultado->>'houve_venda') = 'true' OR fc.veredito = 'venda_realizada'), false)
      OR l.status_crm = 'fechado'
      OR l.venceu_marcos
    ) AS vendeu,
    CASE
      WHEN fc.id IS NULL THEN 'sem'
      WHEN fc.qualidade_lead = '1_alto' THEN 'forte'
      WHEN fc.qualidade_lead = '2_medio' THEN 'bom'
      WHEN fc.qualidade_lead = '3_baixo' THEN 'dificil'
      WHEN fc.qualidade_lead = '4_nao_lead' THEN 'nao'
      WHEN lower(COALESCE(fc.resultado->>'potencial_compra', '')) = 'alto' THEN 'forte'
      WHEN lower(COALESCE(fc.resultado->>'potencial_compra', '')) = 'medio' THEN 'bom'
      WHEN lower(COALESCE(fc.resultado->>'potencial_compra', '')) = 'baixo' THEN 'dificil'
      WHEN lower(COALESCE(fc.resultado->>'potencial_compra', '')) = 'nao_lead' THEN 'nao'
      ELSE 'sem'
    END AS pot
  FROM leads l
  LEFT JOIN LATERAL (
    SELECT f.*
    FROM public.feedback_conversas f
    WHERE f.tenant_id = p_tenant
      AND f.lead_source = l.lead_source
      AND f.lead_id = l.lead_id
      AND f.status = 'concluido'
    ORDER BY f.created_at DESC
    LIMIT 1
  ) fc ON true
  LEFT JOIN public.ai_team_members tm
    ON tm.id = COALESCE(fc.vendedor_id, l.vendedor_id)
),
win AS (
  SELECT b.*
  FROM base b, ref
  WHERE b.dia > ref.d - ref.dias
    AND b.dia <= ref.d
),
ont AS (
  SELECT b.*
  FROM base b, ref
  WHERE b.dia = ref.d
)
SELECT jsonb_build_object(
  'ref_date', (SELECT d FROM ref),
  'dias', (SELECT dias FROM ref),
  'ontem', jsonb_build_object(
    'chegaram',          (SELECT count(*) FROM ont),
    'analisados',        (SELECT count(*) FROM ont WHERE analisado),
    'pendentes_analise', (SELECT count(*) FROM ont WHERE NOT analisado),
    'qualificados',      (SELECT count(*) FROM ont WHERE pot IN ('forte', 'bom')),
    'bem_atendidos',     (SELECT count(*) FROM ont WHERE pot IN ('forte', 'bom') AND score >= 50),
    'vendas',            (SELECT count(*) FROM ont WHERE vendeu)
  ),
  'funil', jsonb_build_object(
    'chegaram',          (SELECT count(*) FROM win),
    'analisados',        (SELECT count(*) FROM win WHERE analisado),
    'pendentes_analise', (SELECT count(*) FROM win WHERE NOT analisado),
    'qualificados',      (SELECT count(*) FROM win WHERE pot IN ('forte', 'bom')),
    'bem_atendidos',     (SELECT count(*) FROM win WHERE pot IN ('forte', 'bom') AND score >= 50),
    'vendas',            (SELECT count(*) FROM win WHERE vendeu),
    'nao_eram',          (SELECT count(*) FROM win WHERE pot = 'nao'),
    'dificeis',          (SELECT count(*) FROM win WHERE pot = 'dificil'),
    'sem_dados',         (SELECT count(*) FROM win WHERE pot = 'sem')
  ),
  'vendedores', COALESCE((
    SELECT jsonb_agg(v ORDER BY (v->>'recebeu')::int DESC, v->>'nome')
    FROM (
      SELECT jsonb_build_object(
        'nome', vendedor,
        'recebeu', count(*),
        'analisados', count(*) FILTER (WHERE analisado),
        'pendentes_analise', count(*) FILTER (WHERE NOT analisado),
        'com_interesse', count(*) FILTER (WHERE pot IN ('forte', 'bom')),
        'bem_atendidos', count(*) FILTER (WHERE pot IN ('forte', 'bom') AND score >= 50),
        'vendas', count(*) FILTER (WHERE vendeu),
        'score_medio', COALESCE(round(avg(score) FILTER (WHERE score IS NOT NULL)), 0)
      ) AS v
      FROM win
      WHERE vendedor <> '(sem vendedor)'
      GROUP BY vendedor
    ) s
  ), '[]'::jsonb)
);
$function$;

COMMENT ON FUNCTION public.feedback_relatorio_diario_dados(uuid, integer, date) IS
  'Fonte do relatorio diario/PDF. Conta leads reais por chegada em ai_crm_leads/crm_leads e separa quantos ja foram analisados pelo feedback.';
