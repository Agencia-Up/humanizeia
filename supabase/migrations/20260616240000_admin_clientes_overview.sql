-- Painel Administracao / BLOCO 3 (Clientes & Agentes). RPC SECURITY DEFINER gated por
-- superadmin. Carteira por agente: status (ativo/pausado), modelo de IA, plano do cliente,
-- e ORIGEM DA CHAVE DE IA (propria/BYOK vs plataforma vs sem-chave) + fonte de estoque.
-- Corte BYOK = 2026-06-16T03:00:00Z (mesmo de aiKeys.ts): conta criada ATE o corte usa a
-- nossa chave (grandfathered); conta nova PRECISA da propria.
create or replace function public.admin_clientes_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := '2026-06-16T03:00:00Z';
  v_result jsonb;
begin
  if not public._is_caller_superadmin() then
    raise exception 'forbidden: only platform admins';
  end if;

  select jsonb_build_object(
    'cutoff', v_cutoff,
    'agents', coalesce(jsonb_agg(row_to_json(t) order by t.is_active desc, t.agent_name), '[]'::jsonb)
  ) into v_result
  from (
    select
      a.id                                   as agent_id,
      a.name                                 as agent_name,
      a.is_active                            as is_active,
      a.model                                as model,
      a.agent_type                           as agent_type,
      a.total_replies                        as total_replies,
      a.created_at                           as agent_created,
      coalesce(p.company_name, p.full_name)  as client_name,
      p.created_at                           as client_created,
      (p.created_at <= v_cutoff)             as grandfathered,
      exists(select 1 from public.user_ai_keys k where k.user_id = a.user_id)                       as has_own_key,
      (select string_agg(distinct k.provider, ',') from public.user_ai_keys k where k.user_id = a.user_id) as own_key_providers,
      (select s.plan_id from public.user_subscriptions s where s.user_id = a.user_id order by s.created_at desc limit 1) as plan_id,
      (select s.status  from public.user_subscriptions s where s.user_id = a.user_id order by s.created_at desc limit 1) as plan_status,
      (select string_agg(distinct pi.platform, ',') from public.platform_integrations pi
         where pi.user_id = a.user_id and pi.is_active is true)                                     as stock_sources
    from public.wa_ai_agents a
    left join public.profiles p on p.id = a.user_id
  ) t;

  return coalesce(v_result, jsonb_build_object('cutoff', v_cutoff, 'agents', '[]'::jsonb));
end;
$$;

revoke all on function public.admin_clientes_overview() from public, anon;
grant execute on function public.admin_clientes_overview() to authenticated;
