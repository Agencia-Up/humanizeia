-- =============================================================================
-- Spec 28/05/2026: form de "Adicionar Lead" do agente Pedro mostra SOMENTE
-- 'Tráfego Pago' como origem (Pedro so cadastra leads vindos de campanhas
-- de tráfego pago — outros canais ficam no Marcos CRM).
--
-- O CHECK constraint atual de ai_crm_leads.origem nao aceita 'trafico_pago'.
-- Esta migration adiciona o novo valor mantendo TODOS os existentes pra
-- preservar leads historicos cadastrados antes dessa spec.
-- =============================================================================

-- Drop constraint antiga
ALTER TABLE public.ai_crm_leads
  DROP CONSTRAINT IF EXISTS ai_crm_leads_origem_check;

-- Recria com 'trafico_pago' adicionado
ALTER TABLE public.ai_crm_leads
  ADD CONSTRAINT ai_crm_leads_origem_check
  CHECK (
    origem IS NULL OR origem = ANY (ARRAY[
      'porta'::text,
      'olx'::text,
      'marketplace'::text,
      'instagram'::text,
      'consignado'::text,
      'indicacao'::text,
      'outros'::text,
      'trafico_pago'::text  -- NOVO 28/05/2026
    ])
  );

-- Confirmacao
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'ai_crm_leads' AND c.conname = 'ai_crm_leads_origem_check';
  RAISE NOTICE '[trafico_pago] CHECK atualizado: %', v_def;
END $$;
