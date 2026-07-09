-- Fonte de dados do RELATORIO DIARIO simplificado (2 paginas), consumido pela
-- edge feedback-relatorio-diario-pdf:
--   * "ontem" = leads criados no dia de referencia (default = ontem BRT)
--   * "funil" = ultimos p_dias (default 7) para diagnostico com volume
--   * "vendedores" = por vendedor na janela (recebeu x com_interesse x bem_atendidos)
-- Classificacao 'pot' (mesma regua do PDF completo): regras oficiais > potencial_compra
-- do especialista (regua rigida) > temperatura do Pedro > 'sem' (sem evidencia).
-- bem_atendido = lead com interesse real E score_atendimento >= 50.
-- Aplicada em prod via MCP em 08/07/2026 (arquivo versionado depois).
CREATE OR REPLACE FUNCTION public.feedback_relatorio_diario_dados(
  p_tenant uuid, p_dias integer DEFAULT 7, p_ref date DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE
SET statement_timeout TO '30s'
AS $function$
WITH ref AS (
  SELECT COALESCE(p_ref, ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 1)) AS d
),
base AS (
  SELECT
    (l.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
    COALESCE(tm.name,'(sem vendedor)') AS vendedor,
    fc.score_atendimento AS score,
    ((fc.resultado->>'houve_venda')='true' OR fc.veredito='venda_realizada') AS vendeu,
    CASE
      WHEN fc.qualidade_lead='1_alto' THEN 'forte'
      WHEN fc.qualidade_lead='2_medio' THEN 'bom'
      WHEN fc.qualidade_lead='3_baixo' THEN 'dificil'
      WHEN fc.qualidade_lead='4_nao_lead' THEN 'nao'
      WHEN lower(coalesce(fc.resultado->>'potencial_compra',''))='alto' THEN 'forte'
      WHEN lower(coalesce(fc.resultado->>'potencial_compra',''))='medio' THEN 'bom'
      WHEN lower(coalesce(fc.resultado->>'potencial_compra',''))='baixo' THEN 'dificil'
      WHEN lower(coalesce(fc.resultado->>'potencial_compra',''))='nao_lead' THEN 'nao'
      WHEN lower(coalesce(l.temperature,''))='quente' THEN 'bom'
      WHEN lower(coalesce(l.temperature,''))='frio' THEN 'dificil'
      ELSE 'sem'
    END AS pot
  FROM feedback_conversas fc
  JOIN ai_crm_leads l ON l.id = fc.lead_id
  LEFT JOIN ai_team_members tm ON tm.id = fc.vendedor_id
  WHERE fc.tenant_id = p_tenant AND fc.status='concluido'
),
win AS (SELECT b.* FROM base b, ref WHERE b.dia > ref.d - p_dias AND b.dia <= ref.d),
ont AS (SELECT b.* FROM base b, ref WHERE b.dia = ref.d)
SELECT jsonb_build_object(
  'ref_date', (SELECT d FROM ref),
  'dias', p_dias,
  'ontem', jsonb_build_object(
     'chegaram',      (SELECT count(*) FROM ont),
     'qualificados',  (SELECT count(*) FROM ont WHERE pot IN ('forte','bom')),
     'bem_atendidos', (SELECT count(*) FROM ont WHERE pot IN ('forte','bom') AND score>=50),
     'vendas',        (SELECT count(*) FROM ont WHERE vendeu)
  ),
  'funil', jsonb_build_object(
     'chegaram',      (SELECT count(*) FROM win),
     'qualificados',  (SELECT count(*) FROM win WHERE pot IN ('forte','bom')),
     'bem_atendidos', (SELECT count(*) FROM win WHERE pot IN ('forte','bom') AND score>=50),
     'vendas',        (SELECT count(*) FROM win WHERE vendeu),
     'nao_eram',      (SELECT count(*) FROM win WHERE pot='nao'),
     'dificeis',      (SELECT count(*) FROM win WHERE pot='dificil'),
     'sem_dados',     (SELECT count(*) FROM win WHERE pot='sem')
  ),
  'vendedores', COALESCE((SELECT jsonb_agg(v ORDER BY (v->>'recebeu')::int DESC) FROM (
     SELECT jsonb_build_object(
        'nome', vendedor,
        'recebeu', count(*),
        'com_interesse', count(*) FILTER (WHERE pot IN ('forte','bom')),
        'bem_atendidos', count(*) FILTER (WHERE pot IN ('forte','bom') AND score>=50),
        'vendas', count(*) FILTER (WHERE vendeu),
        'score_medio', COALESCE(round(avg(score)),0)
     ) AS v
     FROM win WHERE vendedor <> '(sem vendedor)' GROUP BY vendedor
  ) s), '[]'::jsonb)
)
$function$;
