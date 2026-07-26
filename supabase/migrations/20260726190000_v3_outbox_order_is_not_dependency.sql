-- Pedro v3: ordem do outbox serializa efeitos; somente depends_on propaga falha.
-- Assim, uma falha terminal de WhatsApp nao apaga a persistencia independente
-- do CRM, enquanto handoff/notify continuam protegidos por depends_on explicito.

begin;

create or replace function public.v3_claim_outbox_for_conversation(
  p_tenant_id uuid,
  p_conversation_id text,
  p_worker_id text,
  p_ttl_ms integer default 60000,
  p_limit integer default 25,
  p_now timestamptz default now()
)
returns setof public.v3_effect_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ttl_ms <= 0 then
    raise exception 'v3_invalid_outbox_claim_ttl' using errcode = '22023';
  end if;
  if p_limit <= 0 or p_limit > 200 then
    raise exception 'v3_invalid_outbox_claim_limit' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select effect.effect_id
    from public.v3_effect_outbox effect
    where effect.tenant_id = p_tenant_id
      and effect.conversation_id = p_conversation_id
      and effect.status = 'pending'
      and (effect.next_retry_at is null or effect.next_retry_at <= p_now)
      and not exists (
        select 1
        from public.v3_effect_outbox prior
        where prior.tenant_id = effect.tenant_id
          and prior.turn_id = effect.turn_id
          and prior.effect_order < effect.effect_order
          and prior.terminal_at is null
          and not public.v3_effect_satisfied(
            prior.status,
            prior.required_receipt_level,
            prior.receipt_level,
            prior.outcome_applied_at
          )
      )
      and not exists (
        select 1
        from unnest(effect.depends_on) as dependency(plan_id)
        left join public.v3_effect_outbox target
          on target.tenant_id = effect.tenant_id
         and target.turn_id = effect.turn_id
         and target.plan_id = dependency.plan_id
        where target.effect_id is null
           or not public.v3_effect_satisfied(
             target.status,
             target.required_receipt_level,
             target.receipt_level,
             target.outcome_applied_at
           )
      )
    order by effect.created_at, effect.turn_id, effect.effect_order, effect.effect_id
    for update of effect skip locked
    limit p_limit
  ), claimed as (
    update public.v3_effect_outbox effect
       set status = 'processing',
           processing_by = p_worker_id,
           processing_token = gen_random_uuid()::text,
           processing_expires_at = p_now + make_interval(secs => p_ttl_ms::double precision / 1000.0),
           dispatched_at = coalesce(effect.dispatched_at, p_now),
           attempts = effect.attempts + 1,
           last_error = null
      from candidates
     where effect.effect_id = candidates.effect_id
    returning effect.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.v3_claim_outbox_for_conversation(uuid, text, text, integer, integer, timestamptz) from public;
grant execute on function public.v3_claim_outbox_for_conversation(uuid, text, text, integer, integer, timestamptz) to service_role;

commit;
