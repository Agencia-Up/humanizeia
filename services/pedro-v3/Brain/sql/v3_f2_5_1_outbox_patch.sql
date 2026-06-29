-- Pedro v3 - F2.5.1
-- Patch aditivo para claim de outbox por conversa e transicoes de reconciliacao.
-- Execute no SQL Editor somente depois de v3_schema.sql.

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

create or replace function public.v3_record_outbox_result(
  p_tenant_id uuid,
  p_effect_id text,
  p_processing_token text,
  p_result_status text,
  p_receipt_level text default null,
  p_provider_receipt jsonb default null,
  p_last_error text default null,
  p_retryable boolean default false,
  p_next_retry_at timestamptz default null,
  p_media_receipts jsonb default '[]'::jsonb,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.v3_effect_outbox%rowtype;
  v_terminal_at timestamptz;
  v_valid_transition boolean := false;
begin
  if p_result_status not in ('succeeded', 'failed', 'outcome_uncertain') then
    raise exception 'v3_invalid_effect_result_status' using errcode = '22023';
  end if;
  if p_result_status = 'succeeded' and p_receipt_level not in ('accepted', 'delivered') then
    raise exception 'v3_success_requires_receipt_level' using errcode = '22023';
  end if;
  if jsonb_typeof(p_media_receipts) <> 'array' then
    raise exception 'v3_media_receipts_must_be_array' using errcode = '22023';
  end if;

  select * into v_record
  from public.v3_effect_outbox
  where tenant_id = p_tenant_id and effect_id = p_effect_id
  for update;

  if not found then
    raise exception 'v3_outbox_effect_not_found:%', p_effect_id using errcode = 'P0002';
  end if;

  -- Provider callbacks are at-least-once. Duplicate success and stale accepted
  -- after delivered are idempotent no-ops.
  if v_record.status = 'succeeded' and p_result_status = 'succeeded' then
    if v_record.receipt_level = 'delivered' and p_receipt_level in ('accepted', 'delivered') then
      return true;
    end if;
    if v_record.receipt_level = 'accepted' and p_receipt_level = 'accepted' then
      return true;
    end if;
  end if;

  if v_record.status = 'processing' then
    v_valid_transition := v_record.processing_token is not distinct from p_processing_token;
  elsif v_record.status = 'outcome_uncertain' then
    v_valid_transition := p_processing_token is null
      and p_result_status in ('succeeded', 'failed', 'outcome_uncertain');
  elsif v_record.status = 'succeeded' and v_record.receipt_level = 'accepted' then
    v_valid_transition := p_processing_token is null
      and (
        (p_result_status = 'succeeded' and p_receipt_level = 'delivered')
        or p_result_status = 'failed'
      );
  end if;

  if not v_valid_transition then
    raise exception 'v3_outbox_result_transition_invalid:%', p_effect_id using errcode = '40001';
  end if;

  if p_result_status = 'succeeded'
    and v_record.required_receipt_level = 'accepted'
    and p_receipt_level in ('accepted', 'delivered')
  then
    v_terminal_at := p_now;
  elsif p_result_status = 'failed' and not p_retryable then
    v_terminal_at := p_now;
  else
    v_terminal_at := null;
  end if;

  if jsonb_array_length(p_media_receipts) > 0 and v_record.kind <> 'send_media' then
    raise exception 'v3_media_receipts_for_non_media_effect' using errcode = '22023';
  end if;

  insert into public.v3_media_receipts (
    tenant_id, effect_id, photo_id, status, provider_receipt, at
  )
  select
    p_tenant_id,
    p_effect_id,
    item ->> 'photoId',
    item ->> 'status',
    item -> 'providerReceipt',
    coalesce(nullif(item ->> 'at', '')::timestamptz, p_now)
  from jsonb_array_elements(p_media_receipts) as items(item)
  on conflict (effect_id, photo_id) do update
    set status = excluded.status,
        provider_receipt = excluded.provider_receipt,
        at = excluded.at;

  update public.v3_effect_outbox
     set status = p_result_status,
         receipt_level = case when p_result_status = 'succeeded' then p_receipt_level else receipt_level end,
         provider_receipt = coalesce(p_provider_receipt, provider_receipt),
         last_error = p_last_error,
         next_retry_at = case when p_retryable then p_next_retry_at else null end,
         terminal_at = v_terminal_at,
         processing_by = null,
         processing_token = null,
         processing_expires_at = null
   where effect_id = p_effect_id;

  return true;
end;
$$;

create or replace function public.v3_requeue_outbox_guarded(
  p_tenant_id uuid,
  p_effect_id text,
  p_expected_status text,
  p_expected_receipt_level text,
  p_processing_token text,
  p_next_retry_at timestamptz default now(),
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.v3_effect_outbox
     set status = 'pending',
         next_retry_at = p_next_retry_at,
         last_error = p_reason,
         terminal_at = null,
         processing_by = null,
         processing_token = null,
         processing_expires_at = null
   where tenant_id = p_tenant_id
     and effect_id = p_effect_id
     and status = p_expected_status
     and receipt_level is not distinct from p_expected_receipt_level
     and (
       (status = 'processing' and processing_token is not distinct from p_processing_token)
       or (status <> 'processing' and p_processing_token is null)
     )
     and status in ('failed', 'outcome_uncertain', 'processing')
     and (status = 'failed' or provider_capability in ('idempotent', 'queryable'))
     and terminal_at is null
     and outcome_applied_at is null;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.v3_skip_outbox_guarded(
  p_tenant_id uuid,
  p_effect_id text,
  p_expected_status text,
  p_expected_receipt_level text,
  p_processing_token text,
  p_reason text,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.v3_effect_outbox
     set status = 'skipped',
         last_error = p_reason,
         terminal_at = p_now,
         outcome_applied_at = null,
         processing_by = null,
         processing_token = null,
         processing_expires_at = null
   where tenant_id = p_tenant_id
     and effect_id = p_effect_id
     and status = p_expected_status
     and receipt_level is not distinct from p_expected_receipt_level
     and (
       (status = 'processing' and processing_token is not distinct from p_processing_token)
       or (status <> 'processing' and p_processing_token is null)
     )
     and status in ('pending', 'processing')
     and outcome_applied_at is null;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.v3_fail_outbox_guarded(
  p_tenant_id uuid,
  p_effect_id text,
  p_expected_status text,
  p_expected_receipt_level text,
  p_processing_token text,
  p_reason text,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.v3_effect_outbox
     set status = 'failed',
         last_error = p_reason,
         next_retry_at = null,
         terminal_at = p_now,
         outcome_applied_at = null,
         processing_by = null,
         processing_token = null,
         processing_expires_at = null
   where tenant_id = p_tenant_id
     and effect_id = p_effect_id
     and status = p_expected_status
     and receipt_level is not distinct from p_expected_receipt_level
     and (
       (status = 'processing' and processing_token is not distinct from p_processing_token)
       or (status <> 'processing' and p_processing_token is null)
     )
     and status in ('failed', 'processing', 'outcome_uncertain', 'succeeded')
     and terminal_at is null
     and outcome_applied_at is null;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- As RPCs antigas nao possuem guarda de versao logica/token. Permanecem no
-- schema cumulativo por compatibilidade historica, mas o runtime v3 nao pode usa-las.
revoke execute on function public.v3_claim_outbox(text, interval, integer, timestamptz) from service_role;
revoke execute on function public.v3_requeue_outbox(uuid, text, timestamptz, text) from service_role;
revoke execute on function public.v3_skip_outbox(uuid, text, text, timestamptz) from service_role;

revoke all on function public.v3_claim_outbox_for_conversation(uuid, text, text, integer, integer, timestamptz) from public;
revoke all on function public.v3_record_outbox_result(uuid, text, text, text, text, jsonb, text, boolean, timestamptz, jsonb, timestamptz) from public;
revoke all on function public.v3_requeue_outbox_guarded(uuid, text, text, text, text, timestamptz, text) from public;
revoke all on function public.v3_skip_outbox_guarded(uuid, text, text, text, text, text, timestamptz) from public;
revoke all on function public.v3_fail_outbox_guarded(uuid, text, text, text, text, text, timestamptz) from public;

grant execute on function public.v3_claim_outbox_for_conversation(uuid, text, text, integer, integer, timestamptz) to service_role;
grant execute on function public.v3_record_outbox_result(uuid, text, text, text, text, jsonb, text, boolean, timestamptz, jsonb, timestamptz) to service_role;
grant execute on function public.v3_requeue_outbox_guarded(uuid, text, text, text, text, timestamptz, text) to service_role;
grant execute on function public.v3_skip_outbox_guarded(uuid, text, text, text, text, text, timestamptz) to service_role;
grant execute on function public.v3_fail_outbox_guarded(uuid, text, text, text, text, text, timestamptz) to service_role;

commit;