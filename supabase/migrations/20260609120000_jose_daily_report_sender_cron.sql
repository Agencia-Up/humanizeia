-- Relatório diário do José via WhatsApp — ADITIVO.
-- 1) Permite escolher QUAL número (instância) envia o relatório.
-- 2) Liga o cron que dispara o apollo-cron-runner (hoje nao havia pg_cron, entao
--    o relatorio diario nunca rodava sozinho).

-- 1) Instância que ENVIA o relatório (numero conectado escolhido pelo usuario).
alter table public.apollo_cron_config
  add column if not exists report_sender_instance_id uuid;
comment on column public.apollo_cron_config.report_sender_instance_id is
  'wa_instances.id usada pra ENVIAR o relatorio diario. Se null, usa a primeira instancia conectada.';

-- 2) Cron que aciona o apollo-cron-runner (ele acha os usuarios agendados e
--    dispara a analise + relatorio). So chama se houver alguem agendado vencido.
create or replace function public.cron_apollo_runner_tick()
returns void
language plpgsql
security definer
as $$
declare
  v_service_key text;
  v_url text;
begin
  begin
    select decrypted_secret into v_service_key
    from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  exception when others then
    v_service_key := null;
  end;

  v_url := 'https://ezoltigtqgbmftmiwjxh.supabase.co/functions/v1/apollo-cron-runner';

  if v_service_key is null or v_service_key = '' then
    raise notice 'cron_apollo_runner_tick: service_role_key missing';
    return;
  end if;

  if not exists (
    select 1 from public.apollo_cron_config
    where is_enabled = true and (next_run_at is null or next_run_at <= now())
  ) then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := '{}'::jsonb
  );
end;
$$;

do $$
begin
  perform cron.unschedule('apollo-runner-tick');
exception when others then null;
end $$;

select cron.schedule(
  'apollo-runner-tick',
  '*/15 * * * *',
  $$select public.cron_apollo_runner_tick()$$
);
