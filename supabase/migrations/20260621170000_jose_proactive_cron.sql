-- ============================================================================
-- JOSÉ v3.1 — FASE 6: cron semanal do jose-proactive
-- ----------------------------------------------------------------------------
-- Para cada conta com o flag 'otimizacao_proativa' ligado, gera e manda o resumo
-- proativo (oportunidades + riscos + sugestão) no WhatsApp do responsável.
-- Roda 1x/semana (segunda 12:00 UTC ~ 9h BRT).
--
-- OBS: no ambiente foi agendado via Management API usando a chave PUBLICÁVEL
-- (anon, não-secreta) no header. Esta versão (registro) lê do Vault pra não
-- deixar chave no arquivo. Pré-requisito (1x): vault.create_secret(<KEY>, 'jose_cron_key').
-- ============================================================================

DO $$ BEGIN PERFORM cron.unschedule('jose-proactive'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'jose-proactive',
  '0 12 * * 1',
  $job$
  SELECT net.http_post(
    url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/jose-proactive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'jose_cron_key' LIMIT 1),
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'jose_cron_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $job$
);
