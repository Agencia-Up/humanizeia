-- ============================================================================
-- 20260601150000_followup_reactivation_engine.sql
-- ----------------------------------------------------------------------------
-- Motor de REATIVACAO automatica (Follow-up IA) — Fase 2/3.
-- Regras confirmadas pelo master (Wander, 01/06/2026):
--  - Dispara SO na coluna "Lead Inativo" (status_crm='inativo'), pelo numero
--    da IA do master, automaticamente.
--  - Mensagem gerada pelo Claude (personalizada por lead).
--  - Quantidade/dia (max_disparos_dia) + intervalo min/max configuraveis,
--    com PISO HARD de 3 min (ja garantido em 20260601140000).
--  - FILA em rodizio: so repete num lead depois que todos da fila receberam
--    a 1a mensagem (ordena last_sent_at NULLS FIRST).
--  - Filtro por DATA de entrada no CRM: 7/30/90 dias ou personalizado
--    (NULL = todos os inativos).
--  - Quando o lead RESPONDE: a IA REQUALIFICA o lead (conversa de novo, capta
--    as infos) e transfere pro vendedor que JA e dono do lead, com feedback
--    "lead recuperado" + tudo que foi captado. (tratado no webhook, fase C)
--  - Pausa global (is_active=false) para tudo.
--
-- Esta migration cria APENAS a base de dados (nao dispara nada):
--  1. followup_ia_config.periodo_dias          (filtro por data)
--  2. tabela public.pedro_followup_reactivation (estado da fila por lead)
--  3. RPC public.get_next_reactivation_lead     (proximo da fila, round-robin)
-- ============================================================================

-- 1. ── Filtro por data de entrada no CRM ────────────────────────────────────
--    NULL = todos os inativos (sem filtro de data).
ALTER TABLE public.followup_ia_config
  ADD COLUMN IF NOT EXISTS periodo_dias int;

COMMENT ON COLUMN public.followup_ia_config.periodo_dias IS
  'Follow-up IA: so reativa leads criados nos ultimos N dias. NULL = todos.';

-- 2. ── Estado da fila de reativacao (1 linha por lead) ──────────────────────
CREATE TABLE IF NOT EXISTS public.pedro_followup_reactivation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  -- pending     : entrou na fila, ainda nao recebeu cutucao
  -- sent        : recebeu cutucao, aguardando resposta (continua no rodizio)
  -- responded   : respondeu, IA esta requalificando (fase C)
  -- transferred : requalificado e entregue ao vendedor dono (encerrado)
  -- skipped     : saiu da fila (ex.: saiu da coluna inativo, encerrado manual)
  status text NOT NULL DEFAULT 'pending',
  send_count int NOT NULL DEFAULT 0,
  last_sent_at timestamptz,
  last_message text,
  responded_at timestamptz,
  transferred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- 1 registro de reativacao por lead.
  CONSTRAINT pedro_followup_reactivation_lead_unique UNIQUE (lead_id)
);

CREATE INDEX IF NOT EXISTS idx_pedro_fu_react_user_status
  ON public.pedro_followup_reactivation(user_id, status);
CREATE INDEX IF NOT EXISTS idx_pedro_fu_react_lastsent
  ON public.pedro_followup_reactivation(user_id, last_sent_at);

-- ── RLS: master ve/edita so os registros dele. O motor usa service_role
--    (bypassa RLS), entao a policy aqui e so pra leitura no frontend. ────────
ALTER TABLE public.pedro_followup_reactivation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pedro_fu_react_owner ON public.pedro_followup_reactivation;
CREATE POLICY pedro_fu_react_owner
  ON public.pedro_followup_reactivation
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Trigger updated_at ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_pedro_fu_react_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_pedro_fu_react_updated_at ON public.pedro_followup_reactivation;
CREATE TRIGGER set_pedro_fu_react_updated_at
  BEFORE UPDATE ON public.pedro_followup_reactivation
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_pedro_fu_react_updated_at();

-- 3. ── RPC: proximo lead da fila de reativacao pra um master ────────────────
--    Round-robin: leads nunca enviados primeiro (last_sent_at NULLS FIRST),
--    depois os enviados ha mais tempo. So leads na coluna inativo, dentro do
--    periodo configurado, que ainda nao responderam/transferiram.
CREATE OR REPLACE FUNCTION public.get_next_reactivation_lead(
  p_user_id uuid,
  p_periodo_dias int DEFAULT NULL,
  p_limit int DEFAULT 1
)
RETURNS TABLE (
  lead_id uuid,
  remote_jid text,
  lead_name text,
  agent_id uuid,
  assigned_to_id uuid,
  react_id uuid,
  react_status text,
  send_count int,
  last_sent_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    l.id                         AS lead_id,
    l.remote_jid,
    l.lead_name,
    l.agent_id,
    l.assigned_to_id,
    r.id                         AS react_id,
    r.status                     AS react_status,
    COALESCE(r.send_count, 0)    AS send_count,
    r.last_sent_at
  FROM public.ai_crm_leads l
  LEFT JOIN public.pedro_followup_reactivation r ON r.lead_id = l.id
  WHERE l.user_id = p_user_id
    AND l.status_crm = 'inativo'
    AND l.remote_jid IS NOT NULL
    AND (p_periodo_dias IS NULL
         OR l.created_at >= now() - make_interval(days => p_periodo_dias))
    AND (r.status IS NULL OR r.status IN ('pending', 'sent'))
  ORDER BY r.last_sent_at ASC NULLS FIRST, l.created_at ASC
  LIMIT GREATEST(p_limit, 1);
$$;

-- ── Verificacao ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_periodo int;
  v_table int;
  v_fn int;
BEGIN
  SELECT count(*) INTO v_periodo
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='followup_ia_config'
    AND column_name='periodo_dias';

  SELECT count(*) INTO v_table
  FROM information_schema.tables
  WHERE table_schema='public' AND table_name='pedro_followup_reactivation';

  SELECT count(*) INTO v_fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_next_reactivation_lead';

  IF v_periodo <> 1 THEN
    RAISE EXCEPTION '[reactivation] coluna periodo_dias nao criada';
  END IF;
  IF v_table <> 1 THEN
    RAISE EXCEPTION '[reactivation] tabela pedro_followup_reactivation nao criada';
  END IF;
  IF v_fn < 1 THEN
    RAISE EXCEPTION '[reactivation] RPC get_next_reactivation_lead nao criada';
  END IF;

  RAISE NOTICE '[reactivation] OK -> periodo_dias + tabela + RPC criados.';
END $$;
