-- ============================================================================
-- pedro_conversation_state — memória estruturada da conversa do agente Pedro
-- ============================================================================
-- Resolve causa raiz de 12 dos 16 bugs reportados na conversa-benchmark da
-- Roberta (2026-05-15): agente NÃO tinha memória estruturada, só histórico cru
-- de 10 mensagens. Resultado: pedia nome 4x, perguntava troca 3x, re-apresentava
-- ficha do veículo 3x, dizia "vou chamar o consultor" sem chamar de fato.
--
-- Schema: 1 row por (lead_id, agent_id) com state JSONB livre. O extrator
-- (Claude Haiku 4.5 inline no webhook) mantém essa row atualizada a cada
-- mensagem do cliente. O system prompt do GPT-4o agora recebe o state formatado
-- como bloco "ESTADO DA CONVERSA — DADOS JÁ COLETADOS (NÃO PERGUNTAR DE NOVO)".
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pedro_conversation_state (
  lead_id            uuid NOT NULL REFERENCES public.ai_crm_leads(id) ON DELETE CASCADE,
  agent_id           uuid NOT NULL REFERENCES public.wa_ai_agents(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state              jsonb NOT NULL DEFAULT '{}'::jsonb,
  qualificacao_score int  NOT NULL DEFAULT 0,
  last_extracted_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, agent_id)
);

COMMENT ON TABLE public.pedro_conversation_state IS
  'Memória estruturada da conversa do Pedro SDR. Updated a cada mensagem do cliente via extractEntities (Claude Haiku 4.5).';

COMMENT ON COLUMN public.pedro_conversation_state.state IS
  'JSONB com seções: lead{}, interesse{}, negociacao{}, veiculo_apresentado{}, atendimento{}. Schema flexível pra evoluir sem migration.';

COMMENT ON COLUMN public.pedro_conversation_state.qualificacao_score IS
  'Score 0-100 calculado a partir de campos preenchidos. Threshold pra transferência automática: >= 60.';

CREATE INDEX IF NOT EXISTS idx_pedro_state_user_id
  ON public.pedro_conversation_state(user_id);

CREATE INDEX IF NOT EXISTS idx_pedro_state_updated_at
  ON public.pedro_conversation_state(updated_at DESC);

-- Trigger updated_at (reaproveita função existente)
DROP TRIGGER IF EXISTS trg_pedro_state_updated_at ON public.pedro_conversation_state;
CREATE TRIGGER trg_pedro_state_updated_at
  BEFORE UPDATE ON public.pedro_conversation_state
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE public.pedro_conversation_state ENABLE ROW LEVEL SECURITY;

-- Master: vê e gerencia tudo da própria conta
DROP POLICY IF EXISTS "owner_manage_pedro_state" ON public.pedro_conversation_state;
CREATE POLICY "owner_manage_pedro_state" ON public.pedro_conversation_state
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Vendedor: vê o state dos leads do master ao qual pertence (read-only)
DROP POLICY IF EXISTS "seller_view_master_pedro_state" ON public.pedro_conversation_state;
CREATE POLICY "seller_view_master_pedro_state" ON public.pedro_conversation_state
  FOR SELECT TO authenticated
  USING (user_id = public.get_seller_master_user_id());
