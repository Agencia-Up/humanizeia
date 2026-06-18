-- ============================================================================
-- Vendedor pode ESCREVER no Kanban do Marcos do master (adicionar + renomear)
-- ----------------------------------------------------------------------------
-- Antes: crm_pipeline_stages tinha p/ vendedor SÓ a policy de SELECT
-- (seller_view_master_crm_stages). Logo, "Adicionar coluna" e "renomear" na tela
-- de Configurações do Kanban FALHAVAM ao salvar (RLS bloqueava INSERT/UPDATE).
--
-- Agora liberamos INSERT e UPDATE para o vendedor, confinados às etapas do PRÓPRIO
-- master (user_id = get_seller_master_user_id()). DELETE continua master-only
-- (sem policy de seller) — vendedor só remove no front a coluna nova que ele mesmo
-- acabou de adicionar (linha ainda não persistida).
--
-- A granularidade fina (vendedor só mexe em NOME e só de colunas fora do Painel ao
-- Vivo; responsável/tipo/ativo/ordem/cor/Painel ao Vivo = master) é garantida pela
-- TELA (KanbanSettingsTab desabilita esses campos p/ vendedor). Esta policy é por
-- LINHA (não por coluna) — escopo: somente as etapas da conta do master.
-- ============================================================================

DROP POLICY IF EXISTS "seller_insert_master_crm_stages" ON public.crm_pipeline_stages;
CREATE POLICY "seller_insert_master_crm_stages" ON public.crm_pipeline_stages
  FOR INSERT TO authenticated
  WITH CHECK (user_id = public.get_seller_master_user_id());

DROP POLICY IF EXISTS "seller_update_master_crm_stages" ON public.crm_pipeline_stages;
CREATE POLICY "seller_update_master_crm_stages" ON public.crm_pipeline_stages
  FOR UPDATE TO authenticated
  USING (user_id = public.get_seller_master_user_id())
  WITH CHECK (user_id = public.get_seller_master_user_id());
