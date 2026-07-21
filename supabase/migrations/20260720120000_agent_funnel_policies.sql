-- Políticas comerciais estruturadas por agente.
-- A LLM interpreta estas políticas; a engine não roteia por condição textual.

ALTER TABLE public.agent_funnel_config
  ADD COLUMN IF NOT EXISTS tenant_policies jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.agent_funnel_config.tenant_policies IS
  'Políticas comerciais do cliente, avaliadas pela LLM com evidência grounded. Não são regras de roteamento da engine.';
