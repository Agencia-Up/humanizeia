-- ============================================================================
-- Cron: cambio-update roda a cada 6 horas (FASE 2b da metrificacao de custo)
-- ----------------------------------------------------------------------------
-- Dispara a edge function cambio-update, que puxa o dolar (USD->BRL) da
-- AwesomeAPI e grava em public.config_cobranca (cambio_usd_brl + cambio_fonte +
-- cambio_atualizado_em). So leitura externa + 1 UPDATE da linha id=1. Nao toca
-- no Pedro nem em saldo de ninguem.
--
-- PADRAO (igual cron_pedro_trigger_followup / cron_flush_manager_feedbacks):
--   - URL do projeto hardcoded com DEFAULT = PROD (nao e segredo, e dominio
--     publico). STAGING sobrescreve via GUC app.cambio_url (ver abaixo).
--   - service_role_key lido do Vault (NUNCA hardcoded).
--
-- PRE-REQUISITO: secret 'service_role_key' precisa estar no Vault do ambiente.
--   Verificar: SELECT name FROM vault.decrypted_secrets WHERE name='service_role_key';
--
-- OVERRIDE EM STAGING (rodar UMA vez, fora desta migration, so no staging):
--   ALTER DATABASE postgres SET app.cambio_url =
--     'https://ezoltigtqgbmftmiwjxh.supabase.co/functions/v1/cambio-update';
--   (assim o cron do staging chama a function do staging, nao a de prod)
--
-- Idempotente: CREATE OR REPLACE + unschedule defensivo + reschedule.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cron_cambio_update_runner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  -- DEFAULT = PROD. Staging sobrescreve via GUC app.cambio_url (ALTER DATABASE).
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/cambio-update';
  v_service_key text;
BEGIN
  BEGIN
    v_url := COALESCE(NULLIF(current_setting('app.cambio_url', true), ''), v_url);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Lê service_role_key do Vault (NUNCA hardcoded)
  BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    RAISE WARNING '[cron_cambio_update_runner] service_role_key nao esta no Vault — abortando.';
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

COMMENT ON FUNCTION public.cron_cambio_update_runner() IS
  'Cron de 6 em 6 horas: dispara cambio-update (edge function) que atualiza o cambio USD->BRL em config_cobranca via AwesomeAPI. Le service_role_key do Vault; URL default=PROD, staging sobrescreve via GUC app.cambio_url.';

DO $$
BEGIN
  PERFORM cron.unschedule('cambio-update-6h');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cambio-update-6h',
  '0 */6 * * *',
  $$SELECT public.cron_cambio_update_runner()$$
);

DO $$
DECLARE v_jobs int;
BEGIN
  SELECT COUNT(*) INTO v_jobs FROM cron.job WHERE jobname='cambio-update-6h';
  RAISE NOTICE '[cambio-update] cron agendado: % job(s) ativos', v_jobs;
END $$;
