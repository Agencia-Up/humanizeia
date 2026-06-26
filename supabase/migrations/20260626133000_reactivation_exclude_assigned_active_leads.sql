-- Follow-up IA: evita reativar lead que ja esta em atendimento/vendedor.
-- O motor deve atuar somente em leads realmente parados na coluna "inativo".

CREATE OR REPLACE FUNCTION public.get_next_reactivation_lead(
  p_user_id uuid,
  p_periodo_dias int DEFAULT NULL,
  p_limit int DEFAULT 1,
  p_cycle_at timestamptz DEFAULT NULL,
  p_max_attempts int DEFAULT 3,
  p_min_resend_hours int DEFAULT 24
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
    AND l.assigned_to_id IS NULL
    AND COALESCE(l.status, '') NOT IN ('em_atendimento', 'transferido', 'fechado', 'vendido', 'perdido', 'concluido')
    AND l.remote_jid IS NOT NULL
    AND (p_periodo_dias IS NULL
         OR l.created_at >= now() - make_interval(days => p_periodo_dias))
    AND (r.status IS NULL OR r.status IN ('pending', 'sent'))
    AND COALESCE(r.send_count, 0) < GREATEST(p_max_attempts, 1)
    AND (r.last_sent_at IS NULL
         OR r.last_sent_at < now() - make_interval(hours => GREATEST(p_min_resend_hours, 1)))
    AND (p_cycle_at IS NULL OR r.last_sent_at IS NULL OR r.last_sent_at < p_cycle_at)
    AND GREATEST(
          COALESCE(l.last_interaction_at, l.created_at),
          COALESCE(l.last_user_reply_at, l.created_at),
          COALESCE(l.last_agent_reply_at, l.created_at)
        ) < now() - interval '24 hours'
  ORDER BY r.last_sent_at ASC NULLS FIRST, l.created_at ASC
  LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_next_reactivation_lead(uuid, int, int, timestamptz, int, int)
  TO authenticated, service_role, anon;
