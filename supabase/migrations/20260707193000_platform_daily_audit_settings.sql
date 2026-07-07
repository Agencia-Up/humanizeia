-- Daily platform audit settings and cron.
-- Stores the WhatsApp sender instance and recipient admin numbers used by the
-- daily 08:00 America/Sao_Paulo operational check-up.

alter table public.platform_settings
  add column if not exists daily_audit_enabled boolean not null default false,
  add column if not exists daily_audit_sender_instance_id uuid,
  add column if not exists daily_audit_recipient_phones text[] not null default '{}'::text[],
  add column if not exists daily_audit_last_run_at timestamptz,
  add column if not exists daily_audit_last_summary jsonb;

-- Keep the helper aligned with the platform owners.
create or replace function public._is_caller_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_superadmin from public.profiles p where p.id = auth.uid()), false)
      or coalesce((select (lower(u.email) in ('wandercarvalho31@gmail.com', 'douglasaloan@gmail.com')) from auth.users u where u.id = auth.uid()), false);
$$;

create or replace function public.get_platform_daily_audit_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings public.platform_settings%rowtype;
  v_sender jsonb;
  v_senders jsonb;
begin
  if not public._is_caller_superadmin() then
    return null;
  end if;

  select * into v_settings
    from public.platform_settings
   where id = 'global';

  if not found then
    insert into public.platform_settings (id) values ('global')
    returning * into v_settings;
  end if;

  select jsonb_build_object(
      'id', wi.id,
      'friendly_name', wi.friendly_name,
      'phone_number', wi.phone_number,
      'status', wi.status,
      'is_active', wi.is_active,
      'client_name', coalesce(p.company_name, p.full_name)
    )
    into v_sender
    from public.wa_instances wi
    left join public.profiles p on p.id = wi.user_id
   where wi.id = v_settings.daily_audit_sender_instance_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id,
      'friendly_name', x.friendly_name,
      'phone_number', x.phone_number,
      'status', x.status,
      'is_active', x.is_active,
      'client_name', x.client_name
    ) order by x.is_active desc, x.status = 'connected' desc, x.client_name nulls last, x.friendly_name), '[]'::jsonb)
    into v_senders
    from (
      select wi.id, wi.friendly_name, wi.phone_number, wi.status, wi.is_active,
             coalesce(p.company_name, p.full_name) as client_name
        from public.wa_instances wi
        left join public.profiles p on p.id = wi.user_id
       where coalesce(wi.provider, 'uazapi') <> 'meta'
         and wi.api_url is not null
         and wi.api_key_encrypted is not null
       order by wi.is_active desc, wi.status = 'connected' desc, wi.updated_at desc
       limit 80
    ) x;

  return jsonb_build_object(
    'enabled', coalesce(v_settings.daily_audit_enabled, false),
    'sender_instance_id', v_settings.daily_audit_sender_instance_id,
    'sender_instance', v_sender,
    'recipient_phones', coalesce(to_jsonb(v_settings.daily_audit_recipient_phones), '[]'::jsonb),
    'last_run_at', v_settings.daily_audit_last_run_at,
    'last_summary', v_settings.daily_audit_last_summary,
    'sender_candidates', v_senders
  );
end;
$$;

create or replace function public.set_platform_daily_audit_settings(
  p_enabled boolean,
  p_sender_instance_id uuid,
  p_recipient_phones text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phones text[];
  v_sender_exists boolean;
begin
  if not public._is_caller_superadmin() then
    raise exception 'forbidden: only platform admins can set daily audit settings';
  end if;

  select coalesce(array_agg(distinct d), '{}'::text[]) into v_phones
    from (
      select nullif(regexp_replace(coalesce(x, ''), '\D', '', 'g'), '') as d
        from unnest(coalesce(p_recipient_phones, '{}'::text[])) as x
    ) s
   where d is not null and length(d) between 10 and 15;

  if p_sender_instance_id is not null then
    select exists (
      select 1
        from public.wa_instances wi
       where wi.id = p_sender_instance_id
         and coalesce(wi.provider, 'uazapi') <> 'meta'
         and wi.api_url is not null
         and wi.api_key_encrypted is not null
    ) into v_sender_exists;
    if not v_sender_exists then
      raise exception 'sender instance not found or not supported';
    end if;
  end if;

  insert into public.platform_settings (
    id,
    daily_audit_enabled,
    daily_audit_sender_instance_id,
    daily_audit_recipient_phones,
    updated_at,
    updated_by
  )
  values (
    'global',
    coalesce(p_enabled, false),
    p_sender_instance_id,
    coalesce(v_phones, '{}'::text[]),
    now(),
    auth.uid()
  )
  on conflict (id) do update
    set daily_audit_enabled = excluded.daily_audit_enabled,
        daily_audit_sender_instance_id = excluded.daily_audit_sender_instance_id,
        daily_audit_recipient_phones = excluded.daily_audit_recipient_phones,
        updated_at = now(),
        updated_by = auth.uid();

  return public.get_platform_daily_audit_settings();
end;
$$;

revoke all on function public.get_platform_daily_audit_settings() from public, anon;
revoke all on function public.set_platform_daily_audit_settings(boolean, uuid, text[]) from public, anon;
grant execute on function public.get_platform_daily_audit_settings() to authenticated;
grant execute on function public.set_platform_daily_audit_settings(boolean, uuid, text[]) to authenticated;

do $$ begin
  perform cron.unschedule('platform-daily-audit-8am');
exception when others then null;
end $$;

-- 08:00 Sao Paulo = 11:00 UTC.
select cron.schedule(
  'platform-daily-audit-8am',
  '0 11 * * *',
  $$
  select net.http_post(
    url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/platform-daily-audit',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
    ),
    body := jsonb_build_object('source', 'cron', 'send_whatsapp', true)
  );
  $$
);
