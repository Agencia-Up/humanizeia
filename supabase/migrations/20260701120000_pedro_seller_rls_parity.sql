-- ============================================================================
-- Paridade de RLS do CRM do Pedro (ai_crm_leads) com o Marcos (crm_leads)
-- ----------------------------------------------------------------------------
-- BUG (geral, todos os vendedores): ao adicionar lead no Pedro o vendedor tomava
-- ERRO 42501 ("new row violates row-level security policy"). Causa: ai_crm_leads
-- só tinha política de vendedor para SELECT e UPDATE — faltavam INSERT e DELETE
-- (o crm_leads do Marcos já tinha as 4). O código insere com user_id = master,
-- mas auth.uid() = vendedor ≠ master e ele não é 'manager' → nenhuma política
-- permitia o INSERT.
--
-- Fix definitivo: espelha exatamente as políticas seller_insert/delete_own_marcos_crm_leads
-- (mesmas funções get_seller_master_user_id() / get_seller_member_ids_text()).
-- assigned_to_id é uuid → cast ::text pra casar com o retorno text[] do helper.
-- Como o app já grava assigned_to_id = o próprio vendedor, o lead também fica
-- visível pra ele (não recria o problema de "vendedor não vê o lead").
--
-- Aditivo e idempotente. NÃO precisa mudar código.
-- ============================================================================

-- INSERT (adicionar lead)
DROP POLICY IF EXISTS "seller_insert_own_pedro_leads" ON public.ai_crm_leads;
CREATE POLICY "seller_insert_own_pedro_leads" ON public.ai_crm_leads
  FOR INSERT TO authenticated
  WITH CHECK (
    (user_id = get_seller_master_user_id())
    AND (assigned_to_id::text = ANY (get_seller_member_ids_text()))
  );

-- DELETE (apagar lead) — paridade com o Marcos
DROP POLICY IF EXISTS "seller_delete_own_pedro_leads" ON public.ai_crm_leads;
CREATE POLICY "seller_delete_own_pedro_leads" ON public.ai_crm_leads
  FOR DELETE TO authenticated
  USING (
    (user_id = get_seller_master_user_id())
    AND (assigned_to_id::text = ANY (get_seller_member_ids_text()))
  );

-- ============================================================================
-- PROTEÇÃO CONTRA RECORRÊNCIA: garante que ai_crm_leads tem política de vendedor
-- para as 4 operações. Se um dia alguém remover/esquecer uma, esta migration
-- (ou o script supabase/checks/rls_seller_lead_parity.sql) falha ALTO em vez de
-- deixar o vendedor quebrado silenciosamente em produção.
-- ============================================================================
DO $$
DECLARE
  faltando text;
BEGIN
  SELECT string_agg(req.cmd, ', ') INTO faltando
  FROM (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) AS req(cmd)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename  = 'ai_crm_leads'
      AND p.cmd        = req.cmd
      AND p.policyname LIKE 'seller_%'
  );
  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION 'RLS parity check FALHOU: ai_crm_leads sem política de vendedor para: %', faltando;
  END IF;
END $$;
