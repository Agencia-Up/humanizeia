-- Pedro v2 scaffold: observability table for parallel tests.
-- This migration does not route production traffic to Pedro v2.

CREATE TABLE IF NOT EXISTS public.pedro_v2_turn_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.wa_ai_agents(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.ai_crm_leads(id) ON DELETE SET NULL,
  remote_jid text,
  correlation_id text NOT NULL,
  intent text,
  next_action text,
  dry_run boolean NOT NULL DEFAULT true,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pedro_v2_turn_logs_correlation_id
  ON public.pedro_v2_turn_logs(correlation_id);

CREATE INDEX IF NOT EXISTS idx_pedro_v2_turn_logs_user_created
  ON public.pedro_v2_turn_logs(user_id, created_at DESC);

ALTER TABLE public.pedro_v2_turn_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_view_pedro_v2_turn_logs" ON public.pedro_v2_turn_logs;
CREATE POLICY "owner_view_pedro_v2_turn_logs"
  ON public.pedro_v2_turn_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

