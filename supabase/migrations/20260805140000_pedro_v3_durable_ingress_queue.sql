-- ============================================================================
-- Pedro v3 — fila local duravel para o primeiro ingresso.
--
-- Incidente Monaco 04/08/2026: o wa_inbox foi persistido, o bridge externo
-- expirou e devolvemos 503. A UAZAPI nao repetiu a entrega. Sem uma fila local,
-- o lead ficou fora do CRM/v3. Esta migration torna o Supabase a fronteira de
-- durabilidade: CRM minimo + evento de replay nascem na mesma transacao antes
-- de qualquer chamada de rede ao servico v3.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pedro_v3_ingress_queue (
  event_id text PRIMARY KEY,
  tenant_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  conversation_id text NOT NULL,
  turn_id text NOT NULL,
  lead_id uuid NOT NULL REFERENCES public.ai_crm_leads(id) ON DELETE RESTRICT,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'delivered', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processing_by text,
  processing_token uuid,
  processing_started_at timestamptz,
  last_error text,
  last_http_status integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT pedro_v3_ingress_queue_identity_ck CHECK (
    payload->>'eventId' = event_id
    AND payload->>'tenantId' = tenant_id::text
    AND payload->>'agentId' = agent_id::text
    AND payload->>'instanceId' = instance_id::text
    AND payload->>'conversationId' = conversation_id
    AND payload->>'turnId' = turn_id
  )
);

CREATE INDEX IF NOT EXISTS pedro_v3_ingress_queue_pending_idx
  ON public.pedro_v3_ingress_queue (next_attempt_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS pedro_v3_ingress_queue_stale_idx
  ON public.pedro_v3_ingress_queue (processing_started_at)
  WHERE status = 'processing';

ALTER TABLE public.pedro_v3_ingress_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pedro_v3_ingress_queue FROM PUBLIC, anon, authenticated;

-- Enfileira e garante a identidade minima do CRM na MESMA transacao. O v3 usa
-- a mesma unique (agent_id, remote_jid), portanto encontra esta linha depois e
-- apenas a enriquece; nao nasce um CRM paralelo.
CREATE OR REPLACE FUNCTION public.pedro_v3_enqueue_ingress_v1(p_turn jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_agent uuid;
  v_instance uuid;
  v_event text := nullif(trim(p_turn->>'eventId'), '');
  v_conversation text := nullif(trim(p_turn->>'conversationId'), '');
  v_turn text := nullif(trim(p_turn->>'turnId'), '');
  v_phone text := public.logos_phone_canonical(p_turn->>'to');
  v_jid text;
  v_received_at timestamptz;
  v_agent_active boolean;
  v_seller uuid;
  v_lead_id uuid;
  v_lead_name text;
  v_conv public.ai_conversation_index%rowtype;
  v_inbox record;
  v_queue_status text;
BEGIN
  IF p_turn IS NULL OR jsonb_typeof(p_turn) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  END IF;

  BEGIN
    v_tenant := nullif(trim(p_turn->>'tenantId'), '')::uuid;
    v_agent := nullif(trim(p_turn->>'agentId'), '')::uuid;
    v_instance := nullif(trim(p_turn->>'instanceId'), '')::uuid;
    v_received_at := coalesce(nullif(trim(p_turn->>'receivedAt'), '')::timestamptz, now());
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_identity');
  END;

  IF v_tenant IS NULL OR v_agent IS NULL OR v_instance IS NULL
     OR v_event IS NULL OR v_conversation IS NULL OR v_turn IS NULL
     OR NOT public.logos_phone_plausible(v_phone) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_identity');
  END IF;
  v_jid := v_phone || '@s.whatsapp.net';

  SELECT a.is_active
    INTO v_agent_active
  FROM public.wa_ai_agents a
  WHERE a.id = v_agent
    AND a.user_id = v_tenant
    AND (
      a.instance_id = v_instance
      OR v_instance = ANY(coalesce(a.instance_ids, '{}'::uuid[]))
    );
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'agent_not_bound_to_instance');
  END IF;
  IF v_agent_active IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'agent_inactive');
  END IF;

  SELECT i.seller_member_id
    INTO v_seller
  FROM public.wa_instances i
  WHERE i.id = v_instance AND i.user_id = v_tenant;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'instance_not_found');
  END IF;
  IF v_seller IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'seller_instance');
  END IF;

  -- A mesma trava usada pela projecao impede duas identidades concorrentes para
  -- o mesmo telefone do tenant.
  PERFORM public.ai_conv_index_lock(v_tenant, v_phone);
  PERFORM public.ai_conv_index_adopt_instance(v_tenant, v_phone, v_instance, v_agent);

  SELECT l.id
    INTO v_lead_id
  FROM public.ai_crm_leads l
  WHERE l.user_id = v_tenant
    AND l.agent_id = v_agent
    AND l.remote_jid = v_jid
  LIMIT 1
  FOR UPDATE;

  IF v_lead_id IS NULL THEN
    v_lead_name := nullif(trim(p_turn->>'leadNameHint'), '');
    IF v_lead_name IS NULL THEN
      v_lead_name := 'Contato WhatsApp • final ' || right(v_phone, 4);
    END IF;

    INSERT INTO public.ai_crm_leads (
      user_id, agent_id, instance_id, remote_jid, lead_name,
      status, status_crm, message_count, followup_5min_sent,
      last_user_reply_at, last_interaction_at, ai_paused
    ) VALUES (
      v_tenant, v_agent, v_instance, v_jid, left(v_lead_name, 180),
      'novo', 'novo', 1, false,
      v_received_at, v_received_at, false
    )
    ON CONFLICT (agent_id, remote_jid) DO NOTHING
    RETURNING id INTO v_lead_id;

    IF v_lead_id IS NULL THEN
      SELECT l.id
        INTO v_lead_id
      FROM public.ai_crm_leads l
      WHERE l.user_id = v_tenant
        AND l.agent_id = v_agent
        AND l.remote_jid = v_jid
      LIMIT 1
      FOR UPDATE;
    END IF;
  ELSE
    UPDATE public.ai_crm_leads l
    SET instance_id = coalesce(l.instance_id, v_instance),
        last_user_reply_at = coalesce(greatest(l.last_user_reply_at, v_received_at), l.last_user_reply_at, v_received_at),
        last_interaction_at = coalesce(greatest(l.last_interaction_at, v_received_at), l.last_interaction_at, v_received_at),
        message_count = greatest(coalesce(l.message_count, 0), 1),
        updated_at = now()
    WHERE l.id = v_lead_id AND l.user_id = v_tenant;
  END IF;

  -- Se o conflito unico pertence a outro tenant, nunca adota a linha estrangeira.
  IF v_lead_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'foreign_tenant_crm_conflict');
  END IF;

  SELECT *
    INTO v_conv
  FROM public.ai_conversation_index c
  WHERE c.user_id = v_tenant
    AND c.instance_id = v_instance
    AND c.phone_canonical = v_phone
  FOR UPDATE;

  -- Defesa para eventual atraso/falha da trigger da projecao: reconstrui somente
  -- a partir do wa_inbox que ja foi confirmado pelo webhook.
  IF NOT FOUND THEN
    SELECT w.*
      INTO v_inbox
    FROM public.wa_inbox w
    WHERE w.user_id = v_tenant
      AND w.instance_id = v_instance
      AND public.logos_phone_canonical(w.phone) = v_phone
      AND w.direction = 'incoming'
      AND coalesce(w.is_archived, false) = false
    ORDER BY w.created_at DESC, w.id DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'durable_inbox_not_found');
    END IF;

    PERFORM public.ai_conv_index_upsert(
      v_tenant, v_instance, v_inbox.phone, v_agent, v_inbox.contact_name,
      v_inbox.content, v_inbox.message_type, v_inbox.direction,
      v_inbox.created_at, 0, 'webhook', true
    );

    SELECT *
      INTO v_conv
    FROM public.ai_conversation_index c
    WHERE c.user_id = v_tenant
      AND c.instance_id = v_instance
      AND c.phone_canonical = v_phone
    FOR UPDATE;
  END IF;

  IF v_conv.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'projection_not_materialized');
  END IF;

  UPDATE public.ai_conversation_index c
  SET agent_id = v_agent,
      crm_lead_id = v_lead_id,
      crm_source = 'pedro',
      crm_match_status = 'linked',
      updated_at = now()
  WHERE c.id = v_conv.id
    AND (
      c.crm_lead_id IS NULL
      OR (c.crm_source = 'pedro' AND c.crm_lead_id = v_lead_id)
      OR (
        c.crm_source = 'pedro'
        AND NOT EXISTS (
          SELECT 1 FROM public.ai_crm_leads old_lead
          WHERE old_lead.id = c.crm_lead_id AND old_lead.user_id = v_tenant
        )
      )
    );
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'projection_crm_conflict');
  END IF;

  INSERT INTO public.pedro_v3_ingress_queue (
    event_id, tenant_id, agent_id, instance_id, conversation_id, turn_id,
    lead_id, payload, status, next_attempt_at, updated_at
  ) VALUES (
    v_event, v_tenant, v_agent, v_instance, v_conversation, v_turn,
    v_lead_id, p_turn, 'pending', now(), now()
  )
  ON CONFLICT (event_id) DO UPDATE
    SET payload = EXCLUDED.payload,
        lead_id = EXCLUDED.lead_id,
        updated_at = now()
    WHERE public.pedro_v3_ingress_queue.status IN ('pending', 'processing');

  SELECT q.status INTO v_queue_status
  FROM public.pedro_v3_ingress_queue q
  WHERE q.event_id = v_event;

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_queue_status,
    'event_id', v_event,
    'lead_id', v_lead_id,
    'conversation_id', v_conv.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pedro_v3_enqueue_ingress_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pedro_v3_enqueue_ingress_v1(jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.pedro_v3_claim_ingress_v1(
  p_worker text,
  p_limit integer DEFAULT 20,
  p_now timestamptz DEFAULT now()
) RETURNS SETOF public.pedro_v3_ingress_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF nullif(trim(p_worker), '') IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'invalid_ingress_claim' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT q.event_id
    FROM public.pedro_v3_ingress_queue q
    WHERE (
      (q.status = 'pending' AND q.next_attempt_at <= p_now)
      OR (q.status = 'processing' AND q.processing_started_at < p_now - interval '5 minutes')
    )
    ORDER BY q.next_attempt_at, q.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.pedro_v3_ingress_queue q
  SET status = 'processing',
      attempt_count = q.attempt_count + 1,
      processing_by = left(p_worker, 120),
      processing_token = gen_random_uuid(),
      processing_started_at = p_now,
      updated_at = p_now
  FROM candidates c
  WHERE q.event_id = c.event_id
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION public.pedro_v3_claim_ingress_v1(text, integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pedro_v3_claim_ingress_v1(text, integer, timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.pedro_v3_record_ingress_result_v1(
  p_event_id text,
  p_processing_token uuid,
  p_outcome text,
  p_error text DEFAULT NULL,
  p_http_status integer DEFAULT NULL,
  p_now timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_attempt integer;
  v_delay integer;
BEGIN
  IF p_outcome NOT IN ('delivered', 'retry', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_ingress_outcome' USING ERRCODE = '22023';
  END IF;

  SELECT q.attempt_count INTO v_attempt
  FROM public.pedro_v3_ingress_queue q
  WHERE q.event_id = p_event_id
    AND q.status = 'processing'
    AND q.processing_token = p_processing_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  v_delay := least(600, (15 * power(2, least(greatest(v_attempt - 1, 0), 6)))::integer);

  UPDATE public.pedro_v3_ingress_queue q
  SET status = CASE p_outcome
        WHEN 'delivered' THEN 'delivered'
        WHEN 'cancelled' THEN 'cancelled'
        ELSE 'pending'
      END,
      next_attempt_at = CASE WHEN p_outcome = 'retry' THEN p_now + make_interval(secs => v_delay) ELSE q.next_attempt_at END,
      delivered_at = CASE WHEN p_outcome = 'delivered' THEN p_now ELSE q.delivered_at END,
      cancelled_at = CASE WHEN p_outcome = 'cancelled' THEN p_now ELSE q.cancelled_at END,
      last_error = nullif(left(coalesce(p_error, ''), 500), ''),
      last_http_status = p_http_status,
      processing_by = NULL,
      processing_token = NULL,
      processing_started_at = NULL,
      updated_at = p_now
  WHERE q.event_id = p_event_id
    AND q.status = 'processing'
    AND q.processing_token = p_processing_token;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.pedro_v3_record_ingress_result_v1(text, uuid, text, text, integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pedro_v3_record_ingress_result_v1(text, uuid, text, text, integer, timestamptz)
  TO service_role;

-- ACK do caminho sincrono. Se falhar depois do bridge, o replay pode repetir o
-- MESMO eventId com seguranca; o v3 deduplica pela PK do inbox.
CREATE OR REPLACE FUNCTION public.pedro_v3_mark_ingress_delivered_v1(
  p_event_id text,
  p_http_status integer DEFAULT NULL,
  p_service_status text DEFAULT NULL
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.pedro_v3_ingress_queue q
  SET status = 'delivered',
      delivered_at = coalesce(q.delivered_at, now()),
      last_error = NULL,
      last_http_status = p_http_status,
      processing_by = NULL,
      processing_token = NULL,
      processing_started_at = NULL,
      updated_at = now()
  WHERE q.event_id = p_event_id
    AND q.status IN ('pending', 'processing', 'delivered')
  RETURNING true;
$$;

REVOKE ALL ON FUNCTION public.pedro_v3_mark_ingress_delivered_v1(text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pedro_v3_mark_ingress_delivered_v1(text, integer, text)
  TO service_role;

-- Cron de replay: a chave fica no Vault e nunca e versionada.
CREATE OR REPLACE FUNCTION public.cron_pedro_v3_ingress_replay_v1()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;
  IF v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'pedro-v3-ingress-replay: service_role_key ausente no vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/pedro-v3-ingress-replay',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_key,
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('source', 'cron'),
    timeout_milliseconds := 55000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cron_pedro_v3_ingress_replay_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_pedro_v3_ingress_replay_v1()
  TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pedro-v3-ingress-replay-1min') THEN
    PERFORM cron.unschedule('pedro-v3-ingress-replay-1min');
  END IF;
  PERFORM cron.schedule(
    'pedro-v3-ingress-replay-1min',
    '* * * * *',
    'SELECT public.cron_pedro_v3_ingress_replay_v1()'
  );
END;
$$;

COMMENT ON TABLE public.pedro_v3_ingress_queue IS
  'Fronteira local duravel do primeiro ingresso no Pedro v3; replay idempotente quando o bridge externo falha.';
