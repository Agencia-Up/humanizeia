-- José — Cabine de Comando / Bloco D (handoff Pedro->José: qualidade de lead por anúncio)
-- O coração da hierarquia de verdade nível 2/3: "de qual anúncio vêm os leads bons".
-- Aditivo e não-destrutivo. Tudo gated em runtime pelo flag jose_feature_flags 'handoff_qualidade'.

-- 1) Colunas de classificação no lead (Pedro grava no fechamento do atendimento)
alter table public.ai_crm_leads
  add column if not exists qualidade_lead text,
  add column if not exists motivo_classificacao text,
  add column if not exists classificado_em timestamptz,
  add column if not exists classificado_por text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ai_crm_leads_qualidade_lead_chk') then
    alter table public.ai_crm_leads
      add constraint ai_crm_leads_qualidade_lead_chk
      check (qualidade_lead is null or qualidade_lead in ('bom','medio','ruim'));
  end if;
end $$;

create index if not exists idx_ai_crm_leads_user_ad        on public.ai_crm_leads(user_id, ad_id);
create index if not exists idx_ai_crm_leads_user_qualidade on public.ai_crm_leads(user_id, qualidade_lead);
create index if not exists idx_ai_crm_leads_user_adname    on public.ai_crm_leads(user_id, ad_name);

-- 2) Backfill do TÍTULO do anúncio (CTWA) nos leads históricos do UAZAPI.
--    A primeira mensagem com ctwa_ad por (user,agent,contato) carrega o title; só
--    preenche onde ad_name está vazio (nunca sobrescreve um nome de anúncio real).
with first_ctwa as (
  select distinct on (h.user_id, h.agent_id, h.remote_jid)
    h.user_id, h.agent_id, h.remote_jid,
    nullif(trim(h.metadata->'ctwa_ad'->>'title'), '') as title
  from public.wa_chat_history h
  where h.metadata ? 'ctwa_ad'
  order by h.user_id, h.agent_id, h.remote_jid, h.created_at asc
)
update public.ai_crm_leads l
set ad_name = fc.title
from first_ctwa fc
where l.user_id = fc.user_id
  and l.agent_id = fc.agent_id
  and l.remote_jid = fc.remote_jid
  and fc.title is not null
  and (l.ad_name is null or l.ad_name = '');

-- 3) View canônica: qualidade de lead por anúncio, com degradação ad_id -> título.
--    security_invoker => respeita a RLS de ai_crm_leads por user_id no contexto do chamador.
create or replace view public.lead_quality_by_ad
with (security_invoker = true) as
select
  l.user_id,
  coalesce(nullif(l.ad_id,''), lower(trim(l.ad_name))) as ad_key,
  case
    when nullif(l.ad_id,'')   is not null then 'ad_id'
    when nullif(l.ad_name,'') is not null then 'titulo'
    else 'sem_origem'
  end as ad_key_kind,
  max(nullif(l.ad_id,''))   as ad_id,
  max(nullif(l.ad_name,'')) as ad_name,
  count(*)                                                   as leads_total,
  count(*) filter (where l.qualidade_lead = 'bom')          as leads_bom,
  count(*) filter (where l.qualidade_lead = 'medio')        as leads_medio,
  count(*) filter (where l.qualidade_lead = 'ruim')         as leads_ruim,
  count(*) filter (where l.qualidade_lead is null)          as leads_sem_classificacao,
  round(100.0 * count(*) filter (where l.qualidade_lead = 'bom') / nullif(count(*),0), 1) as pct_bom
from public.ai_crm_leads l
group by 1, 2, 3;

grant select on public.lead_quality_by_ad to authenticated;
