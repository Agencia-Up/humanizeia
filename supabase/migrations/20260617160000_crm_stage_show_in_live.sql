-- ============================================================================
-- Kanban Marcos: escolher quais colunas aparecem no Painel ao Vivo
-- ----------------------------------------------------------------------------
-- O dono (master) seleciona, por coluna do Kanban (crm_pipeline_stages), se ela
-- aparece como ORIGEM no Painel ao Vivo (DashboardTV). Default = true (todas
-- aparecem), pra não sumir nada do que já existe. O DashboardTV lê
-- show_in_live != false. Aditivo e idempotente.
-- ============================================================================

ALTER TABLE public.crm_pipeline_stages
  ADD COLUMN IF NOT EXISTS show_in_live boolean NOT NULL DEFAULT true;
