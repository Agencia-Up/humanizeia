-- ============================================================================
-- Gestão Comercial — vendedor define a PRÓPRIA meta individual
-- ----------------------------------------------------------------------------
-- Antes (migração 20260610170000): o vendedor só LIA metas; quem lançava era o
-- gestor. Agora o vendedor pode definir/editar a meta do mês DELE no painel.
-- Continua SEM poder mexer na meta da loja nem na de outro vendedor:
--   - tipo = 'individual'  (não 'loja')
--   - seller_id ∈ os member ids dele  (get_seller_member_ids_text)
--   - user_id = o master dele          (get_seller_master_user_id)
-- O gestor (owner) segue podendo tudo pela policy comercial_metas_owner_all.
-- Aditivo: só adiciona policies de INSERT/UPDATE pro vendedor.
-- ============================================================================

drop policy if exists comercial_metas_seller_insert on public.comercial_metas;
create policy comercial_metas_seller_insert on public.comercial_metas
  for insert with check (
    user_id = public.get_seller_master_user_id()
    and tipo = 'individual'
    and seller_id::text = any (public.get_seller_member_ids_text())
  );

drop policy if exists comercial_metas_seller_update on public.comercial_metas;
create policy comercial_metas_seller_update on public.comercial_metas
  for update using (
    user_id = public.get_seller_master_user_id()
    and tipo = 'individual'
    and seller_id::text = any (public.get_seller_member_ids_text())
  ) with check (
    user_id = public.get_seller_master_user_id()
    and tipo = 'individual'
    and seller_id::text = any (public.get_seller_member_ids_text())
  );
