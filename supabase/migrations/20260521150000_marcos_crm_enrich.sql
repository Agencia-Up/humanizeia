-- =============================================================================
-- Marcos CRM: replicar campos enriched do Pedro em crm_leads
-- =============================================================================
-- 3 colunas opcionais (texto livre). Nenhum dado existente afetado.

ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS client_city      text NULL,
  ADD COLUMN IF NOT EXISTS vehicle_interest text NULL,
  ADD COLUMN IF NOT EXISTS visit_scheduled  text NULL;

-- Validação
DO $$
DECLARE v_cols int;
BEGIN
  SELECT COUNT(*) INTO v_cols
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='crm_leads'
    AND column_name IN ('client_city','vehicle_interest','visit_scheduled');
  RAISE NOTICE '[Marcos] colunas enriched adicionadas: % de 3', v_cols;
END $$;
