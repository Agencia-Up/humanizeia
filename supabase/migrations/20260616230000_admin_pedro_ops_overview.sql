-- Painel Administracao / BLOCO 2 (Operacao por agente). RPC SECURITY DEFINER gated por
-- superadmin (mesmo padrao do admin_ia_margem_overview). Devolve, por agente de cliente:
-- carteira de leads (total), leads novos / turnos da IA na janela, transferidos, visitas
-- agendadas e ultima atividade. So contagens/joins (sem regex) -> robusto e barato.
create or replace function public.admin_pedro_ops_overview(p_days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int := greatest(coalesce(p_days, 7), 1);
  v_since timestamptz := now() - (v_days || ' days')::interval;
  v_result jsonb;
begin
  if not public._is_caller_superadmin() then
    raise exception 'forbidden: only platform admins';
  end if;

  select jsonb_build_object(
    'days', v_days,
    'since', v_since,
    'agents', coalesce(jsonb_agg(row_to_json(t) order by t.leads_total desc, t.turnos desc), '[]'::jsonb)
  ) into v_result
  from (
    select
      a.id                                   as agent_id,
      a.name                                 as agent_name,
      coalesce(p.company_name, p.full_name)  as client_name,
      (select count(*) from public.ai_crm_leads l where l.agent_id = a.id)                                    as leads_total,
      (select count(*) from public.ai_crm_leads l where l.agent_id = a.id and l.created_at >= v_since)         as leads_novos,
      (select count(*) from public.ai_crm_leads l where l.agent_id = a.id and l.assigned_to_id is not null)    as com_vendedor,
      (select count(*) from public.ai_crm_leads l where l.agent_id = a.id and l.visit_scheduled_at is not null) as visitas,
      (select count(*) from public.pedro_v2_turn_logs tl
         where tl.agent_id = a.id and tl.dry_run = false and tl.created_at >= v_since)                         as turnos,
      (select max(l.last_interaction_at) from public.ai_crm_leads l where l.agent_id = a.id)                   as ultima_atividade
    from public.wa_ai_agents a
    left join public.profiles p on p.id = a.user_id
    where exists (select 1 from public.ai_crm_leads l where l.agent_id = a.id)
       or exists (select 1 from public.pedro_v2_turn_logs tl where tl.agent_id = a.id and tl.dry_run = false)
  ) t;

  return coalesce(v_result, jsonb_build_object('days', v_days, 'since', v_since, 'agents', '[]'::jsonb));
end;
$$;

revoke all on function public.admin_pedro_ops_overview(int) from public, anon;
grant execute on function public.admin_pedro_ops_overview(int) to authenticated;
