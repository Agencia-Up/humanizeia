-- ============================================================================
-- Colunas de Kanban POR VENDEDOR (Pedro e Marcos).
-- ----------------------------------------------------------------------------
-- BUG: quando um vendedor adicionava uma coluna nova, ela era gravada so com
-- user_id (do master) e aparecia no board de TODOS os vendedores da conta.
-- Agora cada coluna tem um dono opcional `seller_auth_id`:
--   NULL  = coluna da CONTA (criada pelo master) -> aparece pra todos (padrao).
--   <uid> = coluna do VENDEDOR daquele auth.uid() -> aparece SO pra ele.
-- O escopo na leitura e feito na UI (filtra seller_auth_id IS NULL OR = auth.uid()).
-- As policies de INSERT/UPDATE do vendedor ja existentes continuam validas (so
-- checam user_id = master); este ALTER apenas adiciona a coluna de dono. Idempotente.
-- ============================================================================

ALTER TABLE public.ai_crm_pipeline_stages
  ADD COLUMN IF NOT EXISTS seller_auth_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.crm_pipeline_stages
  ADD COLUMN IF NOT EXISTS seller_auth_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_ai_crm_pipeline_stages_seller
  ON public.ai_crm_pipeline_stages (user_id, seller_auth_id);

CREATE INDEX IF NOT EXISTS idx_crm_pipeline_stages_seller
  ON public.crm_pipeline_stages (user_id, seller_auth_id);
