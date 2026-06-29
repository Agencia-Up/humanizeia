-- Pedro v3 - Fase 2.4
-- Schema isolado, transacional e multi-tenant para Supabase/PostgreSQL.
--
-- IMPORTANTE:
--   1. Este arquivo cria SOMENTE objetos public.v3_*.
--   2. tenant_id representa o user_id da conta proprietaria no sistema atual.
--   3. O runtime deve usar service_role. Usuarios autenticados recebem apenas
--      leitura auditavel das tabelas nao sensiveis do proprio tenant.
--   4. CPF/segredos devem chegar ao cofre JA criptografados pelo adapter.
--      Nunca envie valor cru para v3_sensitive_vault.
--   5. outcome_applied_at significa exclusivamente que as mutacoes de sucesso
--      foram aplicadas ao estado. Falha/skipped usam terminal_at.

begin;

create or replace function public.v3_payload_is_redacted(p_payload jsonb)
returns boolean
language sql
immutable
as $$
  select
    p_payload is not null
    and jsonb_typeof(p_payload) = 'object'
    and p_payload @> '{"__redacted": true}'::jsonb
    -- CPF: usa WORD-BOUNDARY (\y) em vez de [^0-9]/(^|$). Bordas [^0-9] tratavam letras hex como
    -- delimitador valido, entao um event_id (hash hex de 64 chars) com 11 digitos seguidos (ex.:
    -- "...f77842555836c...") era falso-positivo de CPF e barrava o commit (F2.6P). Com \y, sequencias
    -- de digitos GRUDADAS em letras/alfanumerico (hashes) nao casam; CPF real (cercado por espaco/
    -- pontuacao/inicio/fim) continua pego, formatado ou cru.
    and p_payload::text !~* '\y[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}\y'
    and p_payload::text !~* '(bearer[[:space:]]+[a-z0-9._-]{20,}|sk-[a-z0-9_-]{16,})'
$$;

-- ---------------------------------------------------------------------------
-- 1. Snapshot e historico do estado central
-- ---------------------------------------------------------------------------

create table if not exists public.v3_conversation_state (
  conversation_id text primary key,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  lead_id text,
  schema_version integer not null default 1 check (schema_version > 0),
  version bigint not null default 0 check (version >= 0),
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, conversation_id),
  constraint v3_conversation_state_object_ck
    check (jsonb_typeof(state) = 'object'),
  constraint v3_conversation_state_envelope_ck
    check (
      state ?& array['conversationId', 'tenantId', 'agentId', 'schemaVersion', 'version']
      and state ->> 'conversationId' = conversation_id
      and state ->> 'tenantId' = tenant_id::text
      and state ->> 'agentId' = agent_id
      and (state ->> 'schemaVersion')::integer = schema_version
      and (state ->> 'version')::bigint = version
    )
);

create table if not exists public.v3_state_history (
  tenant_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null,
  version bigint not null check (version > 0),
  schema_version integer not null check (schema_version > 0),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  source text not null check (source in ('turn_commit', 'effect_outcome', 'manual_repair')),
  turn_id text,
  effect_id text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, conversation_id, version),
  foreign key (tenant_id, conversation_id)
    references public.v3_conversation_state(tenant_id, conversation_id)
    on delete cascade
);

-- ---------------------------------------------------------------------------
-- 2. Inbox duravel e lease por conversa
-- ---------------------------------------------------------------------------

create table if not exists public.v3_inbox (
  event_id text primary key,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null,
  raw jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'done', 'error')),
  claimed_by text,
  turn_id text,
  attempts integer not null default 0 check (attempts >= 0),
  next_retry_at timestamptz,
  received_at timestamptz not null,
  claimed_at timestamptz,
  done_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint v3_inbox_raw_object_ck check (jsonb_typeof(raw) = 'object'),
  constraint v3_inbox_redacted_ck check (public.v3_payload_is_redacted(raw)),
  constraint v3_inbox_claim_shape_ck check (
    (status = 'pending' and claimed_by is null and turn_id is null and claimed_at is null)
    or (status = 'claimed' and claimed_by is not null and turn_id is not null and claimed_at is not null)
    or status in ('done', 'error')
  )
);

create table if not exists public.v3_leases (
  conversation_id text primary key,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  owner text not null,
  token text not null unique,
  acquired_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (expires_at > acquired_at)
);

-- ---------------------------------------------------------------------------
-- 3. Auditoria do turno, queries e decisao unica
-- ---------------------------------------------------------------------------

create table if not exists public.v3_turn_events (
  event_id text primary key,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  correlation_id text,
  conversation_id text not null,
  turn_id text not null,
  type text not null,
  payload_schema_version integer not null check (payload_schema_version > 0),
  payload jsonb not null,
  at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint v3_turn_events_payload_ck check (
    jsonb_typeof(payload) = 'object'
    and public.v3_payload_is_redacted(payload)
  )
);

create table if not exists public.v3_query_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null,
  turn_id text not null,
  step integer not null check (step >= 0),
  tool text not null,
  input jsonb not null,
  result jsonb not null,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  at timestamptz not null default now(),
  constraint v3_query_log_redacted_ck check (
    jsonb_typeof(input) = 'object'
    and jsonb_typeof(result) = 'object'
    and public.v3_payload_is_redacted(input)
    and public.v3_payload_is_redacted(result)
  )
);

create table if not exists public.v3_decisions (
  turn_id text primary key,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null,
  action text not null check (action in (
    'reply', 'clarify', 'collect_slot', 'search_stock', 'send_photos',
    'answer_vehicle_question', 'schedule_visit', 'handoff', 'close', 'no_op'
  )),
  reason_code text not null,
  reason_summary text not null,
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  policy_checks jsonb not null default '[]'::jsonb check (jsonb_typeof(policy_checks) = 'array'),
  decision jsonb not null check (jsonb_typeof(decision) = 'object'),
  at timestamptz not null default now(),
  unique (tenant_id, conversation_id, turn_id)
);

-- ---------------------------------------------------------------------------
-- 4. Transactional outbox, receipts e reconciliacao
-- ---------------------------------------------------------------------------

create table if not exists public.v3_effect_outbox (
  effect_id text primary key,
  idempotency_key text not null unique,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null,
  turn_id text not null,
  plan_id text not null,
  kind text not null check (kind in (
    'send_message', 'send_media', 'crm_write', 'schedule_visit', 'handoff', 'notify_seller'
  )),
  payload jsonb not null,
  on_success jsonb not null default '[]'::jsonb,
  effect_order integer not null check (effect_order >= 0),
  depends_on text[] not null default '{}'::text[],
  status text not null default 'pending' check (status in (
    'pending', 'processing', 'succeeded', 'failed', 'outcome_uncertain', 'skipped'
  )),
  provider text,
  provider_capability text not null default 'none'
    check (provider_capability in ('idempotent', 'queryable', 'none')),
  receipt_level text check (receipt_level is null or receipt_level in ('accepted', 'delivered')),
  required_receipt_level text generated always as (
    case
      when kind in ('send_media', 'crm_write', 'schedule_visit', 'handoff', 'notify_seller')
        or jsonb_array_length(on_success) > 0
      then 'delivered'
      else 'accepted'
    end
  ) stored,
  attempts integer not null default 0 check (attempts >= 0),
  next_retry_at timestamptz,
  provider_receipt jsonb,
  outcome_applied_at timestamptz,
  terminal_at timestamptz,
  last_error text,
  processing_by text,
  processing_token text,
  processing_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dispatched_at timestamptz,
  unique (tenant_id, turn_id, plan_id),
  constraint v3_outbox_payload_ck check (
    jsonb_typeof(payload) = 'object'
    and public.v3_payload_is_redacted(payload)
  ),
  constraint v3_outbox_on_success_ck check (jsonb_typeof(on_success) = 'array'),
  constraint v3_outbox_effect_id_ck check (effect_id = turn_id || ':' || plan_id),
  constraint v3_outbox_idempotency_ck check (idempotency_key = effect_id),
  constraint v3_outbox_processing_shape_ck check (
    (status = 'processing' and processing_by is not null and processing_token is not null and processing_expires_at is not null)
    or (status <> 'processing' and processing_by is null and processing_token is null and processing_expires_at is null)
  ),
  constraint v3_outbox_applied_only_after_delivery_ck check (
    outcome_applied_at is null
    or (status = 'succeeded' and receipt_level = 'delivered')
  )
);

create table if not exists public.v3_media_receipts (
  tenant_id uuid not null references auth.users(id) on delete cascade,
  effect_id text not null references public.v3_effect_outbox(effect_id) on delete cascade,
  photo_id text not null,
  status text not null check (status in ('succeeded', 'failed')),
  provider_receipt jsonb,
  at timestamptz not null,
  primary key (effect_id, photo_id)
);

-- ---------------------------------------------------------------------------
-- 5. Mensagens, shadow e cofre sensivel
-- ---------------------------------------------------------------------------

create table if not exists public.v3_messages (
  id text primary key,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null,
  turn_id text,
  effect_id text,
  provider_message_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  content jsonb not null,
  mode text not null check (mode in ('active', 'shadow')),
  delivery_level text check (delivery_level is null or delivery_level in ('accepted', 'delivered', 'failed')),
  at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint v3_messages_redacted_ck check (
    jsonb_typeof(content) = 'object'
    and public.v3_payload_is_redacted(content)
  )
);

create table if not exists public.v3_shadow_comparisons (
  turn_id text primary key,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null,
  v2_action text,
  v3_action text not null,
  agreement boolean,
  quality_label text check (quality_label is null or quality_label in ('v2_better', 'v3_better', 'equivalent', 'both_bad')),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  notes text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.v3_sensitive_vault (
  ref text primary key,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null,
  kind text not null check (kind in ('cpf', 'secret')),
  ciphertext bytea not null,
  nonce bytea not null,
  auth_tag bytea,
  enc_alg text not null,
  key_version text not null,
  last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  expires_at timestamptz,
  unique (tenant_id, ref)
);

-- ---------------------------------------------------------------------------
-- 6. Indices operacionais
-- ---------------------------------------------------------------------------

create index if not exists v3_inbox_pending_idx
  on public.v3_inbox (tenant_id, conversation_id, received_at, event_id)
  where status = 'pending';
create index if not exists v3_inbox_claimed_stale_idx
  on public.v3_inbox (claimed_at, conversation_id)
  where status = 'claimed';
create index if not exists v3_inbox_retry_idx
  on public.v3_inbox (next_retry_at)
  where next_retry_at is not null and status in ('pending', 'error');
create index if not exists v3_state_history_turn_idx
  on public.v3_state_history (tenant_id, conversation_id, created_at desc);
create index if not exists v3_turn_events_turn_idx
  on public.v3_turn_events (tenant_id, conversation_id, turn_id, at);
create index if not exists v3_turn_events_type_idx
  on public.v3_turn_events (tenant_id, type, at desc);
create index if not exists v3_query_log_turn_idx
  on public.v3_query_log (tenant_id, conversation_id, turn_id, step);
create index if not exists v3_decisions_conversation_idx
  on public.v3_decisions (tenant_id, conversation_id, at desc);
create index if not exists v3_outbox_dispatch_idx
  on public.v3_effect_outbox (status, next_retry_at, created_at, effect_order)
  where status = 'pending';
create index if not exists v3_outbox_reconcile_idx
  on public.v3_effect_outbox (status, processing_expires_at, dispatched_at)
  where status in ('processing', 'outcome_uncertain', 'succeeded');
create index if not exists v3_outbox_turn_idx
  on public.v3_effect_outbox (tenant_id, conversation_id, turn_id, effect_order);
create index if not exists v3_messages_conversation_idx
  on public.v3_messages (tenant_id, conversation_id, at desc);
create index if not exists v3_shadow_unreviewed_idx
  on public.v3_shadow_comparisons (tenant_id, created_at desc)
  where reviewed_at is null;

-- ---------------------------------------------------------------------------
-- 7. Triggers de integridade
-- ---------------------------------------------------------------------------

create or replace function public.v3_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists v3_conversation_state_touch on public.v3_conversation_state;
create trigger v3_conversation_state_touch
before update on public.v3_conversation_state
for each row execute function public.v3_touch_updated_at();

drop trigger if exists v3_inbox_touch on public.v3_inbox;
create trigger v3_inbox_touch
before update on public.v3_inbox
for each row execute function public.v3_touch_updated_at();

drop trigger if exists v3_leases_touch on public.v3_leases;
create trigger v3_leases_touch
before update on public.v3_leases
for each row execute function public.v3_touch_updated_at();

drop trigger if exists v3_outbox_touch on public.v3_effect_outbox;
create trigger v3_outbox_touch
before update on public.v3_effect_outbox
for each row execute function public.v3_touch_updated_at();

create or replace function public.v3_protect_outbox_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.effect_id is distinct from old.effect_id
    or new.idempotency_key is distinct from old.idempotency_key
    or new.tenant_id is distinct from old.tenant_id
    or new.conversation_id is distinct from old.conversation_id
    or new.turn_id is distinct from old.turn_id
    or new.plan_id is distinct from old.plan_id
    or new.kind is distinct from old.kind
    or new.payload is distinct from old.payload
    or new.on_success is distinct from old.on_success
    or new.effect_order is distinct from old.effect_order
    or new.depends_on is distinct from old.depends_on
    or new.provider_capability is distinct from old.provider_capability
  then
    raise exception 'v3_outbox_immutable_field_changed:%', old.effect_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists v3_outbox_protect_identity on public.v3_effect_outbox;
create trigger v3_outbox_protect_identity
before update on public.v3_effect_outbox
for each row execute function public.v3_protect_outbox_identity();

create or replace function public.v3_validate_effect_graph(
  p_tenant_id uuid,
  p_turn_id text
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_missing text;
  v_has_cycle boolean;
begin
  select o.plan_id || '->' || d.dep
    into v_missing
  from public.v3_effect_outbox o
  cross join lateral unnest(o.depends_on) as d(dep)
  left join public.v3_effect_outbox target
    on target.tenant_id = o.tenant_id
   and target.turn_id = o.turn_id
   and target.plan_id = d.dep
  where o.tenant_id = p_tenant_id
    and o.turn_id = p_turn_id
    and target.effect_id is null
  limit 1;

  if v_missing is not null then
    raise exception 'v3_outbox_missing_dependency:%', v_missing
      using errcode = '23503';
  end if;

  with recursive edges as (
    select o.plan_id, d.dep
    from public.v3_effect_outbox o
    cross join lateral unnest(o.depends_on) as d(dep)
    where o.tenant_id = p_tenant_id and o.turn_id = p_turn_id
  ), walk(root, node, path, cycle) as (
    select e.plan_id, e.dep, array[e.plan_id, e.dep]::text[], e.dep = e.plan_id
    from edges e
    union all
    select w.root, e.dep, w.path || e.dep, e.dep = any(w.path)
    from walk w
    join edges e on e.plan_id = w.node
    where not w.cycle
  )
  select exists(select 1 from walk where cycle) into v_has_cycle;

  if v_has_cycle then
    raise exception 'v3_outbox_dependency_cycle:%', p_turn_id
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.v3_validate_effect_graph_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.v3_validate_effect_graph(new.tenant_id, new.turn_id);
  return null;
end;
$$;

drop trigger if exists v3_outbox_validate_graph on public.v3_effect_outbox;
create constraint trigger v3_outbox_validate_graph
after insert or update of depends_on, plan_id, turn_id on public.v3_effect_outbox
deferrable initially deferred
for each row execute function public.v3_validate_effect_graph_trigger();

-- ---------------------------------------------------------------------------
-- 8. RPCs: inbox e coordination store
-- ---------------------------------------------------------------------------

create or replace function public.v3_ingest_inbox(
  p_tenant_id uuid,
  p_event_id text,
  p_conversation_id text,
  p_raw jsonb,
  p_received_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_raw is null or jsonb_typeof(p_raw) <> 'object' or not public.v3_payload_is_redacted(p_raw) then
    raise exception 'v3_inbox_payload_not_redacted' using errcode = '22023';
  end if;

  insert into public.v3_inbox (
    event_id, tenant_id, conversation_id, raw, received_at
  ) values (
    p_event_id, p_tenant_id, p_conversation_id, p_raw, p_received_at
  ) on conflict (event_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.v3_acquire_lease(
  p_tenant_id uuid,
  p_conversation_id text,
  p_owner text,
  p_ttl_ms integer,
  p_now timestamptz default now()
)
returns table(token text, acquired_at timestamptz, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ttl_ms <= 0 then
    raise exception 'v3_invalid_lease_ttl' using errcode = '22023';
  end if;

  return query
  insert into public.v3_leases as lease (
    conversation_id, tenant_id, owner, token, acquired_at, expires_at
  ) values (
    p_conversation_id,
    p_tenant_id,
    p_owner,
    gen_random_uuid()::text,
    p_now,
    p_now + make_interval(secs => p_ttl_ms::double precision / 1000.0)
  )
  on conflict (conversation_id) do update
    set owner = excluded.owner,
        token = excluded.token,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
  where lease.tenant_id = excluded.tenant_id
    and lease.expires_at <= p_now
  returning lease.token, lease.acquired_at, lease.expires_at;
end;
$$;

create or replace function public.v3_renew_lease(
  p_tenant_id uuid,
  p_conversation_id text,
  p_owner text,
  p_token text,
  p_ttl_ms integer,
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
  if p_ttl_ms <= 0 then
    raise exception 'v3_invalid_lease_ttl' using errcode = '22023';
  end if;

  update public.v3_leases
     set expires_at = p_now + make_interval(secs => p_ttl_ms::double precision / 1000.0)
   where tenant_id = p_tenant_id
     and conversation_id = p_conversation_id
     and owner = p_owner
     and token = p_token
     and expires_at > p_now;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.v3_release_lease(
  p_tenant_id uuid,
  p_conversation_id text,
  p_owner text,
  p_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.v3_leases
   where tenant_id = p_tenant_id
     and conversation_id = p_conversation_id
     and owner = p_owner
     and token = p_token;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.v3_claim_inbox_burst(
  p_tenant_id uuid,
  p_conversation_id text,
  p_cutoff timestamptz,
  p_claimed_by text,
  p_turn_id text,
  p_lease_token text,
  p_claim_ttl interval default interval '2 minutes',
  p_limit integer default 50,
  p_now timestamptz default now()
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids text[];
begin
  if p_limit <= 0 or p_limit > 500 then
    raise exception 'v3_invalid_claim_limit' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.v3_leases
    where tenant_id = p_tenant_id
      and conversation_id = p_conversation_id
      and owner = p_claimed_by
      and token = p_lease_token
      and expires_at > p_now
  ) then
    raise exception 'v3_lease_required_for_claim' using errcode = '55P03';
  end if;

  with candidates as (
    select inbox.event_id
    from public.v3_inbox inbox
    where inbox.tenant_id = p_tenant_id
      and inbox.conversation_id = p_conversation_id
      and inbox.received_at <= p_cutoff
      and (inbox.next_retry_at is null or inbox.next_retry_at <= p_now)
      and (
        inbox.status = 'pending'
        or (
          inbox.status = 'claimed'
          and inbox.claimed_at <= p_now - p_claim_ttl
        )
      )
    order by inbox.received_at, inbox.event_id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.v3_inbox inbox
       set status = 'claimed',
           claimed_by = p_claimed_by,
           turn_id = p_turn_id,
           claimed_at = p_now,
           attempts = inbox.attempts + 1,
           last_error = null
      from candidates
     where inbox.event_id = candidates.event_id
    returning inbox.event_id
  )
  select coalesce(array_agg(event_id order by event_id), '{}'::text[])
    into v_ids
  from claimed;

  return v_ids;
end;
$$;

create or replace function public.v3_release_inbox_claim(
  p_tenant_id uuid,
  p_event_ids text[],
  p_claimed_by text,
  p_turn_id text,
  p_error text default null
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids text[];
begin
  with released as (
    update public.v3_inbox
       set status = 'pending',
           claimed_by = null,
           turn_id = null,
           claimed_at = null,
           last_error = p_error
     where tenant_id = p_tenant_id
       and event_id = any(p_event_ids)
       and status = 'claimed'
       and claimed_by = p_claimed_by
       and turn_id = p_turn_id
    returning event_id
  )
  select coalesce(array_agg(event_id order by event_id), '{}'::text[])
    into v_ids
  from released;
  return v_ids;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. RPC: commit atomico do turno (CAS + decision + events + outbox + inbox)
-- ---------------------------------------------------------------------------

create or replace function public.v3_commit_turn(
  p_tenant_id uuid,
  p_conversation_id text,
  p_agent_id text,
  p_lead_id text,
  p_turn_id text,
  p_expected_version bigint,
  p_next_state jsonb,
  p_decision jsonb,
  p_events jsonb,
  p_outbox jsonb,
  p_event_ids text[],
  p_claimed_by text,
  p_lease_token text,
  p_now timestamptz default now()
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_version bigint := p_expected_version + 1;
  v_state jsonb;
  v_count integer;
  v_event_count integer;
begin
  if p_expected_version < 0 then
    raise exception 'v3_invalid_expected_version' using errcode = '22023';
  end if;
  if coalesce(array_length(p_event_ids, 1), 0) = 0 then
    raise exception 'v3_empty_inbox_claim' using errcode = '22023';
  end if;
  if (select count(*) from unnest(p_event_ids)) <>
     (select count(distinct id) from unnest(p_event_ids) as ids(id)) then
    raise exception 'v3_duplicate_inbox_event_ids' using errcode = '22023';
  end if;
  if jsonb_typeof(p_next_state) <> 'object'
    or jsonb_typeof(p_decision) <> 'object'
    or jsonb_typeof(p_events) <> 'array'
    or jsonb_typeof(p_outbox) <> 'array'
  then
    raise exception 'v3_commit_payload_shape_invalid' using errcode = '22023';
  end if;
  if p_decision ->> 'turnId' is distinct from p_turn_id then
    raise exception 'v3_decision_turn_mismatch' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.v3_leases
    where tenant_id = p_tenant_id
      and conversation_id = p_conversation_id
      and owner = p_claimed_by
      and token = p_lease_token
      and expires_at > p_now
  ) then
    raise exception 'v3_valid_lease_required_for_commit' using errcode = '55P03';
  end if;

  v_state := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(p_next_state, '{conversationId}', to_jsonb(p_conversation_id), true),
          '{tenantId}', to_jsonb(p_tenant_id::text), true
        ),
        '{agentId}', to_jsonb(p_agent_id), true
      ),
      '{version}', to_jsonb(v_new_version), true
    ),
    '{updatedAt}', to_jsonb(p_now::text), true
  );

  if p_expected_version = 0 then
    insert into public.v3_conversation_state (
      conversation_id, tenant_id, agent_id, lead_id, schema_version, version, state, created_at, updated_at
    ) values (
      p_conversation_id,
      p_tenant_id,
      p_agent_id,
      p_lead_id,
      coalesce((v_state ->> 'schemaVersion')::integer, 1),
      v_new_version,
      v_state,
      p_now,
      p_now
    ) on conflict (conversation_id) do nothing;
    get diagnostics v_count = row_count;
  else
    update public.v3_conversation_state
       set lead_id = p_lead_id,
           schema_version = coalesce((v_state ->> 'schemaVersion')::integer, schema_version),
           version = v_new_version,
           state = v_state,
           updated_at = p_now
     where tenant_id = p_tenant_id
       and conversation_id = p_conversation_id
       and agent_id = p_agent_id
       and version = p_expected_version;
    get diagnostics v_count = row_count;
  end if;

  if v_count <> 1 then
    raise exception 'v3_cas_conflict:expected=%', p_expected_version
      using errcode = '40001';
  end if;

  insert into public.v3_state_history (
    tenant_id, conversation_id, version, schema_version, state, source, turn_id, created_at
  ) values (
    p_tenant_id,
    p_conversation_id,
    v_new_version,
    coalesce((v_state ->> 'schemaVersion')::integer, 1),
    v_state,
    'turn_commit',
    p_turn_id,
    p_now
  );

  insert into public.v3_decisions (
    turn_id, tenant_id, conversation_id, action, reason_code, reason_summary,
    confidence, policy_checks, decision, at
  ) values (
    p_turn_id,
    p_tenant_id,
    p_conversation_id,
    p_decision ->> 'action',
    p_decision ->> 'reasonCode',
    p_decision ->> 'reasonSummary',
    (p_decision ->> 'confidence')::numeric,
    coalesce(p_decision -> 'policyChecks', '[]'::jsonb),
    p_decision,
    p_now
  );

  insert into public.v3_turn_events (
    event_id, tenant_id, correlation_id, conversation_id, turn_id, type,
    payload_schema_version, payload, at
  )
  select
    item ->> 'eventId',
    p_tenant_id,
    item ->> 'correlationId',
    p_conversation_id,
    p_turn_id,
    item ->> 'type',
    coalesce((item ->> 'payloadSchemaVersion')::integer, 1),
    item -> 'payload',
    coalesce(nullif(item ->> 'at', '')::timestamptz, p_now)
  from jsonb_array_elements(p_events) as items(item);

  insert into public.v3_effect_outbox (
    effect_id, idempotency_key, tenant_id, conversation_id, turn_id, plan_id,
    kind, payload, on_success, effect_order, depends_on, status, provider,
    provider_capability, receipt_level, attempts, next_retry_at, provider_receipt,
    outcome_applied_at, terminal_at, last_error, created_at, dispatched_at
  )
  select
    item ->> 'effectId',
    item ->> 'idempotencyKey',
    p_tenant_id,
    p_conversation_id,
    p_turn_id,
    item ->> 'planId',
    item ->> 'kind',
    item -> 'payload',
    coalesce(item -> 'onSuccess', '[]'::jsonb),
    (item ->> 'order')::integer,
    coalesce(
      array(select jsonb_array_elements_text(coalesce(item -> 'dependsOn', '[]'::jsonb))),
      '{}'::text[]
    ),
    'pending',
    item ->> 'provider',
    coalesce(item ->> 'providerCapability', 'none'),
    null,
    0,
    null,
    null,
    null,
    null,
    null,
    coalesce(nullif(item ->> 'createdAt', '')::timestamptz, p_now),
    null
  from jsonb_array_elements(p_outbox) as items(item);

  perform public.v3_validate_effect_graph(p_tenant_id, p_turn_id);

  update public.v3_inbox
     set status = 'done',
         done_at = p_now
   where tenant_id = p_tenant_id
     and event_id = any(p_event_ids)
     and status = 'claimed'
     and claimed_by = p_claimed_by
     and turn_id = p_turn_id;
  get diagnostics v_event_count = row_count;

  if v_event_count <> array_length(p_event_ids, 1) then
    raise exception 'v3_inbox_claim_mismatch:expected=%,updated=%',
      array_length(p_event_ids, 1), v_event_count
      using errcode = '40001';
  end if;

  return v_new_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. RPCs: claim/resultado/retry/skipped do outbox
-- ---------------------------------------------------------------------------

create or replace function public.v3_effect_satisfied(
  p_status text,
  p_required_receipt text,
  p_receipt_level text,
  p_outcome_applied_at timestamptz
)
returns boolean
language sql
immutable
as $$
  select case
    when p_status <> 'succeeded' then false
    when p_required_receipt = 'delivered'
      then p_receipt_level = 'delivered' and p_outcome_applied_at is not null
    else p_receipt_level in ('accepted', 'delivered')
  end
$$;

create or replace function public.v3_claim_outbox(
  p_worker_id text,
  p_ttl interval default interval '1 minute',
  p_limit integer default 25,
  p_now timestamptz default now()
)
returns setof public.v3_effect_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit <= 0 or p_limit > 200 then
    raise exception 'v3_invalid_outbox_claim_limit' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select effect.effect_id
    from public.v3_effect_outbox effect
    where effect.status = 'pending'
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
           processing_expires_at = p_now + p_ttl,
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

  -- Callbacks de provider sao at-least-once. Repeticoes e callbacks atrasados
  -- que tentariam rebaixar delivered para accepted sao no-op idempotente.
  if v_record.status = 'succeeded' and p_result_status = 'succeeded' then
    if v_record.receipt_level = 'delivered' and p_receipt_level in ('accepted', 'delivered') then
      return true;
    end if;
    if v_record.receipt_level = 'accepted' and p_receipt_level = 'accepted' then
      return true;
    end if;
  end if;

  -- Resultado inicial exige o token do claim. A unica excecao e o upgrade
  -- assincrono accepted -> delivered, recebido depois pelo webhook do provider.
  if v_record.status = 'processing' then
    if v_record.processing_token is distinct from p_processing_token then
      raise exception 'v3_outbox_processing_claim_mismatch:%', p_effect_id using errcode = '40001';
    end if;
  elsif not (
    v_record.status = 'succeeded'
    and v_record.receipt_level = 'accepted'
    and p_result_status = 'succeeded'
    and p_receipt_level = 'delivered'
    and p_processing_token is null
  ) then
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

create or replace function public.v3_requeue_outbox(
  p_tenant_id uuid,
  p_effect_id text,
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
     and status in ('failed', 'outcome_uncertain', 'processing')
     and provider_capability in ('idempotent', 'queryable')
     and outcome_applied_at is null;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.v3_skip_outbox(
  p_tenant_id uuid,
  p_effect_id text,
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
         processing_by = null,
         processing_token = null,
         processing_expires_at = null
   where tenant_id = p_tenant_id
     and effect_id = p_effect_id
     and status in ('pending', 'processing')
     and outcome_applied_at is null;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. RPC: EffectOutcomeCommit atomico e idempotente
-- ---------------------------------------------------------------------------

create or replace function public.v3_commit_effect_outcome(
  p_tenant_id uuid,
  p_conversation_id text,
  p_effect_id text,
  p_expected_version bigint,
  p_next_state jsonb default null,
  p_now timestamptz default now()
)
returns table(state_version bigint, applied boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.v3_effect_outbox%rowtype;
  v_state_record public.v3_conversation_state%rowtype;
  v_state jsonb;
  v_new_version bigint;
  v_count integer;
begin
  select * into v_record
  from public.v3_effect_outbox
  where tenant_id = p_tenant_id
    and conversation_id = p_conversation_id
    and effect_id = p_effect_id
  for update;

  if not found then
    raise exception 'v3_outbox_effect_not_found:%', p_effect_id using errcode = 'P0002';
  end if;

  if v_record.outcome_applied_at is not null then
    select version into state_version
    from public.v3_conversation_state
    where tenant_id = p_tenant_id and conversation_id = p_conversation_id;
    applied := false;
    return next;
    return;
  end if;

  if v_record.status <> 'succeeded' or v_record.receipt_level <> 'delivered' then
    raise exception 'v3_outcome_requires_delivered_success:%', p_effect_id using errcode = '22023';
  end if;

  select * into v_state_record
  from public.v3_conversation_state
  where tenant_id = p_tenant_id and conversation_id = p_conversation_id
  for update;

  if not found then
    raise exception 'v3_conversation_state_not_found:%', p_conversation_id using errcode = 'P0002';
  end if;
  if v_state_record.version <> p_expected_version then
    raise exception 'v3_outcome_cas_conflict:expected=%,actual=%',
      p_expected_version, v_state_record.version
      using errcode = '40001';
  end if;

  if jsonb_array_length(v_record.on_success) > 0 then
    if p_next_state is null or jsonb_typeof(p_next_state) <> 'object' then
      raise exception 'v3_outcome_next_state_required:%', p_effect_id using errcode = '22023';
    end if;

    v_new_version := p_expected_version + 1;
    v_state := jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(p_next_state, '{conversationId}', to_jsonb(p_conversation_id), true),
            '{tenantId}', to_jsonb(p_tenant_id::text), true
          ),
          '{agentId}', to_jsonb(v_state_record.agent_id), true
        ),
        '{version}', to_jsonb(v_new_version), true
      ),
      '{updatedAt}', to_jsonb(p_now::text), true
    );

    update public.v3_conversation_state
       set schema_version = coalesce((v_state ->> 'schemaVersion')::integer, schema_version),
           version = v_new_version,
           state = v_state,
           updated_at = p_now
     where tenant_id = p_tenant_id
       and conversation_id = p_conversation_id
       and version = p_expected_version;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception 'v3_outcome_cas_conflict_during_update' using errcode = '40001';
    end if;

    insert into public.v3_state_history (
      tenant_id, conversation_id, version, schema_version, state, source, effect_id, created_at
    ) values (
      p_tenant_id,
      p_conversation_id,
      v_new_version,
      coalesce((v_state ->> 'schemaVersion')::integer, 1),
      v_state,
      'effect_outcome',
      p_effect_id,
      p_now
    );

    insert into public.v3_turn_events (
      event_id, tenant_id, correlation_id, conversation_id, turn_id, type,
      payload_schema_version, payload, at
    ) values (
      p_effect_id || ':outcome',
      p_tenant_id,
      p_effect_id,
      p_conversation_id,
      v_record.turn_id,
      'effect_outcome_applied',
      1,
      jsonb_build_object('__redacted', true, 'effectId', p_effect_id),
      p_now
    ) on conflict (event_id) do nothing;
  else
    v_new_version := p_expected_version;
  end if;

  update public.v3_effect_outbox
     set outcome_applied_at = p_now,
         terminal_at = p_now
   where effect_id = p_effect_id
     and outcome_applied_at is null;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'v3_outcome_lost_idempotency_race:%', p_effect_id using errcode = '40001';
  end if;

  state_version := v_new_version;
  applied := true;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. RLS e privilegios
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'v3_conversation_state', 'v3_state_history', 'v3_inbox', 'v3_leases',
    'v3_turn_events', 'v3_query_log', 'v3_decisions', 'v3_effect_outbox',
    'v3_media_receipts', 'v3_messages', 'v3_shadow_comparisons'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('drop policy if exists v3_tenant_read on public.%I', v_table);
    execute format(
      'create policy v3_tenant_read on public.%I for select to authenticated using (auth.uid() = tenant_id)',
      v_table
    );
    execute format('revoke all on table public.%I from anon, authenticated', v_table);
    execute format('grant select on table public.%I to authenticated', v_table);
    execute format('grant all on table public.%I to service_role', v_table);
  end loop;

  alter table public.v3_sensitive_vault enable row level security;
  alter table public.v3_sensitive_vault force row level security;
  revoke all on table public.v3_sensitive_vault from anon, authenticated;
  grant all on table public.v3_sensitive_vault to service_role;
end;
$$;

revoke all on function public.v3_payload_is_redacted(jsonb) from public;
revoke all on function public.v3_touch_updated_at() from public;
revoke all on function public.v3_protect_outbox_identity() from public;
revoke all on function public.v3_validate_effect_graph(uuid, text) from public;
revoke all on function public.v3_validate_effect_graph_trigger() from public;
revoke all on function public.v3_ingest_inbox(uuid, text, text, jsonb, timestamptz) from public;
revoke all on function public.v3_acquire_lease(uuid, text, text, integer, timestamptz) from public;
revoke all on function public.v3_renew_lease(uuid, text, text, text, integer, timestamptz) from public;
revoke all on function public.v3_release_lease(uuid, text, text, text) from public;
revoke all on function public.v3_claim_inbox_burst(uuid, text, timestamptz, text, text, text, interval, integer, timestamptz) from public;
revoke all on function public.v3_release_inbox_claim(uuid, text[], text, text, text) from public;
revoke all on function public.v3_commit_turn(uuid, text, text, text, text, bigint, jsonb, jsonb, jsonb, jsonb, text[], text, text, timestamptz) from public;
revoke all on function public.v3_effect_satisfied(text, text, text, timestamptz) from public;
revoke all on function public.v3_claim_outbox(text, interval, integer, timestamptz) from public;
revoke all on function public.v3_record_outbox_result(uuid, text, text, text, text, jsonb, text, boolean, timestamptz, jsonb, timestamptz) from public;
revoke all on function public.v3_requeue_outbox(uuid, text, timestamptz, text) from public;
revoke all on function public.v3_skip_outbox(uuid, text, text, timestamptz) from public;
revoke all on function public.v3_commit_effect_outcome(uuid, text, text, bigint, jsonb, timestamptz) from public;

grant execute on function public.v3_ingest_inbox(uuid, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.v3_acquire_lease(uuid, text, text, integer, timestamptz) to service_role;
grant execute on function public.v3_renew_lease(uuid, text, text, text, integer, timestamptz) to service_role;
grant execute on function public.v3_release_lease(uuid, text, text, text) to service_role;
grant execute on function public.v3_claim_inbox_burst(uuid, text, timestamptz, text, text, text, interval, integer, timestamptz) to service_role;
grant execute on function public.v3_release_inbox_claim(uuid, text[], text, text, text) to service_role;
grant execute on function public.v3_commit_turn(uuid, text, text, text, text, bigint, jsonb, jsonb, jsonb, jsonb, text[], text, text, timestamptz) to service_role;
grant execute on function public.v3_claim_outbox(text, interval, integer, timestamptz) to service_role;
grant execute on function public.v3_record_outbox_result(uuid, text, text, text, text, jsonb, text, boolean, timestamptz, jsonb, timestamptz) to service_role;
grant execute on function public.v3_requeue_outbox(uuid, text, timestamptz, text) to service_role;
grant execute on function public.v3_skip_outbox(uuid, text, text, timestamptz) to service_role;
grant execute on function public.v3_commit_effect_outcome(uuid, text, text, bigint, jsonb, timestamptz) to service_role;

comment on table public.v3_sensitive_vault is
  'Cofre Pedro v3. ciphertext deve ser produzido por envelope encryption no adapter; nunca grave CPF/segredo cru.';
comment on column public.v3_effect_outbox.outcome_applied_at is
  'Somente mutacoes on_success efetivamente aplicadas ao estado apos receipt delivered.';
comment on column public.v3_effect_outbox.terminal_at is
  'Resolucao operacional terminal, inclusive succeeded sem mutacao, failed ou skipped.';

commit;

-- CUMULATIVE F2.5.1 OUTBOX PATCH
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

create index if not exists v3_effect_outbox_provider_message_lookup_idx
  on public.v3_effect_outbox (tenant_id, ((provider_receipt ->> 'providerMessageId')))
  where kind = 'send_message'
    and provider_receipt ? 'providerMessageId';

create or replace function public.v3_find_outbox_by_provider_message_id(
  p_tenant_id uuid,
  p_provider_message_id text
)
returns setof public.v3_effect_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tenant_id is null
    or p_provider_message_id is null
    or length(btrim(p_provider_message_id)) < 1
    or length(p_provider_message_id) > 240
  then
    raise exception 'v3_provider_message_id_invalid' using errcode = '22023';
  end if;

  return query
  select effect.*
    from public.v3_effect_outbox effect
   where effect.tenant_id = p_tenant_id
     and effect.kind = 'send_message'
     and effect.status = 'succeeded'
     and effect.receipt_level in ('accepted', 'delivered')
     and effect.provider_receipt ->> 'providerMessageId' = btrim(p_provider_message_id)
   order by effect.created_at desc, effect.effect_id desc
   limit 2;
end;
$$;

revoke all on function public.v3_find_outbox_by_provider_message_id(uuid, text) from public;
grant execute on function public.v3_find_outbox_by_provider_message_id(uuid, text) to service_role;

commit;
