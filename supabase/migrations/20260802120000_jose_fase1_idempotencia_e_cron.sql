-- ============================================================================
-- JOSÉ — FASE 1/2: idempotência de ações + observabilidade real do cron
--
-- NÃO APLICADA. Arquivo versionado para revisão; aplicar só com autorização.
--
-- Por que existe:
--   1) Toda ação do José que muta a Meta gasta dinheiro. Sem chave de
--      idempotência, um retry/duplo clique dobra orçamento ou clona campanha 2x.
--   2) O cron hoje reporta sucesso porque o net.http_post foi aceito. Não há
--      onde gravar status real, tentativa, erro, duração — então falha do
--      apollo-agent some e o cliente perde o relatório do dia em silêncio.
--
-- Aditiva: nenhuma coluna existente é alterada ou removida.
-- Rollback ao final do arquivo (comentado).
-- ============================================================================

-- ── 1) IDEMPOTÊNCIA DE AÇÕES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.jose_action_idempotency (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,               -- tenant (escopo de cobrança)
  idempotency_key  text NOT NULL,
  action_type      text NOT NULL,
  resource_ref     text,                        -- campaign_id / adset_id / ad_id
  request_hash     text NOT NULL,               -- detecta reuso da chave com corpo diferente
  status           text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','succeeded','failed')),
  response         jsonb,                       -- resposta devolvida no replay
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

-- A unicidade é o coração da garantia: duas requisições simultâneas com a mesma
-- chave -> a segunda recebe 23505 e NÃO executa.
CREATE UNIQUE INDEX IF NOT EXISTS jose_action_idem_user_key_uq
  ON public.jose_action_idempotency (user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS jose_action_idem_criado_idx
  ON public.jose_action_idempotency (user_id, created_at DESC);

ALTER TABLE public.jose_action_idempotency ENABLE ROW LEVEL SECURITY;

-- Leitura só do próprio tenant; escrita é exclusiva do servidor (service_role
-- ignora RLS). Sem policy de INSERT/UPDATE para authenticated de propósito.
DROP POLICY IF EXISTS jose_action_idem_owner_read ON public.jose_action_idempotency;
CREATE POLICY jose_action_idem_owner_read ON public.jose_action_idempotency
  FOR SELECT USING (auth.uid() = user_id);

-- ── 2) OBSERVABILIDADE DO CRON (colunas aditivas) ───────────────────────────
ALTER TABLE public.apollo_cron_config
  ADD COLUMN IF NOT EXISTS last_status        text,      -- queued|running|succeeded|failed|retrying
  ADD COLUMN IF NOT EXISTS last_error         text,
  ADD COLUMN IF NOT EXISTS last_http_status   int,
  ADD COLUMN IF NOT EXISTS last_duration_ms   int,
  ADD COLUMN IF NOT EXISTS attempt_count      int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_success_at    timestamptz,
  ADD COLUMN IF NOT EXISTS retry_after        timestamptz,
  ADD COLUMN IF NOT EXISTS last_runner_version text;

-- ── 3) HISTÓRICO DE EXECUÇÕES (auditoria do agendador) ──────────────────────
CREATE TABLE IF NOT EXISTS public.jose_cron_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  job            text NOT NULL,                 -- 'daily_report' | 'measure_outcomes'
  status         text NOT NULL
    CHECK (status IN ('queued','running','succeeded','failed','retrying','skipped')),
  attempt        int  NOT NULL DEFAULT 1,
  http_status    int,
  erro           text,
  duracao_ms     int,
  runner_version text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);
CREATE INDEX IF NOT EXISTS jose_cron_runs_user_idx ON public.jose_cron_runs (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS jose_cron_runs_job_idx  ON public.jose_cron_runs (job, started_at DESC);
ALTER TABLE public.jose_cron_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jose_cron_runs_owner_read ON public.jose_cron_runs;
CREATE POLICY jose_cron_runs_owner_read ON public.jose_cron_runs
  FOR SELECT USING (auth.uid() = user_id);

-- ── 4) TRAVA DE EXECUÇÃO DIÁRIA (impede o measure-outcomes rodar 60x/hora) ──
-- O runner disparava a medição sempre que utcHour==6, sem marcar que já rodou.
-- Rodando a cada minuto, isso são até 60 disparos na mesma hora.
CREATE TABLE IF NOT EXISTS public.jose_cron_daily_marks (
  job        text NOT NULL,
  dia        date NOT NULL,
  marcado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job, dia)
);
ALTER TABLE public.jose_cron_daily_marks ENABLE ROW LEVEL SECURITY;
-- sem policy: só service_role (servidor) enxerga/escreve

-- ── 5) SAÚDE POR TENANT (Fase 2) ────────────────────────────────────────────
-- Responde, por cliente: última sincronização, último relatório, última
-- recomendação, último erro, idade do dado e a versão que processou.
CREATE OR REPLACE VIEW public.jose_tenant_health AS
SELECT
  c.user_id,
  c.is_enabled,
  c.auto_execute,
  c.last_status,
  c.last_error,
  c.last_http_status,
  c.last_duration_ms,
  c.attempt_count,
  c.last_run_at,
  c.last_success_at,
  c.next_run_at,
  c.last_runner_version,
  -- destinatário configurado? (relatório ligado sem número é falha silenciosa)
  (c.send_daily_report AND c.whatsapp_report_number IS NULL) AS relatorio_sem_destinatario,
  (SELECT max(s.created_at) FROM public.jose_dashboard_snapshots s WHERE s.user_id = c.user_id) AS ultimo_snapshot_em,
  (SELECT max(m.created_at) FROM public.apollo_metric_snapshots m WHERE m.user_id = c.user_id) AS ultima_metrica_meta_em,
  (SELECT max(l.executed_at) FROM public.apollo_action_log l WHERE l.user_id = c.user_id) AS ultima_acao_em,
  (SELECT count(*) FROM public.jose_action_approvals a
     WHERE a.user_id = c.user_id AND a.status = 'pendente') AS aprovacoes_pendentes,
  EXTRACT(EPOCH FROM (now() - c.last_success_at))/3600 AS horas_desde_ultimo_sucesso
FROM public.apollo_cron_config c;

COMMENT ON VIEW public.jose_tenant_health IS
  'Saúde do José por cliente: última execução com sucesso, último erro real, idade do dado, aprovações pendentes e se o relatório está ligado sem destinatário.';

-- ============================================================================
-- ROLLBACK (executar em bloco único se precisar reverter):
--
--   DROP VIEW IF EXISTS public.jose_tenant_health;
--   DROP TABLE IF EXISTS public.jose_cron_daily_marks;
--   DROP TABLE IF EXISTS public.jose_cron_runs;
--   DROP TABLE IF EXISTS public.jose_action_idempotency;
--   ALTER TABLE public.apollo_cron_config
--     DROP COLUMN IF EXISTS last_status,
--     DROP COLUMN IF EXISTS last_error,
--     DROP COLUMN IF EXISTS last_http_status,
--     DROP COLUMN IF EXISTS last_duration_ms,
--     DROP COLUMN IF EXISTS attempt_count,
--     DROP COLUMN IF EXISTS last_success_at,
--     DROP COLUMN IF EXISTS retry_after,
--     DROP COLUMN IF EXISTS last_runner_version;
--
-- Nenhum dado operacional é perdido: as tabelas são novas e as colunas são
-- aditivas (o comportamento anterior não lia nenhuma delas).
-- ============================================================================
