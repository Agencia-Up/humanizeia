-- =============================================================================
-- Cron: wa-automation-runner roda a cada 5 minutos
-- =============================================================================
-- Processa wa_automation_flows ativos. MVP suporta SOMENTE nó add_to_list.
-- A função é idempotente: re-execução não duplica nada
-- (UNIQUE(flow_id, contact_id) em wa_automation_runs + ON CONFLICT em wa_contact_list_members).
--
-- URL hardcoded em prod (mesmo padrão dos outros crons do projeto).
-- Em staging: testar manualmente via dashboard / curl.

CREATE OR REPLACE FUNCTION public.cron_wa_automation_runner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/wa-automation-runner';
  v_service_key text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    RAISE NOTICE 'cron_wa_automation_runner: service_role_key não está no vault — abortando';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := '{}'::jsonb
  );
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('wa-automation-runner-5min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'wa-automation-runner-5min',
  '*/5 * * * *',
  $$SELECT public.cron_wa_automation_runner()$$
);

COMMENT ON FUNCTION public.cron_wa_automation_runner() IS
  'Cron de 5 em 5 minutos: dispara wa-automation-runner (Item 4 executor). Em staging testar manualmente.';
