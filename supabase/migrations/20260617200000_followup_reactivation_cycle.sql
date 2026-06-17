-- ============================================================================
-- Follow-up de reativação: CICLO DE FILA (round-robin justo)
-- ----------------------------------------------------------------------------
-- Bug: o motor recutucava os MESMOS leads (que não respondem) todo dia, sem
-- percorrer a fila inteira (200+). Faltava o conceito de "ciclo": um lead já
-- cutucado continuava elegível para sempre (status 'sent') e voltava ao topo
-- do ORDER BY last_sent_at.
--
-- Correção: a RPC ganha p_cycle_at — exclui quem já foi cutucado NESTE ciclo
-- (last_sent_at >= p_cycle_at). O motor passa o início do ciclo (followup_ia_
-- config.reactivation_cycle_at) e, quando a fila do ciclo zera mas ainda há
-- leads inativos, abre um ciclo novo (move reactivation_cycle_at = now()) — só
-- então um lead volta a receber follow-up. Resultado: manda 1x pra cada lead da
-- aba inativa e só repete depois que a fila inteira passou.
-- ============================================================================

ALTER TABLE public.followup_ia_config
  ADD COLUMN IF NOT EXISTS reactivation_cycle_at timestamptz NOT NULL DEFAULT now();

DROP FUNCTION IF EXISTS public.get_next_reactivation_lead(uuid, int, int);

CREATE OR REPLACE FUNCTION public.get_next_reactivation_lead(
  p_user_id uuid,
  p_periodo_dias int DEFAULT NULL,
  p_limit int DEFAULT 1,
  p_cycle_at timestamptz DEFAULT NULL
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
    -- CICLO: não repete quem já foi cutucado NESTE ciclo. O lead só volta quando
    -- a fila inteira passou (o motor move p_cycle_at pra now() ao reiniciar).
    AND (p_cycle_at IS NULL OR r.last_sent_at IS NULL OR r.last_sent_at < p_cycle_at)
    -- TRAVA 24h: o atendimento mais recente tem que ser há MAIS de 24h.
    AND GREATEST(
          COALESCE(l.last_interaction_at, l.created_at),
          COALESCE(l.last_user_reply_at, l.created_at),
          COALESCE(l.last_agent_reply_at, l.created_at)
        ) < now() - interval '24 hours'
  ORDER BY r.last_sent_at ASC NULLS FIRST, l.created_at ASC
  LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_next_reactivation_lead(uuid, int, int, timestamptz)
  TO authenticated, service_role, anon;
