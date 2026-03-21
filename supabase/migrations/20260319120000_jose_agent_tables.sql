-- ══════════════════════════════════════════════════════════════════
-- JOSÉ Governador — Tabelas necessárias para o agente funcionar
-- apollo_sessions, apollo_cron_config, apollo_metric_snapshots,
-- apollo_action_outcomes, apollo_action_log
-- ══════════════════════════════════════════════════════════════════

-- ── apollo_sessions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.apollo_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id           UUID,
  campaigns_analyzed   INTEGER DEFAULT 0,
  actions_generated    INTEGER DEFAULT 0,
  actions_executed     INTEGER DEFAULT 0,
  ai_analysis          TEXT,
  health_score         INTEGER,
  summary              TEXT,
  campaigns_snapshot   JSONB DEFAULT '[]',
  actions_snapshot     JSONB DEFAULT '[]',
  execution_log        JSONB DEFAULT '[]',
  date_preset          TEXT DEFAULT 'last_7d',
  auto_mode            BOOLEAN DEFAULT FALSE,
  analyzed_at          TIMESTAMPTZ DEFAULT NOW(),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, account_id)
);

ALTER TABLE public.apollo_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own sessions" ON public.apollo_sessions;
CREATE POLICY "Users manage own sessions"
  ON public.apollo_sessions FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── apollo_cron_config ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.apollo_cron_config (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_enabled                BOOLEAN DEFAULT FALSE,
  run_hour                  INTEGER DEFAULT 8,
  run_minute                INTEGER DEFAULT 0,
  timezone                  TEXT DEFAULT 'America/Sao_Paulo',
  date_preset               TEXT DEFAULT 'last_7d',
  auto_execute              BOOLEAN DEFAULT FALSE,
  send_whatsapp_on_critical BOOLEAN DEFAULT TRUE,
  last_run_at               TIMESTAMPTZ,
  next_run_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id)
);

ALTER TABLE public.apollo_cron_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own cron config" ON public.apollo_cron_config;
CREATE POLICY "Users manage own cron config"
  ON public.apollo_cron_config FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── apollo_metric_snapshots ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.apollo_metric_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id            UUID,
  snapshot_date         DATE NOT NULL,
  date_preset           TEXT DEFAULT 'last_7d',
  total_spend           NUMERIC(12,2) DEFAULT 0,
  total_impressions     BIGINT DEFAULT 0,
  total_clicks          BIGINT DEFAULT 0,
  avg_ctr               NUMERIC(8,4) DEFAULT 0,
  avg_cpc               NUMERIC(10,4) DEFAULT 0,
  avg_cpm               NUMERIC(10,4) DEFAULT 0,
  avg_roas              NUMERIC(8,4) DEFAULT 0,
  avg_frequency         NUMERIC(8,4) DEFAULT 0,
  overall_health_score  INTEGER DEFAULT 50,
  campaigns_data        JSONB DEFAULT '[]',
  wow_spend_delta       NUMERIC(8,2),
  wow_roas_delta        NUMERIC(8,2),
  wow_ctr_delta         NUMERIC(8,2),
  wow_cpc_delta         NUMERIC(8,2),
  wow_health_delta      INTEGER,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, account_id, snapshot_date)
);

ALTER TABLE public.apollo_metric_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own snapshots" ON public.apollo_metric_snapshots;
CREATE POLICY "Users manage own snapshots"
  ON public.apollo_metric_snapshots FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── apollo_action_outcomes ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.apollo_action_outcomes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_log_id        UUID,
  campaign_id_meta     TEXT NOT NULL,
  action_type          TEXT NOT NULL,
  before_health_score  INTEGER,
  before_roas          NUMERIC(8,4),
  before_ctr           NUMERIC(8,4),
  before_cpc           NUMERIC(10,4),
  before_spend         NUMERIC(12,2),
  after_health_score   INTEGER,
  after_roas           NUMERIC(8,4),
  after_ctr            NUMERIC(8,4),
  after_cpc            NUMERIC(10,4),
  after_spend          NUMERIC(12,2),
  outcome              TEXT,       -- 'improved' | 'declined' | 'neutral'
  improvement_score    INTEGER,    -- delta health_score
  measured_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.apollo_action_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own outcomes" ON public.apollo_action_outcomes;
CREATE POLICY "Users manage own outcomes"
  ON public.apollo_action_outcomes FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── apollo_action_log (IF NOT EXISTS guard) ───────────────────────
CREATE TABLE IF NOT EXISTS public.apollo_action_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id   TEXT NOT NULL,
  action_type   TEXT NOT NULL,
  params        JSONB DEFAULT '{}',
  result        JSONB DEFAULT '{}',
  before_state  JSONB DEFAULT '{}',
  executed_by   TEXT DEFAULT 'user',
  executed_at   TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.apollo_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own action log" ON public.apollo_action_log;
CREATE POLICY "Users manage own action log"
  ON public.apollo_action_log FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Service role bypass for all tables (Edge Functions usam service role)
DROP POLICY IF EXISTS "Service role bypass sessions" ON public.apollo_sessions;
CREATE POLICY "Service role bypass sessions"
  ON public.apollo_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role bypass cron" ON public.apollo_cron_config;
CREATE POLICY "Service role bypass cron"
  ON public.apollo_cron_config FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role bypass snapshots" ON public.apollo_metric_snapshots;
CREATE POLICY "Service role bypass snapshots"
  ON public.apollo_metric_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role bypass outcomes" ON public.apollo_action_outcomes;
CREATE POLICY "Service role bypass outcomes"
  ON public.apollo_action_outcomes FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role bypass log" ON public.apollo_action_log;
CREATE POLICY "Service role bypass log"
  ON public.apollo_action_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_apollo_sessions_user ON public.apollo_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_apollo_cron_user ON public.apollo_cron_config(user_id);
CREATE INDEX IF NOT EXISTS idx_apollo_snapshots_user_date ON public.apollo_metric_snapshots(user_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_apollo_outcomes_user ON public.apollo_action_outcomes(user_id);
CREATE INDEX IF NOT EXISTS idx_apollo_log_user ON public.apollo_action_log(user_id);
