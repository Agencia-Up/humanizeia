-- ============================================================================
-- FIX: Vendedor não consegue importar/gerenciar listas e contatos do master
-- ============================================================================
-- Bug: RLS de wa_contact_lists e wa_contacts só permitia auth.uid() = user_id.
-- Como vendedores inserem listas/contatos no NOME do master (modelo de dados
-- compartilhado, como já era pras instâncias antes do design unificado), o
-- INSERT falhava com 'new row violates row-level security policy'.
--
-- Fix: adiciona policy que permite vendedor gerenciar listas/contatos onde
-- o user_id corresponde ao master daquele vendedor (usa a função
-- get_seller_master_user_id() já existente em produção).
-- ============================================================================

-- wa_contact_lists
DROP POLICY IF EXISTS "seller_manage_master_contact_lists" ON public.wa_contact_lists;
CREATE POLICY "seller_manage_master_contact_lists" ON public.wa_contact_lists
  FOR ALL
  TO authenticated
  USING (user_id = public.get_seller_master_user_id())
  WITH CHECK (user_id = public.get_seller_master_user_id());

-- wa_contacts
DROP POLICY IF EXISTS "seller_manage_master_contacts" ON public.wa_contacts;
CREATE POLICY "seller_manage_master_contacts" ON public.wa_contacts
  FOR ALL
  TO authenticated
  USING (user_id = public.get_seller_master_user_id())
  WITH CHECK (user_id = public.get_seller_master_user_id());

COMMENT ON POLICY "seller_manage_master_contact_lists" ON public.wa_contact_lists IS
  'Permite vendedor (seller) gerenciar listas de contatos do master dele (mesmo modelo das instâncias compartilhadas).';
COMMENT ON POLICY "seller_manage_master_contacts" ON public.wa_contacts IS
  'Permite vendedor (seller) gerenciar contatos do master dele.';
