-- =============================================================================
-- Item 4 (parte 0): cria wa_automation_flows que estava FALTANDO no schema
-- =============================================================================
-- Bug pré-existente: AutomationFlowBuilder.tsx tentava salvar em wa_automation_flows
-- mas a tabela nunca existiu. Save sempre dava erro silencioso.
-- Esta migration cria a tabela com o shape exato que o builder envia:
--   { user_id, name, is_active, nodes (jsonb React Flow), edges (jsonb React Flow), updated_at }

CREATE TABLE IF NOT EXISTS public.wa_automation_flows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL DEFAULT 'Novo Fluxo',
  is_active   boolean NOT NULL DEFAULT false,
  nodes       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- React Flow nodes (id, type, position, data)
  edges       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- React Flow edges (id, source, target)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.wa_automation_flows IS
  'Fluxos de automação visuais (React Flow). nodes/edges são JSONB do React Flow. Processados pelo edge function wa-automation-runner.';

CREATE INDEX IF NOT EXISTS idx_waf_user_id   ON public.wa_automation_flows (user_id);
CREATE INDEX IF NOT EXISTS idx_waf_is_active ON public.wa_automation_flows (is_active) WHERE is_active = true;

ALTER TABLE public.wa_automation_flows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_manage_waf" ON public.wa_automation_flows;
CREATE POLICY "owner_manage_waf" ON public.wa_automation_flows
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Trigger updated_at automático (usa função genérica já existente)
DROP TRIGGER IF EXISTS trg_waf_updated_at ON public.wa_automation_flows;
CREATE TRIGGER trg_waf_updated_at
  BEFORE UPDATE ON public.wa_automation_flows
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DO $$
BEGIN
  RAISE NOTICE '[Item4 waf] tabela wa_automation_flows criada (corrige bug pre-existente do builder)';
END $$;
