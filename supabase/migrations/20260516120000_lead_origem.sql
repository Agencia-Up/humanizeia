-- ============================================================================
-- Prompt 1.1 — Campo "origem" do Lead (Pedro / ai_crm_leads)
-- ============================================================================
-- Adiciona coluna `origem` (TEXT NULL) com 6 valores aceitos + `origem_outros`
-- (TEXT NULL) pra texto livre quando origem='outros'.
--
-- Marcos (crm_leads) já tem campo `source` próprio — vai ser unificado num
-- prompt futuro (1.1.1). Por ora, só Pedro.
--
-- Default da coluna = NULL: leads antigos NÃO são preenchidos automaticamente.
-- O default 'outros' pra leads criados via WhatsApp é setado explicitamente
-- no uazapi-webhook (não no schema), pra preservar valores manuais futuros.
--
-- Reversível: DROP CONSTRAINT + DROP INDEX + DROP COLUMN.
-- ============================================================================

ALTER TABLE public.ai_crm_leads
  ADD COLUMN IF NOT EXISTS origem text NULL,
  ADD COLUMN IF NOT EXISTS origem_outros text NULL;

-- CHECK constraint pros 6 valores aceitos (NULL também ok)
ALTER TABLE public.ai_crm_leads
  DROP CONSTRAINT IF EXISTS ai_crm_leads_origem_check;
ALTER TABLE public.ai_crm_leads
  ADD CONSTRAINT ai_crm_leads_origem_check
  CHECK (origem IS NULL OR origem IN (
    'porta',
    'marketplace_facebook',
    'marketplace_olx',
    'marketplace_mercadolivre',
    'instagram_vendedor',
    'outros'
  ));

-- Index parcial pra filtros futuros (Prompt 1.3)
CREATE INDEX IF NOT EXISTS idx_ai_crm_leads_origem
  ON public.ai_crm_leads(origem)
  WHERE origem IS NOT NULL;

COMMENT ON COLUMN public.ai_crm_leads.origem IS
  'Canal de origem do lead. Valores: porta (walk-in na loja) | marketplace_facebook | marketplace_olx | marketplace_mercadolivre | instagram_vendedor | outros (texto livre em origem_outros). NULL = legado/desconhecido.';

COMMENT ON COLUMN public.ai_crm_leads.origem_outros IS
  'Texto livre quando origem=''outros''. NULL caso contrário.';
