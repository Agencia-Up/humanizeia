-- Restore the mass-send queue processor cron.
-- The campaign can be "running" with pending wa_queue rows, but nothing is sent
-- if pg_cron is not calling process-whatsapp-queue.

CREATE OR REPLACE FUNCTION public.cron_process_whatsapp_queue_runner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/process-whatsapp-queue';
  v_service_key text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  -- Fallback to the existing production service key used by older cron migrations.
  -- Prefer vault when it is configured; keep this fallback so production does not
  -- silently stop if the vault secret is missing.
  IF v_service_key IS NULL OR v_service_key = '' THEN
    v_service_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNleWxqc3FtaGxvcGtjYXVobG9yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzkzMDEyNywiZXhwIjoyMDg5NTA2MTI3fQ.b5oaiDazO1ncJYdwlHJo-tnOx88UBjeIwCf175eBrJM';
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
  PERFORM cron.unschedule('process-whatsapp-queue');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'process-whatsapp-queue',
  '* * * * *',
  $$SELECT public.cron_process_whatsapp_queue_runner()$$
);

COMMENT ON FUNCTION public.cron_process_whatsapp_queue_runner() IS
  'Cron 1min: calls process-whatsapp-queue to send one due wa_queue item while respecting campaign delays and instance rules.';
