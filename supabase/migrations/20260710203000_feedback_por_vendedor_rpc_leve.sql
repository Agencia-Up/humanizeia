-- Feedbacks > Por vendedor: versao leve para o painel.
-- Motivo: a RPC antiga reutilizava feedback_relatorio_dados(), que monta o PDF
-- completo e varre wa_inbox varias vezes. Na tela isso causava timeout.
-- Esta funcao retorna apenas os campos necessarios para o dashboard por vendedor.

create or replace function public.feedback_relatorio_por_vendedor()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
    'vehicle_interest', n.vehicle_interest
  ) order by n.vendedor_nome asc, n.score asc nulls last, n.analisado_em desc), '[]'::jsonb)
  into v_result
  from normalizado n;

  return v_result;
end;
$$;

comment on function public.feedback_relatorio_por_vendedor() is
  'Feedbacks > Por vendedor (frontend master). Retorna resumo mensal leve por conversa, sem varrer wa_inbox/PDF.';

revoke all on function public.feedback_relatorio_por_vendedor() from public;
revoke all on function public.feedback_relatorio_por_vendedor() from anon;
grant execute on function public.feedback_relatorio_por_vendedor() to authenticated;

create index if not exists idx_feedback_conversas_tenant_status_vendedor_mes
  on public.feedback_conversas (tenant_id, status, vendedor_id, (coalesce(analisado_em, created_at)) desc)
  where status = 'concluido' and vendedor_id is not null;
