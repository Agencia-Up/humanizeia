-- Pausa de IA por conversa, inclusive quando a conversa ainda nao tem lead no CRM.
-- Identidade oficial: tenant + instancia + telefone canonico (ou conversation_id V3).
-- A pausa bloqueia somente automacoes; mensagens e transferencias manuais seguem livres.

alter table public.ai_conversation_index
  add column if not exists ai_paused boolean not null default false,
  add column if not exists ai_paused_at timestamptz,
  add column if not exists ai_paused_by uuid,
  add column if not exists pause_reason text;

alter table public.ai_pause_audit
  add column if not exists conversation_id uuid;

create index if not exists ai_pause_audit_conversation_idx
  on public.ai_pause_audit (conversation_id, created_at desc);

create or replace function public.set_ai_conversation_paused(
  p_conversation_id uuid,
  p_paused boolean,
  p_reason text default null,
  p_source text default 'agent_inbox'
) returns table(
  conversation_id uuid,
  crm_lead_id uuid,
  ai_paused boolean,
  ai_paused_at timestamptz,
  ai_paused_by uuid
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_lead_id uuid;
  v_crm_source text;
  v_prev boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select c.user_id, c.crm_lead_id, c.crm_source, c.ai_paused
    into v_tenant, v_lead_id, v_crm_source, v_prev
    from public.ai_conversation_index c
   where c.id = p_conversation_id
   for update;

  if v_tenant is null then raise exception 'conversation_not_found'; end if;

  if not (
    v_tenant = v_uid
    or coalesce(public.is_current_user_superadmin(), false)
    or exists (
      select 1
        from public.ai_team_members m
       where m.auth_user_id = v_uid
         and m.user_id = v_tenant
         and m.removed_at is null
         and coalesce(m.active_in_system, true) <> false
    )
  ) then
    raise exception 'not_authorized';
  end if;

  update public.ai_conversation_index c
     set ai_paused = p_paused,
         ai_paused_at = case when p_paused then now() else null end,
         ai_paused_by = case when p_paused then v_uid else null end,
         pause_reason = case when p_paused then p_reason else null end,
         updated_at = now()
   where c.id = p_conversation_id;

  -- Compatibilidade: se a conversa ja possui lead Pedro, os dois estados ficam iguais.
  if v_crm_source = 'pedro' and v_lead_id is not null then
    update public.ai_crm_leads l
       set ai_paused = p_paused,
           ai_paused_at = case when p_paused then now() else null end,
           ai_paused_by = case when p_paused then v_uid else null end,
           pause_reason = case when p_paused then p_reason else null end
     where l.id = v_lead_id
       and l.user_id = v_tenant;
  end if;

  insert into public.ai_pause_audit(
    tenant_id, scope, conversation_id, lead_id, previous_paused, new_paused,
    changed_by, source, reason, metadata
  ) values (
    v_tenant, 'conversation', p_conversation_id, v_lead_id, coalesce(v_prev, false),
    p_paused, v_uid, coalesce(nullif(p_source, ''), 'agent_inbox'), p_reason,
    jsonb_build_object('via', 'projection_rpc')
  );

  return query
    select c.id, c.crm_lead_id, c.ai_paused, c.ai_paused_at, c.ai_paused_by
      from public.ai_conversation_index c
     where c.id = p_conversation_id;
end;
$$;

grant execute on function public.set_ai_conversation_paused(uuid, boolean, text, text)
  to authenticated;

-- Compatibilidade com qualquer tela/rotina antiga que ainda altere a pausa pelo
-- lead do Pedro. A projecao e a fonte usada pelo gateway/V3, portanto nunca pode
-- ficar defasada do CRM.
create or replace function public.sync_crm_pause_to_conversation_index()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.ai_paused is distinct from new.ai_paused
     or old.ai_paused_at is distinct from new.ai_paused_at
     or old.ai_paused_by is distinct from new.ai_paused_by
     or old.pause_reason is distinct from new.pause_reason then
    update public.ai_conversation_index c
       set ai_paused = coalesce(new.ai_paused, false),
           ai_paused_at = new.ai_paused_at,
           ai_paused_by = new.ai_paused_by,
           pause_reason = new.pause_reason,
           updated_at = now()
     where c.user_id = new.user_id
       and c.crm_source = 'pedro'
       and c.crm_lead_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_crm_pause_to_conversation_index on public.ai_crm_leads;
create trigger trg_sync_crm_pause_to_conversation_index
after update of ai_paused, ai_paused_at, ai_paused_by, pause_reason
on public.ai_crm_leads
for each row execute function public.sync_crm_pause_to_conversation_index();

-- Alinha o estado inicial sem sobrescrever pausas de conversas ainda orfas.
update public.ai_conversation_index c
   set ai_paused = coalesce(l.ai_paused, false),
       ai_paused_at = l.ai_paused_at,
       ai_paused_by = l.ai_paused_by,
       pause_reason = l.pause_reason,
       updated_at = now()
  from public.ai_crm_leads l
 where c.user_id = l.user_id
   and c.crm_source = 'pedro'
   and c.crm_lead_id = l.id;

create or replace function public.is_ai_automation_allowed_v2(
  p_tenant uuid,
  p_agent_id uuid,
  p_lead_id uuid,
  p_v3_conversation_id text,
  p_instance_id uuid,
  p_phone text,
  p_action_kind text,
  p_origin text default 'ai'
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_agent_active boolean;
  v_lead_paused boolean := false;
  v_lead_tenant uuid;
  v_projection_paused boolean := false;
  v_route_instance uuid;
  v_route_phone text;
begin
  -- Pausa da IA nunca bloqueia operacao humana.
  if coalesce(p_origin, 'ai') in ('manual', 'seller')
     or p_action_kind in ('manual_message', 'manual_transfer', 'seller_ack', 'inbox_record') then
    return jsonb_build_object('allowed', true, 'reason', 'operational');
  end if;

  if p_agent_id is not null then
    select a.is_active into v_agent_active
      from public.wa_ai_agents a
     where a.id = p_agent_id
       and (p_tenant is null or a.user_id = p_tenant);
    if coalesce(v_agent_active, false) = false then
      return jsonb_build_object('allowed', false, 'reason', 'agent_inactive');
    end if;
  end if;

  if p_lead_id is not null then
    select coalesce(l.ai_paused, false), l.user_id
      into v_lead_paused, v_lead_tenant
      from public.ai_crm_leads l
     where l.id = p_lead_id;
    if p_tenant is not null and v_lead_tenant is not null and v_lead_tenant <> p_tenant then
      return jsonb_build_object('allowed', false, 'reason', 'tenant_mismatch');
    end if;
  end if;

  if p_v3_conversation_id is not null then
    select r.instance_id, r.to_addr
      into v_route_instance, v_route_phone
      from public.v3_conversation_routing r
     where r.tenant_id = p_tenant
       and r.conversation_id = p_v3_conversation_id
     limit 1;
  end if;

  select coalesce(bool_or(c.ai_paused), false)
    into v_projection_paused
    from public.ai_conversation_index c
   where c.user_id = p_tenant
     and (
       (p_lead_id is not null and c.crm_source = 'pedro' and c.crm_lead_id = p_lead_id)
       or
       (
         coalesce(p_instance_id, v_route_instance) is not null
         and c.instance_id = coalesce(p_instance_id, v_route_instance)
         and public.logos_phone_canonical(c.phone_canonical)
             = public.logos_phone_canonical(coalesce(p_phone, v_route_phone))
       )
     );

  if v_lead_paused or v_projection_paused then
    return jsonb_build_object('allowed', false, 'reason', 'conversation_paused');
  end if;

  return jsonb_build_object('allowed', true, 'reason', 'ok');
end;
$$;

grant execute on function public.is_ai_automation_allowed_v2(
  uuid, uuid, uuid, text, uuid, text, text, text
) to service_role;

-- Preserva a RPC de listagem validada e envolve somente os dois campos de pausa.
do $$
begin
  if to_regprocedure('public.get_ai_conversations_v2_base(integer,timestamp with time zone,uuid)') is null
     and to_regprocedure('public.get_ai_conversations_v2(integer,timestamp with time zone,uuid)') is not null then
    alter function public.get_ai_conversations_v2(integer, timestamptz, uuid)
      rename to get_ai_conversations_v2_base;
  end if;
end $$;

create or replace function public.get_ai_conversations_v2(
  p_limit integer default 50,
  p_before timestamptz default null,
  p_before_id uuid default null
) returns table(
  conversation_id uuid, instance_id uuid, agent_id uuid, phone text, phone_raw text,
  contact_name text, profile_picture_url text, last_message text, last_message_type text,
  last_message_direction text, last_message_at timestamptz, message_count integer,
  crm_lead_id uuid, crm_source text, crm_match_status text, sem_vinculo_crm boolean,
  agente_inativo boolean, ia_pausada boolean, atendimento_manual boolean,
  first_seen_at timestamptz, assigned_to_id uuid
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select b.conversation_id, b.instance_id, b.agent_id, b.phone, b.phone_raw,
         b.contact_name, b.profile_picture_url, b.last_message, b.last_message_type,
         b.last_message_direction, b.last_message_at, b.message_count,
         b.crm_lead_id, b.crm_source, b.crm_match_status, b.sem_vinculo_crm,
         b.agente_inativo,
         (coalesce(c.ai_paused, false) or b.ia_pausada) as ia_pausada,
         (coalesce(c.ai_paused, false) or b.atendimento_manual) as atendimento_manual,
         b.first_seen_at, b.assigned_to_id
    from public.get_ai_conversations_v2_base(p_limit, p_before, p_before_id) b
    join public.ai_conversation_index c on c.id = b.conversation_id;
$$;

grant execute on function public.get_ai_conversations_v2(integer, timestamptz, uuid)
  to authenticated;

-- Atualizacao em tempo real da lista e do historico sincronizado.
do $$
begin
  alter publication supabase_realtime add table public.ai_conversation_index;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.wa_synced_messages;
exception when duplicate_object then null;
end $$;
