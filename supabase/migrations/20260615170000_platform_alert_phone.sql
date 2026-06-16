-- platform_settings: configs GLOBAIS da plataforma (singleton id='global'). Hoje guarda o
-- telefone que recebe o alerta quando a NOSSA chave de IA (contas grandfathered) falha por
-- falta de credito / chave invalida. So o superadmin le/escreve (via RPC); o edge function le
-- com service_role (bypassa RLS).
create table if not exists public.platform_settings (
  id text primary key default 'global',
  alert_phone text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.platform_settings (id) values ('global') on conflict (id) do nothing;

alter table public.platform_settings enable row level security;
-- Sem policies de acesso direto p/ authenticated: tudo passa pelas RPCs (SECURITY DEFINER) ou service_role.

-- O chamador atual e superadmin? (flag no profile OU email do dono).
create or replace function public._is_caller_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_superadmin from public.profiles p where p.id = auth.uid()), false)
      or coalesce((select (u.email = 'wandercarvalho31@gmail.com') from auth.users u where u.id = auth.uid()), false);
$$;

-- Le o telefone de alerta da plataforma (so superadmin; senao null).
create or replace function public.get_platform_alert_phone()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public._is_caller_superadmin() then
    return null;
  end if;
  return (select alert_phone from public.platform_settings where id = 'global');
end;
$$;

-- Grava/limpa o telefone (so superadmin). Normaliza p/ so digitos; vazio -> null.
create or replace function public.set_platform_alert_phone(p_phone text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean text;
begin
  if not public._is_caller_superadmin() then
    raise exception 'forbidden: only platform admins can set the alert phone';
  end if;
  v_clean := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  update public.platform_settings
     set alert_phone = v_clean, updated_at = now(), updated_by = auth.uid()
   where id = 'global';
  if not found then
    insert into public.platform_settings (id, alert_phone, updated_by) values ('global', v_clean, auth.uid());
  end if;
  return v_clean;
end;
$$;

revoke all on function public.get_platform_alert_phone() from public, anon;
revoke all on function public.set_platform_alert_phone(text) from public, anon;
grant execute on function public.get_platform_alert_phone() to authenticated;
grant execute on function public.set_platform_alert_phone(text) to authenticated;
