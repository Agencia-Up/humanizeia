-- =============================================================================
-- MELHORIA 1 (spec 29/05/2026): novo canal de origem "Redes Sociais".
--
-- Adiciona 'redes_sociais' aos CHECK de origem das DUAS tabelas de lead
-- (crm_leads = Marcos, ai_crm_leads = Pedro), PRESERVANDO todos os valores
-- existentes — nao quebra nenhum lead historico.
--
-- Tambem provisiona a coluna "Redes Sociais" no Kanban do Marcos
-- (crm_pipeline_stages) pros masters que JA usam o modelo de colunas por canal
-- (tem 'Marketplace'/'Consignado'/'Indicacao'). NAO hardcoda user_id, entao roda
-- igual em STAGING e PROD (onde os ids do master diferem). Idempotente via
-- NOT EXISTS (pode rodar de novo sem duplicar).
--
-- Reversivel: recriar os CHECK sem 'redes_sociais' + DELETE da stage 'Redes Sociais'.
-- =============================================================================

-- 1. crm_leads.origem (Marcos) — 7 valores atuais + redes_sociais
ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_origem_check;
ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS origem_check;
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_origem_check
  CHECK (origem IS NULL OR origem IN (
    'porta','olx','marketplace','instagram','consignado','indicacao','outros','redes_sociais'
  ));

-- 2. ai_crm_leads.origem (Pedro) — 8 valores atuais (inclui trafico_pago) + redes_sociais
ALTER TABLE public.ai_crm_leads DROP CONSTRAINT IF EXISTS ai_crm_leads_origem_check;
ALTER TABLE public.ai_crm_leads ADD CONSTRAINT ai_crm_leads_origem_check
  CHECK (origem IS NULL OR origem IN (
    'porta','olx','marketplace','instagram','consignado','indicacao','outros','trafico_pago','redes_sociais'
  ));

-- 3. Provisiona a coluna "Redes Sociais" no Kanban dos masters que ja usam
--    colunas por canal. Posiciona ao final (max(position)+1 daquele master).
--    NOT EXISTS evita duplicar se a coluna ja existir (idempotente).
INSERT INTO public.crm_pipeline_stages (user_id, name, color, position, is_default)
SELECT u.user_id,
       'Redes Sociais',
       '#ec4899',
       COALESCE((SELECT MAX(s2.position) FROM public.crm_pipeline_stages s2 WHERE s2.user_id = u.user_id), 0) + 1,
       false
FROM (
  SELECT DISTINCT user_id
  FROM public.crm_pipeline_stages
  WHERE name ILIKE 'marketplace' OR name ILIKE 'consignado' OR name ILIKE 'indica%'
) u
WHERE NOT EXISTS (
  SELECT 1 FROM public.crm_pipeline_stages e
  WHERE e.user_id = u.user_id AND e.name ILIKE 'redes sociais'
);

-- 4. Confirmacao (aparece no output da migration)
DO $$
DECLARE v_crm text; v_ai text; v_stages int;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_crm FROM pg_constraint
    WHERE conname = 'crm_leads_origem_check' AND conrelid = 'public.crm_leads'::regclass;
  SELECT pg_get_constraintdef(oid) INTO v_ai FROM pg_constraint
    WHERE conname = 'ai_crm_leads_origem_check' AND conrelid = 'public.ai_crm_leads'::regclass;
  SELECT count(*) INTO v_stages FROM public.crm_pipeline_stages WHERE name ILIKE 'redes sociais';
  RAISE NOTICE '[redes_sociais] crm_leads CHECK: %', v_crm;
  RAISE NOTICE '[redes_sociais] ai_crm_leads CHECK: %', v_ai;
  RAISE NOTICE '[redes_sociais] colunas "Redes Sociais" no Kanban: %', v_stages;
END $$;
