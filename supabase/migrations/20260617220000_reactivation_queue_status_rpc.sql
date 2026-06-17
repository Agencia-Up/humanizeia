-- ============================================================================
-- Andamento da fila de reativacao (round-robin) — visao para o painel
-- ----------------------------------------------------------------------------
-- Devolve, para o master logado, o estado da fila do ciclo ATUAL do motor de
-- reativacao (pedro-auto-followup):
--   * cycle_started_at  -> quando a volta atual comecou (followup_ia_config)
--   * total_fila        -> leads inativos elegiveis na fila (alvo da volta)
--   * enviados_ciclo    -> ja contatados NESTA volta (last_sent_at >= ciclo)
--   * restantes_ciclo   -> ainda faltam contatar NESTA volta
--   * responderam_ciclo -> responderam ao cutucao desde o inicio da volta
--
-- A elegibilidade espelha EXATAMENTE o WHERE de get_next_reactivation_lead
-- (status_crm='inativo' + remote_jid + periodo_dias + trava 24h + status da
-- fila pending/sent), para o numero refletir o que o motor realmente faz.
--
-- Quando restantes_ciclo chega a 0, a volta fechou: o motor abre um ciclo novo
-- (reactivation_cycle_at = now()) e so entao um lead volta a receber follow-up.
-- Isso e a prova visual de que a fila esta sendo respeitada.
--
-- SECURITY DEFINER + guarda (user_id = auth.uid()): so retorna dados da PROPRIA
-- conta de quem chama; passar outro p_user_id devolve tudo zerado/nulo.
-- Somente leitura — nao altera nada.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_reactivation_queue_status(p_user_id uuid)
RETURNS TABLE (
  cycle_started_at   timestamptz,
  total_fila         bigint,
  enviados_ciclo     bigint,
  restantes_ciclo    bigint,
  responderam_ciclo  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cfg AS (
    SELECT periodo_dias, reactivation_cycle_at
    FROM public.followup_ia_config
    WHERE user_id = p_user_id
      AND p_user_id = auth.uid()   -- guarda multi-tenant
    LIMIT 1
  ),
  base AS (
    SELECT r.last_sent_at
    FROM public.ai_crm_leads l
    LEFT JOIN public.pedro_followup_reactivation r ON r.lead_id = l.id
    CROSS JOIN cfg
    WHERE l.user_id = p_user_id
      AND l.status_crm = 'inativo'
      AND l.remote_jid IS NOT NULL
      AND (cfg.periodo_dias IS NULL
           OR l.created_at >= now() - make_interval(days => cfg.periodo_dias))
      AND (r.status IS NULL OR r.status IN ('pending', 'sent'))
      AND GREATEST(
            COALESCE(l.last_interaction_at, l.created_at),
            COALESCE(l.last_user_reply_at, l.created_at),
            COALESCE(l.last_agent_reply_at, l.created_at)
          ) < now() - interval '24 hours'
  )
  SELECT
    c.reactivation_cycle_at AS cycle_started_at,
    (SELECT COUNT(*) FROM base)                                                   AS total_fila,
    (SELECT COUNT(*) FROM base WHERE base.last_sent_at >= c.reactivation_cycle_at) AS enviados_ciclo,
    (SELECT COUNT(*) FROM base
       WHERE base.last_sent_at IS NULL
          OR base.last_sent_at < c.reactivation_cycle_at)                        AS restantes_ciclo,
    (SELECT COUNT(*) FROM public.pedro_followup_reactivation r2
       WHERE r2.user_id = p_user_id
         AND r2.status = 'responded'
         AND r2.responded_at >= c.reactivation_cycle_at)                         AS responderam_ciclo
  FROM cfg c;
$$;

GRANT EXECUTE ON FUNCTION public.get_reactivation_queue_status(uuid)
  TO authenticated, service_role;
