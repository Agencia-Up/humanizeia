-- Feedback 10/10: fecha as fontes que ainda estavam incompletas.
--
-- Escopo seguro:
-- - somente leitura, analise e relatorio;
-- - nao altera transferencia, fila, follow-up, CRM operacional ou envio ao vendedor;
-- - unifica Pedro + Marcos nas fontes que ainda dependiam so de ai_crm_leads.

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
  WITH candidatos AS (
    SELECT
      'pedro'::text AS lead_source,
      l.id AS lead_id,
      l.user_id AS tenant_id,
      COALESCE(l.last_interaction_at, l.created_at) AS sort_at
    FROM public.ai_crm_leads l
    JOIN public.feedback_config c
      ON c.tenant_id = l.user_id
     AND COALESCE((c.feature_flags->>'analise')::boolean, false) IS TRUE
    WHERE COALESCE(l.last_interaction_at, l.created_at) <
          now() - make_interval(hours => GREATEST(COALESCE(p_horas, 6), 1))
      AND COALESCE(l.last_interaction_at, l.created_at) >= date_trunc('month', now())
      AND EXISTS (
        SELECT 1
        FROM public.wa_inbox w
        WHERE w.user_id = l.user_id
          AND right(regexp_replace(COALESCE(w.phone, ''), '[^0-9]', '', 'g'), 8)
            = right(regexp_replace(split_part(COALESCE(l.remote_jid, ''), '@', 1), '[^0-9]', '', 'g'), 8)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.feedback_conversas f
        WHERE f.lead_source = 'pedro'
          AND f.lead_id = l.id
          AND f.versao_thread = 'v1'
          AND f.status IN ('concluido', 'processando')
      )

    UNION ALL

    SELECT
      'marcos'::text AS lead_source,
      m.id AS lead_id,
      m.user_id AS tenant_id,
      COALESCE(m.updated_at, m.created_at) AS sort_at
    FROM public.crm_leads m
    JOIN public.feedback_config c
      ON c.tenant_id = m.user_id
     AND COALESCE((c.feature_flags->>'analise')::boolean, false) IS TRUE
    WHERE COALESCE(m.updated_at, m.created_at) <
          now() - make_interval(hours => GREATEST(COALESCE(p_horas, 6), 1))
      AND COALESCE(m.updated_at, m.created_at) >= date_trunc('month', now())
      -- O feedback de vendedor precisa de um responsavel real. Se assigned_to
      -- estiver legado em texto livre, evita criar analise sem vendedor UUID.
      AND COALESCE(m.assigned_to, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1
        FROM public.wa_inbox w
        WHERE w.user_id = m.user_id
          AND right(regexp_replace(COALESCE(w.phone, ''), '[^0-9]', '', 'g'), 8)
            = right(regexp_replace(COALESCE(m.phone, ''), '[^0-9]', '', 'g'), 8)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.feedback_conversas f
        WHERE f.lead_source = 'marcos'
          AND f.lead_id = m.id
          AND f.versao_thread = 'v1'
          AND f.status IN ('concluido', 'processando')
      )
  )
  SELECT c.lead_source, c.lead_id, c.tenant_id
  FROM candidatos c
  ORDER BY c.sort_at DESC NULLS LAST
  LIMIT GREATEST(COALESCE(p_limit, 20), 1);
$function$;

COMMENT ON FUNCTION public.feedback_leads_pendentes(integer, integer) IS
  'Fonte do batch do feedback-analista. Unifica Pedro e Marcos sem analisar lead sem vendedor valido.';

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
  SELECT COALESCE(p_ref, ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 1)) AS d
),
base AS (
  SELECT
    (COALESCE(p.created_at, m.created_at, fc.created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
    COALESCE(tm.name, '(sem vendedor)') AS vendedor,
    fc.score_atendimento AS score,
    ((fc.resultado->>'houve_venda') = 'true' OR fc.veredito = 'venda_realizada') AS vendeu,
    CASE
      WHEN fc.qualidade_lead = '1_alto' THEN 'forte'
      WHEN fc.qualidade_lead = '2_medio' THEN 'bom'
      WHEN fc.qualidade_lead = '3_baixo' THEN 'dificil'
      WHEN fc.qualidade_lead = '4_nao_lead' THEN 'nao'
      WHEN lower(COALESCE(fc.resultado->>'potencial_compra', '')) = 'alto' THEN 'forte'
      WHEN lower(COALESCE(fc.resultado->>'potencial_compra', '')) = 'medio' THEN 'bom'
      WHEN lower(COALESCE(fc.resultado->>'potencial_compra', '')) = 'baixo' THEN 'dificil'
      WHEN lower(COALESCE(fc.resultado->>'potencial_compra', '')) = 'nao_lead' THEN 'nao'
      WHEN fc.lead_source = 'pedro' AND lower(COALESCE(p.temperature, '')) = 'quente' THEN 'bom'
      WHEN fc.lead_source = 'pedro' AND lower(COALESCE(p.temperature, '')) = 'frio' THEN 'dificil'
      ELSE 'sem'
    END AS pot
  FROM public.feedback_conversas fc
  LEFT JOIN public.ai_crm_leads p
    ON fc.lead_source = 'pedro' AND p.id = fc.lead_id
  LEFT JOIN public.crm_leads m
    ON fc.lead_source = 'marcos' AND m.id = fc.lead_id
  LEFT JOIN public.ai_team_members tm
    ON tm.id = fc.vendedor_id
  WHERE fc.tenant_id = p_tenant
    AND fc.status = 'concluido'
),
win AS (
  SELECT b.*
  FROM base b, ref
  WHERE b.dia > ref.d - GREATEST(COALESCE(p_dias, 7), 1)
    AND b.dia <= ref.d
),
ont AS (
  SELECT b.*
  FROM base b, ref
  WHERE b.dia = ref.d
)
SELECT jsonb_build_object(
  'ref_date', (SELECT d FROM ref),
  'dias', GREATEST(COALESCE(p_dias, 7), 1),
  'ontem', jsonb_build_object(
    'chegaram',      (SELECT count(*) FROM ont),
    'qualificados',  (SELECT count(*) FROM ont WHERE pot IN ('forte', 'bom')),
    'bem_atendidos', (SELECT count(*) FROM ont WHERE pot IN ('forte', 'bom') AND score >= 50),
    'vendas',        (SELECT count(*) FROM ont WHERE vendeu)
  ),
  'funil', jsonb_build_object(
    'chegaram',      (SELECT count(*) FROM win),
    'qualificados',  (SELECT count(*) FROM win WHERE pot IN ('forte', 'bom')),
    'bem_atendidos', (SELECT count(*) FROM win WHERE pot IN ('forte', 'bom') AND score >= 50),
    'vendas',        (SELECT count(*) FROM win WHERE vendeu),
    'nao_eram',      (SELECT count(*) FROM win WHERE pot = 'nao'),
    'dificeis',      (SELECT count(*) FROM win WHERE pot = 'dificil'),
    'sem_dados',     (SELECT count(*) FROM win WHERE pot = 'sem')
  ),
  'vendedores', COALESCE((
    SELECT jsonb_agg(v ORDER BY (v->>'recebeu')::int DESC, v->>'nome')
    FROM (
      SELECT jsonb_build_object(
        'nome', vendedor,
        'recebeu', count(*),
        'com_interesse', count(*) FILTER (WHERE pot IN ('forte', 'bom')),
        'bem_atendidos', count(*) FILTER (WHERE pot IN ('forte', 'bom') AND score >= 50),
        'vendas', count(*) FILTER (WHERE vendeu),
        'score_medio', COALESCE(round(avg(score)), 0)
      ) AS v
      FROM win
      WHERE vendedor <> '(sem vendedor)'
      GROUP BY vendedor
    ) s
  ), '[]'::jsonb)
);
$function$;

COMMENT ON FUNCTION public.feedback_relatorio_diario_dados(uuid, integer, date) IS
  'Fonte do relatorio diario/PDF simplificado. Conta Pedro e Marcos pela tabela de origem correta.';

CREATE OR REPLACE FUNCTION public.feedback_relatorio_dados(p_tenant uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET statement_timeout TO '30s'
AS $function$
WITH base AS (
  SELECT
    fc.id AS fc_id,
    fc.lead_source,
    fc.lead_id,
    fc.vendedor_id,
    fc.score_atendimento::numeric AS score,
    fc.resultado AS resultado,
    tm.name AS vendedor_nome,
    tm.whatsapp_number AS vendedor_fone,
    COALESCE(p.lead_name, m.name, 'Lead') AS lead_name,
    COALESCE(p.remote_jid, CASE WHEN COALESCE(m.phone, '') <> '' THEN regexp_replace(m.phone, '[^0-9]', '', 'g') || '@s.whatsapp.net' END) AS remote_jid,
    p.temperature,
    COALESCE(
      NULLIF(trim(fc.produto_interesse), ''),
      NULLIF(trim(p.vehicle_interest), ''),
      NULLIF(trim(m.vehicle_interest), ''),
      NULLIF(trim(m.consignado_modelo), '')
    ) AS vehicle_interest,
    COALESCE(NULLIF(trim(p.ad_name), ''), NULLIF(trim(m.utm_campaign), ''), NULLIF(trim(m.source), '')) AS ad_name,
    COALESCE(NULLIF(trim(p.campaign_name), ''), NULLIF(trim(m.utm_campaign), ''), NULLIF(trim(m.source), '')) AS campaign_name,
    COALESCE(p.created_at, m.created_at, fc.created_at) AS lead_created_at,
    right(regexp_replace(COALESCE(p.remote_jid, m.phone, ''), '[^0-9]', '', 'g'), 8) AS tail8
  FROM public.feedback_conversas fc
  LEFT JOIN public.ai_crm_leads p
    ON fc.lead_source = 'pedro' AND p.id = fc.lead_id
  LEFT JOIN public.crm_leads m
    ON fc.lead_source = 'marcos' AND m.id = fc.lead_id
  LEFT JOIN public.ai_team_members tm
    ON tm.id = fc.vendedor_id
  WHERE fc.tenant_id = p_tenant
    AND fc.status = 'concluido'
),
audio AS (
  SELECT
    b.fc_id,
    count(*) FILTER (WHERE w.message_type = 'audio' AND w.direction = 'outgoing') AS audios_vendedor,
    count(*) FILTER (WHERE w.message_type = 'audio' AND w.direction = 'outgoing' AND t.message_id IS NOT NULL) AS audios_transcritos
  FROM base b
  JOIN public.wa_inbox w
    ON w.user_id = p_tenant
   AND right(regexp_replace(COALESCE(w.phone, ''), '[^0-9]', '', 'g'), 8) = b.tail8
   AND b.tail8 <> ''
  LEFT JOIN public.feedback_transcricoes t
    ON t.message_id = w.id
  GROUP BY b.fc_id
),
msgs_ranked AS (
  SELECT
    b.fc_id,
    w.direction,
    w.message_type,
    w.content,
    w.created_at,
    t.texto AS transcricao,
    (inst.id IS NOT NULL AND inst.seller_member_id IS NULL) AS from_ia,
    row_number() OVER (PARTITION BY b.fc_id ORDER BY w.created_at DESC) AS rn
  FROM base b
  JOIN public.wa_inbox w
    ON w.user_id = p_tenant
   AND right(regexp_replace(COALESCE(w.phone, ''), '[^0-9]', '', 'g'), 8) = b.tail8
   AND b.tail8 <> ''
  LEFT JOIN public.feedback_transcricoes t
    ON t.message_id = w.id AND t.ok
  LEFT JOIN public.wa_instances inst
    ON inst.id = w.instance_id
  WHERE COALESCE(w.content, '') NOT LIKE E'\U0001F6A8%'
    AND COALESCE(w.content, '') NOT LIKE '%LEAD REPASSADO%'
    AND COALESCE(w.content, '') NOT LIKE '%LEAD AGUARDANDO REPASSE%'
    AND COALESCE(w.content, '') NOT LIKE '%TRANSFER_NCIA DE LEAD%'
),
msgs AS (
  SELECT
    fc_id,
    jsonb_agg(jsonb_build_object(
      'direction', direction,
      'message_type', message_type,
      'content', content,
      'created_at', created_at,
      'transcricao', transcricao,
      'from_ia', from_ia
    ) ORDER BY created_at ASC) AS ultimas
  FROM (SELECT * FROM msgs_ranked WHERE rn <= 10) s
  GROUP BY fc_id
),
inc AS (
  SELECT b.fc_id, string_agg(lower(COALESCE(w.content, '')), ' | ') AS incoming_txt
  FROM base b
  JOIN public.wa_inbox w
    ON w.user_id = p_tenant
   AND right(regexp_replace(COALESCE(w.phone, ''), '[^0-9]', '', 'g'), 8) = b.tail8
   AND b.tail8 <> ''
   AND w.direction = 'incoming'
  GROUP BY b.fc_id
),
out_any AS (
  SELECT b.fc_id, bool_or(w.direction = 'outgoing') AS tem_outgoing
  FROM base b
  JOIN public.wa_inbox w
    ON w.user_id = p_tenant
   AND right(regexp_replace(COALESCE(w.phone, ''), '[^0-9]', '', 'g'), 8) = b.tail8
   AND b.tail8 <> ''
  GROUP BY b.fc_id
),
ancora AS (
  SELECT
    b.fc_id,
    CASE
      WHEN b.lead_source = 'pedro' THEN COALESCE(
        (SELECT max(COALESCE(t.confirmed_at, t.created_at)) FROM public.ai_lead_transfers t WHERE t.lead_id = b.lead_id),
        b.lead_created_at
      )
      ELSE b.lead_created_at
    END AS t0
  FROM base b
),
first_in AS (
  SELECT b.fc_id, min(w.created_at) AS t_in
  FROM base b
  JOIN ancora an
    ON an.fc_id = b.fc_id
  JOIN public.wa_inbox w
    ON w.user_id = p_tenant
   AND right(regexp_replace(COALESCE(w.phone, ''), '[^0-9]', '', 'g'), 8) = b.tail8
   AND b.tail8 <> ''
   AND w.direction = 'incoming'
   AND (an.t0 IS NULL OR w.created_at >= an.t0)
  GROUP BY b.fc_id
),
first_resp AS (
  SELECT f.fc_id, round(extract(epoch FROM (min(w.created_at) - f.t_in)) / 60)::int AS tempo_min
  FROM first_in f
  JOIN base b
    ON b.fc_id = f.fc_id
  JOIN public.wa_inbox w
    ON w.user_id = p_tenant
   AND right(regexp_replace(COALESCE(w.phone, ''), '[^0-9]', '', 'g'), 8) = b.tail8
   AND w.direction = 'outgoing'
   AND w.created_at > f.t_in
  JOIN public.wa_instances inst
    ON inst.id = w.instance_id
   AND inst.seller_member_id IS NOT NULL
  GROUP BY f.fc_id, f.t_in
),
inst_vend AS (
  SELECT b.fc_id, bool_or(wi.status = 'connected') AS instancia_conectada
  FROM base b
  JOIN public.wa_instances wi
    ON wi.user_id = p_tenant
   AND wi.seller_member_id IS NOT NULL
   AND right(regexp_replace(COALESCE(wi.phone_number, ''), '[^0-9]', '', 'g'), 8)
     = right(regexp_replace(COALESCE(b.vendedor_fone, ''), '[^0-9]', '', 'g'), 8)
   AND COALESCE(b.vendedor_fone, '') <> ''
  GROUP BY b.fc_id
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'fc_id', b.fc_id,
  'lead_source', b.lead_source,
  'lead_id', b.lead_id,
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
  'qualidade_lead', COALESCE(b.resultado->>'qualidade_lead', NULL),
  'potencial_compra', b.resultado->>'potencial_compra',
  'frase_coaching', b.resultado->>'frase_coaching',
  'resumo_executivo', b.resultado->>'resumo_executivo',
  'evidencia_principal', b.resultado->>'evidencia_principal',
  'risco_perda', b.resultado->>'risco_perda',
  'acao_gestor', b.resultado->>'acao_gestor',
  'acao_vendedor', b.resultado->>'acao_vendedor',
  'proxima_pergunta_ideal', b.resultado->>'proxima_pergunta_ideal',
  'oportunidades_perdidas', b.resultado->'oportunidades_perdidas',
  'pontos_fortes', b.resultado->'pontos_fortes',
  'tempo_resposta_min', fr.tempo_min,
  'sinais', b.resultado->'sinais',
  'houve_venda', b.resultado->>'houve_venda',
  'audios_vendedor', COALESCE(a.audios_vendedor, 0),
  'audios_transcritos', COALESCE(a.audios_transcritos, 0),
  'ultimas_msgs', COALESCE(m.ultimas, '[]'::jsonb),
  'incoming_txt', COALESCE(i.incoming_txt, ''),
  'tem_outgoing', COALESCE(o.tem_outgoing, false),
  'instancia_conectada', COALESCE(iv.instancia_conectada, false)
) ORDER BY b.score ASC NULLS LAST, b.vendedor_nome ASC NULLS LAST), '[]'::jsonb)
FROM base b
LEFT JOIN audio a ON a.fc_id = b.fc_id
LEFT JOIN msgs m ON m.fc_id = b.fc_id
LEFT JOIN inc i ON i.fc_id = b.fc_id
LEFT JOIN out_any o ON o.fc_id = b.fc_id
LEFT JOIN first_resp fr ON fr.fc_id = b.fc_id
LEFT JOIN inst_vend iv ON iv.fc_id = b.fc_id;
$function$;

COMMENT ON FUNCTION public.feedback_relatorio_dados(uuid) IS
  'Fonte do PDF completo conversa a conversa. Unificada para Pedro e Marcos.';

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

  WITH janela AS (
    SELECT now() - interval '7 days' AS ini
  ),
  analises AS (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE status = 'concluido') AS concluidas,
      count(*) FILTER (WHERE status = 'falhou') AS falharam,
      count(*) FILTER (WHERE status = 'processando') AS processando,
      count(*) FILTER (WHERE lead_source = 'pedro') AS pedro,
      count(*) FILTER (WHERE lead_source = 'marcos') AS marcos
    FROM public.feedback_conversas fc, janela j
    WHERE fc.tenant_id = v_tenant
      AND fc.created_at >= j.ini
  ),
  trans AS (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE ok) AS ok,
      count(*) FILTER (WHERE NOT ok) AS falhas
    FROM public.feedback_transcricoes ft
    JOIN public.wa_inbox w ON w.id = ft.message_id
    CROSS JOIN janela j
    WHERE w.user_id = v_tenant
      AND COALESCE(ft.updated_at, w.created_at) >= j.ini
  ),
  jobs AS (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE status = 'falhou') AS falhas
    FROM public.feedback_job_log jl, janela j
    WHERE jl.tenant_id = v_tenant
      AND jl.created_at >= j.ini
  ),
  rels AS (
    SELECT
      count(*) AS total,
      max(enviado_em) AS ultimo_envio,
      count(*) FILTER (WHERE status IN ('falhou', 'erro')) AS falhas
    FROM public.feedback_relatorios fr, janela j
    WHERE fr.tenant_id = v_tenant
      AND COALESCE(fr.enviado_em, fr.data_ref::timestamptz) >= j.ini
  )
  SELECT jsonb_build_object(
    'ok', true,
    'tenant_id', v_tenant,
    'janela_dias', 7,
    'analises', (SELECT to_jsonb(a) FROM analises a),
    'transcricoes', (SELECT to_jsonb(t) FROM trans t),
    'jobs', (SELECT to_jsonb(j) FROM jobs j),
    'relatorios', (SELECT to_jsonb(r) FROM rels r),
    'pendentes_estimados', (
      SELECT count(*)
      FROM public.feedback_leads_pendentes(100, 6)
      WHERE tenant_id = v_tenant
    )
  )
  INTO v_res;

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.feedback_status_operacional(uuid) FROM public;
REVOKE ALL ON FUNCTION public.feedback_status_operacional(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.feedback_status_operacional(uuid) TO authenticated;

COMMENT ON FUNCTION public.feedback_status_operacional(uuid) IS
  'Saude do Cerebro de Feedback: analises, falhas, transcricoes, relatorios e pendencias recentes.';
