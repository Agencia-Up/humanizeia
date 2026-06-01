-- ============================================================================
-- 20260601160000_cron_followup_reactivation.sql
-- ----------------------------------------------------------------------------
-- Cron que dispara o MOTOR de reativacao automatica (pedro-auto-followup).
--
-- SEGURANCA (importante):
--  - O motor (edge function) so envia de verdade quando a secret
--    PEDRO_FF_AUTO_REACTIVATION = 'on'. Enquanto ela estiver OFF (padrao),
--    este cron pode rodar a vontade que o motor responde "disabled" e NAO
--    envia nada. Ou seja: subir este cron em producao NAO dispara mensagem
--    pra ninguem ate o master ligar a flag.
--  - JWT (service_role) lido do Vault — NUNCA hardcoded. Mesmo padrao do
--    20260527170000_pedro_followup_cron_vault.sql.
--  - URL: default = PROD; em STAGING sobrescreve via setting app.auto_followup_url
--    (set explicito no deploy de staging), pra um ambiente nunca chamar o outro.
--
-- Frequencia: a cada 5 min. O proprio motor respeita horario/dias, teto/dia,
-- intervalo (piso 3 min) e a fila em rodizio — entao rodar de 5 em 5 min so
-- "checa se tem algo a fazer agora".
-- ============================================================================

-- 1. Remove agendamento anterior (idempotente).
DO $$
BEGIN
  PERFORM cron.unschedule('pedro-auto-followup');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[cron-reactivation] job pedro-auto-followup nao existia — OK';
END $$;

-- 2. Funcao wrapper: le service_role_key do Vault e chama o motor.
CREATE OR REPLACE FUNCTION public.cron_pedro_auto_followup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  -- URL default = PROD (dominio publico do projeto, NAO e segredo).
  -- Em STAGING, sobrescreve com:
  --   ALTER DATABASE postgres SET app.auto_followup_url =
  --     'https://ezoltigtqgbmftmiwjxh.supabase.co/functions/v1/pedro-auto-followup';
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/pedro-auto-followup';
  v_service_key text;
BEGIN
  BEGIN
    v_url := COALESCE(NULLIF(current_setting('app.auto_followup_url', true), ''), v_url);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    RAISE WARNING '[cron_pedro_auto_followup] service_role_key ausente no Vault — abortando.';
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

COMMENT ON FUNCTION public.cron_pedro_auto_followup() IS
  'Cron do motor de reativacao automatica (Follow-up IA). Le service_role_key do Vault. O envio real so ocorre se a secret PEDRO_FF_AUTO_REACTIVATION=on no edge function pedro-auto-followup.';

-- 3. Agenda a cada 5 min.
SELECT cron.schedule(
  'pedro-auto-followup',
  '*/5 * * * *',
  $$SELECT public.cron_pedro_auto_followup()$$
);

-- 4. Confirma.
DO $$
DECLARE v_jobs int;
BEGIN
  SELECT COUNT(*) INTO v_jobs FROM cron.job WHERE jobname='pedro-auto-followup';
  IF v_jobs < 1 THEN
    RAISE EXCEPTION '[cron-reactivation] cron pedro-auto-followup NAO foi criado';
  END IF;
  RAISE NOTICE '[cron-reactivation] OK -> % job(s). Motor segue OFF ate PEDRO_FF_AUTO_REACTIVATION=on.', v_jobs;
END $$;
