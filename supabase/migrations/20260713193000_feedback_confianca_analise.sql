-- ============================================================================
-- Feedback — Fase 3 (confiança da análise), passo 1: coluna aditiva.
--
-- Marca quão confiável é CADA análise (alta/media/baixa) conforme a cobertura
-- real da conversa (mensagens IA/vendedor/cliente, áudios transcritos×sem
-- transcrição, imagens). A confiança é calculada em CÓDIGO (analista), de forma
-- determinística — a IA não define isso. Os contadores detalhados ficam no
-- `resultado` (jsonb); aqui só promovemos `confianca_analise` a coluna para
-- filtrar/rollup/badge sem parsear jsonb.
--
-- 100% ADITIVO e retrocompatível: coluna nullable, CHECK aceita NULL, nenhum
-- backfill (as análises antigas ficam NULL até serem reprocessadas). Não toca
-- transferência, follow-up, CRM, atendimento IA nem fila.
-- Aplicado em prod via MCP; este arquivo é o registro local (sem `db push`).
-- ============================================================================

ALTER TABLE public.feedback_conversas
  ADD COLUMN IF NOT EXISTS confianca_analise text;

ALTER TABLE public.feedback_conversas
  DROP CONSTRAINT IF EXISTS feedback_conversas_confianca_analise_chk;
ALTER TABLE public.feedback_conversas
  ADD CONSTRAINT feedback_conversas_confianca_analise_chk
  CHECK (confianca_analise IS NULL OR confianca_analise IN ('alta','media','baixa'));

CREATE INDEX IF NOT EXISTS idx_feedback_conversas_tenant_confianca
  ON public.feedback_conversas (tenant_id, confianca_analise);

COMMENT ON COLUMN public.feedback_conversas.confianca_analise IS
  'Confianca da analise (alta|media|baixa) calculada pelo analista a partir da cobertura real da conversa. NULL = analise antiga ainda sem calculo. Detalhe dos contadores em resultado->cobertura.';

-- ── feedback_relatorio_dados: expor confianca/cobertura (ADITIVO, Fase 3) ─────
-- Mesma funcao da Fase 2 (canonico + Pedro/Marcos) + 3 chaves novas por linha:
-- confianca_analise (coluna), motivo_confianca e cobertura (do resultado jsonb).
-- Nao altera nenhuma chave existente da saida.
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
    fc.confianca_analise as confianca_analise,
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
    case when length(g.gl) > 11 and left(g.gl,2) = '55' then substr(g.gl,3) else g.gl end as lead_nac,
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
  'instancia_conectada', coalesce(iv.instancia_conectada,false),
  'confianca_analise', b.confianca_analise,
  'motivo_confianca', b.resultado->>'motivo_confianca',
  'cobertura', b.resultado->'cobertura'
) order by b.score asc, b.vendedor_nome asc)
from base b
left join audio a on a.fc_id = b.fc_id
left join msgs m on m.fc_id = b.fc_id
left join inc i on i.fc_id = b.fc_id
left join out_any o on o.fc_id = b.fc_id
left join first_resp fr on fr.fc_id = b.fc_id
left join inst_vend iv on iv.fc_id = b.fc_id;
$function$;
