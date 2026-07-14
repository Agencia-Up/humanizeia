-- ============================================================================
-- Feedback — correção consolidada da VERDADE dos dados (Fase 2)
--
-- Objetivo: remover o cruzamento frágil por ÚLTIMOS 8 DÍGITOS de telefone como
-- chave oficial de análise/relatório e garantir que Pedro E Marcos sejam lidos
-- corretamente nas RPCs do Cérebro de Feedback.
--
-- Padrão aplicado em todas as funções:
--   • Telefone = número NACIONAL CANÔNICO (mesma lógica do ingestor:
--     tira o prefixo '55' só quando o número tem >11 dígitos; exige >= 10 díg.).
--     NUNCA usar right(...,8) como join oficial. Last-8 só como diagnóstico.
--   • Canônico PRÉ-COMPUTADO em CTEs + JOIN hashável (sem EXISTS correlacionado
--     recalculando regex por linha) — performance.
--   • Pedro (ai_crm_leads = tráfego/IA/SDR) e Marcos (crm_leads = manual/CRM/
--     outros canais) em ramos SEPARADOS, sem misturar conversa.
--
-- Este arquivo é o REGISTRO LOCAL do que já foi aplicado em produção via MCP
-- (idempotente, CREATE OR REPLACE). NÃO rodar `supabase db push` — as funções
-- já existem em prod; este arquivo só reconcilia código × banco (fim do drift).
--
-- Escopo: SOMENTE as 5 funções abaixo. Não toca transferência, follow-up,
-- atendimento IA, CRM operacional, layout ou Edge Functions.
--
-- Tempo de execução medido em prod (conta Icom): leads_pendentes <1s,
-- relatorio_dados ~3,0s, nepq_diario ~0,26s, alertas_pendentes ~0,48s,
-- status_operacional ~0,78s.
-- ============================================================================


-- 1) feedback_leads_pendentes — portão do analista (Pedro + Marcos, canônico) ----
CREATE OR REPLACE FUNCTION public.feedback_leads_pendentes(
  p_limit integer DEFAULT 20,
  p_horas integer DEFAULT 6
)
RETURNS TABLE(lead_source text, lead_id uuid, tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
  WITH tenants AS (
    SELECT c.tenant_id
    FROM public.feedback_config c
    WHERE COALESCE((c.feature_flags->>'analise')::boolean, false) IS TRUE
  ),
  -- número nacional canônico de cada telefone do wa_inbox, calculado UMA vez
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
      -- feedback de vendedor precisa de responsável REAL (UUID); evita analisar lead sem vendedor
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
  ORDER BY c.sort_at DESC NULLS LAST
  LIMIT GREATEST(COALESCE(p_limit,20),1);
$function$;


-- 2) feedback_relatorio_dados — fonte do PDF completo (Pedro + Marcos, canônico) --
CREATE OR REPLACE FUNCTION public.feedback_relatorio_dados(p_tenant uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET statement_timeout TO '30s'
AS $function$
with base as (
  select
    fc.id as fc_id,
    fc.lead_source,
    fc.lead_id,
    fc.vendedor_id,
    (fc.score_atendimento)::numeric as score,
    fc.resultado as resultado,
    tm.name as vendedor_nome,
    tm.whatsapp_number as vendedor_fone,
    coalesce(p.lead_name, m.name) as lead_name,
    coalesce(
      p.remote_jid,
      case when coalesce(m.phone,'') <> '' then regexp_replace(m.phone,'[^0-9]','','g') || '@s.whatsapp.net' end
    ) as remote_jid,
    p.temperature,
    coalesce(nullif(trim(p.vehicle_interest),''), nullif(trim(m.vehicle_interest),''), nullif(trim(m.consignado_modelo),'')) as vehicle_interest,
    coalesce(nullif(trim(p.ad_name),''), nullif(trim(m.utm_campaign),''), nullif(trim(m.source),'')) as ad_name,
    coalesce(nullif(trim(p.campaign_name),''), nullif(trim(m.utm_campaign),''), nullif(trim(m.source),'')) as campaign_name,
    coalesce(p.created_at, m.created_at, fc.created_at) as lead_created_at,
    -- número nacional canônico do LEAD (Pedro: remote_jid ; Marcos: phone), calculado 1x
    case when length(g.gl) > 11 and left(g.gl,2) = '55' then substr(g.gl,3) else g.gl end as lead_nac,
    -- número nacional canônico do VENDEDOR (pra checar instância conectada)
    case when length(g.gv) > 11 and left(g.gv,2) = '55' then substr(g.gv,3) else g.gv end as vendedor_nac
  from feedback_conversas fc
  left join ai_crm_leads p on fc.lead_source = 'pedro' and p.id = fc.lead_id
  left join crm_leads m on fc.lead_source = 'marcos' and m.id = fc.lead_id
  left join ai_team_members tm on tm.id = fc.vendedor_id
  cross join lateral (
    select
      regexp_replace(coalesce(case when fc.lead_source='pedro' then split_part(p.remote_jid,'@',1) else m.phone end,''),'[^0-9]','','g') as gl,
      regexp_replace(coalesce(tm.whatsapp_number,''),'[^0-9]','','g') as gv
  ) g
  where fc.tenant_id = p_tenant and fc.status = 'concluido'
),
-- wa_inbox do tenant com telefone nacional canônico calculado UMA vez
inbox as (
  select iw.id, iw.direction, iw.message_type, iw.content, iw.created_at, iw.instance_id,
    case when length(iw.g) > 11 and left(iw.g,2) = '55' then substr(iw.g,3) else iw.g end as fone_nac
  from (
    select w.id, w.direction, w.message_type, w.content, w.created_at, w.instance_id,
      regexp_replace(coalesce(w.phone,''),'[^0-9]','','g') as g
    from wa_inbox w
    where w.user_id = p_tenant
  ) iw
  where length(iw.g) >= 10
),
audio as (
  select b.fc_id,
    count(*) filter (where w.message_type='audio' and w.direction='outgoing') as audios_vendedor,
    count(*) filter (where w.message_type='audio' and w.direction='outgoing' and t.message_id is not null) as audios_transcritos
  from base b
  join inbox w on w.fone_nac = b.lead_nac and b.lead_nac <> ''
  left join feedback_transcricoes t on t.message_id = w.id
  group by b.fc_id
),
msgs_ranked as (
  select b.fc_id, w.direction, w.message_type, w.content, w.created_at,
    t.texto as transcricao,
    (inst.id is not null and inst.seller_member_id is null) as from_ia,
    row_number() over (partition by b.fc_id order by w.created_at desc) as rn
  from base b
  join inbox w on w.fone_nac = b.lead_nac and b.lead_nac <> ''
  left join feedback_transcricoes t on t.message_id = w.id and t.ok
  left join wa_instances inst on inst.id = w.instance_id
  where coalesce(w.content,'') not like E'\U0001F6A8%'
    and coalesce(w.content,'') not like '%LEAD REPASSADO%'
    and coalesce(w.content,'') not like '%LEAD AGUARDANDO REPASSE%'
    and coalesce(w.content,'') not like '%TRANSFER_NCIA DE LEAD%'
),
msgs as (
  select fc_id,
    jsonb_agg(jsonb_build_object(
      'direction',direction,'message_type',message_type,'content',content,
      'created_at',created_at,'transcricao',transcricao,'from_ia',from_ia
    ) order by created_at asc) as ultimas
  from (select * from msgs_ranked where rn <= 10) s
  group by fc_id
),
inc as (
  select b.fc_id, string_agg(lower(coalesce(w.content,'')), ' | ') as incoming_txt
  from base b
  join inbox w on w.fone_nac = b.lead_nac and b.lead_nac <> '' and w.direction = 'incoming'
  group by b.fc_id
),
out_any as (
  select b.fc_id, bool_or(w.direction='outgoing') as tem_outgoing
  from base b
  join inbox w on w.fone_nac = b.lead_nac and b.lead_nac <> ''
  group by b.fc_id
),
ancora as (
  select b.fc_id,
    case when b.lead_source = 'pedro' then coalesce(
      (select max(coalesce(t.confirmed_at, t.created_at)) from ai_lead_transfers t where t.lead_id = b.lead_id),
      b.lead_created_at
    ) else b.lead_created_at end as t0
  from base b
),
first_in as (
  select b.fc_id, min(w.created_at) as t_in
  from base b
  join ancora an on an.fc_id = b.fc_id
  join inbox w on w.fone_nac = b.lead_nac and b.lead_nac <> '' and w.direction = 'incoming'
   and (an.t0 is null or w.created_at >= an.t0)
  group by b.fc_id
),
first_resp as (
  select f.fc_id, round(extract(epoch from (min(w.created_at) - f.t_in))/60)::int as tempo_min
  from first_in f
  join base b on b.fc_id = f.fc_id
  join inbox w on w.fone_nac = b.lead_nac and b.lead_nac <> '' and w.direction = 'outgoing' and w.created_at > f.t_in
  join wa_instances inst on inst.id = w.instance_id and inst.seller_member_id is not null
  group by f.fc_id, f.t_in
),
inst_vend as (
  select b.fc_id, bool_or(wi.status = 'connected') as instancia_conectada
  from base b
  join wa_instances wi
    on wi.user_id = p_tenant
   and wi.seller_member_id is not null
   and (case when length(regexp_replace(coalesce(wi.phone_number,''),'[^0-9]','','g')) > 11
               and left(regexp_replace(coalesce(wi.phone_number,''),'[^0-9]','','g'),2) = '55'
             then substr(regexp_replace(coalesce(wi.phone_number,''),'[^0-9]','','g'),3)
             else regexp_replace(coalesce(wi.phone_number,''),'[^0-9]','','g') end) = b.vendedor_nac
   and coalesce(b.vendedor_nac,'') <> ''
  group by b.fc_id
)
select jsonb_agg(jsonb_build_object(
  'fc_id', b.fc_id,
  'lead_source', b.lead_source,
  'vendedor_id', b.vendedor_id,
  'vendedor_nome', b.vendedor_nome,
  'lead_name', b.lead_name,
  'remote_jid', b.remote_jid,
  'temperature', b.temperature,
  'vehicle_interest', b.vehicle_interest,
  'ad_name', b.ad_name,
  'campaign_name', b.campaign_name,
  'lead_created_at', b.lead_created_at,
  'score', b.score,
  'qualidade_lead', b.resultado->>'qualidade_lead',
  'potencial_compra', b.resultado->>'potencial_compra',
  'frase_coaching', b.resultado->>'frase_coaching',
  'oportunidades_perdidas', b.resultado->'oportunidades_perdidas',
  'pontos_fortes', b.resultado->'pontos_fortes',
  'tempo_resposta_min', fr.tempo_min,
  'sinais', b.resultado->'sinais',
  'houve_venda', b.resultado->>'houve_venda',
  'audios_vendedor', coalesce(a.audios_vendedor,0),
  'audios_transcritos', coalesce(a.audios_transcritos,0),
  'ultimas_msgs', coalesce(m.ultimas, '[]'::jsonb),
  'incoming_txt', coalesce(i.incoming_txt,''),
  'tem_outgoing', coalesce(o.tem_outgoing,false),
  'instancia_conectada', coalesce(iv.instancia_conectada,false)
) order by b.score asc, b.vendedor_nome asc)
from base b
left join audio a on a.fc_id = b.fc_id
left join msgs m on m.fc_id = b.fc_id
left join inc i on i.fc_id = b.fc_id
left join out_any o on o.fc_id = b.fc_id
left join first_resp fr on fr.fc_id = b.fc_id
left join inst_vend iv on iv.fc_id = b.fc_id;
$function$;


-- 3) feedback_nepq_diario_dados — resumo NEPQ diário (Pedro + Marcos, canônico) --
CREATE OR REPLACE FUNCTION public.feedback_nepq_diario_dados(p_tenant uuid, p_ref date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH fones_dia AS (
    -- telefones (nacional canônico) que tiveram atividade no wa_inbox NA data p_ref
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
$function$;


-- 4) feedback_alertas_pendentes — "bom cliente em risco" (Pedro + Marcos, canônico)
CREATE OR REPLACE FUNCTION public.feedback_alertas_pendentes(p_tenant uuid)
RETURNS TABLE(conversa_id uuid, lead_nome text, veiculo text, vendedor_nome text, telefone text, ultimo_contato text, tem_troca boolean, tem_entrada boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH inbox_ultimo AS (
    -- último contato por telefone nacional canônico (pré-computado 1x)
    SELECT z.fone, max(z.created_at) AS ultimo
    FROM (
      SELECT CASE WHEN length(w.g) > 11 AND left(w.g,2) = '55' THEN substr(w.g,3) ELSE w.g END AS fone,
             w.created_at
      FROM (
        SELECT regexp_replace(COALESCE(phone,''),'[^0-9]','','g') AS g, created_at
        FROM public.wa_inbox
        WHERE user_id = p_tenant
      ) w
      WHERE length(w.g) >= 10
    ) z
    GROUP BY z.fone
  ),
  c AS (
    SELECT fc.id,
      COALESCE(p.remote_jid,
        CASE WHEN COALESCE(m.phone,'') <> '' THEN regexp_replace(m.phone,'[^0-9]','','g') || '@s.whatsapp.net' END
      ) AS remote_jid,
      CASE WHEN length(g.gl) > 11 AND left(g.gl,2) = '55' THEN substr(g.gl,3) ELSE g.gl END AS lead_nac,
      COALESCE(NULLIF(trim(p.lead_name),''), NULLIF(trim(m.name),''), 'Cliente') AS lead_nome,
      left(COALESCE(NULLIF(trim(p.vehicle_interest),''), NULLIF(trim(m.vehicle_interest),''), NULLIF(trim(m.consignado_modelo),''), ''), 24) AS veiculo,
      nullif(trim(tm.name),'') AS vendedor_nome,
      fc.score_atendimento AS score,
      ((fc.resultado->>'houve_venda')='true' OR fc.veredito='venda_realizada') AS vendeu,
      CASE
        WHEN fc.qualidade_lead IN ('1_alto','2_medio') THEN true
        WHEN lower(coalesce(fc.resultado->>'potencial_compra','')) IN ('alto','medio') THEN true
        WHEN lower(coalesce(p.temperature,'')) = 'quente' THEN true
        ELSE false
      END AS bom,
      coalesce((fc.resultado->'sinais'->>'carro_na_troca')::boolean, false) AS troca,
      coalesce((fc.resultado->'sinais'->>'tem_entrada')::boolean, false) AS entrada
    FROM public.feedback_conversas fc
    LEFT JOIN public.ai_crm_leads p ON fc.lead_source = 'pedro' AND p.id = fc.lead_id
    LEFT JOIN public.crm_leads m ON fc.lead_source = 'marcos' AND m.id = fc.lead_id
    JOIN public.ai_team_members tm ON tm.id = fc.vendedor_id
    CROSS JOIN LATERAL (
      SELECT regexp_replace(COALESCE(CASE WHEN fc.lead_source='pedro' THEN split_part(p.remote_jid,'@',1) ELSE m.phone END,''),'[^0-9]','','g') AS gl
    ) g
    WHERE fc.tenant_id = p_tenant AND fc.status = 'concluido'
      AND fc.vendedor_id IS NOT NULL
      AND fc.analisado_em >= now() - interval '2 days'
      AND NOT EXISTS (SELECT 1 FROM public.feedback_alertas a WHERE a.feedback_conversa_id = fc.id)
  )
  SELECT c.id,
    c.lead_nome,
    c.veiculo,
    c.vendedor_nome,
    regexp_replace(COALESCE(split_part(c.remote_jid,'@',1),''),'[^0-9]','','g') AS telefone,
    to_char(iu.ultimo AT TIME ZONE 'America/Sao_Paulo','HH24:MI') AS ultimo_contato,
    c.troca AS tem_troca,
    c.entrada AS tem_entrada
  FROM c
  LEFT JOIN inbox_ultimo iu ON iu.fone = c.lead_nac AND c.lead_nac <> ''
  WHERE c.bom AND NOT c.vendeu AND coalesce(c.score,0) < 45
  ORDER BY c.score ASC NULLS FIRST
  LIMIT 25;
$function$;


-- 5) feedback_status_operacional — saúde da rotina (NOVA; separa Pedro × Marcos) --
CREATE OR REPLACE FUNCTION public.feedback_status_operacional(p_tenant uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    'pendentes_estimados', (SELECT total FROM pend),          -- compat com o front atual
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
$$;

REVOKE ALL ON FUNCTION public.feedback_status_operacional(uuid) FROM public;
REVOKE ALL ON FUNCTION public.feedback_status_operacional(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.feedback_status_operacional(uuid) TO authenticated;

COMMENT ON FUNCTION public.feedback_status_operacional(uuid) IS
  'Saude do Cerebro de Feedback (janela 7d): analises Pedro/Marcos, falhas, transcricoes, relatorios, pendentes por origem e flag de rotina. Sem cruzamento por last-8.';
