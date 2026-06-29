-- Pedro v3 F2.6L - observabilidade: gravar o motivo sanitizado da falha de turno em v3_inbox.last_error.
-- O dono aplica MANUALMENTE no SQL Editor do Supabase. NUNCA via db push.
--
-- Por que: quando o turno do v3 falha, o erro fica so no log do container (EasyPanel), invisivel pelo
-- Supabase. Esta RPC deixa o serviço gravar o motivo SANITIZADO (sem segredo) na linha do inbox, pra
-- diagnosticar a raiz pelo banco. Tenant-scoped; so service-role chama.

begin;

create or replace function public.v3_record_inbox_error(
  p_tenant_id uuid,
  p_event_id text,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tenant_id is null or p_event_id is null or length(btrim(p_event_id)) < 1 then
    raise exception 'v3_record_inbox_error_invalid_args' using errcode = '22023';
  end if;

  update public.v3_inbox
     set last_error = left(coalesce(p_error, ''), 500),
         updated_at = now()
   where tenant_id = p_tenant_id
     and event_id = p_event_id;
end;
$$;

revoke all on function public.v3_record_inbox_error(uuid, text, text) from public;
revoke all on function public.v3_record_inbox_error(uuid, text, text) from anon;
revoke all on function public.v3_record_inbox_error(uuid, text, text) from authenticated;
grant execute on function public.v3_record_inbox_error(uuid, text, text) to service_role;

commit;

-- Verificacao read-only:
--   select count(*) = 1 as function_ok from pg_proc where proname = 'v3_record_inbox_error';
