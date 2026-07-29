-- ============================================================================
-- F3 — agendamento da reconciliacao incremental (cron 10 min -> wa-sync-reconcile).
-- ADITIVO. O dispatcher so age nos tenants da allowlist WA_SYNC_TENANT_IDS (piloto);
-- allowlist vazia = no-op. Idempotente (unschedule antes de schedule).
-- ============================================================================
select cron.unschedule('wa-sync-reconcile-10min')
 where exists (select 1 from cron.job where jobname = 'wa-sync-reconcile-10min');

select cron.schedule(
  'wa-sync-reconcile-10min',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/wa-sync-reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)),
    body := jsonb_build_object('trigger_source', 'cron'),
    timeout_milliseconds := 120000)
  $$
);
