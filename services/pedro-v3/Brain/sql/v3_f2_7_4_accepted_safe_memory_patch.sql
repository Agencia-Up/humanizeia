-- ============================================================================
-- Pedro v3 — F2.7.4-A — Memoria accepted-safe (alinhar o contrato SQL ao codigo)
-- O dono aplica MANUALMENTE no SQL Editor do Supabase. NUNCA via db push. Idempotente.
--
-- POR QUE: o codigo (TS) ja aplica `append_assistant_turn` no receipt "accepted" (memoria do que o AGENTE
-- ENVIOU != confirmacao de que o lead RECEBEU). Mas o banco de prod ainda exige "delivered" para QUALQUER
-- on_success -> o outcome era rejeitado -> recentTurns ficava VAZIO (agente se reapresentava, sem memoria).
-- Este patch alinha o SQL ao contrato accepted-safe, SEM tocar CRM/handoff/schedule/midia/objetivo/oferta.
--
-- REGRA (fonte unica = funcao v3_required_receipt_level):
--   accepted  -> kind='send_message' E on_success vazio OU so 'append_assistant_turn'
--   delivered -> qualquer outro caso (outro op no on_success; ou send_media/crm_write/schedule_visit/
--                handoff/notify_seller). Acoes comerciais/entrega NAO avancam por accepted.
-- ============================================================================

begin;

-- 1) FONTE UNICA da regra accepted-safe.
create or replace function public.v3_required_receipt_level(p_kind text, p_on_success jsonb)
returns text
language sql
immutable
as $$
  select case
    when p_kind = 'send_message'
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(p_on_success, '[]'::jsonb)) as e
        where e->>'op' is distinct from 'append_assistant_turn'
      )
    then 'accepted'
    else 'delivered'
  end
$$;

-- 2) Coluna gerada `required_receipt_level` -> usa o helper (drop+add: nao da p/ alterar expressao gerada).
--    Sem indice nela (verificado), entao o drop nao remove indices.
alter table public.v3_effect_outbox drop constraint if exists v3_outbox_applied_only_after_delivery_ck;
alter table public.v3_effect_outbox drop column if exists required_receipt_level;
alter table public.v3_effect_outbox
  add column required_receipt_level text
  generated always as (public.v3_required_receipt_level(kind, on_success)) stored;

-- 3) Check: `outcome_applied_at` com `accepted` SOMENTE no caso accepted-safe. Comercial/entrega segue delivered.
alter table public.v3_effect_outbox
  add constraint v3_outbox_applied_only_after_delivery_ck check (
    outcome_applied_at is null
    or (status = 'succeeded' and receipt_level = 'delivered')
    or (status = 'succeeded' and receipt_level = 'accepted'
        and public.v3_required_receipt_level(kind, on_success) = 'accepted')
  );

-- 4) RPC de outcome: valida o receipt MINIMO real (helper). accepted-safe aceita accepted/delivered; o resto
--    exige delivered. NAO rebaixa delivered. O early-return (outcome_applied_at) garante delivered POSTERIOR
--    idempotente (nao reaplica, nao duplica append_assistant_turn).
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

  -- F2.7.4-A: receipt minimo real exigido por este record (coluna gerada via helper accepted-safe).
  if v_record.status <> 'succeeded'
     or not (
       v_record.receipt_level = 'delivered'
       or (v_record.required_receipt_level = 'accepted' and v_record.receipt_level = 'accepted')
     )
  then
    raise exception 'v3_outcome_requires_%_receipt:%', v_record.required_receipt_level, p_effect_id using errcode = '22023';
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

revoke all on function public.v3_commit_effect_outcome(uuid, text, text, bigint, jsonb, timestamptz) from public;
revoke all on function public.v3_commit_effect_outcome(uuid, text, text, bigint, jsonb, timestamptz) from anon;
revoke all on function public.v3_commit_effect_outcome(uuid, text, text, bigint, jsonb, timestamptz) from authenticated;
grant execute on function public.v3_commit_effect_outcome(uuid, text, text, bigint, jsonb, timestamptz) to service_role;

commit;

-- ============================================================================
-- VERIFICADOR (read-only, NAO muta nada). Rode DEPOIS de aplicar o patch acima.
-- Espera-se "all_ok": true. A regra (helper) e a UNICA fonte usada pela coluna gerada, pelo check e pelo RPC,
-- entao validar o helper valida os 3. Os casos comportamentais (insert/commit/idempotencia/delivered-posterior)
-- sao provados OFFLINE pelo teste pglite `tests/run-sql-schema.ts` (sem tocar o banco de prod).
-- ============================================================================
-- with checks as (
--   select jsonb_build_object(
--     'send_message_assistant_only_accepted',  public.v3_required_receipt_level('send_message', '[{"op":"append_assistant_turn"}]'::jsonb) = 'accepted',
--     'send_message_vazio_accepted',           public.v3_required_receipt_level('send_message', '[]'::jsonb) = 'accepted',
--     'send_message_mark_delivered_delivered', public.v3_required_receipt_level('send_message', '[{"op":"append_assistant_turn"},{"op":"mark_message_delivered"}]'::jsonb) = 'delivered',
--     'send_message_activate_objective_delivered', public.v3_required_receipt_level('send_message', '[{"op":"activate_objective"}]'::jsonb) = 'delivered',
--     'send_message_record_offer_delivered',   public.v3_required_receipt_level('send_message', '[{"op":"record_offer"}]'::jsonb) = 'delivered',
--     'send_media_delivered',                  public.v3_required_receipt_level('send_media', '[]'::jsonb) = 'delivered',
--     'crm_write_delivered',                   public.v3_required_receipt_level('crm_write', '[]'::jsonb) = 'delivered',
--     'schedule_visit_delivered',              public.v3_required_receipt_level('schedule_visit', '[]'::jsonb) = 'delivered',
--     'handoff_delivered',                     public.v3_required_receipt_level('handoff', '[]'::jsonb) = 'delivered',
--     'notify_seller_delivered',               public.v3_required_receipt_level('notify_seller', '[]'::jsonb) = 'delivered'
--   ) as c
-- )
-- select c as checks, (not (c::text ~ ': ?false')) as all_ok from checks;
