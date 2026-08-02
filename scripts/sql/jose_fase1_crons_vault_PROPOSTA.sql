-- ============================================================================
-- PROPOSTA (NÃO APLICADA) — tirar os JWTs hardcoded dos comandos do pg_cron
--
-- Situação atual (verificada em 02/08/2026):
--   jobid  7  apollo-cron-every-minute -> jose-cron-runner        JWT no comando
--   jobid 36  jose-cost-alerts                                    JWT no comando (apikey + Authorization)
--   jobid 37  jose-proactive                                      JWT no comando (apikey + Authorization)
--
-- PROVA de que a troca é segura (executada em produção, sem expor o segredo):
--   o JWT gravado no jobid 7 é EXATAMENTE a service_role_key atual
--   (comparação `= vault.decrypted_secrets` -> true; 219 chars em ambos).
--   Logo, ler do Vault produz o MESMO valor: é troca de origem, não de chave.
--   É também por isso que remover o fallback `atob` do jose-cron-runner não
--   derruba o cron: a comparação estrita com a service key continua passando.
--
-- ORDEM OBRIGATÓRIA (não inverter):
--   1. aplicar a migration de schema (idempotência/cron)
--   2. deployar jose-cron-runner corrigido (sem atob, com response.ok)
--   3. SÓ ENTÃO rodar este script (jobs passam a ler do Vault)
--   4. rotação da chave: só depois de 1-3, com janela combinada
--
-- Requisito: o segredo 'service_role_key' já existe no Vault (confirmado — 6
-- segredos cadastrados; 3 outros crons já usam este mesmo padrão).
-- ============================================================================

-- ── jobid 7: relatório diário do José (a cada minuto, decide quem vence) ────
SELECT cron.alter_job(
  job_id  := 7,
  command := $cmd$
  SELECT net.http_post(
    url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/jose-cron-runner',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      -- proteção contra replay (só passa a ser exigida quando a env
      -- JOSE_REQUIRE_REPLAY_GUARD=1 for ligada na função)
      'x-jose-ts', (EXTRACT(EPOCH FROM now()) * 1000)::bigint::text,
      'x-jose-nonce', gen_random_uuid()::text
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cmd$
);

-- ── jobid 36: alertas de custo (diário 23:30) ───────────────────────────────
SELECT cron.alter_job(
  job_id  := 36,
  command := $cmd$
  SELECT net.http_post(
    url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/jose-cost-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'x-jose-ts', (EXTRACT(EPOCH FROM now()) * 1000)::bigint::text,
      'x-jose-nonce', gen_random_uuid()::text
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cmd$
);

-- ── jobid 37: resumo proativo (segundas 12:00) ──────────────────────────────
-- Note que o 'apikey' com o JWT foi REMOVIDO: era duplicação desnecessária do
-- segredo no comando.
SELECT cron.alter_job(
  job_id  := 37,
  command := $cmd$
  SELECT net.http_post(
    url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/jose-proactive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'x-jose-ts', (EXTRACT(EPOCH FROM now()) * 1000)::bigint::text,
      'x-jose-nonce', gen_random_uuid()::text
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cmd$
);

-- ── VERIFICAÇÃO (rodar depois; nenhum segredo aparece no resultado) ─────────
--   SELECT jobid, jobname,
--          (command ~ 'eyJ')                       AS ainda_tem_jwt_no_texto,  -- deve ser false
--          (command ~ 'vault.decrypted_secrets')   AS le_do_vault              -- deve ser true
--   FROM cron.job WHERE jobid IN (7,36,37);

-- ============================================================================
-- ROLLBACK — restaura o comando literal anterior.
-- ATENÇÃO: guardar ANTES o texto original com
--     SELECT jobid, command FROM cron.job WHERE jobid IN (7,36,37);
-- e reaplicar via cron.alter_job(job_id := N, command := $cmd$ ...original... $cmd$);
-- Não há como reconstruir o texto original a partir deste arquivo — ele contém
-- justamente o segredo que estamos removendo.
--
-- Rollback funcional imediato (se o cron parar de funcionar por qualquer motivo):
--   SELECT cron.alter_job(job_id := 7,  active := false);   -- pausa, não apaga
-- ============================================================================
