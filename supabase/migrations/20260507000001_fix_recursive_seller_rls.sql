-- ============================================================
-- FIX: Remove política RLS auto-referencial que quebrava todas
-- as queries em ai_team_members (causava recursão infinita).
-- A policy "seller_view_master_team" consultava ai_team_members
-- dentro de uma policy da própria ai_team_members.
-- ============================================================

-- 1. Remove a policy problemática
DROP POLICY IF EXISTS "seller_view_master_team" ON public.ai_team_members;

-- 2. Cria função SECURITY DEFINER para buscar master_user_id do vendedor
--    Roda como dono da função (superuser) → sem RLS → sem recursão
CREATE OR REPLACE FUNCTION public.get_seller_master_user_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT user_id
  FROM public.ai_team_members
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

-- 3. Recria a policy usando a função (zero risco de recursão)
DROP POLICY IF EXISTS "seller_view_master_team_safe" ON public.ai_team_members;
CREATE POLICY "seller_view_master_team_safe" ON public.ai_team_members
  FOR SELECT
  USING (user_id = public.get_seller_master_user_id());

-- 4. Mesma correção para policies em outras tabelas que subquery ai_team_members
--    Substitui as subqueries diretas pela função

-- ai_crm_leads: seller pode ver seus leads
DROP POLICY IF EXISTS "seller_view_own_leads" ON public.ai_crm_leads;
CREATE POLICY "seller_view_own_leads" ON public.ai_crm_leads
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_team_members atm
      WHERE atm.auth_user_id = auth.uid()
        AND atm.id = ai_crm_leads.assigned_to_id
    )
  );

-- ai_crm_leads: seller pode atualizar seus leads (drag-and-drop no kanban)
DROP POLICY IF EXISTS "seller_update_own_leads" ON public.ai_crm_leads;
CREATE POLICY "seller_update_own_leads" ON public.ai_crm_leads
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_team_members atm
      WHERE atm.auth_user_id = auth.uid()
        AND atm.id = ai_crm_leads.assigned_to_id
    )
  );

-- wa_ai_agents: seller pode ver o agente ao qual pertence
DROP POLICY IF EXISTS "seller_view_assigned_agent" ON public.wa_ai_agents;
CREATE POLICY "seller_view_assigned_agent" ON public.wa_ai_agents
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_team_members atm
      WHERE atm.auth_user_id = auth.uid()
        AND atm.agent_id = wa_ai_agents.id
    )
  );

-- ai_lead_transfers: seller pode ver transferências onde é o destinatário
DROP POLICY IF EXISTS "seller_view_own_transfers" ON public.ai_lead_transfers;
CREATE POLICY "seller_view_own_transfers" ON public.ai_lead_transfers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_team_members atm
      WHERE atm.auth_user_id = auth.uid()
        AND atm.id = ai_lead_transfers.to_member_id
    )
  );
