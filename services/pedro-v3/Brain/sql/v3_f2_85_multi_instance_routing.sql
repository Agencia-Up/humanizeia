-- F2.85 - Same forward migration as production. Kept here for the local SQL
-- contract suite and manual Supabase verification.

begin;

alter table public.v3_conversation_routing
  add column if not exists instance_id uuid references public.wa_instances(id) on delete set null;

create index if not exists v3_conversation_routing_instance_idx
  on public.v3_conversation_routing (tenant_id, instance_id)
  where instance_id is not null;

-- Before this migration the v3 dispatcher always loaded wa_ai_agents.instance_id
-- (singular). Preserve that exact historical routing for conversations already
-- in flight. Do not guess from instance_ids[]: the first array item was never
-- an authority for an existing conversation.
update public.v3_conversation_routing r
   set instance_id = a.instance_id
  from public.wa_ai_agents a
  join public.wa_instances wi
    on wi.id = a.instance_id
   and wi.user_id = a.user_id
 where r.instance_id is null
   and a.id::text = r.agent_id
   and a.user_id = r.tenant_id;

drop function if exists public.v3_upsert_conversation_routing(uuid, text, text, text, text, uuid, timestamptz);
create function public.v3_upsert_conversation_routing(
  p_tenant_id uuid,
  p_conversation_id text,
  p_agent_id text,
  p_lead_id text,
  p_to_addr text,
  p_instance_id uuid,
  p_now timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_instance_id uuid;
begin
  if p_instance_id is not null and not exists (
    select 1 from public.wa_instances wi
     where wi.id = p_instance_id and wi.user_id = p_tenant_id
  ) then
    raise exception 'V3_ROUTING_INSTANCE_OWNERSHIP_MISMATCH';
  end if;

  insert into public.v3_conversation_routing (
    tenant_id, conversation_id, agent_id, lead_id, to_addr, instance_id, updated_at
  ) values (
    p_tenant_id, p_conversation_id, p_agent_id, p_lead_id, p_to_addr, p_instance_id, p_now
  ) on conflict (tenant_id, conversation_id) do nothing;

  select r.instance_id into v_instance_id
    from public.v3_conversation_routing r
   where r.tenant_id = p_tenant_id and r.conversation_id = p_conversation_id
   for update;

  if v_instance_id is not null and p_instance_id is not null and v_instance_id <> p_instance_id then
    raise exception 'V3_ROUTING_INSTANCE_CONFLICT';
  end if;

  update public.v3_conversation_routing r
     set agent_id = p_agent_id,
         lead_id = p_lead_id,
         to_addr = p_to_addr,
         instance_id = coalesce(r.instance_id, p_instance_id),
         updated_at = p_now
   where r.tenant_id = p_tenant_id and r.conversation_id = p_conversation_id;
  return true;
end;
$$;

create or replace function public.v3_upsert_conversation_routing(
  p_tenant_id uuid,
  p_conversation_id text,
  p_agent_id text,
  p_lead_id text,
  p_to_addr text,
  p_now timestamptz default now()
) returns boolean
language sql security definer set search_path = public
as $$
  select public.v3_upsert_conversation_routing(
    p_tenant_id, p_conversation_id, p_agent_id, p_lead_id, p_to_addr, null::uuid, p_now
  )
$$;

drop function if exists public.v3_find_settled_conversations(uuid, timestamptz, integer, integer, integer);
create function public.v3_find_settled_conversations(
  p_tenant_id uuid,
  p_now timestamptz,
  p_debounce_ms integer,
  p_max_ms integer,
  p_limit integer
) returns table(conversation_id text, agent_id text, lead_id text, to_addr text, instance_id uuid, pending_count integer)
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.v3_leases l where l.tenant_id = p_tenant_id and l.expires_at <= p_now;

  update public.v3_inbox i
     set status = 'pending', claimed_by = null, turn_id = null, claimed_at = null,
         next_retry_at = p_now, last_error = 'STALE_CLAIM_RECOVERED', updated_at = p_now
   where i.tenant_id = p_tenant_id and i.status = 'claimed'
     and i.claimed_at <= p_now - interval '2 minutes'
     and not exists (
       select 1 from public.v3_leases l
        where l.tenant_id = i.tenant_id and l.conversation_id = i.conversation_id and l.expires_at > p_now
     );

  return query
  with pending as (
    select i.conversation_id, count(*)::integer as pending_count,
           min(i.received_at) as oldest, max(i.received_at) as newest
      from public.v3_inbox i
     where i.tenant_id = p_tenant_id and i.status = 'pending'
     group by i.conversation_id
  )
  select p.conversation_id, r.agent_id, r.lead_id, r.to_addr, r.instance_id, p.pending_count
    from pending p
    join public.v3_conversation_routing r
      on r.tenant_id = p_tenant_id and r.conversation_id = p.conversation_id
    left join lateral (
      select lower(lp.state) as state, lp.updated_at
        from public.wa_lead_presence lp
        join public.wa_instances wi
          on wi.instance_name = lp.instance_name and wi.user_id = p_tenant_id
         and (r.instance_id is null or wi.id = r.instance_id)
       where regexp_replace(lp.remote_jid, '[^0-9]', '', 'g') = r.to_addr
         and lp.updated_at > p_now - interval '15 seconds'
       order by lp.updated_at desc limit 1
    ) presence on true
   where p.oldest <= p_now - make_interval(secs => greatest(p_max_ms, 0)::numeric / 1000.0)
      or (p.newest <= p_now - make_interval(secs => greatest(p_debounce_ms, 0)::numeric / 1000.0)
          and coalesce(presence.state not in ('composing', 'recording'), true))
   order by p.oldest asc
   limit greatest(1, coalesce(p_limit, 20));
end;
$$;

revoke all on function public.v3_upsert_conversation_routing(uuid,text,text,text,text,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.v3_upsert_conversation_routing(uuid,text,text,text,text,uuid,timestamptz) to service_role;
revoke all on function public.v3_upsert_conversation_routing(uuid,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.v3_upsert_conversation_routing(uuid,text,text,text,text,timestamptz) to service_role;
revoke all on function public.v3_find_settled_conversations(uuid,timestamptz,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.v3_find_settled_conversations(uuid,timestamptz,integer,integer,integer) to service_role;

commit;
