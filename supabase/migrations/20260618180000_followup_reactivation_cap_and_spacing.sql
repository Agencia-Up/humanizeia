-- ============================================================================
-- Follow-up de reativação: TETO por lead + INTERVALO mínimo entre reenvios
-- ----------------------------------------------------------------------------
-- Bug (lead 28 98115-7836 recebeu 6 follow-ups em 3 dias; 10 leads com 7-8):
-- a RPC do ciclo (20260617200000) garantia round-robin mas faltavam DUAS travas:
--   1) TETO de tentativas por lead -> send_count crescia sem limite (8+).
--   2) INTERVALO mínimo desde o ÚLTIMO ENVIO -> a trava de 24h existente é sobre
--      a última INTERAÇÃO do LEAD (sempre verdadeira p/ lead morto), não sobre o
--      nosso último follow-up. Com a fila pequena (periodo_dias=7 -> 21 leads), o
--      ciclo zerava em horas e reabria -> mesmo lead várias vezes/dia.
--
-- Correção (decisão do dono: MÁX 3 follow-ups, >=24h entre eles, depois PARA):
--   - p_max_attempts (default 3): exclui quem já recebeu >= N follow-ups.
--   - p_min_resend_hours (default 24): exclui quem recebeu follow-up nas últimas Nh
--     (sobre r.last_sent_at) -> no máximo ~1 follow-up/dia por lead.
-- O alcance (quais leads) segue por p_periodo_dias (config); o dono escolheu TODOS
-- os inativos (config.periodo_dias = NULL). O ciclo round-robin continua igual.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_next_reactivation_lead(uuid, int, int, timestamptz);

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
    AND l.remote_jid IS NOT NULL
    AND (p_periodo_dias IS NULL
         OR l.created_at >= now() - make_interval(days => p_periodo_dias))
    AND (r.status IS NULL OR r.status IN ('pending', 'sent'))
    -- TETO POR LEAD: no máximo p_max_attempts follow-ups. Depois disso o lead sai
    -- da fila para sempre (não reativa mais). Resolve os 6-8 disparos por lead.
    AND COALESCE(r.send_count, 0) < GREATEST(p_max_attempts, 1)
    -- INTERVALO MÍNIMO ENTRE ENVIOS (sobre o NOSSO último follow-up): no máximo
    -- ~1 follow-up por dia por lead. Resolve os múltiplos disparos no mesmo dia.
    AND (r.last_sent_at IS NULL
         OR r.last_sent_at < now() - make_interval(hours => GREATEST(p_min_resend_hours, 1)))
    -- CICLO: não repete quem já foi cutucado NESTE ciclo (round-robin justo).
    AND (p_cycle_at IS NULL OR r.last_sent_at IS NULL OR r.last_sent_at < p_cycle_at)
    -- TRAVA: o atendimento/atividade mais recente DO LEAD tem que ser há > 24h.
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
