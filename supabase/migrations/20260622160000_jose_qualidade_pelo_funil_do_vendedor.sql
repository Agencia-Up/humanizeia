-- José — Cabine / Integração do FUNIL DO VENDEDOR na qualidade por anúncio.
-- A verdade do vendedor (status do CRM: fechou/perdeu/em negociação) VENCE a
-- classificação da IA do Pedro. Adiciona contagem de VENDAS por anúncio (fechado).
-- seller_feedbacks (estruturado) está vazio hoje; quando popular, entra como camada
-- extra. Por ora o sinal real é o status_crm (que o vendedor/Pedro movimenta no funil).

drop view if exists public.lead_quality_by_ad;
create view public.lead_quality_by_ad
with (security_invoker = true) as
with base as (
  select
    l.user_id,
    coalesce(nullif(l.ad_id,''), lower(trim(l.ad_name))) as ad_key,
    case
      when nullif(l.ad_id,'')   is not null then 'ad_id'
      when nullif(l.ad_name,'') is not null then 'titulo'
      else 'sem_origem'
    end as ad_key_kind,
    nullif(l.ad_id,'')   as ad_id_raw,
    nullif(l.ad_name,'') as ad_name_raw,
    -- QUALIDADE EFETIVA: o desfecho no funil (verdade do vendedor) vence a IA.
    case
      when l.status_crm = 'fechado'                                   then 'venda'
      when l.status_crm in ('negociacao','qualificado','agendamento') then 'bom'
      when l.status_crm in ('em_atendimento','pouco_qualificado','carro_nao_disponivel') then 'medio'
      when l.status_crm in ('perdido','inativo')                      then 'ruim'
      else l.qualidade_lead   -- sem desfecho de funil -> cai na classificação da IA (ou null)
    end as qualidade_efetiva,
    (l.status_crm = 'fechado') as eh_venda
  from public.ai_crm_leads l
)
select
  user_id, ad_key, ad_key_kind,
  max(ad_id_raw)   as ad_id,
  max(ad_name_raw) as ad_name,
  count(*)                                                        as leads_total,
  count(*) filter (where qualidade_efetiva in ('bom','venda'))   as leads_bom,
  count(*) filter (where qualidade_efetiva = 'medio')            as leads_medio,
  count(*) filter (where qualidade_efetiva = 'ruim')             as leads_ruim,
  count(*) filter (where eh_venda)                               as vendas,
  count(*) filter (where qualidade_efetiva is null)              as leads_sem_classificacao,
  round(100.0 * count(*) filter (where qualidade_efetiva in ('bom','venda')) / nullif(count(*),0), 1) as pct_bom
from base
group by user_id, ad_key, ad_key_kind;

grant select on public.lead_quality_by_ad to authenticated;
