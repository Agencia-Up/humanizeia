-- ============================================================================
-- Cron: cron-flush-manager-feedbacks roda a cada 5 minutos
-- ============================================================================
-- A edge function decide internamente se há config em modo 'scheduled' cuja
-- janela horária está ativa AGORA. Se não houver, retorna sem fazer nada.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cron_flush_manager_feedbacks_runner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/cron-flush-manager-feedbacks';
  v_service_key text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    RAISE NOTICE 'cron_flush_manager_feedbacks_runner: service_role_key não está no vault — abortando';
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
  PERFORM cron.unschedule('flush-manager-feedbacks-5min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'flush-manager-feedbacks-5min',
  '*/5 * * * *',
  $$SELECT public.cron_flush_manager_feedbacks_runner()$$
);

COMMENT ON FUNCTION public.cron_flush_manager_feedbacks_runner() IS
  'Cron de 5 em 5 minutos: dispara cron-flush-manager-feedbacks (edge function).';
