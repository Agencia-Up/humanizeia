-- Monitor de saude do Pedro v2 (registro diario). Tabela de relatorios + cron que chama o
-- edge function pedro-v2-health-monitor 1x/dia. Decisao do dono: SO registro (sem WhatsApp).
create table if not exists public.pedro_v2_health_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  window_hours int,
  total_turns int,
  has_findings boolean,
  counts jsonb,
  samples jsonb
);
alter table public.pedro_v2_health_reports enable row level security;
-- Leitura so superadmin (reusa _is_caller_superadmin do platform_settings). O edge function grava
-- via service_role (bypassa RLS).
drop policy if exists "health_reports_superadmin_read" on public.pedro_v2_health_reports;
create policy "health_reports_superadmin_read" on public.pedro_v2_health_reports
  for select to authenticated using (public._is_caller_superadmin());

-- Wrapper do cron: le service_role_key do Vault e chama o edge function (mesmo padrao dos demais crons).
create or replace function public.cron_pedro_v2_health()
returns void
language plpgsql
security definer
as $$
declare
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/pedro-v2-health-monitor';
  v_key text;
begin
  begin
    v_url := coalesce(nullif(current_setting('app.health_monitor_url', true), ''), v_url);
  exception when others then null;
  end;
  begin
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  exception when others then v_key := null;
  end;
  if v_key is null or v_key = '' then
    raise warning '[cron_pedro_v2_health] service_role_key ausente no Vault — abortando.';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('hours', 24)
  );
end;
$$;

-- Agenda diario as 23:00 UTC (~20:00 BRT). Idempotente: desagenda antes de reagendar.
do $$ begin
  perform cron.unschedule('pedro-v2-health');
exception when others then null;
end $$;
select cron.schedule('pedro-v2-health', '0 23 * * *', $$select public.cron_pedro_v2_health()$$);
