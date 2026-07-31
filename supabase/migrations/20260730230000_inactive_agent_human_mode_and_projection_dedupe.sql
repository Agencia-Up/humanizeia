-- ============================================================================
-- Conversa canônica + modo humano para agente inativo.
--
-- Contratos:
--   1) um telefone em uma única linha de IA aparece uma única vez, mesmo quando
--      um alimentador ainda não conhece a instance_id;
--   2) agente inativo não responde e não agenda follow-up, mas a mensagem entra
--      no inbox, cria/vincula CRM pausado e permanece operável por humanos;
--   3) linha de vendedor continua totalmente fora deste fluxo.
-- ============================================================================

-- 1. Merge seguro da projeção órfã com a identidade de instância conhecida.
CREATE OR REPLACE FUNCTION public.ai_conv_index_adopt_instance(
  p_user uuid, p_canon text, p_instance uuid, p_agent uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_orphan public.ai_conversation_index%rowtype;
  v_winner public.ai_conversation_index%rowtype;
  v_orphan_pause_wins boolean;
BEGIN
  IF p_instance IS NULL OR NOT public.logos_phone_plausible(p_canon) THEN RETURN; END IF;
  PERFORM public.ai_conv_index_lock(p_user, p_canon);

  SELECT * INTO v_orphan
  FROM public.ai_conversation_index
  WHERE user_id = p_user
    AND phone_canonical = p_canon
    AND instance_id IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_winner
  FROM public.ai_conversation_index
  WHERE user_id = p_user
    AND phone_canonical = p_canon
    AND instance_id = p_instance
  FOR UPDATE;

  IF FOUND THEN
    -- Leads CRM diferentes são uma ambiguidade de dados real. Nunca apagar uma
    -- das identidades silenciosamente só para "sumir" com a duplicação visual.
    IF v_winner.crm_lead_id IS NOT NULL
       AND v_orphan.crm_lead_id IS NOT NULL
       AND v_winner.crm_lead_id <> v_orphan.crm_lead_id THEN
      UPDATE public.ai_conversation_index
      SET crm_match_status = 'ambiguous', updated_at = now()
      WHERE id IN (v_winner.id, v_orphan.id);
      RETURN;
    END IF;

    v_orphan_pause_wins :=
      coalesce(v_orphan.ai_paused, false)
      AND (
        NOT coalesce(v_winner.ai_paused, false)
        OR coalesce(v_orphan.ai_paused_at, '-infinity') >
           coalesce(v_winner.ai_paused_at, '-infinity')
      );

    UPDATE public.ai_conversation_index w
    SET
      agent_id = coalesce(w.agent_id, v_orphan.agent_id, p_agent),
      phone_raw = coalesce(w.phone_raw, v_orphan.phone_raw),
      contact_name = coalesce(w.contact_name, v_orphan.contact_name),
      profile_picture_url = coalesce(w.profile_picture_url, v_orphan.profile_picture_url),
      last_message = CASE
        WHEN v_orphan.last_message_at > coalesce(w.last_message_at, '-infinity')
          THEN v_orphan.last_message ELSE w.last_message END,
      last_message_type = CASE
        WHEN v_orphan.last_message_at > coalesce(w.last_message_at, '-infinity')
          THEN v_orphan.last_message_type ELSE w.last_message_type END,
      last_message_direction = CASE
        WHEN v_orphan.last_message_at > coalesce(w.last_message_at, '-infinity')
          THEN v_orphan.last_message_direction ELSE w.last_message_direction END,
      last_message_at = greatest(
        coalesce(w.last_message_at, '-infinity'),
        coalesce(v_orphan.last_message_at, '-infinity')
      ),
      -- As duas projeções podem representar o MESMO evento (uma órfã e outra
      -- já ligada à instância). Somar inflaria a conversa; preservamos o maior
      -- contador observado até que novos eventos canônicos cheguem.
      message_count = greatest(
        coalesce(w.message_count, 0),
        coalesce(v_orphan.message_count, 0)
      ),
      first_seen_at = least(w.first_seen_at, v_orphan.first_seen_at),
      crm_lead_id = coalesce(w.crm_lead_id, v_orphan.crm_lead_id),
      crm_source = coalesce(w.crm_source, v_orphan.crm_source),
      crm_match_status = CASE
        WHEN coalesce(w.crm_lead_id, v_orphan.crm_lead_id) IS NOT NULL THEN 'linked'
        WHEN w.crm_match_status = 'ambiguous' OR v_orphan.crm_match_status = 'ambiguous' THEN 'ambiguous'
        ELSE 'orphan'
      END,
      -- A linha com instância conhecida é autoritativa sobre a finalidade.
      ai_line = w.ai_line,
      ai_paused = coalesce(w.ai_paused, false) OR coalesce(v_orphan.ai_paused, false),
      ai_paused_at = CASE
        WHEN v_orphan_pause_wins THEN v_orphan.ai_paused_at
        WHEN coalesce(w.ai_paused, false) THEN w.ai_paused_at
        ELSE v_orphan.ai_paused_at
      END,
      ai_paused_by = CASE
        WHEN v_orphan_pause_wins THEN v_orphan.ai_paused_by
        ELSE coalesce(w.ai_paused_by, v_orphan.ai_paused_by)
      END,
      pause_reason = CASE
        WHEN v_orphan_pause_wins THEN v_orphan.pause_reason
        ELSE coalesce(w.pause_reason, v_orphan.pause_reason)
      END,
      updated_at = now()
    WHERE w.id = v_winner.id;

    DELETE FROM public.ai_conversation_index WHERE id = v_orphan.id;
  ELSE
    UPDATE public.ai_conversation_index
    SET instance_id = p_instance,
        agent_id = coalesce(agent_id, p_agent),
        updated_at = now()
    WHERE id = v_orphan.id;
  END IF;
END;
$$;

-- 2. Upsert canônico bidirecional.
-- Se o evento não conhece a instância, mas existe EXATAMENTE uma instância
-- conhecida para tenant+telefone, ele reutiliza aquela identidade. Com duas ou
-- mais instâncias reais, mantém a órfã: escolher uma seria vazamento cross-line.
CREATE OR REPLACE FUNCTION public.ai_conv_index_upsert(
  p_user uuid, p_instance uuid, p_phone_raw text,
  p_agent uuid, p_name text,
  p_msg text, p_msg_type text, p_dir text, p_at timestamptz,
  p_count_delta int, p_origem text, p_create boolean DEFAULT true
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_canon text := public.logos_phone_canonical(p_phone_raw);
  v_instance uuid := p_instance;
  v_agent uuid := p_agent;
  v_known_count integer := 0;
BEGIN
  IF p_user IS NULL OR NOT public.logos_phone_plausible(v_canon) THEN RETURN; END IF;
  PERFORM public.ai_conv_index_lock(p_user, v_canon);

  IF v_instance IS NULL THEN
    SELECT
      count(DISTINCT i.instance_id),
      (array_agg(i.instance_id ORDER BY i.instance_id))[1],
      (array_agg(i.agent_id ORDER BY i.agent_id) FILTER (WHERE i.agent_id IS NOT NULL))[1]
      INTO v_known_count, v_instance, v_agent
    FROM public.ai_conversation_index i
    WHERE i.user_id = p_user
      AND i.phone_canonical = v_canon
      AND i.instance_id IS NOT NULL;

    IF v_known_count <> 1 THEN
      v_instance := NULL;
      v_agent := p_agent;
    ELSE
      v_agent := coalesce(p_agent, v_agent);
    END IF;
  END IF;

  IF v_instance IS NOT NULL THEN
    PERFORM public.ai_conv_index_adopt_instance(p_user, v_canon, v_instance, v_agent);
  END IF;

  IF NOT p_create THEN
    UPDATE public.ai_conversation_index i
    SET
      last_message = CASE
        WHEN p_at > coalesce(i.last_message_at, '-infinity') THEN p_msg ELSE i.last_message END,
      last_message_type = CASE
        WHEN p_at > coalesce(i.last_message_at, '-infinity') THEN p_msg_type ELSE i.last_message_type END,
      last_message_direction = CASE
        WHEN p_at > coalesce(i.last_message_at, '-infinity') THEN p_dir ELSE i.last_message_direction END,
      last_message_at = greatest(coalesce(i.last_message_at, '-infinity'), p_at),
      updated_at = now()
    WHERE i.user_id = p_user
      AND i.phone_canonical = v_canon
      AND i.instance_id IS NOT DISTINCT FROM v_instance;
    RETURN;
  END IF;

  INSERT INTO public.ai_conversation_index AS i (
    user_id, instance_id, agent_id, phone_raw, phone_canonical, contact_name,
    last_message, last_message_type, last_message_direction, last_message_at,
    message_count, origem
  ) VALUES (
    p_user, v_instance, v_agent, p_phone_raw, v_canon, nullif(p_name, ''),
    p_msg, p_msg_type, p_dir, p_at, greatest(p_count_delta, 0), p_origem
  )
  ON CONFLICT (user_id, instance_id, phone_canonical) DO UPDATE
  SET
    agent_id = coalesce(i.agent_id, excluded.agent_id),
    phone_raw = coalesce(excluded.phone_raw, i.phone_raw),
    contact_name = coalesce(excluded.contact_name, i.contact_name),
    last_message = CASE
      WHEN excluded.last_message_at > coalesce(i.last_message_at, '-infinity')
        THEN excluded.last_message ELSE i.last_message END,
    last_message_type = CASE
      WHEN excluded.last_message_at > coalesce(i.last_message_at, '-infinity')
        THEN excluded.last_message_type ELSE i.last_message_type END,
    last_message_direction = CASE
      WHEN excluded.last_message_at > coalesce(i.last_message_at, '-infinity')
        THEN excluded.last_message_direction ELSE i.last_message_direction END,
    last_message_at = greatest(coalesce(i.last_message_at, '-infinity'), excluded.last_message_at),
    message_count = i.message_count + greatest(p_count_delta, 0),
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.ai_conv_index_upsert(
  uuid, uuid, text, uuid, text, text, text, text, timestamptz, int, text, boolean
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_conv_index_adopt_instance(uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- 3. Garante o CRM humano depois que wa_inbox já confirmou a entrada.
CREATE OR REPLACE FUNCTION public.ensure_inactive_agent_human_lead_v1(
  p_tenant uuid,
  p_agent uuid,
  p_instance uuid,
  p_phone text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_canon text := public.logos_phone_canonical(p_phone);
  v_agent_active boolean;
  v_seller uuid;
  v_conv public.ai_conversation_index%rowtype;
  v_inbox record;
  v_lead_id uuid;
  v_ids uuid[] := '{}';
  v_created boolean := false;
  v_was_paused boolean := false;
  v_inbound_at timestamptz;
  v_inbox_count integer := 0;
  v_projection_updated integer := 0;
BEGIN
  IF p_tenant IS NULL OR p_agent IS NULL OR p_instance IS NULL
     OR NOT public.logos_phone_plausible(v_canon) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_identity');
  END IF;

  SELECT a.is_active
    INTO v_agent_active
  FROM public.wa_ai_agents a
  WHERE a.id = p_agent
    AND a.user_id = p_tenant
    AND (
      a.instance_id = p_instance
      OR p_instance = ANY(coalesce(a.instance_ids, '{}'::uuid[]))
    );
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'agent_not_bound_to_instance');
  END IF;
  IF v_agent_active IS DISTINCT FROM false THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', CASE
        WHEN v_agent_active IS TRUE THEN 'agent_active'
        ELSE 'agent_state_unknown'
      END
    );
  END IF;

  SELECT i.seller_member_id
    INTO v_seller
  FROM public.wa_instances i
  WHERE i.id = p_instance AND i.user_id = p_tenant;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'instance_not_found');
  END IF;
  IF v_seller IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'seller_instance');
  END IF;

  PERFORM public.ai_conv_index_lock(p_tenant, v_canon);
  PERFORM public.ai_conv_index_adopt_instance(p_tenant, v_canon, p_instance, p_agent);

  SELECT *
    INTO v_conv
  FROM public.ai_conversation_index
  WHERE user_id = p_tenant
    AND instance_id = p_instance
    AND phone_canonical = v_canon
  FOR UPDATE;

  -- Defesa para trigger/projeção ainda não materializada: reconstrói apenas a
  -- partir do inbox durável que acabou de ser gravado.
  IF NOT FOUND THEN
    SELECT w.*
      INTO v_inbox
    FROM public.wa_inbox w
    WHERE w.user_id = p_tenant
      AND w.instance_id = p_instance
      AND public.logos_phone_canonical(w.phone) = v_canon
      AND w.direction = 'incoming'
      AND coalesce(w.is_archived, false) = false
    ORDER BY w.created_at DESC, w.id DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'durable_inbox_not_found');
    END IF;

    PERFORM public.ai_conv_index_upsert(
      p_tenant, p_instance, v_inbox.phone, p_agent, v_inbox.contact_name,
      v_inbox.content, v_inbox.message_type, v_inbox.direction,
      v_inbox.created_at, 0, 'webhook', true
    );

    SELECT *
      INTO v_conv
    FROM public.ai_conversation_index
    WHERE user_id = p_tenant
      AND instance_id = p_instance
      AND phone_canonical = v_canon
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'projection_not_materialized');
    END IF;
  END IF;

  SELECT max(w.created_at), count(*)::integer
    INTO v_inbound_at, v_inbox_count
  FROM public.wa_inbox w
  WHERE w.user_id = p_tenant
    AND w.instance_id = p_instance
    AND public.logos_phone_canonical(w.phone) = v_canon
    AND w.direction = 'incoming'
    AND coalesce(w.is_archived, false) = false;

  -- Uma conversa já ligada ao CRM Marcos já cumpriu o contrato operacional.
  IF v_conv.crm_lead_id IS NOT NULL AND v_conv.crm_source = 'marcos' THEN
    UPDATE public.ai_conversation_index
    SET ai_paused = true,
        ai_paused_at = coalesce(ai_paused_at, now()),
        pause_reason = coalesce(pause_reason, 'agente_inativo_atendimento_humano'),
        agent_id = coalesce(agent_id, p_agent),
        updated_at = now()
    WHERE id = v_conv.id;

    RETURN jsonb_build_object(
      'ok', true, 'reason', 'existing_marcos_crm', 'created', false,
      'lead_id', v_conv.crm_lead_id, 'conversation_id', v_conv.id
    );
  END IF;

  -- Um vínculo vivo nunca pode ser substituído silenciosamente. Já um vínculo
  -- Pedro cujo lead foi apagado é apenas uma referência órfã: ele pode e deve
  -- convergir para o CRM idempotente encontrado/criado abaixo. Fontes
  -- desconhecidas ficam fail-closed, porque não sabemos a qual sistema o UUID
  -- pertence.
  IF v_conv.crm_lead_id IS NOT NULL
     AND v_conv.crm_source IS DISTINCT FROM 'pedro'
     AND NOT EXISTS (
       SELECT 1
       FROM public.ai_crm_leads l
       WHERE l.id = v_conv.crm_lead_id
         AND l.user_id = p_tenant
     ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_crm_link');
  END IF;

  IF v_conv.crm_lead_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.ai_crm_leads l
    WHERE l.id = v_conv.crm_lead_id AND l.user_id = p_tenant
  ) THEN
    v_lead_id := v_conv.crm_lead_id;
  ELSE
    SELECT coalesce(array_agg(l.id ORDER BY l.created_at), '{}')
      INTO v_ids
    FROM public.ai_crm_leads l
    WHERE l.user_id = p_tenant
      AND l.agent_id = p_agent
      AND l.instance_id = p_instance
      AND public.logos_phone_canonical(l.remote_jid) = v_canon;

    IF array_length(v_ids, 1) = 1 THEN
      v_lead_id := v_ids[1];
    ELSIF coalesce(array_length(v_ids, 1), 0) > 1 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'ambiguous_instance_crm_leads');
    END IF;

    IF v_lead_id IS NULL THEN
      SELECT coalesce(array_agg(l.id ORDER BY l.created_at), '{}')
        INTO v_ids
      FROM public.ai_crm_leads l
      WHERE l.user_id = p_tenant
        AND l.agent_id = p_agent
        AND public.logos_phone_canonical(l.remote_jid) = v_canon;

      IF array_length(v_ids, 1) = 1 THEN
        v_lead_id := v_ids[1];
      ELSIF coalesce(array_length(v_ids, 1), 0) > 1 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'ambiguous_agent_crm_leads');
      END IF;
    END IF;
  END IF;

  IF v_lead_id IS NULL THEN
    INSERT INTO public.ai_crm_leads (
      user_id, agent_id, instance_id, remote_jid, lead_name,
      status, status_crm,
      ai_paused, ai_paused_at, ai_paused_by, pause_reason,
      summary, additional_notes, arrived_at, entry_datetime,
      last_interaction_at, message_count,
      followup_5min_sent, next_followup_at,
      last_agent_reply_at, last_user_reply_at
    ) VALUES (
      p_tenant, p_agent, p_instance, v_canon || '@s.whatsapp.net', v_conv.contact_name,
      'novo', 'novo',
      true, now(), NULL, 'agente_inativo_atendimento_humano',
      v_conv.last_message,
      'Lead recebido com o agente inativo; atendimento humano no inbox.',
      coalesce(v_conv.first_seen_at, now()), coalesce(v_conv.first_seen_at, now()),
      coalesce(v_inbound_at, v_conv.last_message_at, now()),
      greatest(coalesce(v_conv.message_count, 0), coalesce(v_inbox_count, 0)),
      true, NULL,
      NULL, v_inbound_at
    )
    RETURNING id INTO v_lead_id;
    v_created := true;
  ELSE
    SELECT coalesce(l.ai_paused, false)
      INTO v_was_paused
    FROM public.ai_crm_leads l
    WHERE l.id = v_lead_id AND l.user_id = p_tenant
    FOR UPDATE;

    UPDATE public.ai_crm_leads l
    SET
      agent_id = p_agent,
      instance_id = coalesce(l.instance_id, p_instance),
      lead_name = coalesce(nullif(l.lead_name, ''), v_conv.contact_name),
      summary = coalesce(nullif(l.summary, ''), v_conv.last_message),
      additional_notes = coalesce(
        nullif(l.additional_notes, ''),
        'Lead recebido com o agente inativo; atendimento humano no inbox.'
      ),
      last_interaction_at = coalesce(
        greatest(l.last_interaction_at, v_inbound_at, v_conv.last_message_at),
        l.last_interaction_at,
        v_inbound_at,
        v_conv.last_message_at,
        now()
      ),
      last_user_reply_at = coalesce(
        greatest(l.last_user_reply_at, v_inbound_at),
        l.last_user_reply_at,
        v_inbound_at
      ),
      message_count = greatest(
        coalesce(l.message_count, 0),
        coalesce(v_conv.message_count, 0),
        coalesce(v_inbox_count, 0)
      ),
      ai_paused = true,
      ai_paused_at = coalesce(l.ai_paused_at, now()),
      pause_reason = coalesce(l.pause_reason, 'agente_inativo_atendimento_humano'),
      followup_5min_sent = true,
      next_followup_at = NULL,
      updated_at = now()
    WHERE l.id = v_lead_id AND l.user_id = p_tenant;
  END IF;

  UPDATE public.ai_conversation_index c
  SET
    agent_id = p_agent,
    crm_lead_id = v_lead_id,
    crm_source = 'pedro',
    crm_match_status = 'linked',
    ai_paused = true,
    ai_paused_at = coalesce(c.ai_paused_at, now()),
    pause_reason = coalesce(c.pause_reason, 'agente_inativo_atendimento_humano'),
    updated_at = now()
  WHERE c.user_id = p_tenant
    AND c.phone_canonical = v_canon
    AND c.instance_id = p_instance
    AND (
      c.crm_lead_id IS NULL
      OR c.crm_lead_id = v_lead_id
      OR (
        c.crm_source = 'pedro'
        AND NOT EXISTS (
          SELECT 1
          FROM public.ai_crm_leads old_lead
          WHERE old_lead.id = c.crm_lead_id
            AND old_lead.user_id = p_tenant
        )
      )
    );

  GET DIAGNOSTICS v_projection_updated = ROW_COUNT;
  IF v_projection_updated <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'projection_crm_conflict');
  END IF;

  IF v_created OR NOT v_was_paused THEN
    INSERT INTO public.ai_pause_audit (
      tenant_id, scope, lead_id, agent_id,
      previous_paused, new_paused, changed_by, source, reason, metadata,
      conversation_id
    ) VALUES (
      p_tenant, 'conversation', v_lead_id, p_agent,
      CASE WHEN v_created THEN false ELSE v_was_paused END,
      true, NULL, 'webhook', 'agente_inativo_atendimento_humano',
      jsonb_build_object('instance_id', p_instance, 'mode', 'human_only'),
      v_conv.id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'inactive_agent_human_mode',
    'created', v_created,
    'lead_id', v_lead_id,
    'conversation_id', v_conv.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_inactive_agent_human_lead_v1(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_inactive_agent_human_lead_v1(uuid, uuid, uuid, text)
  TO service_role;

-- 4. Corrige as duplicações órfã+instância que já são inequivocamente seguras.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT
      o.user_id,
      o.phone_canonical,
      (array_agg(k.instance_id ORDER BY k.instance_id))[1] AS instance_id,
      (array_agg(k.agent_id ORDER BY k.agent_id) FILTER (WHERE k.agent_id IS NOT NULL))[1] AS agent_id
    FROM public.ai_conversation_index o
    JOIN public.ai_conversation_index k
      ON k.user_id = o.user_id
     AND k.phone_canonical = o.phone_canonical
     AND k.instance_id IS NOT NULL
    WHERE o.instance_id IS NULL
    GROUP BY o.user_id, o.phone_canonical
    HAVING count(DISTINCT k.instance_id) = 1
  LOOP
    PERFORM public.ai_conv_index_adopt_instance(
      r.user_id, r.phone_canonical, r.instance_id, r.agent_id
    );
  END LOOP;
END;
$$;

-- 5. A RPC da lista reconhece todos os vínculos de instância do agente.
CREATE OR REPLACE FUNCTION public.get_ai_conversations_v2_base(
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
) RETURNS TABLE(
  conversation_id uuid, instance_id uuid, agent_id uuid, phone text, phone_raw text,
  contact_name text, profile_picture_url text, last_message text, last_message_type text,
  last_message_direction text, last_message_at timestamptz, message_count integer,
  crm_lead_id uuid, crm_source text, crm_match_status text, sem_vinculo_crm boolean,
  agente_inativo boolean, ia_pausada boolean, atendimento_manual boolean,
  first_seen_at timestamptz, assigned_to_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_is_seller boolean := false;
  v_is_manager boolean := false;
  v_tenant uuid;
  v_members uuid[] := '{}';
  v_members_txt text[] := '{}';
  v_internos text[];
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF coalesce(v_role, '') = 'seller' THEN
    v_is_seller := true;
    v_tenant := public.get_seller_master_user_id();
    SELECT coalesce(array_agg(id), '{}'), coalesce(array_agg(id::text), '{}')
      INTO v_members, v_members_txt
    FROM public.ai_team_members
    WHERE auth_user_id = v_uid AND coalesce(active_in_system, true) <> false;
    SELECT coalesce(bool_or(coalesce(m2.is_manager, false)), false)
      INTO v_is_manager
    FROM public.ai_team_members m2
    WHERE m2.auth_user_id = v_uid
      AND coalesce(m2.active_in_system, true) <> false
      AND m2.removed_at IS NULL;
  ELSE
    v_tenant := v_uid;
  END IF;
  IF v_tenant IS NULL THEN RETURN; END IF;

  v_internos := public.logos_internal_keys(v_tenant);

  RETURN QUERY
  SELECT
    c.id, c.instance_id, c.agent_id,
    c.phone_canonical, c.phone_raw, c.contact_name, c.profile_picture_url,
    c.last_message, c.last_message_type, c.last_message_direction,
    c.last_message_at, c.message_count,
    c.crm_lead_id, c.crm_source, c.crm_match_status,
    (c.crm_lead_id IS NULL),
    (
      c.instance_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.wa_ai_agents a
        WHERE a.user_id = v_tenant
          AND (
            a.instance_id = c.instance_id
            OR c.instance_id = ANY(coalesce(a.instance_ids, '{}'::uuid[]))
          )
          AND a.is_active
      )
    ),
    coalesce(pl.ai_paused, false),
    (
      coalesce(pl.ai_paused, false)
      OR (
        c.instance_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.wa_ai_agents a
          WHERE a.user_id = v_tenant
            AND (
              a.instance_id = c.instance_id
              OR c.instance_id = ANY(coalesce(a.instance_ids, '{}'::uuid[]))
            )
            AND a.is_active
        )
      )
    ),
    c.first_seen_at,
    coalesce(pl.assigned_to_id, ml.assigned_member_id)
  FROM public.ai_conversation_index c
  LEFT JOIN public.ai_crm_leads pl
    ON c.crm_source = 'pedro' AND pl.id = c.crm_lead_id
  LEFT JOIN LATERAL (
    SELECT CASE
      WHEN m.assigned_to ~ '^[0-9a-fA-F-]{36}$' THEN m.assigned_to::uuid
    END AS assigned_member_id
    FROM public.crm_leads m
    WHERE c.crm_source = 'marcos'
      AND m.id = c.crm_lead_id
      AND m.user_id = v_tenant
    LIMIT 1
  ) ml ON true
  WHERE c.user_id = v_tenant
    AND coalesce(c.ai_line, true)
    AND NOT EXISTS (
      SELECT 1 FROM public.wa_instances wi
      WHERE wi.id = c.instance_id AND wi.seller_member_id IS NOT NULL
    )
    AND public.logos_phone_key(c.phone_canonical) <> ALL(v_internos)
    AND (
      NOT v_is_seller OR v_is_manager OR (
        (
          c.crm_source = 'pedro'
          AND EXISTS (
            SELECT 1 FROM public.ai_crm_leads l
            WHERE l.id = c.crm_lead_id
              AND l.user_id = v_tenant
              AND l.assigned_to_id = ANY(v_members)
          )
        )
        OR (
          c.crm_source = 'marcos'
          AND EXISTS (
            SELECT 1 FROM public.crm_leads m
            WHERE m.id = c.crm_lead_id
              AND m.user_id = v_tenant
              AND m.assigned_to = ANY(v_members_txt)
          )
        )
      )
    )
    AND (
      p_before IS NULL
      OR c.last_message_at < p_before
      OR (
        c.last_message_at = p_before
        AND p_before_id IS NOT NULL
        AND c.id < p_before_id
      )
    )
  ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.get_ai_conversations_v2_base(integer, timestamptz, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_conversations_v2_base(integer, timestamptz, uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
