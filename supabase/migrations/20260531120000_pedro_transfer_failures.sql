-- ============================================================
-- Pedro/Marcos — Log de falhas de transferência (Diagnóstico)
-- ------------------------------------------------------------
-- Registra POR QUE um lead NÃO foi transferido automaticamente.
-- Alimenta o painel "Leads sem Transferência — Diagnóstico".
-- Serve tanto Pedro (ai_crm_leads) quanto Marcos (crm_leads) via
-- a coluna `mode`; por isso lead_id/agent_id/member_id ficam SEM
-- foreign key (preservam o histórico mesmo se o lead for apagado).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pedro_transfer_failures (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode               TEXT        NOT NULL DEFAULT 'pedro',   -- pedro | marcos
  lead_id            UUID,                                    -- ai_crm_leads.id (pedro) | crm_leads.id (marcos)
  agent_id           UUID,                                    -- wa_ai_agents.id
  member_id          UUID,                                    -- vendedor tentado (se houve), ai_team_members.id
  lead_name          TEXT,                                    -- snapshot do nome
  remote_jid         TEXT,                                    -- snapshot do contato
  reason_code        TEXT        NOT NULL,                    -- 8 categorias (ver CHECK)
  reason_detail      TEXT,                                    -- explicação livre
  lead_status        TEXT,                                    -- snapshot do status do lead
  lead_status_crm    TEXT,                                    -- snapshot da classificação (status_crm)
  attempted_transfer BOOLEAN     NOT NULL DEFAULT false,      -- houve tentativa real de transferir?
  source             TEXT,                                    -- uazapi-webhook | cron-lead-followup | transfer-timeout-checker | auto-classify-leads | manual
  attempt_count      INT         NOT NULL DEFAULT 1,          -- nº de vezes que a mesma falha se repetiu
  last_attempt_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at        TIMESTAMPTZ,                             -- preenchido quando o lead é finalmente transferido
  resolved_by        TEXT,                                    -- operador que resolveu (opcional)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pedro_transfer_failures_reason_chk CHECK (reason_code IN (
    'lead_nao_qualificado',     -- lead não qualificado
    'lead_inativo',             -- lead inativo / parou de responder
    'sem_vendedor_disponivel',  -- nenhum vendedor disponível na fila
    'erro_tecnico',             -- erro técnico (API/banco/timeout de chamada)
    'funil_timeout',            -- funil expirou antes de transferir
    'regra_nao_atingida',       -- regra de transferência não foi atingida
    'agente_nao_executou',      -- agente IA não chegou a executar
    'outros'                    -- outros
  )),
  CONSTRAINT pedro_transfer_failures_mode_chk CHECK (mode IN ('pedro', 'marcos'))
);

ALTER TABLE public.pedro_transfer_failures ENABLE ROW LEVEL SECURITY;

-- Gerente/dono enxerga e gerencia as falhas dos seus próprios leads.
-- (Painel de diagnóstico é ferramenta de gestor; vendedor não precisa ver.)
CREATE POLICY "owner_manage_transfer_failures" ON public.pedro_transfer_failures
  FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── Índices ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS pedro_tf_user_created_idx ON public.pedro_transfer_failures(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pedro_tf_lead_idx         ON public.pedro_transfer_failures(lead_id);
CREATE INDEX IF NOT EXISTS pedro_tf_reason_idx       ON public.pedro_transfer_failures(reason_code);
CREATE INDEX IF NOT EXISTS pedro_tf_agent_idx        ON public.pedro_transfer_failures(agent_id);
CREATE INDEX IF NOT EXISTS pedro_tf_unresolved_idx   ON public.pedro_transfer_failures(user_id, created_at DESC) WHERE resolved_at IS NULL;

-- Deduplicação: no máximo 1 falha ABERTA por (user, lead, motivo).
-- As edge functions usarão ON CONFLICT p/ incrementar attempt_count
-- em vez de criar linhas duplicadas a cada varredura do cron.
CREATE UNIQUE INDEX IF NOT EXISTS pedro_tf_open_uq
  ON public.pedro_transfer_failures(user_id, lead_id, reason_code)
  WHERE resolved_at IS NULL;

-- ── updated_at automático (reusa função existente) ──────────
DROP TRIGGER IF EXISTS trg_pedro_tf_updated_at ON public.pedro_transfer_failures;
CREATE TRIGGER trg_pedro_tf_updated_at
  BEFORE UPDATE ON public.pedro_transfer_failures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Realtime p/ o painel atualizar sozinho ──────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pedro_transfer_failures'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pedro_transfer_failures;
  END IF;
END$$;
