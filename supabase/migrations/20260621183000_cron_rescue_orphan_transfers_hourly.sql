-- ============================================================================
-- Cron: rescue-orphan-transfers roda de hora em hora
-- ----------------------------------------------------------------------------
-- Dispara a edge function rescue-orphan-transfers em modo LIVE para procurar
-- leads presos em status='transferido' sem assigned_to_id e redistribuir pelo
-- rodizio dos vendedores. A edge function respeita o horario operacional; fora
-- dele ela retorna "fora_do_horario" sem alterar nada.
--
-- PADRAO:
--   - URL default = PROD. Staging pode sobrescrever via GUC
--     app.rescue_orphan_transfers_url.
--   - service_role_key lido do Vault (NUNCA hardcoded).
--
-- PRE-REQUISITO:
--   SELECT name FROM vault.decrypted_secrets WHERE name='service_role_key';
--
-- OVERRIDE EM STAGING (rodar uma vez, fora desta migration):
--   ALTER DATABASE postgres SET app.rescue_orphan_transfers_url =
--     'https://ezoltigtqgbmftmiwjxh.supabase.co/functions/v1/rescue-orphan-transfers';
--
-- Idempotente: CREATE OR REPLACE + unschedule defensivo + reschedule.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cron_rescue_orphan_transfers_hourly()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/rescue-orphan-transfers';
  v_service_key text;
BEGIN
  BEGIN
    v_url := COALESCE(NULLIF(current_setting('app.rescue_orphan_transfers_url', true), ''), v_url);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    RAISE WARNING '[cron_rescue_orphan_transfers_hourly] service_role_key nao esta no Vault - abortando.';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key,
      'apikey', v_service_key
    ),
    body := jsonb_build_object(
      'dry_run', false,
      'limit', 100
    )
  );
END;
$$;

COMMENT ON FUNCTION public.cron_rescue_orphan_transfers_hourly() IS
  'Cron horario: chama rescue-orphan-transfers em modo live para resgatar leads transferidos sem vendedor, respeitando a janela operacional da edge function.';

DO $$
BEGIN
  PERFORM cron.unschedule('rescue-orphan-transfers-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'rescue-orphan-transfers-hourly',
  '7 * * * *',
  $$SELECT public.cron_rescue_orphan_transfers_hourly()$$
);

DO $$
DECLARE v_jobs int;
BEGIN
  SELECT COUNT(*) INTO v_jobs FROM cron.job WHERE jobname = 'rescue-orphan-transfers-hourly';
  RAISE NOTICE '[rescue-orphan-transfers] cron agendado: % job(s) ativos', v_jobs;
END $$;
