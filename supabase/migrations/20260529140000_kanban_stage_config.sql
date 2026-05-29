-- =============================================================================
-- MELHORIA 2 (spec 29/05/2026): "Tabela de Configuracoes" do Kanban do Marcos.
--
-- DECISAO DE ARQUITETURA (aprovada pelo usuario): em vez de criar a tabela
-- kanban_configuracoes do spec — que DUPLICARIA crm_pipeline_stages (a fonte de
-- verdade que o board JA le via useFluxCRM/CrmAoVivo/DashboardTV) e exigiria
-- reescrever o board + migrar os stage_id de TODOS os leads — ESTENDEMOS
-- crm_pipeline_stages com os 3 campos novos. Assim "as alteracoes refletem
-- imediatamente no board" sai de graca, sem migracao de dados, preservando tudo
-- (inclusive a coluna "Redes Sociais" criada em 20260529130000).
--
-- Mapeamento spec -> existente:
--   nome_coluna -> name | cor -> color | ordem -> position | id -> id
--   agente_id 'marcos' -> user_id (escopo multi-conta, ja existente)
--   criado_em/atualizado_em -> created_at/updated_at (ja existem)
-- Campos NOVOS (este arquivo): ativo, tipo, responsavel_padrao_id
--
-- Idempotente (IF NOT EXISTS / DROP IF EXISTS). Reversivel: DROP das 3 colunas.
-- =============================================================================

-- 1. ativo: liga/desliga a coluna no board. Default ligado, NOT NULL — nao
--    quebra historico (linhas existentes herdam true).
ALTER TABLE public.crm_pipeline_stages
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;

-- 2. tipo: classificacao da etapa (entrada | em_andamento | saida).
--    NULL = nao classificada (default).
ALTER TABLE public.crm_pipeline_stages
  ADD COLUMN IF NOT EXISTS tipo text;
ALTER TABLE public.crm_pipeline_stages DROP CONSTRAINT IF EXISTS crm_pipeline_stages_tipo_check;
ALTER TABLE public.crm_pipeline_stages ADD CONSTRAINT crm_pipeline_stages_tipo_check
  CHECK (tipo IS NULL OR tipo IN ('entrada','em_andamento','saida'));

-- 3. responsavel_padrao_id: vendedor padrao da coluna. FK -> ai_team_members
--    (NAO 'vendedores', tabela que nao existe). ON DELETE SET NULL: excluir um
--    vendedor nao quebra a coluna (consistente com a blindagem anti-fantasma).
ALTER TABLE public.crm_pipeline_stages
  ADD COLUMN IF NOT EXISTS responsavel_padrao_id uuid;
ALTER TABLE public.crm_pipeline_stages DROP CONSTRAINT IF EXISTS crm_pipeline_stages_responsavel_padrao_fk;
ALTER TABLE public.crm_pipeline_stages ADD CONSTRAINT crm_pipeline_stages_responsavel_padrao_fk
  FOREIGN KEY (responsavel_padrao_id) REFERENCES public.ai_team_members(id) ON DELETE SET NULL;

-- 4. Confirmacao (aparece no output)
DO $$
DECLARE v_cols text;
BEGIN
  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='crm_pipeline_stages'
     AND column_name IN ('ativo','tipo','responsavel_padrao_id');
  RAISE NOTICE '[kanban_config] colunas novas presentes: %', v_cols;
END $$;
