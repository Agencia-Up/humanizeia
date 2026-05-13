-- ============================================================
-- RLS: Vendedores podem ver instâncias e mensagens do master
--
-- Problema: wa_instances e wa_inbox tinham apenas a policy
-- "auth.uid() = user_id", que bloqueava vendedores de ver
-- as instâncias/mensagens do seu gerente (master).
-- Resultado: botão de envio desabilitado para vendedores.
--
-- Solução: Usa a função get_seller_master_user_id() (SECURITY DEFINER)
-- já existente para permitir SELECT/INSERT/UPDATE aos vendedores.
-- ============================================================

-- 1. wa_instances: seller pode ver as instâncias do master
DROP POLICY IF EXISTS "seller_view_master_instances" ON public.wa_instances;
CREATE POLICY "seller_view_master_instances" ON public.wa_instances
  FOR SELECT
  TO authenticated
  USING (user_id = public.get_seller_master_user_id());

-- 2. wa_inbox: seller pode ler as mensagens do master
DROP POLICY IF EXISTS "seller_view_master_inbox" ON public.wa_inbox;
CREATE POLICY "seller_view_master_inbox" ON public.wa_inbox
  FOR SELECT
  TO authenticated
  USING (user_id = public.get_seller_master_user_id());

-- 3. wa_inbox: seller pode inserir mensagens (outgoing) com user_id do master
DROP POLICY IF EXISTS "seller_insert_master_inbox" ON public.wa_inbox;
CREATE POLICY "seller_insert_master_inbox" ON public.wa_inbox
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = public.get_seller_master_user_id());

-- 4. wa_inbox: seller pode atualizar mensagens do master (marcar como lido)
DROP POLICY IF EXISTS "seller_update_master_inbox" ON public.wa_inbox;
CREATE POLICY "seller_update_master_inbox" ON public.wa_inbox
  FOR UPDATE
  TO authenticated
  USING (user_id = public.get_seller_master_user_id());
