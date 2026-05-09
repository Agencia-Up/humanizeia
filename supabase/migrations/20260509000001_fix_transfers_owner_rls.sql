-- ============================================================
-- FIX CRÍTICO: RLS faltante em ai_lead_transfers
--
-- A tabela tinha apenas:
--   - alt_service_all (service_role bypass)
--   - seller_view_own_transfers (vendedor vê os seus)
--
-- Faltava a policy que permite o DONO/GERENTE ver os transfers
-- do próprio user_id. Resultado: o painel "Rodízio Inteligente"
-- do CRM ao Vivo retornava sempre 0 porque o owner não tinha
-- permissão SELECT na tabela.
-- ============================================================

DROP POLICY IF EXISTS "owner_view_own_transfers" ON public.ai_lead_transfers;
CREATE POLICY "owner_view_own_transfers" ON public.ai_lead_transfers
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "owner_manage_own_transfers" ON public.ai_lead_transfers;
CREATE POLICY "owner_manage_own_transfers" ON public.ai_lead_transfers
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
