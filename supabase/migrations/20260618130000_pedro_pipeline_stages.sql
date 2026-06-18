-- ============================================================================
-- Kanban do Pedro EDITÁVEL (seguro) — tabela ai_crm_pipeline_stages
-- ----------------------------------------------------------------------------
-- Análoga a crm_pipeline_stages (Marcos), MAS com `status_key`: o valor que o
-- MOTOR do Pedro usa em ai_crm_leads.status_crm (novo/inativo/perdido/...). Esse
-- status_key é IMUTÁVEL nas colunas do motor (is_engine=true) — o dono pode mudar
-- nome/cor/ordem, mas NÃO excluir nem trocar o status_key (senão reativação,
-- classificação e triggers quebram). Colunas NOVAS (is_engine=false) são livres.
--
-- O board do Pedro passa a ler daqui; se a conta não tiver linhas, o frontend cai
-- na lista fixa antiga (PIPELINE_COLUMNS) — agente nunca fica sem board.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_crm_pipeline_stages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status_key            text NOT NULL,          -- mapeia ai_crm_leads.status_crm
  name                  text NOT NULL,
  color                 text NOT NULL DEFAULT '#64748b',
  position              int  NOT NULL DEFAULT 0,
  tipo                  text,
  ativo                 boolean NOT NULL DEFAULT true,
  responsavel_padrao_id uuid REFERENCES public.ai_team_members(id) ON DELETE SET NULL,
  show_in_live          boolean NOT NULL DEFAULT true,
  is_engine             boolean NOT NULL DEFAULT false,  -- coluna do motor (não exclui / status_key travado)
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, status_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_crm_pipeline_stages_user
  ON public.ai_crm_pipeline_stages (user_id, position);

ALTER TABLE public.ai_crm_pipeline_stages ENABLE ROW LEVEL SECURITY;

-- Master: controle total das próprias etapas.
DROP POLICY IF EXISTS "owner_all_pedro_stages" ON public.ai_crm_pipeline_stages;
CREATE POLICY "owner_all_pedro_stages" ON public.ai_crm_pipeline_stages
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Vendedor: lê + adiciona + renomeia (confinado às etapas do master). DELETE é
-- master-only (sem policy de seller). A granularidade (vendedor só nome + colunas
-- fora do Painel ao Vivo) é garantida pela TELA, igual ao Kanban do Marcos.
DROP POLICY IF EXISTS "seller_select_pedro_stages" ON public.ai_crm_pipeline_stages;
CREATE POLICY "seller_select_pedro_stages" ON public.ai_crm_pipeline_stages
  FOR SELECT TO authenticated
  USING (user_id = public.get_seller_master_user_id());

DROP POLICY IF EXISTS "seller_insert_pedro_stages" ON public.ai_crm_pipeline_stages;
CREATE POLICY "seller_insert_pedro_stages" ON public.ai_crm_pipeline_stages
  FOR INSERT TO authenticated
  WITH CHECK (user_id = public.get_seller_master_user_id());

DROP POLICY IF EXISTS "seller_update_pedro_stages" ON public.ai_crm_pipeline_stages;
CREATE POLICY "seller_update_pedro_stages" ON public.ai_crm_pipeline_stages
  FOR UPDATE TO authenticated
  USING (user_id = public.get_seller_master_user_id())
  WITH CHECK (user_id = public.get_seller_master_user_id());

-- ── Seed: as 7 colunas atuais do Pedro (PIPELINE_COLUMNS) pra cada master que já
--    tem agente Pedro (wa_ai_agents). is_engine=true => protegidas. Idempotente.
INSERT INTO public.ai_crm_pipeline_stages (user_id, status_key, name, color, position, is_engine, show_in_live)
SELECT m.u, s.key, s.nome, s.cor, s.pos, true, true
FROM (SELECT DISTINCT user_id AS u FROM public.wa_ai_agents WHERE user_id IS NOT NULL) m
CROSS JOIN (VALUES
  ('novo',                 'Novo',                 '#3B82F6', 0),
  ('inativo',              'Lead Inativo',         '#9CA3AF', 1),
  ('carro_nao_disponivel', 'Carro não disponível', '#EF4444', 2),
  ('em_atendimento',       'Agendamento',          '#06B6D4', 3),
  ('negociacao',           'Negociação',           '#8B5CF6', 4),
  ('fechado',              'Venda concluída',      '#10B981', 5),
  ('perdido',              'Perdido',              '#6B7280', 6)
) AS s(key, nome, cor, pos)
ON CONFLICT (user_id, status_key) DO NOTHING;
