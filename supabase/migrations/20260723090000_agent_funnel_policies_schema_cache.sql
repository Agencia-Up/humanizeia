-- Compatibilidade para ambientes onde a migration de políticas do Funil
-- ainda não foi aplicada ou o PostgREST ainda está com o schema antigo em
-- cache. Idempotente para poder ser executada no SQL Editor do Supabase.

ALTER TABLE public.agent_funnel_config
  ADD COLUMN IF NOT EXISTS tenant_policies jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.agent_funnel_config.tenant_policies IS
  'Políticas comerciais do cliente, avaliadas pela LLM com evidência grounded. Não são regras de roteamento da engine.';

NOTIFY pgrst, 'reload schema';
