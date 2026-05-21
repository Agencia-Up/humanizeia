-- Permite que vendedores usem o CRM manual do Marcos sem abrir acesso geral.
-- O gerente continua gerenciando tudo pelo policy original auth.uid() = user_id.
-- O vendedor enxerga as etapas do funil do gerente e cria/edita/remove somente
-- leads atribuídos ao próprio cadastro em ai_team_members.

CREATE OR REPLACE FUNCTION public.get_seller_member_ids_text()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(id::text), ARRAY[]::text[])
  FROM public.ai_team_members
  WHERE auth_user_id = auth.uid();
$$;

DROP POLICY IF EXISTS "seller_view_master_crm_stages" ON public.crm_pipeline_stages;
CREATE POLICY "seller_view_master_crm_stages" ON public.crm_pipeline_stages
  FOR SELECT
  TO authenticated
  USING (user_id = public.get_seller_master_user_id());

DROP POLICY IF EXISTS "seller_view_own_marcos_crm_leads" ON public.crm_leads;
CREATE POLICY "seller_view_own_marcos_crm_leads" ON public.crm_leads
  FOR SELECT
  TO authenticated
  USING (
    user_id = public.get_seller_master_user_id()
    AND assigned_to = ANY(public.get_seller_member_ids_text())
  );

DROP POLICY IF EXISTS "seller_insert_own_marcos_crm_leads" ON public.crm_leads;
CREATE POLICY "seller_insert_own_marcos_crm_leads" ON public.crm_leads
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = public.get_seller_master_user_id()
    AND assigned_to = ANY(public.get_seller_member_ids_text())
  );

DROP POLICY IF EXISTS "seller_update_own_marcos_crm_leads" ON public.crm_leads;
CREATE POLICY "seller_update_own_marcos_crm_leads" ON public.crm_leads
  FOR UPDATE
  TO authenticated
  USING (
    user_id = public.get_seller_master_user_id()
    AND assigned_to = ANY(public.get_seller_member_ids_text())
  )
  WITH CHECK (
    user_id = public.get_seller_master_user_id()
    AND assigned_to = ANY(public.get_seller_member_ids_text())
  );

DROP POLICY IF EXISTS "seller_delete_own_marcos_crm_leads" ON public.crm_leads;
CREATE POLICY "seller_delete_own_marcos_crm_leads" ON public.crm_leads
  FOR DELETE
  TO authenticated
  USING (
    user_id = public.get_seller_master_user_id()
    AND assigned_to = ANY(public.get_seller_member_ids_text())
  );
