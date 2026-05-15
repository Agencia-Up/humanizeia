-- ============================================================================
-- FEATURE: Funil do Agente — configuração estruturada de 9 blocos por agente IA
-- ============================================================================
-- Cria tabela agent_funnel_config (1 linha por wa_ai_agents.id) onde o master
-- configura os blocos do funil SDR genérico. Quando salvo, gera um system_prompt
-- final que sobrescreve wa_ai_agents.system_prompt (com backup automático).
--
-- Segurança:
--   - Tabela NOVA, vazia. Não afeta nada existente.
--   - Adiciona use_funnel_config (default false) e system_prompt_backup em
--     wa_ai_agents → permite rollback instantâneo se o prompt novo der ruim.
--   - RLS: master gerencia config dos agentes da própria conta. Vendedor:
--     herda via get_seller_master_user_id() (mesmo padrão das outras tabelas).
-- ============================================================================

-- ── Tabela principal ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_funnel_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL UNIQUE REFERENCES public.wa_ai_agents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- BLOCO 1 — Identidade {agent_name, role, company, niche}
  bloco1_identidade jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- BLOCO 3 — Abordagem {objective, presentation, first_question, avoid:[]}
  bloco3_abordagem jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- BLOCO 4 — Qualificação {objective, questions:[], required_data:[]}
  bloco4_qualificacao jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- BLOCO 5 — Ramificações {branches:[{trigger, questions:[]}]}
  bloco5_ramificacoes jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- BLOCO 6 — Critérios {qualified_when:[], disqualified_when:[], closing_message}
  bloco6_criterios jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- BLOCO 7 — Transferência {required_data:[], customer_message, internal_summary_template}
  bloco7_transferencia jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- BLOCO 8 — Regras específicas {always:[], never:[]}
  bloco8_regras jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- BLOCO 9 — Empresa {name, address, hours, website, price_range, differentiators}
  bloco9_empresa jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Prompt final concatenado (gerado pela edge function)
  generated_system_prompt text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Índice para lookup rápido por agente
CREATE INDEX IF NOT EXISTS idx_agent_funnel_config_agent_id
  ON public.agent_funnel_config(agent_id);

-- ── Colunas de segurança em wa_ai_agents ────────────────────────────────────
ALTER TABLE public.wa_ai_agents
  ADD COLUMN IF NOT EXISTS use_funnel_config boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS system_prompt_backup text;

COMMENT ON COLUMN public.wa_ai_agents.use_funnel_config IS
  'TRUE quando o agente está usando system_prompt gerado a partir de agent_funnel_config. Permite rollback.';
COMMENT ON COLUMN public.wa_ai_agents.system_prompt_backup IS
  'Backup do system_prompt anterior antes da geração via funil. Usado para restauração 1-clique.';

-- ── Trigger updated_at ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_funnel_config_updated_at ON public.agent_funnel_config;
CREATE TRIGGER trg_agent_funnel_config_updated_at
  BEFORE UPDATE ON public.agent_funnel_config
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.agent_funnel_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_manage_funnel_config" ON public.agent_funnel_config;
CREATE POLICY "owner_manage_funnel_config" ON public.agent_funnel_config
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "seller_view_master_funnel_config" ON public.agent_funnel_config;
CREATE POLICY "seller_view_master_funnel_config" ON public.agent_funnel_config
  FOR SELECT
  TO authenticated
  USING (user_id = public.get_seller_master_user_id());

COMMENT ON TABLE public.agent_funnel_config IS
  'Configuração estruturada de 9 blocos do Funil do Agente SDR. 1 linha por wa_ai_agents.id.';
