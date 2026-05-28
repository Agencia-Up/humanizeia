-- ============================================================================
-- 20260527240000_marcos_consignado.sql
-- ----------------------------------------------------------------------------
-- Marcos CRM: nova coluna kanban "Consignado" + 6 campos do veículo do cliente.
--
-- Spec do usuário (27/05/2026):
-- - Nova stage "Consignado" no fim do pipeline (posição 7, depois de Fechado)
-- - Form com 6 campos do veículo aparece quando lead está em Consignado:
--   Modelo / Ano / Versão / KM / Cor / Estado geral (bom/médio/ruim)
-- - Restrito ao Marcos (Pedro não tem essa coluna)
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + DO $$ guards pra constraints +
-- INSERT WHERE NOT EXISTS pra stages.
-- ============================================================================

-- ─── 1. Adicionar 6 colunas em crm_leads ──────────────────────────────────
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS consignado_modelo  text NULL,
  ADD COLUMN IF NOT EXISTS consignado_ano     int  NULL,
  ADD COLUMN IF NOT EXISTS consignado_versao  text NULL,
  ADD COLUMN IF NOT EXISTS consignado_km      int  NULL,
  ADD COLUMN IF NOT EXISTS consignado_cor     text NULL,
  ADD COLUMN IF NOT EXISTS consignado_estado  text NULL;

-- ─── 2. CHECK constraints (idempotentes via DO $$) ─────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_leads_consignado_ano_check'
  ) THEN
    ALTER TABLE public.crm_leads
      ADD CONSTRAINT crm_leads_consignado_ano_check
      CHECK (consignado_ano IS NULL OR (consignado_ano BETWEEN 1900 AND 2030));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_leads_consignado_km_check'
  ) THEN
    ALTER TABLE public.crm_leads
      ADD CONSTRAINT crm_leads_consignado_km_check
      CHECK (consignado_km IS NULL OR consignado_km >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_leads_consignado_estado_check'
  ) THEN
    ALTER TABLE public.crm_leads
      ADD CONSTRAINT crm_leads_consignado_estado_check
      CHECK (consignado_estado IS NULL OR consignado_estado IN ('bom','medio','ruim'));
  END IF;
END $$;

-- ─── 3. Inserir stage "Consignado" pra todos os users que tem Kanban Marcos v2 ─
-- Detecta usuários do Marcos pela existência da stage "Fechado" (única do Marcos
-- v2 que não existe no Pedro). Idempotente: NOT EXISTS guard previne duplicação.
-- Posição 7 = após todas as 7 existentes (Inativos=0 ... Fechado=6).
-- Cor #a78bfa = roxo claro (combina com identidade visual do Marcos).
INSERT INTO public.crm_pipeline_stages (user_id, name, color, position, is_default)
SELECT DISTINCT s1.user_id, 'Consignado', '#a78bfa', 7, false
FROM public.crm_pipeline_stages s1
WHERE s1.name = 'Fechado'
  AND NOT EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages s2
    WHERE s2.user_id = s1.user_id
      AND s2.name = 'Consignado'
  );

-- ─── 4. Verificação final ─────────────────────────────────────────────────
DO $$
DECLARE
  v_cols    int;
  v_checks  int;
  v_stages  int;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name='crm_leads'
    AND column_name LIKE 'consignado_%';

  SELECT count(*) INTO v_checks FROM pg_constraint
  WHERE conname IN (
    'crm_leads_consignado_ano_check',
    'crm_leads_consignado_km_check',
    'crm_leads_consignado_estado_check'
  );

  SELECT count(*) INTO v_stages FROM public.crm_pipeline_stages
  WHERE name='Consignado';

  RAISE NOTICE '[marcos_consignado] colunas criadas: % (esperado 6)', v_cols;
  RAISE NOTICE '[marcos_consignado] CHECK constraints: % (esperado 3)', v_checks;
  RAISE NOTICE '[marcos_consignado] stages Consignado criadas: %', v_stages;

  IF v_cols <> 6 THEN
    RAISE EXCEPTION 'Esperava 6 colunas consignado_*, encontrei %', v_cols;
  END IF;
  IF v_checks <> 3 THEN
    RAISE EXCEPTION 'Esperava 3 CHECK constraints, encontrei %', v_checks;
  END IF;
END $$;
