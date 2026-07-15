-- ============================================================================
-- FEEDBACK — nao analisar/mostrar CONVERSA INTERNA como lead (item 4 do escopo).
--
-- Bug: existiam feedback_conversas cujo "lead" era um contato INTERNO
-- (vendedor/gerente/responsavel/instancia) porque feedback_leads_pendentes
-- enfileirava esses telefones -> poluiam o dashboard.
-- Fix: coluna is_internal (flag+backfill) + feedback_leads_pendentes/read-RPCs
-- excluindo interno (reusa logos_phone_key / logos_internal_keys).
--
-- Estado FINAL aplicado em prod via MCP em 14/07. Os corpos das funcoes abaixo
-- foram EXTRAIDOS de producao com pg_get_functiondef (byte-exato) — NAO reescritos
-- a mao. Idempotente (CREATE OR REPLACE). Nao deleta historico.
--
-- DEPENDENCIAS (helpers usados por estas RPCs, versionados em OUTRAS migrations —
-- nao redefinidos aqui para manter dono unico):
--   logos_phone_key / logos_phone_variants / logos_internal_keys
--       -> 20260714130000_conversas_privacy_lead_only_rpcs.sql
--   resolve_billing_owner_user_id / get_seller_master_user_id
--       -> migrations de billing/seller (helpers globais de auth/tenant).
-- ============================================================================

-- ── 1) Flag + backfill (ajuste minimo de schema para a migration versionada) ─
ALTER TABLE public.feedback_conversas
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.feedback_conversas.is_internal IS
  'true = o lead desta conversa e um contato INTERNO (vendedor/gerente/responsavel/instancia), nao um lead real. Excluido do dashboard/relatorios. Nunca deletar historico.';

UPDATE public.feedback_conversas fc SET is_internal = true
FROM public.ai_crm_leads p
WHERE fc.lead_source = 'pedro' AND p.id = fc.lead_id
  AND public.logos_phone_key(split_part(p.remote_jid,'@',1)) = ANY(public.logos_internal_keys(fc.tenant_id));

UPDATE public.feedback_conversas fc SET is_internal = true
FROM public.crm_leads m
WHERE fc.lead_source = 'marcos' AND m.id = fc.lead_id
  AND public.logos_phone_key(m.phone) = ANY(public.logos_internal_keys(fc.tenant_id));

-- ── 2) Funcoes/RPCs do Feedback (byte-exato via pg_get_functiondef de PROD) ──

-- ─── public.feedback_leads_pendentes ───
CREATE OR REPLACE FUNCTION public.feedback_leads_pendentes(p_limit integer DEFAULT 20, p_horas integer DEFAULT 6)
 RETURNS TABLE(lead_source text, lead_id uuid, tenant_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
  WITH tenants AS (
    SELECT c.tenant_id
    FROM public.feedback_config c
    WHERE COALESCE((c.feature_flags->>'analise')::boolean, false) IS TRUE
  ),
  internos AS (
    SELECT t.tenant_id, k AS ikey
    FROM tenants t
    CROSS JOIN LATERAL unnest(public.logos_internal_keys(t.tenant_id)) AS k
  ),
  fones_inbox AS (
    SELECT DISTINCT y.user_id, y.fone
    FROM (
      SELECT x.user_id,
             CASE WHEN length(x.g) > 11 AND left(x.g,2) = '55' THEN substr(x.g,3) ELSE x.g END AS fone
      FROM (
        SELECT w.user_id, regexp_replace(COALESCE(w.phone,''), '[^0-9]', '', 'g') AS g
        FROM public.wa_inbox w
        JOIN tenants t ON t.tenant_id = w.user_id
      ) x
    ) y
    WHERE length(y.fone) >= 10
  ),
  pedro AS (
    SELECT 'pedro'::text AS lead_source, l.id AS lead_id, l.user_id AS tenant_id,
           COALESCE(l.last_interaction_at, l.created_at) AS sort_at,
           CASE WHEN length(l.gp) > 11 AND left(l.gp,2) = '55' THEN substr(l.gp,3) ELSE l.gp END AS fone
    FROM (
      SELECT ai.id, ai.user_id, ai.last_interaction_at, ai.created_at,
             regexp_replace(COALESCE(split_part(ai.remote_jid,'@',1),''), '[^0-9]', '', 'g') AS gp
      FROM public.ai_crm_leads ai
    ) l
    JOIN tenants t ON t.tenant_id = l.user_id
    WHERE COALESCE(l.last_interaction_at, l.created_at) < now() - make_interval(hours => GREATEST(COALESCE(p_horas,6),1))
      AND COALESCE(l.last_interaction_at, l.created_at) >= date_trunc('month', now())
      AND length(l.gp) >= 10
      AND NOT EXISTS (
        SELECT 1 FROM public.feedback_conversas f
        WHERE f.lead_source='pedro' AND f.lead_id=l.id AND f.versao_thread='v1'
          AND f.status IN ('concluido','processando')
      )
  ),
  marcos AS (
    SELECT 'marcos'::text AS lead_source, m.id AS lead_id, m.user_id AS tenant_id,
           COALESCE(m.updated_at, m.created_at) AS sort_at,
           CASE WHEN length(m.gm) > 11 AND left(m.gm,2) = '55' THEN substr(m.gm,3) ELSE m.gm END AS fone
    FROM (
      SELECT cl.id, cl.user_id, cl.updated_at, cl.created_at, cl.assigned_to,
             regexp_replace(COALESCE(cl.phone,''), '[^0-9]', '', 'g') AS gm
      FROM public.crm_leads cl
    ) m
    JOIN tenants t ON t.tenant_id = m.user_id
    WHERE COALESCE(m.updated_at, m.created_at) < now() - make_interval(hours => GREATEST(COALESCE(p_horas,6),1))
      AND COALESCE(m.updated_at, m.created_at) >= date_trunc('month', now())
      AND COALESCE(m.assigned_to,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND length(m.gm) >= 10
      AND NOT EXISTS (
        SELECT 1 FROM public.feedback_conversas f
        WHERE f.lead_source='marcos' AND f.lead_id=m.id AND f.versao_thread='v1'
          AND f.status IN ('concluido','processando')
      )
  ),
  cand AS (
    SELECT * FROM pedro
    UNION ALL
    SELECT * FROM marcos
  )
  SELECT c.lead_source, c.lead_id, c.tenant_id
  FROM cand c
  JOIN fones_inbox fi ON fi.user_id = c.tenant_id AND fi.fone = c.fone
  -- NOVO: nunca enfileira telefone que bate com contato interno do tenant.
  WHERE NOT EXISTS (
    SELECT 1 FROM internos ii
    WHERE ii.tenant_id = c.tenant_id
      AND ii.ikey = public.logos_phone_key(c.fone)
  )
  ORDER BY c.sort_at DESC NULLS LAST
  LIMIT GREATEST(COALESCE(p_limit,20),1);
$function$
;

-- ─── public.feedback_relatorio_por_vendedor ───
CREATE OR REPLACE FUNCTION public.feedback_relatorio_por_vendedor()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_inicio_mes timestamptz;
  v_result jsonb;
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;

  v_tenant := public.resolve_billing_owner_user_id(auth.uid());
  if v_tenant is null then
    return '[]'::jsonb;
  end if;

  v_inicio_mes := date_trunc('month', (now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';

  with base as (
    select
      fc.id as fc_id,
      fc.vendedor_id,
      coalesce(tm.name, '(vendedor)') as vendedor_nome,
      coalesce(l.lead_name, 'Lead') as lead_name,
      fc.score_atendimento::numeric as score,
      coalesce(fc.qualidade_lead::text, fc.resultado->>'qualidade_lead') as qualidade_lead,
      fc.resultado->>'potencial_compra' as potencial_compra,
      l.temperature::text as temperature,
      nullif(fc.resultado->>'frase_coaching', '') as frase_coaching,
      fc.resultado->'oportunidades_perdidas' as oportunidades_raw,
      case
        when lower(coalesce(fc.resultado->>'houve_venda', 'false')) in ('true', 'sim', '1') then 'true'
        else 'false'
      end as houve_venda,
      l.vehicle_interest,
      fc.confianca_analise as confianca_analise,
      nullif(fc.resultado->>'motivo_confianca', '') as motivo_confianca,
      coalesce(fc.analisado_em, fc.created_at) as analisado_em,
      case
        when nullif(fc.resultado->>'tempo_primeira_resposta_min', '') ~ '^[0-9]+(\.[0-9]+)?$'
          then (fc.resultado->>'tempo_primeira_resposta_min')::numeric
        else null
      end as tempo_resposta_min
    from public.feedback_conversas fc
    left join public.ai_crm_leads l on l.id = fc.lead_id
    left join public.ai_team_members tm on tm.id = fc.vendedor_id
    where fc.tenant_id = v_tenant
      and fc.status = 'concluido'
      and coalesce(fc.is_internal, false) = false   -- NOVO: nunca conversa interna
      and fc.vendedor_id is not null
      and coalesce(fc.analisado_em, fc.created_at) >= v_inicio_mes
  ),
  normalizado as (
    select
      b.*,
      coalesce((
        select jsonb_agg(
          coalesce(
            nullif(x.item->>'texto', ''),
            nullif(x.item->>'trecho', ''),
            nullif(x.item->>'resumo', ''),
            trim(both '"' from x.item::text)
          )
        )
        from jsonb_array_elements(
          case
            when jsonb_typeof(b.oportunidades_raw) = 'array' then b.oportunidades_raw
            else '[]'::jsonb
          end
        ) as x(item)
      ), '[]'::jsonb) as oportunidades_perdidas
    from base b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'fc_id', n.fc_id,
    'vendedor_id', n.vendedor_id,
    'vendedor_nome', n.vendedor_nome,
    'lead_name', n.lead_name,
    'score', n.score,
    'qualidade_lead', n.qualidade_lead,
    'potencial_compra', n.potencial_compra,
    'temperature', n.temperature,
    'frase_coaching', n.frase_coaching,
    'oportunidades_perdidas', n.oportunidades_perdidas,
    'tempo_resposta_min', n.tempo_resposta_min,
    'houve_venda', n.houve_venda,
    'vehicle_interest', n.vehicle_interest,
    'confianca_analise', n.confianca_analise,
    'motivo_confianca', n.motivo_confianca
  ) order by n.vendedor_nome asc, n.score asc nulls last, n.analisado_em desc), '[]'::jsonb)
  into v_result
  from normalizado n;

  return v_result;
end;
$function$
;

-- ─── public.feedback_produtos_qualidade ───
CREATE OR REPLACE FUNCTION public.feedback_produtos_qualidade(p_dias integer DEFAULT 30, p_ini date DEFAULT NULL::date, p_fim date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_res jsonb; v_ini date; v_fim date;
BEGIN
  IF auth.uid() IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_tenant := public.resolve_billing_owner_user_id(auth.uid());
  IF v_tenant IS NULL THEN RETURN '[]'::jsonb; END IF;

  IF p_ini IS NOT NULL THEN
    v_ini := p_ini;
    v_fim := coalesce(p_fim, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  ELSE
    v_ini := ((now() AT TIME ZONE 'America/Sao_Paulo')::date) - greatest(coalesce(p_dias, 30), 1) + 1;
    v_fim := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  END IF;

  WITH base AS (
    SELECT
      coalesce(fc.qualidade_lead::text, fc.resultado->>'qualidade_lead') AS q,
      lower(trim(coalesce(nullif(trim(fc.produto_interesse), ''), nullif(trim(l.vehicle_interest), '')))) AS pkey,
      coalesce(nullif(trim(fc.produto_interesse), ''), nullif(trim(l.vehicle_interest), '')) AS plabel
    FROM public.feedback_conversas fc
    LEFT JOIN public.ai_crm_leads l ON l.id = fc.lead_id
    WHERE fc.tenant_id = v_tenant AND fc.status = 'concluido'
      AND coalesce(fc.is_internal, false) = false   -- NOVO: nunca conversa interna
      AND coalesce(fc.analisado_em, fc.created_at)::date >= v_ini
      AND coalesce(fc.analisado_em, fc.created_at)::date <= v_fim
  ),
  agg AS (
    SELECT coalesce(pkey, '(nao identificado)') AS pkey,
      coalesce(max(plabel), '(não identificado)') AS produto,
      count(*) AS total,
      count(*) FILTER (WHERE q = '1_alto') AS qualificados,
      count(*) FILTER (WHERE q = '2_medio') AS pouco,
      count(*) FILTER (WHERE q = '3_baixo') AS ruins,
      count(*) FILTER (WHERE q = '4_nao_lead') AS nao_lead,
      count(*) FILTER (WHERE q IS NULL) AS sem_classe
    FROM base GROUP BY coalesce(pkey, '(nao identificado)')
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'produto', produto, 'total', total,
    'qualificados', qualificados, 'pouco_qualificados', pouco, 'ruins', ruins,
    'nao_lead', nao_lead, 'sem_classe', sem_classe,
    'pct_qualificado', CASE WHEN total > 0 THEN round(100.0 * qualificados / total) ELSE 0 END
  ) ORDER BY total DESC, qualificados DESC), '[]'::jsonb)
  INTO v_res FROM agg;
  RETURN v_res;
END; $function$
;

-- ─── public.feedback_nepq_diario_dados ───
CREATE OR REPLACE FUNCTION public.feedback_nepq_diario_dados(p_tenant uuid, p_ref date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH fones_dia AS (
    SELECT DISTINCT
      CASE WHEN length(x.g) > 11 AND left(x.g,2) = '55' THEN substr(x.g,3) ELSE x.g END AS fone
    FROM (
      SELECT regexp_replace(COALESCE(w.phone,''),'[^0-9]','','g') AS g
      FROM public.wa_inbox w
      WHERE w.user_id = p_tenant
        AND (w.created_at AT TIME ZONE 'America/Sao_Paulo')::date = p_ref
    ) x
    WHERE length(x.g) >= 10
  ),
  conv AS (
    SELECT
      c.vendedor_id,
      tm.name AS vendedor_nome,
      COALESCE(p.lead_name, m.name) AS lead_name,
      nullif(c.resultado->>'nepq_score','')::int AS nepq_score,
      c.resultado->>'nepq_semaforo' AS nepq_semaforo,
      c.resultado->>'frase_coaching' AS frase_coaching,
      CASE WHEN length(g.gl) > 11 AND left(g.gl,2) = '55' THEN substr(g.gl,3) ELSE g.gl END AS lead_nac
    FROM public.feedback_conversas c
    LEFT JOIN public.ai_crm_leads p ON c.lead_source = 'pedro' AND p.id = c.lead_id
    LEFT JOIN public.crm_leads m ON c.lead_source = 'marcos' AND m.id = c.lead_id
    LEFT JOIN public.ai_team_members tm ON tm.id = c.vendedor_id
    CROSS JOIN LATERAL (
      SELECT regexp_replace(COALESCE(CASE WHEN c.lead_source='pedro' THEN split_part(p.remote_jid,'@',1) ELSE m.phone END,''),'[^0-9]','','g') AS gl
    ) g
    WHERE c.tenant_id = p_tenant
      AND c.status = 'concluido'
      AND coalesce(c.is_internal, false) = false   -- NOVO: nunca conversa interna
      AND c.resultado ? 'nepq_score'
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'vendedor_id', cv.vendedor_id,
      'vendedor_nome', cv.vendedor_nome,
      'lead_name', cv.lead_name,
      'nepq_score', cv.nepq_score,
      'nepq_semaforo', cv.nepq_semaforo,
      'frase_coaching', cv.frase_coaching
    ) ORDER BY cv.nepq_score NULLS LAST
  ), '[]'::jsonb)
  FROM conv cv
  JOIN fones_dia fd ON fd.fone = cv.lead_nac AND cv.lead_nac <> '';
$function$
;

-- ─── public.feedback_relatorio_diario_dados ───
CREATE OR REPLACE FUNCTION public.feedback_relatorio_diario_dados(p_tenant uuid, p_dias integer DEFAULT 7, p_ref date DEFAULT NULL::date)
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
internos AS (
  SELECT k AS ikey FROM unnest(public.logos_internal_keys(p_tenant)) AS k
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
    AND public.logos_phone_key(split_part(p.remote_jid,'@',1)) NOT IN (SELECT ikey FROM internos)

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
    AND public.logos_phone_key(m.phone) NOT IN (SELECT ikey FROM internos)
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
      AND coalesce(f.is_internal, false) = false
    ORDER BY f.created_at DESC
    LIMIT 1
  ) fc ON true
  LEFT JOIN public.ai_team_members tm
    ON tm.id = COALESCE(fc.vendedor_id, l.vendedor_id)
),
win AS (
  SELECT b.* FROM base b, ref
  WHERE b.dia > ref.d - ref.dias AND b.dia <= ref.d
),
ont AS (
  SELECT b.* FROM base b, ref WHERE b.dia = ref.d
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
$function$
;

-- ─── public.feedback_rollup_recompute ───
CREATE OR REPLACE FUNCTION public.feedback_rollup_recompute()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n int;
begin
  with base as (
    select
      c.id, c.tenant_id, c.vendedor_id,
      date_trunc('month', (coalesce(c.analisado_em, c.created_at) at time zone 'America/Sao_Paulo'))::date as periodo,
      nullif(c.resultado->>'nepq_score','')::numeric as nepq,
      c.veredito::text     as veredito,
      c.qualidade_lead::text as qualidade,
      coalesce(c.rotulagem_incorreta, false) as rotulagem
    from public.feedback_conversas c
    where c.status = 'concluido' and c.vendedor_id is not null
      and coalesce(c.is_internal, false) = false   -- NOVO: nunca conversa interna
  ),
  main as (
    select tenant_id, vendedor_id, periodo,
      count(*)                              as conversas,
      round(avg(nepq), 1)                   as score_medio,
      round(avg((rotulagem)::int)::numeric, 3) as taxa_conflito
    from base group by 1,2,3
  ),
  notas_dim as (
    select b.tenant_id, b.vendedor_id, b.periodo,
      jsonb_object_agg(d.dimensao_cod, d.media order by d.dimensao_cod) as dims
    from base b
    join (
      select b2.id, fd.dimensao_cod, round(avg(fd.nota)::numeric, 2) as media
      from base b2 join public.feedback_dimensoes fd on fd.analise_id = b2.id
      group by b2.id, fd.dimensao_cod
    ) d on d.id = b.id
    group by 1,2,3
  ),
  dv as (
    select tenant_id, vendedor_id, periodo, jsonb_object_agg(veredito, n) as dist
    from (select tenant_id, vendedor_id, periodo, coalesce(veredito,'sem') as veredito, count(*) n
          from base group by 1,2,3,4) x group by 1,2,3
  ),
  dq as (
    select tenant_id, vendedor_id, periodo, jsonb_object_agg(qualidade, n) as dist
    from (select tenant_id, vendedor_id, periodo, coalesce(qualidade,'sem') as qualidade, count(*) n
          from base group by 1,2,3,4) x group by 1,2,3
  ),
  upserted as (
    insert into public.feedback_vendedor_rollup
      (tenant_id, vendedor_id, periodo, conversas, score_medio, notas_por_dimensao,
       taxa_conflito_rotulagem, distribuicao_veredicto, distribuicao_qualidade, updated_at)
    select m.tenant_id, m.vendedor_id, m.periodo, m.conversas, m.score_medio,
           coalesce(nd.dims, '{}'::jsonb), m.taxa_conflito,
           coalesce(dv.dist, '{}'::jsonb), coalesce(dq.dist, '{}'::jsonb), now()
    from main m
    left join notas_dim nd on (nd.tenant_id, nd.vendedor_id, nd.periodo) = (m.tenant_id, m.vendedor_id, m.periodo)
    left join dv on (dv.tenant_id, dv.vendedor_id, dv.periodo) = (m.tenant_id, m.vendedor_id, m.periodo)
    left join dq on (dq.tenant_id, dq.vendedor_id, dq.periodo) = (m.tenant_id, m.vendedor_id, m.periodo)
    on conflict (tenant_id, vendedor_id, periodo) do update set
      conversas = excluded.conversas,
      score_medio = excluded.score_medio,
      notas_por_dimensao = excluded.notas_por_dimensao,
      taxa_conflito_rotulagem = excluded.taxa_conflito_rotulagem,
      distribuicao_veredicto = excluded.distribuicao_veredicto,
      distribuicao_qualidade = excluded.distribuicao_qualidade,
      updated_at = now()
    returning 1
  )
  select count(*) into v_n from upserted;

  delete from public.feedback_vendedor_rollup r
  where not exists (
    select 1 from public.feedback_conversas c
    where c.status='concluido' and c.vendedor_id = r.vendedor_id and c.tenant_id = r.tenant_id
      and coalesce(c.is_internal, false) = false
      and date_trunc('month', (coalesce(c.analisado_em, c.created_at) at time zone 'America/Sao_Paulo'))::date = r.periodo
  );

  return v_n;
end;
$function$
;

-- ─── public.feedback_rollup_por_vendedor ───
CREATE OR REPLACE FUNCTION public.feedback_rollup_por_vendedor()
 RETURNS SETOF feedback_vendedor_rollup
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select *
  from public.feedback_vendedor_rollup
  where tenant_id = public.resolve_billing_owner_user_id(auth.uid())
  order by vendedor_id, periodo desc;
$function$
;

-- ─── public.feedback_status_operacional ───
CREATE OR REPLACE FUNCTION public.feedback_status_operacional(p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_res jsonb;
BEGIN
  v_tenant := COALESCE(p_tenant, public.resolve_billing_owner_user_id(auth.uid()));
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tenant nao resolvido');
  END IF;

  WITH janela AS (SELECT now() - interval '7 days' AS ini),
  analises AS (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE status='concluido') AS concluidas,
      count(*) FILTER (WHERE status='falhou') AS falharam,
      count(*) FILTER (WHERE status='processando') AS processando,
      count(*) FILTER (WHERE lead_source='pedro') AS pedro,
      count(*) FILTER (WHERE lead_source='marcos') AS marcos,
      max(analisado_em) AS ultima
    FROM public.feedback_conversas fc, janela j
    WHERE fc.tenant_id = v_tenant AND fc.created_at >= j.ini
  ),
  trans AS (
    SELECT count(*) AS total, count(*) FILTER (WHERE ok) AS ok, count(*) FILTER (WHERE NOT ok) AS falhas
    FROM public.feedback_transcricoes ft
    JOIN public.wa_inbox w ON w.id = ft.message_id
    CROSS JOIN janela j
    WHERE w.user_id = v_tenant AND COALESCE(ft.updated_at, w.created_at) >= j.ini
  ),
  jobs AS (
    SELECT count(*) AS total, count(*) FILTER (WHERE jl.status::text = 'falhou') AS falhas
    FROM public.feedback_job_log jl, janela j
    WHERE jl.tenant_id = v_tenant AND jl.created_at >= j.ini
  ),
  rels AS (
    SELECT count(*) AS total, max(enviado_em) AS ultimo_envio,
           count(*) FILTER (WHERE fr.status::text IN ('falhou','erro')) AS falhas
    FROM public.feedback_relatorios fr, janela j
    WHERE fr.tenant_id = v_tenant AND COALESCE(fr.enviado_em, fr.data_ref::timestamptz) >= j.ini
  ),
  pend AS (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE lead_source='pedro') AS pedro,
      count(*) FILTER (WHERE lead_source='marcos') AS marcos
    FROM public.feedback_leads_pendentes(1000, 6)
    WHERE tenant_id = v_tenant
  )
  SELECT jsonb_build_object(
    'ok', true,
    'tenant_id', v_tenant,
    'janela_dias', 7,
    'analises', (SELECT to_jsonb(a) FROM analises a),
    'transcricoes', (SELECT to_jsonb(t) FROM trans t),
    'jobs', (SELECT to_jsonb(j) FROM jobs j),
    'relatorios', (SELECT to_jsonb(r) FROM rels r),
    'pendentes', (SELECT to_jsonb(pp) FROM pend pp),
    'pendentes_estimados', (SELECT total FROM pend),
    'ultima_analise', (SELECT ultima FROM analises),
    'rotina', CASE
        WHEN (SELECT falharam FROM analises) > 0
          OR (SELECT falhas FROM jobs) > 0
          OR (SELECT falhas FROM rels) > 0
          OR (SELECT ultima FROM analises) IS NULL
          OR (SELECT ultima FROM analises) < now() - interval '36 hours'
        THEN 'alerta' ELSE 'saudavel' END,
    'rotina_motivo', CASE
        WHEN (SELECT falharam FROM analises) > 0 THEN 'ha analises que falharam na janela'
        WHEN (SELECT falhas FROM jobs) > 0 THEN 'ha jobs com falha'
        WHEN (SELECT falhas FROM rels) > 0 THEN 'ha relatorio com falha'
        WHEN (SELECT ultima FROM analises) IS NULL THEN 'nenhuma analise na janela'
        WHEN (SELECT ultima FROM analises) < now() - interval '36 hours' THEN 'sem analise ha mais de 36h'
        ELSE 'rotina rodando normalmente' END
  ) INTO v_res;

  RETURN v_res;
END;
$function$
;

-- ─── public.feedback_cost_gate ───
CREATE OR REPLACE FUNCTION public.feedback_cost_gate(p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cap_analises  int;
  v_cap_custo     numeric;
  v_dia           date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_analises_hoje int;
  v_custo_mes     numeric;
BEGIN
  SELECT cap_analises_dia, cap_custo_mes_usd INTO v_cap_analises, v_cap_custo
  FROM public.feedback_config
  WHERE (tenant_id = p_tenant OR tenant_id IS NULL)
  ORDER BY (tenant_id IS NOT NULL) DESC, created_at ASC LIMIT 1;
  v_cap_analises := COALESCE(v_cap_analises, 300);
  v_cap_custo    := COALESCE(v_cap_custo, 30);

  SELECT COALESCE(analises,0) INTO v_analises_hoje
  FROM public.feedback_uso_custo WHERE tenant_id=p_tenant AND dia_ref=v_dia;
  v_analises_hoje := COALESCE(v_analises_hoje, 0);
  SELECT COALESCE(sum(custo_usd),0) INTO v_custo_mes
  FROM public.feedback_uso_custo
  WHERE tenant_id=p_tenant AND date_trunc('month', dia_ref) = date_trunc('month', v_dia);

  IF v_analises_hoje >= v_cap_analises THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'cap_analises_dia', 'analises_hoje', v_analises_hoje);
  END IF;
  IF v_custo_mes >= v_cap_custo THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'cap_custo_mes_usd', 'custo_mes', v_custo_mes);
  END IF;

  INSERT INTO public.feedback_uso_custo (tenant_id, dia_ref, analises)
  VALUES (p_tenant, v_dia, 1)
  ON CONFLICT (tenant_id, dia_ref) DO UPDATE SET analises = feedback_uso_custo.analises + 1, updated_at = now();

  RETURN jsonb_build_object('allowed', true);
END;
$function$
;

-- ─── public.feedback_instancia_ia ───
CREATE OR REPLACE FUNCTION public.feedback_instancia_ia(p_tenant uuid)
 RETURNS TABLE(instance_id uuid, phone text, api_url text, provider text, token text, purpose text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id, phone_number, api_url, provider, api_key_encrypted, purpose
  from public.wa_instances
  where user_id = p_tenant
    and seller_member_id is null      -- trava dura: nunca numero de vendedor
    and status = 'connected'
    and coalesce(is_active, true)
  order by (purpose = 'agent') desc, last_message_at desc nulls last
  limit 1;
$function$
;

-- ── 3) Recompute do rollup (remove internas ja existentes do feedback_vendedor_rollup) ─
-- feedback_vendedor_rollup e uma TABELA (nao view/matview) populada por
-- feedback_rollup_recompute(); feedback_rollup_por_vendedor apenas a le.
SELECT public.feedback_rollup_recompute();
