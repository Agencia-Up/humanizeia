-- Mantem o ACK do webhook ligado a uma ingestao duravel, sem perder o
-- enriquecimento posterior de audio/anuncio.
--
-- A primeira chamada cria a linha pending. Uma segunda chamada com o MESMO
-- event_id pode complementar raw enquanto nenhum worker a reivindicou. Ela
-- continua retornando false (duplicata), portanto nao cria outro turno.
-- Linhas claimed/done/error nunca sao alteradas.

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
  if v_count = 1 then
    return true;
  end if;

  update public.v3_inbox as inbox
     set raw = inbox.raw || p_raw
   where inbox.event_id = p_event_id
     and inbox.tenant_id = p_tenant_id
     and inbox.conversation_id = p_conversation_id
     and inbox.status = 'pending';

  return false;
end;
$$;

revoke all on function public.v3_ingest_inbox(uuid, text, text, jsonb, timestamptz) from public;
grant execute on function public.v3_ingest_inbox(uuid, text, text, jsonb, timestamptz) to service_role;
