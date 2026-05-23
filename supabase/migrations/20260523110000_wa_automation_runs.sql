-- =============================================================================
-- Item 4 (parte 2): state tracking do executor de automações
-- =============================================================================
-- wa_automation_runs registra QUE contato JÁ PASSOU por QUE flow.
-- Evita re-processar o mesmo contato no mesmo flow (idempotência).
-- Cada flow só processa contato 1x (no futuro pode-se relaxar via reset_at).

CREATE TABLE IF NOT EXISTS public.wa_automation_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id         uuid NOT NULL REFERENCES public.wa_automation_flows(id) ON DELETE CASCADE,
  contact_id      uuid NOT NULL REFERENCES public.wa_contacts(id)         ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id)                 ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','running','completed','failed')),
  error_message   text NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz NULL,
  -- nós executados nesta run (pra debug/auditoria)
  executed_nodes  jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (flow_id, contact_id)
);

COMMENT ON TABLE public.wa_automation_runs IS
  'Rastreia execução de wa_automation_flows por contato. UNIQUE(flow_id, contact_id) garante que cada contato passa só 1x por cada flow.';

CREATE INDEX IF NOT EXISTS idx_war_flow_id    ON public.wa_automation_runs (flow_id);
CREATE INDEX IF NOT EXISTS idx_war_user_id    ON public.wa_automation_runs (user_id);
CREATE INDEX IF NOT EXISTS idx_war_status     ON public.wa_automation_runs (status) WHERE status IN ('pending','running','failed');

ALTER TABLE public.wa_automation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_read_war" ON public.wa_automation_runs;
CREATE POLICY "owner_read_war" ON public.wa_automation_runs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE só pelo service_role (executor). Sem policy = bloqueado pra authenticated.

DO $$
BEGIN
  RAISE NOTICE '[Item4 war] tabela wa_automation_runs criada';
END $$;
