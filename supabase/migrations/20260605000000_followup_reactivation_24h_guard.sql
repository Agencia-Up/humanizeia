-- ============================================================================
-- 20260605000000_followup_reactivation_24h_guard.sql
-- ----------------------------------------------------------------------------
-- TRAVA DE 24h no motor de reativacao (Follow-up IA).
--
-- Regra do dono (04/06/2026): a reativacao SO pode disparar para leads que estao
-- SEM atendimento da IA ha MAIS de 24h. Evita encher o saco de quem acabou de
-- falar com o agente (caso real: lead falou 11:04, recusou, e recebeu a
-- reativacao "vi que voce esteve aqui ha uns dias atras" as 11:07 — 3 min depois).
--
-- Implementacao: adiciona o filtro de 24h na RPC get_next_reactivation_lead,
-- usando o TOQUE mais recente (interacao / resposta do lead / resposta do agente)
-- com fallback no created_at. So RESTRINGE o que a RPC ja retornava.
--
-- OBS: a mesma trava ja esta replicada no edge function pedro-auto-followup
-- (pickEligibleByRecency), que e a rede ativa em producao enquanto esta migration
-- nao e aplicada. As duas juntas sao redundantes e seguras.
-- ============================================================================

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
    -- TRAVA 24h: o atendimento mais recente tem que ser ha MAIS de 24h.
    AND GREATEST(
          COALESCE(l.last_interaction_at, l.created_at),
          COALESCE(l.last_user_reply_at, l.created_at),
          COALESCE(l.last_agent_reply_at, l.created_at)
        ) < now() - interval '24 hours'
  ORDER BY r.last_sent_at ASC NULLS FIRST, l.created_at ASC
  LIMIT GREATEST(p_limit, 1);
$$;
