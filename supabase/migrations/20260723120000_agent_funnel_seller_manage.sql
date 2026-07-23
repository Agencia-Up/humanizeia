-- Permite que um vendedor/parceiro autorizado edite o funil do agente ao qual
-- pertence, mantendo o cliente (master) como dono persistido da configuração.
-- O vendedor nunca ganha acesso a outro agente da mesma conta: a policy exige
-- uma linha de ai_team_members ligando auth.uid() ao agent_id alvo.

DROP POLICY IF EXISTS "seller_manage_assigned_funnel_config" ON public.agent_funnel_config;
CREATE POLICY "seller_manage_assigned_funnel_config" ON public.agent_funnel_config
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = public.get_seller_master_user_id()
    AND EXISTS (
      SELECT 1
      FROM public.ai_team_members atm
      WHERE atm.auth_user_id = auth.uid()
        AND atm.agent_id = agent_funnel_config.agent_id
    )
  );

DROP POLICY IF EXISTS "seller_update_assigned_funnel_config" ON public.agent_funnel_config;
CREATE POLICY "seller_update_assigned_funnel_config" ON public.agent_funnel_config
  FOR UPDATE
  TO authenticated
  USING (
    user_id = public.get_seller_master_user_id()
    AND EXISTS (
      SELECT 1
      FROM public.ai_team_members atm
      WHERE atm.auth_user_id = auth.uid()
        AND atm.agent_id = agent_funnel_config.agent_id
    )
  )
  WITH CHECK (
    user_id = public.get_seller_master_user_id()
    AND EXISTS (
      SELECT 1
      FROM public.ai_team_members atm
      WHERE atm.auth_user_id = auth.uid()
        AND atm.agent_id = agent_funnel_config.agent_id
    )
  );
