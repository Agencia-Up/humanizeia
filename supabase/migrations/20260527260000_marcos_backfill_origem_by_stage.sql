-- ============================================================================
-- 20260527260000_marcos_backfill_origem_by_stage.sql
-- ----------------------------------------------------------------------------
-- Bug 2 do spec 27/05/2026: leads historicos do Marcos nao apareciam no
-- Painel ao Vivo do Pedro porque o backfill anterior (20260526120000) usava
-- ILIKE no source — e leads cadastrados manualmente com source='manual' ou
-- 'Marcos Manual' cairam todos em 'outros' (fallback final).
--
-- Estratégia: derivar origem a partir da COLUNA DO KANBAN (stage_id) onde o
-- lead esta. Se o lead esta na coluna "Porta/loja", origem='porta'. Se esta
-- em "Marketplace", origem='marketplace'. Etc.
--
-- Aplica APENAS pra leads que tem origem NULL ou origem='outros' (fallback
-- inutil). Leads que ja tem origem='porta'/'marketplace'/'consignado'/
-- 'indicacao' setada CORRETAMENTE nao sao tocados (preserva trabalho manual).
--
-- Idempotente: rerunavel sem efeito colateral.
-- ============================================================================

-- ─── 1. Porta/loja → origem='porta' ───────────────────────────────────────
UPDATE public.crm_leads SET origem = 'porta'
WHERE (origem IS NULL OR origem = 'outros')
  AND stage_id IN (
    SELECT id FROM public.crm_pipeline_stages
    WHERE unaccent(LOWER(TRIM(name))) IN ('porta/loja','porta','porta loja')
  );

-- ─── 2. Marketplace → origem='marketplace' ────────────────────────────────
-- Aceita tanto a stage nova 'Marketplace' quanto a antiga 'Marketing Place'
-- (caso a migration 20260527250000 ainda nao tenha rodado em algum ambiente).
UPDATE public.crm_leads SET origem = 'marketplace'
WHERE (origem IS NULL OR origem = 'outros')
  AND stage_id IN (
    SELECT id FROM public.crm_pipeline_stages
    WHERE unaccent(LOWER(TRIM(name))) IN ('marketplace','marketing place')
  );

-- ─── 3. Consignado → origem='consignado' ──────────────────────────────────
UPDATE public.crm_leads SET origem = 'consignado'
WHERE (origem IS NULL OR origem = 'outros')
  AND stage_id IN (
    SELECT id FROM public.crm_pipeline_stages
    WHERE unaccent(LOWER(TRIM(name))) = 'consignado'
  );

-- ─── 4. Indicação → origem='indicacao' ─────────────────────────────────────
UPDATE public.crm_leads SET origem = 'indicacao'
WHERE (origem IS NULL OR origem = 'outros')
  AND stage_id IN (
    SELECT id FROM public.crm_pipeline_stages
    WHERE unaccent(LOWER(TRIM(name))) = 'indicacao'
  );

-- ─── 5. Relatorio de contagens pos-backfill ───────────────────────────────
DO $$
DECLARE
  v_porta       int;
  v_marketplace int;
  v_consignado  int;
  v_indicacao   int;
  v_outros      int;
  v_null        int;
BEGIN
  SELECT count(*) INTO v_porta       FROM public.crm_leads WHERE origem='porta';
  SELECT count(*) INTO v_marketplace FROM public.crm_leads WHERE origem='marketplace';
  SELECT count(*) INTO v_consignado  FROM public.crm_leads WHERE origem='consignado';
  SELECT count(*) INTO v_indicacao   FROM public.crm_leads WHERE origem='indicacao';
  SELECT count(*) INTO v_outros      FROM public.crm_leads WHERE origem='outros';
  SELECT count(*) INTO v_null        FROM public.crm_leads WHERE origem IS NULL;

  RAISE NOTICE '[backfill_origem_by_stage] porta=%, marketplace=%, consignado=%, indicacao=%, outros=%, null=%',
    v_porta, v_marketplace, v_consignado, v_indicacao, v_outros, v_null;
END $$;
