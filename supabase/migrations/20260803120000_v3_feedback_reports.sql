-- ============================================================================
-- Relatórios Pedro v3 — leitura operacional agregada
--
-- A tela de Relatórios antiga lia feedback_conversas/feedback_dimensoes (v2).
-- O Pedro v3 registra a verdade operacional em v3_*; esta RPC adapta esses
-- eventos para o contrato visual existente sem expor raw, payload ou segredos.
-- Nenhuma métrica abaixo é uma análise NEPQ: são sinais observáveis do v3.
-- ============================================================================

create or replace function public.v3_feedback_reports(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_days integer := least(greatest(coalesce(p_days, 30), 7), 90);
  v_start timestamptz;
begin
  if auth.uid() is null then
    return jsonb_build_object(
      'source', 'v3', 'days', v_days, 'conversas', '[]'::jsonb,
      'produtos', '[]'::jsonb, 'rollup', '[]'::jsonb, 'historico', '[]'::jsonb,
      'health', jsonb_build_object('ok', false)
    );
  end if;

  v_tenant := public.resolve_billing_owner_user_id(auth.uid());
  if v_tenant is null then
    return jsonb_build_object(
      'source', 'v3', 'days', v_days, 'conversas', '[]'::jsonb,
      'produtos', '[]'::jsonb, 'rollup', '[]'::jsonb, 'historico', '[]'::jsonb,
      'health', jsonb_build_object('ok', false)
    );
  end if;

  v_start := now() - (v_days::text || ' days')::interval;

  return (
    with state_rows as (
      select
        cs.conversation_id,
        cs.updated_at,
        nullif(cs.lead_id, '') as lead_id,
        l.lead_name,
        l.client_name,
        l.vehicle_interest,
        coalesce(nullif(l.status_crm, ''), nullif(l.status, ''), 'novo') as lead_status,
        l.assigned_to_id as vendedor_id,
        m.name as vendedor_nome
      from public.v3_conversation_state cs
      left join public.ai_crm_leads l
        on l.id::text = cs.lead_id
       and l.user_id = v_tenant
      left join public.ai_team_members m
        on m.id = l.assigned_to_id
       and m.user_id = v_tenant
      where cs.tenant_id = v_tenant
        and cs.updated_at >= v_start
    ),
    conv_metrics as (
      select
        s.*,
        coalesce(i.inbound_count, 0)::integer as inbound_count,
        coalesce(d.decision_count, 0)::integer as decision_count,
        coalesce(d.avg_confidence, 0)::numeric as avg_confidence,
        coalesce(d.brain_unavailable, 0)::integer as brain_unavailable,
        coalesce(d.stock_searches, 0)::integer as stock_searches,
        coalesce(o.outbound_success, 0)::integer as outbound_success,
        coalesce(o.outbound_failed, 0)::integer as outbound_failed,
        coalesce(o.handoffs, 0)::integer as handoffs,
        coalesce(o.schedules, 0)::integer as schedules
      from state_rows s
      left join lateral (
        select count(*)::integer as inbound_count
        from public.v3_inbox x
        where x.tenant_id = v_tenant
          and x.conversation_id = s.conversation_id
          and coalesce(x.received_at, x.created_at) >= v_start
      ) i on true
      left join lateral (
        select
          count(*)::integer as decision_count,
          avg(d.confidence) as avg_confidence,
          count(*) filter (where d.reason_code = 'brain_unavailable')::integer as brain_unavailable,
          count(*) filter (where d.reason_code like 'stock_%' or d.action = 'search_stock')::integer as stock_searches
        from public.v3_decisions d
        where d.tenant_id = v_tenant
          and d.conversation_id = s.conversation_id
          and d.at >= v_start
      ) d on true
      left join lateral (
        select
          count(*) filter (
            where e.kind in ('send_message', 'send_media')
              and e.status = 'succeeded'
              and e.dispatched_at is not null
          )::integer as outbound_success,
          count(*) filter (where e.status in ('failed', 'outcome_uncertain'))::integer as outbound_failed,
          count(*) filter (where e.kind = 'handoff' and e.status = 'succeeded')::integer as handoffs,
          count(*) filter (where e.kind = 'schedule_visit' and e.status = 'succeeded')::integer as schedules
        from public.v3_effect_outbox e
        where e.tenant_id = v_tenant
          and e.conversation_id = s.conversation_id
          and e.created_at >= v_start
      ) o on true
    ),
    convs as (
      select
        c.*,
        case
          when lower(c.lead_status) in ('qualificado', 'negociacao', 'negociação') then '1_alto'
          when lower(c.lead_status) in ('pouco_qualificado', 'pouco qualificado') then '3_baixo'
          when lower(c.lead_status) in ('perdido', 'inativo') then '4_nao_lead'
          when c.lead_id is null then 'sem'
          else '2_medio'
        end as qualidade_lead,
        case
          when lower(c.lead_status) in ('qualificado', 'negociacao', 'negociação') then 'alto'
          when lower(c.lead_status) in ('perdido', 'inativo') then 'baixo'
          else 'medio'
        end as potencial_compra,
        case
          when lower(c.lead_status) in ('qualificado', 'negociacao', 'negociação') then 'quente'
          when lower(c.lead_status) in ('perdido', 'inativo') then 'frio'
          else 'morno'
        end as temperature,
        round((100 * c.avg_confidence)::numeric, 0)::integer as operational_score,
        case
          when c.outbound_failed > 0 then 'alto'
          when c.outbound_success = 0 and c.inbound_count > 0 then 'medio'
          else 'baixo'
        end as risco_perda
      from conv_metrics c
    ),
    conv_json as (
      select jsonb_agg(
        jsonb_build_object(
          'fc_id', c.conversation_id,
          'vendedor_id', c.vendedor_id,
          'vendedor_nome', c.vendedor_nome,
          'lead_name', coalesce(nullif(c.lead_name, ''), nullif(c.client_name, ''), 'Lead v3'),
          'score', c.operational_score,
          'qualidade_lead', c.qualidade_lead,
          'potencial_compra', c.potencial_compra,
          'temperature', c.temperature,
          'frase_coaching', case
            when c.outbound_failed > 0 then 'Revisar os efeitos v3 que falharam antes de concluir o atendimento.'
            when c.outbound_success = 0 and c.inbound_count > 0 then 'Verificar se a próxima resposta foi realmente entregue ao lead.'
            else 'Manter a continuidade e registrar um próximo passo concreto.'
          end,
          'resumo_executivo', format('v3: %s entrada(s), %s decisão(ões) e %s saída(s) entregue(s).', c.inbound_count, c.decision_count, c.outbound_success),
          'evidencia_principal', format('Dados operacionais do v3: %s decisões, confiança média de %s%% e %s efeito(s) com falha.', c.decision_count, c.operational_score, c.outbound_failed),
          'risco_perda', c.risco_perda,
          'acao_gestor', case
            when c.outbound_failed > 0 then 'Abrir os efeitos falhos e conferir o receipt do provedor.'
            when c.outbound_success = 0 and c.inbound_count > 0 then 'Conferir a entrega da resposta e o próximo passo da conversa.'
            else 'Acompanhar a continuidade do atendimento no inbox v3.'
          end,
          'acao_vendedor', 'Usar a conversa e os receipts do v3 para alinhar o próximo passo.',
          'proxima_pergunta_ideal', 'Confirmar o próximo passo comercial sem repetir informações já registradas.',
          'oportunidades_perdidas', case when c.outbound_failed > 0 then jsonb_build_array('Efeito de saída com falha no v3.') else '[]'::jsonb end,
          'tempo_resposta_min', null,
          'houve_venda', null,
          'vehicle_interest', c.vehicle_interest,
          'confianca_analise', null,
          'motivo_confianca', 'Métrica operacional derivada dos eventos e receipts do Pedro v3.'
        ) order by c.updated_at desc
      ) as value
      from convs c
    ),
    product_json as (
      select jsonb_agg(
        jsonb_build_object(
          'produto', p.vehicle_interest,
          'total', p.total,
          'qualificados', p.qualificados,
          'pouco_qualificados', p.pouco_qualificados,
          'ruins', p.ruins,
          'nao_lead', p.nao_lead,
          'sem_classe', p.sem_classe,
          'pct_qualificado', round((100.0 * p.qualificados / nullif(p.total, 0))::numeric, 0)
        ) order by p.total desc, p.vehicle_interest
      ) as value
      from (
        select
          c.vehicle_interest,
          count(*)::integer as total,
          count(*) filter (where c.qualidade_lead = '1_alto')::integer as qualificados,
          count(*) filter (where c.qualidade_lead = '2_medio')::integer as pouco_qualificados,
          count(*) filter (where c.qualidade_lead = '3_baixo')::integer as ruins,
          count(*) filter (where c.qualidade_lead = '4_nao_lead')::integer as nao_lead,
          count(*) filter (where c.qualidade_lead = 'sem')::integer as sem_classe
        from convs c
        where nullif(btrim(c.vehicle_interest), '') is not null
        group by c.vehicle_interest
      ) p
    ),
    rollup_json as (
      select jsonb_agg(
        jsonb_build_object(
          'vendedor_id', r.vendedor_id,
          'vendedor_nome', r.vendedor_nome,
          'periodo', to_char(current_date, 'YYYY-MM'),
          'conversas', r.conversas,
          'score_medio', r.score_medio,
          'notas_por_dimensao', jsonb_build_object(
            'A', r.nota_confianca,
            'B1', r.nota_entrada,
            'B2', r.nota_decisao,
            'B3', r.nota_entrega,
            'B4', r.nota_resultado,
            'B5', r.nota_qualificacao,
            'C', r.nota_estoque,
            'D', r.nota_transferencia,
            'E1', r.nota_disponibilidade,
            'E2', r.nota_continuidade,
            'E3', r.nota_falhas,
            'E4', r.nota_ritmo
          ),
          'taxa_conflito_rotulagem', 0,
          'distribuicao_veredicto', jsonb_build_object(
            'operacao_sucesso', r.sucessos,
            'efeito_falho', r.falhas,
            'sem_veredicto', r.conversas - r.sucessos - r.falhas
          ),
          'distribuicao_qualidade', jsonb_build_object(
            '1_alto', r.altos,
            '2_medio', r.medios,
            '3_baixo', r.baixos,
            '4_nao_lead', r.nao_lead,
            'sem', r.sem_classe
          )
        ) order by r.vendedor_nome
      ) as value
      from (
        select
          c.vendedor_id,
          max(c.vendedor_nome) as vendedor_nome,
          count(*)::integer as conversas,
          round(avg(c.operational_score), 0)::integer as score_medio,
          round(avg(least(4, greatest(0, c.avg_confidence * 4)))::numeric, 2) as nota_confianca,
          round(avg(case when c.inbound_count > 0 then 4 else 0 end)::numeric, 2) as nota_entrada,
          round(avg(case when c.decision_count > 0 then 4 else 0 end)::numeric, 2) as nota_decisao,
          round(avg(case when c.outbound_success > 0 then 4 else 0 end)::numeric, 2) as nota_entrega,
          round(avg(case when c.handoffs + c.schedules > 0 then 4 else 0 end)::numeric, 2) as nota_resultado,
          round(avg(case when c.qualidade_lead = '1_alto' then 4 when c.qualidade_lead = '2_medio' then 3 when c.qualidade_lead = '3_baixo' then 2 when c.qualidade_lead = '4_nao_lead' then 1 else 0 end)::numeric, 2) as nota_qualificacao,
          round(avg(least(4, c.stock_searches))::numeric, 2) as nota_estoque,
          round(avg(case when c.handoffs > 0 then 4 else 0 end)::numeric, 2) as nota_transferencia,
          round(avg(case when c.brain_unavailable = 0 then 4 else 1 end)::numeric, 2) as nota_disponibilidade,
          round(avg(least(4, c.decision_count::numeric))::numeric, 2) as nota_continuidade,
          round(avg(case when c.outbound_failed = 0 then 4 else 1 end)::numeric, 2) as nota_falhas,
          round(avg(least(4, c.outbound_success::numeric / greatest(c.inbound_count, 1) * 2))::numeric, 2) as nota_ritmo,
          count(*) filter (where c.outbound_failed = 0 and c.outbound_success > 0)::integer as sucessos,
          count(*) filter (where c.outbound_failed > 0)::integer as falhas,
          count(*) filter (where c.qualidade_lead = '1_alto')::integer as altos,
          count(*) filter (where c.qualidade_lead = '2_medio')::integer as medios,
          count(*) filter (where c.qualidade_lead = '3_baixo')::integer as baixos,
          count(*) filter (where c.qualidade_lead = '4_nao_lead')::integer as nao_lead,
          count(*) filter (where c.qualidade_lead = 'sem')::integer as sem_classe
        from convs c
        where c.vendedor_id is not null
        group by c.vendedor_id
      ) r
    ),
    history_json as (
      select jsonb_agg(
        jsonb_build_object(
          'id', md5('v3:' || d.dia::text)::uuid,
          'data_ref', d.dia,
          'loja', 'Pedro v3',
          'status', case when d.falhas > 0 then 'falhou' else 'processado' end,
          'enviado_em', null,
          'v3', true,
          'resumo', jsonb_build_object(
            'v3', true,
            'ref_date', d.dia,
            'leads_recebidos', d.recebidos,
            'leads_analisados', d.analisados,
            'pendentes_analise', greatest(d.recebidos - d.analisados, 0),
            'leads_qualificados', d.qualificados,
            'por_qualidade', jsonb_build_object(
              '1_alto', d.qualificados,
              'sem', greatest(d.recebidos - d.qualificados, 0)
            ),
            'efeitos_entregues', d.entregues,
            'falhas_v3', d.falhas
          )
        ) order by d.dia desc
      ) as value
      from (
        select
          x.dia,
          count(distinct x.conversation_id) filter (where x.fonte = 'inbox')::integer as recebidos,
          count(distinct x.conversation_id) filter (where x.fonte = 'decision')::integer as analisados,
          count(distinct x.conversation_id) filter (where x.fonte = 'qualified')::integer as qualificados,
          count(*) filter (where x.fonte = 'delivered')::integer as entregues,
          count(*) filter (where x.fonte = 'failed')::integer as falhas
        from (
          select (i.received_at at time zone 'America/Sao_Paulo')::date as dia, i.conversation_id, 'inbox'::text as fonte
          from public.v3_inbox i
          where i.tenant_id = v_tenant and i.received_at >= v_start
          union all
          select (d.at at time zone 'America/Sao_Paulo')::date, d.conversation_id, 'decision'
          from public.v3_decisions d
          where d.tenant_id = v_tenant and d.at >= v_start
          union all
          select (c.updated_at at time zone 'America/Sao_Paulo')::date, c.conversation_id, 'qualified'
          from convs c
          where c.qualidade_lead = '1_alto'
          union all
          select (e.created_at at time zone 'America/Sao_Paulo')::date, e.conversation_id, 'delivered'
          from public.v3_effect_outbox e
          where e.tenant_id = v_tenant and e.created_at >= v_start
            and e.kind in ('send_message', 'send_media') and e.status = 'succeeded' and e.dispatched_at is not null
          union all
          select (e.created_at at time zone 'America/Sao_Paulo')::date, e.conversation_id, 'failed'
          from public.v3_effect_outbox e
          where e.tenant_id = v_tenant and e.created_at >= v_start
            and e.status in ('failed', 'outcome_uncertain')
        ) x
        group by x.dia
      ) d
    )
    select jsonb_build_object(
      'source', 'v3',
      'days', v_days,
      'generated_at', now(),
      'conversas', coalesce((select value from conv_json), '[]'::jsonb),
      'produtos', coalesce((select value from product_json), '[]'::jsonb),
      'rollup', coalesce((select value from rollup_json), '[]'::jsonb),
      'historico', coalesce((select value from history_json), '[]'::jsonb),
      'health', jsonb_build_object(
        'ok', true,
        'analises', jsonb_build_object(
          'total', (select count(*) from convs),
          'concluidas', (select count(*) from convs where decision_count > 0),
          'falharam', (select coalesce(sum(outbound_failed), 0) from convs),
          'processando', 0,
          'pedro', (select count(*) from convs),
          'marcos', 0
        ),
        'transcricoes', jsonb_build_object('total', 0, 'ok', 0, 'falhas', 0),
        'jobs', jsonb_build_object('total', (select count(*) from convs), 'falhas', (select coalesce(sum(outbound_failed), 0) from convs)),
        'relatorios', jsonb_build_object('total', (select count(*) from convs), 'falhas', (select coalesce(sum(outbound_failed), 0) from convs), 'ultimo_envio', null),
        'pendentes_estimados', (select count(*) from convs where inbound_count > 0 and decision_count = 0)
      )
    )
  );
end;
$$;

revoke all on function public.v3_feedback_reports(integer) from public, anon;
grant execute on function public.v3_feedback_reports(integer) to authenticated, service_role;

comment on function public.v3_feedback_reports(integer) is
  'Relatórios do Pedro v3: agrega somente eventos/decisões/receipts tenant-scoped e adapta para a tela de Relatórios.';
