-- ============================================================
-- Pedro/Marcos — RPC de log de falha de transferencia (2-b)
-- ------------------------------------------------------------
-- As edge functions chamam pedro_log_transfer_failure(...) num
-- UNICO ponto por falha. A funcao faz upsert idempotente contra
-- o indice parcial pedro_tf_open_uq (user_id, lead_id, reason_code)
-- WHERE resolved_at IS NULL: em vez de duplicar linhas a cada
-- varredura do cron, incrementa attempt_count.
--
-- Por que RPC e nao upsert via PostgREST: o indice e PARCIAL e o
-- PostgREST nao consegue informar o predicado (WHERE resolved_at
-- IS NULL) necessario para a inferencia do ON CONFLICT. Dentro de
-- uma funcao SQL podemos escrever o ON CONFLICT completo.
--
-- SECURITY DEFINER + REVOKE PUBLIC + GRANT service_role: so as
-- edge functions (service role) registram falhas; um usuario
-- autenticado nao pode injetar falhas no painel de outro usuario.
-- ============================================================

CREATE OR REPLACE FUNCTION public.pedro_log_transfer_failure(
  p_user_id            uuid,
  p_reason_code        text,
  p_mode               text    DEFAULT 'pedro',
  p_lead_id            uuid    DEFAULT NULL,
  p_agent_id           uuid    DEFAULT NULL,
  p_member_id          uuid    DEFAULT NULL,
  p_lead_name          text    DEFAULT NULL,
  p_remote_jid         text    DEFAULT NULL,
  p_reason_detail      text    DEFAULT NULL,
  p_lead_status        text    DEFAULT NULL,
  p_lead_status_crm    text    DEFAULT NULL,
  p_attempted_transfer boolean DEFAULT false,
  p_source             text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason text := p_reason_code;
  v_mode   text := COALESCE(p_mode, 'pedro');
  v_id     uuid;
BEGIN
  -- Sem dono nao ha o que registrar.
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Blindagem: motivo invalido nunca derruba a chamada -> cai em 'outros'.
  IF v_reason IS NULL OR v_reason NOT IN (
    'lead_nao_qualificado','lead_inativo','sem_vendedor_disponivel','erro_tecnico',
    'funil_timeout','regra_nao_atingida','agente_nao_executou','outros'
  ) THEN
    v_reason := 'outros';
  END IF;

  IF v_mode NOT IN ('pedro','marcos') THEN
    v_mode := 'pedro';
  END IF;

  INSERT INTO public.pedro_transfer_failures (
    user_id, mode, lead_id, agent_id, member_id, lead_name, remote_jid,
    reason_code, reason_detail, lead_status, lead_status_crm,
    attempted_transfer, source, attempt_count, last_attempt_at
  ) VALUES (
    p_user_id, v_mode, p_lead_id, p_agent_id, p_member_id, p_lead_name, p_remote_jid,
    v_reason, p_reason_detail, p_lead_status, p_lead_status_crm,
    COALESCE(p_attempted_transfer, false), p_source, 1, NOW()
  )
  ON CONFLICT (user_id, lead_id, reason_code) WHERE resolved_at IS NULL
  DO UPDATE SET
    attempt_count      = pedro_transfer_failures.attempt_count + 1,
    last_attempt_at    = NOW(),
    reason_detail      = COALESCE(EXCLUDED.reason_detail,   pedro_transfer_failures.reason_detail),
    lead_status        = COALESCE(EXCLUDED.lead_status,     pedro_transfer_failures.lead_status),
    lead_status_crm    = COALESCE(EXCLUDED.lead_status_crm, pedro_transfer_failures.lead_status_crm),
    lead_name          = COALESCE(EXCLUDED.lead_name,       pedro_transfer_failures.lead_name),
    remote_jid         = COALESCE(EXCLUDED.remote_jid,      pedro_transfer_failures.remote_jid),
    member_id          = COALESCE(EXCLUDED.member_id,       pedro_transfer_failures.member_id),
    agent_id           = COALESCE(EXCLUDED.agent_id,        pedro_transfer_failures.agent_id),
    attempted_transfer = pedro_transfer_failures.attempted_transfer OR EXCLUDED.attempted_transfer,
    source             = COALESCE(EXCLUDED.source,          pedro_transfer_failures.source),
    updated_at         = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Marca como resolvidas todas as falhas ABERTAS de um lead (quando ele
-- finalmente e transferido, manual ou automaticamente).
CREATE OR REPLACE FUNCTION public.pedro_resolve_transfer_failures(
  p_user_id     uuid,
  p_lead_id     uuid,
  p_resolved_by text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_user_id IS NULL OR p_lead_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.pedro_transfer_failures
     SET resolved_at = NOW(),
         resolved_by = COALESCE(p_resolved_by, resolved_by),
         updated_at  = NOW()
   WHERE user_id = p_user_id
     AND lead_id = p_lead_id
     AND resolved_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── Permissoes: apenas service_role (edge functions) ────────
-- Importante: o Supabase concede EXECUTE por default a anon/authenticated
-- em funcoes do schema public. Como estas funcoes sao SECURITY DEFINER e
-- recebem p_user_id por parametro (ignoram RLS), precisamos REVOGAR
-- explicitamente de anon e authenticated — senao um usuario logado poderia
-- injetar falhas no painel de OUTRO usuario.
REVOKE ALL ON FUNCTION public.pedro_log_transfer_failure(uuid,text,text,uuid,uuid,uuid,text,text,text,text,text,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pedro_log_transfer_failure(uuid,text,text,uuid,uuid,uuid,text,text,text,text,text,boolean,text) FROM anon;
REVOKE ALL ON FUNCTION public.pedro_log_transfer_failure(uuid,text,text,uuid,uuid,uuid,text,text,text,text,text,boolean,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.pedro_log_transfer_failure(uuid,text,text,uuid,uuid,uuid,text,text,text,text,text,boolean,text) TO service_role;

REVOKE ALL ON FUNCTION public.pedro_resolve_transfer_failures(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pedro_resolve_transfer_failures(uuid,uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.pedro_resolve_transfer_failures(uuid,uuid,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.pedro_resolve_transfer_failures(uuid,uuid,text) TO service_role;
