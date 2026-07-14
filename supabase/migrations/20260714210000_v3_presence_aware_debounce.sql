-- Pedro v3 F2.56 - use WhatsApp composing/recording presence during debounce.
-- Presence only delays a reply. p_max_ms always wins to avoid starvation.

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
  with pending as (
    select i.conversation_id,
           count(*)::integer as pending_count,
           min(i.received_at) as oldest,
           max(i.received_at) as newest
      from public.v3_inbox i
     where i.tenant_id = p_tenant_id
       and i.status = 'pending'
     group by i.conversation_id
  )
  select p.conversation_id, r.agent_id, r.lead_id, r.to_addr, p.pending_count
    from pending p
    join public.v3_conversation_routing r
      on r.tenant_id = p_tenant_id
     and r.conversation_id = p.conversation_id
    left join lateral (
      select lower(lp.state) as state, lp.updated_at
        from public.wa_lead_presence lp
        join public.wa_instances wi
          on wi.instance_name = lp.instance_name
         and wi.user_id = p_tenant_id
       where regexp_replace(lp.remote_jid, '[^0-9]', '', 'g') = r.to_addr
         and lp.updated_at > p_now - interval '15 seconds'
       order by lp.updated_at desc
       limit 1
    ) presence on true
   where
     p.oldest <= p_now - make_interval(secs => greatest(p_max_ms, 0)::numeric / 1000.0)
     or (
       p.newest <= p_now - make_interval(secs => greatest(p_debounce_ms, 0)::numeric / 1000.0)
       and coalesce(presence.state not in ('composing', 'recording'), true)
     )
   order by p.oldest asc
   limit greatest(1, coalesce(p_limit, 20));
end;
$$;

revoke all on function public.v3_find_settled_conversations(uuid,timestamptz,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.v3_find_settled_conversations(uuid,timestamptz,integer,integer,integer) to service_role;

commit;
