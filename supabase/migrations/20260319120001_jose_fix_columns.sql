-- Fix colunas e políticas faltando nas tabelas do JOSÉ

-- apollo_action_log: adicionar colunas se não existirem
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='apollo_action_log' AND column_name='created_at') THEN
    ALTER TABLE public.apollo_action_log ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='apollo_action_log' AND column_name='before_state') THEN
    ALTER TABLE public.apollo_action_log ADD COLUMN before_state JSONB DEFAULT '{}';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='apollo_action_log' AND column_name='executed_by') THEN
    ALTER TABLE public.apollo_action_log ADD COLUMN executed_by TEXT DEFAULT 'user';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='apollo_action_log' AND column_name='executed_at') THEN
    ALTER TABLE public.apollo_action_log ADD COLUMN executed_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- apollo_sessions: adicionar colunas se não existirem
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='apollo_sessions' AND column_name='campaigns_snapshot') THEN
    ALTER TABLE public.apollo_sessions ADD COLUMN campaigns_snapshot JSONB DEFAULT '[]';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='apollo_sessions' AND column_name='actions_snapshot') THEN
    ALTER TABLE public.apollo_sessions ADD COLUMN actions_snapshot JSONB DEFAULT '[]';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='apollo_sessions' AND column_name='execution_log') THEN
    ALTER TABLE public.apollo_sessions ADD COLUMN execution_log JSONB DEFAULT '[]';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='apollo_sessions' AND column_name='auto_mode') THEN
    ALTER TABLE public.apollo_sessions ADD COLUMN auto_mode BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='apollo_sessions' AND column_name='analyzed_at') THEN
    ALTER TABLE public.apollo_sessions ADD COLUMN analyzed_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- apollo_cron_config: adicionar colunas se não existirem
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='apollo_cron_config' AND column_name='send_whatsapp_on_critical') THEN
    ALTER TABLE public.apollo_cron_config ADD COLUMN send_whatsapp_on_critical BOOLEAN DEFAULT TRUE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='apollo_cron_config' AND column_name='timezone') THEN
    ALTER TABLE public.apollo_cron_config ADD COLUMN timezone TEXT DEFAULT 'America/Sao_Paulo';
  END IF;
END $$;

-- apollo_metric_snapshots: adicionar colunas se não existirem
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='apollo_metric_snapshots' AND column_name='campaigns_data') THEN
    ALTER TABLE public.apollo_metric_snapshots ADD COLUMN campaigns_data JSONB DEFAULT '[]';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='apollo_metric_snapshots' AND column_name='wow_health_delta') THEN
    ALTER TABLE public.apollo_metric_snapshots ADD COLUMN wow_health_delta INTEGER;
  END IF;
END $$;

-- Políticas service role (para Edge Functions com service_role key)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename='apollo_sessions' AND policyname='Service role bypass sessions') THEN
    EXECUTE 'CREATE POLICY "Service role bypass sessions" ON public.apollo_sessions FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename='apollo_cron_config' AND policyname='Service role bypass cron') THEN
    EXECUTE 'CREATE POLICY "Service role bypass cron" ON public.apollo_cron_config FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename='apollo_metric_snapshots' AND policyname='Service role bypass snapshots') THEN
    EXECUTE 'CREATE POLICY "Service role bypass snapshots" ON public.apollo_metric_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename='apollo_action_outcomes' AND policyname='Service role bypass outcomes') THEN
    EXECUTE 'CREATE POLICY "Service role bypass outcomes" ON public.apollo_action_outcomes FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename='apollo_action_log' AND policyname='Service role bypass log') THEN
    EXECUTE 'CREATE POLICY "Service role bypass log" ON public.apollo_action_log FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- Índice corrigido para apollo_action_log
CREATE INDEX IF NOT EXISTS idx_apollo_log_user ON public.apollo_action_log(user_id);
CREATE INDEX IF NOT EXISTS idx_apollo_snapshots_user_date ON public.apollo_metric_snapshots(user_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_apollo_outcomes_user ON public.apollo_action_outcomes(user_id, created_at DESC);
