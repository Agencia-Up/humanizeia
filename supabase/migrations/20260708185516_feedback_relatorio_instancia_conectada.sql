-- feedback_relatorio_dados (fonte do relatorio COMPLETO, conversa por conversa).
-- Estado FINAL do dia 08/07 (consolida 3 iteracoes same-day aplicadas via MCP:
-- tempo_real -> tempo_ancora_repasse -> instancia_conectada):
--   * tempo_resposta_min agora e CALCULADO dos timestamps reais do wa_inbox
--     (antes vinha do LLM, que "estimava" e inventava "350 horas"),
--     ancorado no REPASSE do lead ao vendedor (ai_lead_transfers) — nao pune o
--     vendedor pelo periodo em que quem atendia era a IA.
--   * expoe potencial_compra (regua rigida do especialista) pro PDF nao chutar
--     "bom" por padrao.
--   * expoe instancia_conectada: se o numero do vendedor esta desconectado, o PDF
--     diz "nao pude acompanhar" em vez de afirmar "ficou sem responder".
-- Aplicada em prod via MCP em 08/07/2026 (arquivo versionado depois).
CREATE OR REPLACE FUNCTION public.feedback_relatorio_dados(p_tenant uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '30s'
AS $function$
with base as (
  select
    fc.id as fc_id,
    fc.lead_id,
    fc.vendedor_id,
    (fc.score_atendimento)::numeric as score,
    fc.resultado as resultado,
    tm.name as vendedor_nome,
    tm.whatsapp_number as vendedor_fone,
    l.lead_name,
    l.remote_jid,
    l.temperature,
    l.vehicle_interest,
    l.ad_name,
    l.campaign_name,
    l.created_at as lead_created_at,
    right(regexp_replace(coalesce(l.remote_jid,''),'[^0-9]','','g'),8) as tail8
  from feedback_conversas fc
  left join ai_crm_leads l on l.id = fc.lead_id
  left join ai_team_members tm on tm.id = fc.vendedor_id
  where fc.tenant_id = p_tenant and fc.status = 'concluido'
),
audio as (
  select b.fc_id,
    count(*) filter (where w.message_type='audio' and w.direction='outgoing') as audios_vendedor,
    count(*) filter (where w.message_type='audio' and w.direction='outgoing' and t.message_id is not null) as audios_transcritos
  from base b
  join wa_inbox w
    on w.user_id = p_tenant
   and right(regexp_replace(coalesce(w.phone,''),'[^0-9]','','g'),8) = b.tail8
   and b.tail8 <> ''
  left join feedback_transcricoes t on t.message_id = w.id
  group by b.fc_id
),
msgs_ranked as (
  select b.fc_id, w.direction, w.message_type, w.content, w.created_at,
    t.texto as transcricao,
    (inst.id is not null and inst.seller_member_id is null) as from_ia,
    row_number() over (partition by b.fc_id order by w.created_at desc) as rn
  from base b
  join wa_inbox w
    on w.user_id = p_tenant
   and right(regexp_replace(coalesce(w.phone,''),'[^0-9]','','g'),8) = b.tail8
   and b.tail8 <> ''
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
  join wa_inbox w
    on w.user_id = p_tenant
   and right(regexp_replace(coalesce(w.phone,''),'[^0-9]','','g'),8) = b.tail8
   and b.tail8 <> ''
   and w.direction = 'incoming'
  group by b.fc_id
),
out_any as (
  select b.fc_id, bool_or(w.direction='outgoing') as tem_outgoing
  from base b
  join wa_inbox w
    on w.user_id = p_tenant
   and right(regexp_replace(coalesce(w.phone,''),'[^0-9]','','g'),8) = b.tail8
   and b.tail8 <> ''
  group by b.fc_id
),
ancora as (
  select b.fc_id,
    coalesce(
      (select max(coalesce(t.confirmed_at, t.created_at)) from ai_lead_transfers t where t.lead_id = b.lead_id),
      b.lead_created_at
    ) as t0
  from base b
),
first_in as (
  select b.fc_id, min(w.created_at) as t_in
  from base b
  join ancora an on an.fc_id = b.fc_id
  join wa_inbox w
    on w.user_id = p_tenant
   and right(regexp_replace(coalesce(w.phone,''),'[^0-9]','','g'),8) = b.tail8
   and b.tail8 <> ''
   and w.direction = 'incoming'
   and (an.t0 is null or w.created_at >= an.t0)
  group by b.fc_id
),
first_resp as (
  select f.fc_id, round(extract(epoch from (min(w.created_at) - f.t_in))/60)::int as tempo_min
  from first_in f
  join base b on b.fc_id = f.fc_id
  join wa_inbox w
    on w.user_id = p_tenant
   and right(regexp_replace(coalesce(w.phone,''),'[^0-9]','','g'),8) = b.tail8
   and w.direction = 'outgoing'
   and w.created_at > f.t_in
  join wa_instances inst on inst.id = w.instance_id and inst.seller_member_id is not null
  group by f.fc_id, f.t_in
),
inst_vend as (
  select b.fc_id, bool_or(wi.status = 'connected') as instancia_conectada
  from base b
  join wa_instances wi
    on wi.user_id = p_tenant
   and wi.seller_member_id is not null
   and right(regexp_replace(coalesce(wi.phone_number,''),'[^0-9]','','g'),8)
     = right(regexp_replace(coalesce(b.vendedor_fone,''),'[^0-9]','','g'),8)
   and coalesce(b.vendedor_fone,'') <> ''
  group by b.fc_id
)
select jsonb_agg(jsonb_build_object(
  'fc_id', b.fc_id,
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
