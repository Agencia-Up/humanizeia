-- Pedro v3 F2.19 - recuperacao de inbox claimed apos crash/restart.
-- Idempotente. Nao toca v2. Execute no SQL Editor antes/depois do deploy.

begin;

create or replace function public.v3_find_settled_conversations(
  p_tenant_id uuid,
  p_now timestamptz,
  p_debounce_ms integer,
  p_max_ms integer,
  p_limit integer
) returns table(conversation_id text, agent_id text, lead_id text, to_addr text, pending_count integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.v3_leases l
   where l.tenant_id = p_tenant_id
     and l.expires_at <= p_now;

  update public.v3_inbox i
     set status = 'pending',
         claimed_by = null,
         turn_id = null,
         claimed_at = null,
         next_retry_at = p_now,
         last_error = 'STALE_CLAIM_RECOVERED',
         updated_at = p_now
   where i.tenant_id = p_tenant_id
     and i.status = 'claimed'
     and i.claimed_at <= p_now - interval '2 minutes'
     and not exists (
       select 1 from public.v3_leases l
        where l.tenant_id = i.tenant_id
          and l.conversation_id = i.conversation_id
          and l.expires_at > p_now
     );

  return query
  select s.conversation_id, r.agent_id, r.lead_id, r.to_addr, s.pending_count
  from (
    select i.conversation_id,
           count(*)::integer as pending_count,
           min(i.received_at) as oldest,
           max(i.received_at) as newest
      from public.v3_inbox i
     where i.tenant_id = p_tenant_id and i.status = 'pending'
     group by i.conversation_id
    having max(i.received_at) <= p_now - make_interval(secs => greatest(p_debounce_ms, 0)::numeric / 1000.0)
        or min(i.received_at) <= p_now - make_interval(secs => greatest(p_max_ms, 0)::numeric / 1000.0)
  ) s
  join public.v3_conversation_routing r
    on r.tenant_id = p_tenant_id and r.conversation_id = s.conversation_id
  order by s.oldest asc
  limit greatest(1, coalesce(p_limit, 20));
end;
$$;

revoke all on function public.v3_find_settled_conversations(uuid,timestamptz,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.v3_find_settled_conversations(uuid,timestamptz,integer,integer,integer) to service_role;

commit;

-- Verificador read-only: espera function_ok=true.
select to_regprocedure('public.v3_find_settled_conversations(uuid,timestamptz,integer,integer,integer)') is not null as function_ok;
