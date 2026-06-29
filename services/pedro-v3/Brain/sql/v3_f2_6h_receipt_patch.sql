-- Pedro v3 F2.6H - locate an outbound effect from a Uazapi delivery callback.
-- Owner applies this patch manually in Supabase SQL Editor. Never via db push.

begin;

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