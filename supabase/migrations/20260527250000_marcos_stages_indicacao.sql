-- ============================================================================
-- 20260527250000_marcos_stages_indicacao.sql
-- ----------------------------------------------------------------------------
-- Marcos CRM — Bug 1 do spec 27/05/2026: leads adicionados manualmente
-- devem ir pra coluna do kanban que corresponde a sua origem. Pra isso:
--
-- 1. Renomear "Marketing Place" → "Marketplace" (consistencia com origem
--    'marketplace' do form Adicionar Lead).
-- 2. Inserir stage "Indicação" (posicao 8, depois do Consignado) pra todos
--    masters Marcos que ja tem o pipeline v2 (detectado via existencia
--    da stage "Fechado").
--
-- Idempotente: UPDATE usa unaccent+LOWER pra normalizar e nao reaplica.
-- INSERT tem NOT EXISTS guard. Sem perda de dados — IDs das stages nao
-- mudam, leads ja vinculados continuam intactos.
-- ============================================================================

-- ─── 1. Renomear Marketing Place → Marketplace ────────────────────────────
UPDATE public.crm_pipeline_stages
SET name = 'Marketplace'
WHERE unaccent(LOWER(TRIM(name))) = 'marketing place';

-- ─── 2. Inserir stage "Indicação" (pos 8) pra masters Marcos ──────────────
-- Detecta usuarios Marcos via existencia de stage "Fechado" (mesmo padrao
-- do consignado). Posicao 8 = depois do Consignado (que esta em 7).
-- Cor #fb923c (laranja, mesma do card "Indicação" do DashboardTV/ORIGENS).
INSERT INTO public.crm_pipeline_stages (user_id, name, color, position, is_default)
SELECT DISTINCT s1.user_id, 'Indicação', '#fb923c', 8, false
FROM public.crm_pipeline_stages s1
WHERE s1.name = 'Fechado'
  AND NOT EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages s2
    WHERE s2.user_id = s1.user_id
      AND unaccent(LOWER(TRIM(s2.name))) = 'indicacao'
  );

-- ─── 3. Verificacao final ─────────────────────────────────────────────────
DO $$
DECLARE
  v_marketplace int;
  v_indicacao   int;
BEGIN
  SELECT count(*) INTO v_marketplace FROM public.crm_pipeline_stages
   WHERE unaccent(LOWER(TRIM(name))) = 'marketplace';
  SELECT count(*) INTO v_indicacao FROM public.crm_pipeline_stages
   WHERE unaccent(LOWER(TRIM(name))) = 'indicacao';

  RAISE NOTICE '[marcos_stages_indicacao] stages Marketplace: %', v_marketplace;
  RAISE NOTICE '[marcos_stages_indicacao] stages Indicacao: %', v_indicacao;

  -- Sanidade: nenhum master deve ter ficado sem Marketplace renomeado.
  IF EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages
    WHERE unaccent(LOWER(TRIM(name))) = 'marketing place'
  ) THEN
    RAISE EXCEPTION 'Ainda existe stage "Marketing Place" — rename falhou';
  END IF;
END $$;
