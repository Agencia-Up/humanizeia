-- =============================================================================
-- BUG-NOVO-02 — Move cron pedro-trigger-followup pra usar Vault (JWT)
-- =============================================================================
-- A migration original (20260509000001_cron_pedro_trigger_followup.sql) tinha
-- o service_role JWT HARDCODED no SQL — arquivo versionado em git, exposto
-- pra qualquer pessoa com acesso ao repo.
--
-- Esta migration:
--   1. Recria o cron usando vault.decrypted_secrets pra ler o JWT do cofre.
--   2. URL fica hardcoded (NÃO é segredo, só domínio público do projeto).
--      Cada projeto Supabase tem sua URL fixa que não precisa ser ocultada.
--   3. Segue o mesmo padrão de cron_wa_automation_runner.sql.
--   4. É idempotente — pode ser aplicada várias vezes sem efeito colateral.
--
-- PRÉ-REQUISITO: secret 'service_role_key' precisa estar no Vault.
--   Verificar: SELECT name FROM vault.decrypted_secrets WHERE name='service_role_key';
--   Aplicado em STAGING (já existia) e PROD (inserido em 27/05/2026) antes
--   desta migration.
--
-- NOTA SOBRE ROTAÇÃO DA KEY: a chave antiga (hardcoded no commit b0070b3)
-- continua VÁLIDA até master rotacionar no dashboard Supabase. Esta migration
-- apenas garante que daqui pra frente nenhum código novo expõe a key.
-- Pra eliminar 100% o vazamento histórico, master rotaciona em:
-- Settings → API → Reset service_role secret (e atualiza Vault + EasyPanel).
-- =============================================================================

-- 1. Remove cron antigo (que tinha JWT hardcoded)
DO $$
BEGIN
  PERFORM cron.unschedule('pedro-trigger-followup');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[BUG-NOVO-02] cron pedro-trigger-followup não existia — OK';
END $$;

-- 2. Cria função wrapper que lê service_role_key do Vault
CREATE OR REPLACE FUNCTION public.cron_pedro_trigger_followup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  -- URL hardcoded — não é secret, é domínio público do projeto.
  -- Detecta PROD vs STAGING via current_setting de identificador customizado
  -- ou usa fallback baseado em REF do projeto. Mais simples: hardcode da URL
  -- de cada ambiente em migration separada se necessário.
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/pedro-trigger-followup';
  v_service_key text;
BEGIN
  -- Pra STAGING, sobrescrever via SETTINGS (set localmente via SQL):
  --   ALTER DATABASE postgres SET app.followup_url = 'https://ezoltigtqgbmftmiwjxh.supabase.co/functions/v1/pedro-trigger-followup';
  BEGIN
    v_url := COALESCE(NULLIF(current_setting('app.followup_url', true), ''), v_url);
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
    RAISE WARNING '[cron_pedro_trigger_followup] service_role_key não está no Vault — abortando. Configurar via: SELECT vault.create_secret(''<key>'', ''service_role_key'');';
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

COMMENT ON FUNCTION public.cron_pedro_trigger_followup() IS
  'Cron pedro-trigger-followup que lê service_role_key do vault.decrypted_secrets em vez de ter JWT hardcoded. BUG-NOVO-02 da auditoria 27/05/2026. Substitui versão antiga do commit b0070b3.';

-- 3. Recria o schedule chamando a função (em vez de http_post inline com JWT exposto)
SELECT cron.schedule(
  'pedro-trigger-followup',
  '* * * * *',
  $$SELECT public.cron_pedro_trigger_followup()$$
);

-- 4. Confirma
DO $$
DECLARE v_jobs int;
BEGIN
  SELECT COUNT(*) INTO v_jobs FROM cron.job WHERE jobname='pedro-trigger-followup';
  RAISE NOTICE '[BUG-NOVO-02] cron pedro-trigger-followup recriado lendo do Vault: % job(s) ativos', v_jobs;
END $$;
