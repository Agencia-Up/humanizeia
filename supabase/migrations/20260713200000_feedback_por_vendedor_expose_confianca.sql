-- ============================================================================
-- Feedback — Fase 3 / Passo 7: expor confianca no read-RPC das abas.
--
-- Mudança ADITIVA e só de LEITURA: a feedback_relatorio_por_vendedor (que
-- alimenta as abas "Resumo", "Por vendedor" e, agora, o selo agregado do NEPQ)
-- passa a devolver 2 chaves novas por conversa: `confianca_analise` (coluna) e
-- `motivo_confianca` (do resultado jsonb). Não muda nenhuma chave existente, não
-- toca cálculo/prompt/cron/lógica de análise. Registro local = prod (MCP, sem db push).
--
-- NULL continua NULL (o front não mostra badge para análise antiga sem cálculo).
-- O corpo completo abaixo é exatamente o aplicado em produção.
-- ============================================================================

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
$function$;
