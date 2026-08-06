-- =============================================================================
-- Timeline visual das tentativas de transferencia de um lead.
--
-- Somente leitura: nao escolhe vendedor, nao confirma, nao expira e nao altera
-- prazo. A UI recebe confirmation_timeout_at persistido pelo motor e mostra o
-- cronometro real, alem das tentativas expiradas/confirmadas em ordem.
-- =============================================================================

drop function if exists public.get_lead_transfer_timeline(uuid);

create function public.get_lead_transfer_timeline(p_lead_id uuid)
returns table(
  transfer_id uuid,
  transfer_status text,
  is_confirmed boolean,
  transfer_created_at timestamptz,
  confirmation_timeout_at timestamptz,
  confirmed_at timestamptz,
  to_member_id uuid,
  seller_name text,
  transfer_reason text,
  server_now timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_tenant uuid;
  v_is_manager boolean := false;
  v_member_ids uuid[] := '{}';
  v_lead public.ai_crm_leads%rowtype;
begin
  if v_uid is null then return; end if;

  select p.role into v_role
  from public.profiles p
  where p.id = v_uid;

  if coalesce(public.is_current_user_superadmin(), false) then
    select l.* into v_lead
    from public.ai_crm_leads l
    where l.id = p_lead_id;
    if not found then return; end if;
    v_tenant := v_lead.user_id;
  elsif coalesce(v_role, '') = 'seller' then
    v_tenant := public.get_seller_master_user_id();

    select coalesce(array_agg(m.id), '{}'::uuid[]),
           coalesce(bool_or(coalesce(m.is_manager, false)), false)
      into v_member_ids, v_is_manager
    from public.ai_team_members m
    where m.auth_user_id = v_uid
      and m.user_id = v_tenant
      and coalesce(m.active_in_system, true) <> false
      and m.removed_at is null;

    select l.* into v_lead
    from public.ai_crm_leads l
    where l.id = p_lead_id
      and l.user_id = v_tenant;
    if not found then return; end if;

    if not v_is_manager
       and not (
         v_lead.assigned_to_id = any(v_member_ids)
         or exists (
           select 1
           from public.ai_lead_transfers visible_transfer
           where visible_transfer.user_id = v_tenant
             and visible_transfer.lead_id = p_lead_id
             and visible_transfer.to_member_id = any(v_member_ids)
             and visible_transfer.transfer_status in ('pending', 'confirmed')
         )
       ) then
      return;
    end if;
  else
    v_tenant := v_uid;
    select l.* into v_lead
    from public.ai_crm_leads l
    where l.id = p_lead_id
      and l.user_id = v_tenant;
    if not found then return; end if;
  end if;

  if v_lead.id is null or v_tenant is null then return; end if;

  return query
  select timeline.transfer_id,
         timeline.transfer_status,
         timeline.is_confirmed,
         timeline.transfer_created_at,
         timeline.confirmation_timeout_at,
         timeline.confirmed_at,
         timeline.to_member_id,
         timeline.seller_name,
         timeline.transfer_reason,
         now()
  from (
    select t.id as transfer_id,
           case
             when coalesce(t.is_confirmed, false) = true or t.transfer_status = 'confirmed' then 'confirmed'
             else coalesce(t.transfer_status, 'closed')
           end as transfer_status,
           coalesce(t.is_confirmed, false) as is_confirmed,
           t.created_at as transfer_created_at,
           t.confirmation_timeout_at,
           t.confirmed_at,
           t.to_member_id,
           coalesce(m.name, 'Vendedor') as seller_name,
           t.transfer_reason
    from public.ai_lead_transfers t
    left join public.ai_team_members m
      on m.id = t.to_member_id
     and m.user_id = v_tenant
    where t.user_id = v_tenant
      and t.lead_id = p_lead_id
    order by t.created_at desc
    limit 50
  ) timeline
  order by timeline.transfer_created_at asc;
end
$function$;

comment on function public.get_lead_transfer_timeline(uuid) is
  'Timeline read-only das tentativas de transferencia. O prazo exibido vem de confirmation_timeout_at, autoridade persistida pelo motor.';

revoke all on function public.get_lead_transfer_timeline(uuid) from public, anon;
grant execute on function public.get_lead_transfer_timeline(uuid) to authenticated, service_role;
