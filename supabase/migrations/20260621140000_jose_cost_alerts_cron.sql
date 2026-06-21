-- ============================================================================
-- JOSÉ v3.1 — FASE 0: cron diário do jose-cost-alerts
-- ----------------------------------------------------------------------------
-- Agrega o custo de IA por tenant (jose_usage_ledger) e dispara jose_cost_alerts
-- quando passa do threshold. Roda 1x/dia (23:30 UTC ~ 20:30 BRT). Idempotente.
--
-- SEGURANÇA: o bearer NÃO fica em texto no arquivo. É lido do Vault
-- (vault.decrypted_secrets, nome 'service_role_key'). Pré-requisito (1x):
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
-- (faço isso no deploy, ou rode você no Dashboard. NUNCA commitar a chave.)
-- ============================================================================

DO $$ BEGIN
  PERFORM cron.unschedule('jose-cost-alerts');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'jose-cost-alerts',
  '30 23 * * *',
  $$
  SELECT net.http_post(
    url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/jose-cost-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
