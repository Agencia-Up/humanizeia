-- ============================================================================
-- Dashboard TV — Etapa 1: schema base
-- ============================================================================
-- 1. ai_team_members.profile_picture (foto do vendedor)
-- 2. profiles.dashboard_tv_* (branding customizável por master)
-- 3. crm_leads.origem (coluna nova, deriva de source via backfill)
-- 4. ai_crm_leads.origem (simplificar valores: marketplace_* → marketplace, instagram_vendedor → instagram)
-- 5. CHECK constraint origem em ambas as tabelas (7 valores: porta/olx/marketplace/instagram/consignado/indicacao/outros)
-- 6. Indices pra performance do dashboard
--
-- IDEMPOTENTE: pode re-rodar sem efeito colateral (IF NOT EXISTS + WHERE origem IS NULL).
-- COMPAT: crm_leads.source intocado — código existente continua funcionando.
-- ============================================================================

-- 1. Foto do vendedor (NULL = avatar com iniciais como fallback no DashboardTV)
ALTER TABLE public.ai_team_members
  ADD COLUMN IF NOT EXISTS profile_picture TEXT;

-- 2. Branding customizável por master no Dashboard TV
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dashboard_tv_logo_url        TEXT,
  ADD COLUMN IF NOT EXISTS dashboard_tv_company_name    TEXT,
  ADD COLUMN IF NOT EXISTS dashboard_tv_primary_color   TEXT DEFAULT '#3b82f6',
  ADD COLUMN IF NOT EXISTS dashboard_tv_secondary_color TEXT DEFAULT '#f59e0b';

-- 3. Coluna origem nova em crm_leads (Marcos)
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS origem TEXT;

-- 4. Backfill crm_leads.origem a partir de source existente (idempotente via WHERE origem IS NULL)
UPDATE public.crm_leads SET origem='porta'
  WHERE origem IS NULL AND source ILIKE '%porta%';
UPDATE public.crm_leads SET origem='olx'
  WHERE origem IS NULL AND source ILIKE '%olx%';
UPDATE public.crm_leads SET origem='marketplace'
  WHERE origem IS NULL
    AND (source ILIKE '%marketplace%' OR source ILIKE '%facebook%' OR source ILIKE '%mercadolivre%');
UPDATE public.crm_leads SET origem='instagram'
  WHERE origem IS NULL AND source ILIKE '%instagram%';
UPDATE public.crm_leads SET origem='consignado'
  WHERE origem IS NULL AND source ILIKE '%consignado%';
UPDATE public.crm_leads SET origem='indicacao'
  WHERE origem IS NULL
    AND (source ILIKE '%indica%' OR source ILIKE '%referral%');
-- Fallback: leads sem source mapeável viram 'outros' (NULL → 'outros')
UPDATE public.crm_leads SET origem='outros' WHERE origem IS NULL;

-- 5. Simplificar ai_crm_leads.origem (Pedro): remover sub-categorias
UPDATE public.ai_crm_leads SET origem='marketplace'
  WHERE origem IN ('marketplace_facebook','marketplace_mercadolivre');
UPDATE public.ai_crm_leads SET origem='olx'
  WHERE origem='marketplace_olx';
UPDATE public.ai_crm_leads SET origem='instagram'
  WHERE origem='instagram_vendedor';
-- Leads Pedro sem origem ficam NULL (não força 'outros' pra preservar histórico de quem não tinha campo)

-- 6. CHECK constraint origem em ambas as tabelas (7 valores aceitos)
ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_origem_check;
ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS origem_check;
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_origem_check
  CHECK (origem IS NULL OR origem IN ('porta','olx','marketplace','instagram','consignado','indicacao','outros'));

ALTER TABLE public.ai_crm_leads DROP CONSTRAINT IF EXISTS ai_crm_leads_origem_check;
ALTER TABLE public.ai_crm_leads ADD CONSTRAINT ai_crm_leads_origem_check
  CHECK (origem IS NULL OR origem IN ('porta','olx','marketplace','instagram','consignado','indicacao','outros'));

-- 7. Indices pra queries do Dashboard TV (filtra por origem + período)
CREATE INDEX IF NOT EXISTS idx_crm_leads_origem
  ON public.crm_leads(origem) WHERE origem IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_crm_leads_origem
  ON public.ai_crm_leads(origem) WHERE origem IS NOT NULL;

-- 8. Relatório de validação (vai pra logs do Supabase)
DO $$
DECLARE
  v_marcos_total int;
  v_marcos_origem int;
  v_pedro_total int;
  v_pedro_origem int;
BEGIN
  SELECT COUNT(*) INTO v_marcos_total  FROM public.crm_leads;
  SELECT COUNT(*) INTO v_marcos_origem FROM public.crm_leads WHERE origem IS NOT NULL;
  SELECT COUNT(*) INTO v_pedro_total   FROM public.ai_crm_leads;
  SELECT COUNT(*) INTO v_pedro_origem  FROM public.ai_crm_leads WHERE origem IS NOT NULL;
  RAISE NOTICE '[DashboardTV] Marcos crm_leads: % total, % com origem populada', v_marcos_total, v_marcos_origem;
  RAISE NOTICE '[DashboardTV] Pedro ai_crm_leads: % total, % com origem populada', v_pedro_total, v_pedro_origem;
END $$;
