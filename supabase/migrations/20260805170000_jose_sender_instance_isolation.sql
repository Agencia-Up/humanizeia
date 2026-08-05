-- Isolamento do remetente do Jose.
--
-- Uma linha de vendedor pode continuar conectada para inbox, transferencia,
-- confirmacao e atendimento. Ela apenas nao pode ser configurada nem usada
-- como identidade de envio do Jose.

alter table public.apollo_cron_config
  add column if not exists report_sender_instance_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'apollo_cron_config_report_sender_instance_id_fkey'
      and conrelid = 'public.apollo_cron_config'::regclass
  ) then
    alter table public.apollo_cron_config
      add constraint apollo_cron_config_report_sender_instance_id_fkey
      foreign key (report_sender_instance_id)
      references public.wa_instances(id)
      on delete set null;
  end if;
end;
$$;

create or replace function public.enforce_jose_report_sender_instance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_instance public.wa_instances%rowtype;
begin
  if new.report_sender_instance_id is null then
    return new;
  end if;

  select * into v_instance
  from public.wa_instances
  where id = new.report_sender_instance_id;

  if not found then
    raise exception 'instancia remetente do Jose nao encontrada';
  end if;

  if v_instance.user_id <> new.user_id then
    raise exception 'instancia remetente do Jose pertence a outro tenant';
  end if;

  if v_instance.seller_member_id is not null then
    raise exception 'BLOQUEADO: numero de vendedor nunca pode enviar como Jose';
  end if;

  if not exists (
    select 1
    from public.wa_ai_agents a
    where a.user_id = new.user_id
      and coalesce(a.is_active, false)
      and (
        a.instance_id = new.report_sender_instance_id
        or new.report_sender_instance_id = any(coalesce(a.instance_ids, '{}'::uuid[]))
      )
  ) then
    raise exception 'instancia remetente do Jose nao esta vinculada a agente ativo';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_jose_report_sender_instance() from public, anon, authenticated;

drop trigger if exists trg_enforce_jose_report_sender_instance on public.apollo_cron_config;
create trigger trg_enforce_jose_report_sender_instance
before insert or update of user_id, report_sender_instance_id
on public.apollo_cron_config
for each row execute function public.enforce_jose_report_sender_instance();

-- Remove configuracoes legadas que apontem para vendedor, outro tenant ou
-- linha que nao representa um agente ativo. O relatorio usara o fallback
-- institucional seguro no proximo ciclo.
update public.apollo_cron_config c
set report_sender_instance_id = null,
    updated_at = now()
where c.report_sender_instance_id is not null
  and not exists (
    select 1
    from public.wa_instances i
    join public.wa_ai_agents a
      on a.user_id = c.user_id
     and coalesce(a.is_active, false)
     and (a.instance_id = i.id or i.id = any(coalesce(a.instance_ids, '{}'::uuid[])))
    where i.id = c.report_sender_instance_id
      and i.user_id = c.user_id
      and i.seller_member_id is null
  );

-- Se uma linha institucional for posteriormente entregue a um vendedor, a
-- configuracao do Jose e removida no mesmo commit. Os demais vinculos da linha
-- (inbox/fila/atendimento) permanecem intactos.
create or replace function public.clear_jose_sender_when_instance_becomes_seller()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.seller_member_id is not null
     and old.seller_member_id is distinct from new.seller_member_id then
    update public.apollo_cron_config
    set report_sender_instance_id = null,
        updated_at = now()
    where report_sender_instance_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_jose_sender_when_instance_becomes_seller() from public, anon, authenticated;

drop trigger if exists trg_clear_jose_sender_when_instance_becomes_seller on public.wa_instances;
create trigger trg_clear_jose_sender_when_instance_becomes_seller
after update of seller_member_id
on public.wa_instances
for each row execute function public.clear_jose_sender_when_instance_becomes_seller();

comment on function public.enforce_jose_report_sender_instance() is
  'Impede que o Jose use linha de vendedor, de outro tenant ou sem agente ativo como remetente.';
