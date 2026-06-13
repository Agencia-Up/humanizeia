-- ============================================================================
-- Kanban Marcos — vendedor pode GERENCIAR as etapas do funil do master
-- ----------------------------------------------------------------------------
-- Bug: o vendedor (com acesso às Configurações do Kanban) cria uma coluna, a UI
-- diz "salvo", mas a coluna NÃO aparece no CRM. Causa: a RLS de
-- crm_pipeline_stages só dava SELECT pro vendedor (ver as etapas do master).
-- A criação caía sob o uid do PRÓPRIO vendedor (a policy base auth.uid()=user_id
-- deixa passar), enquanto o CRM lê as etapas pelo uid do MASTER -> some.
--
-- Correção: dar ao vendedor INSERT/UPDATE/DELETE nas etapas do MASTER dele
-- (user_id = get_seller_master_user_id()). Assim a coluna é criada na pipeline
-- COMPARTILHADA (a do master) e aparece pra todos. O frontend tambem passa a
-- gravar sob o uid do master (KanbanSettingsTab). O master segue mandando em
-- tudo pela policy original auth.uid()=user_id.
-- ============================================================================

drop policy if exists seller_insert_master_crm_stages on public.crm_pipeline_stages;
create policy seller_insert_master_crm_stages on public.crm_pipeline_stages
  for insert to authenticated
  with check (user_id = public.get_seller_master_user_id());

drop policy if exists seller_update_master_crm_stages on public.crm_pipeline_stages;
create policy seller_update_master_crm_stages on public.crm_pipeline_stages
  for update to authenticated
  using (user_id = public.get_seller_master_user_id())
  with check (user_id = public.get_seller_master_user_id());

drop policy if exists seller_delete_master_crm_stages on public.crm_pipeline_stages;
create policy seller_delete_master_crm_stages on public.crm_pipeline_stages
  for delete to authenticated
  using (user_id = public.get_seller_master_user_id());
