-- ============================================================================
-- PRIVACIDADE Conversas — camada server-side lead-only.
-- A Logos só pode exibir conversa com LEAD REAL cadastrado. NUNCA conversa
-- interna (vendedor/gerente/responsavel/instancia), p/ nenhum perfil (incl. master).
--
-- Antes: policies seller_view_master_inbox / seller_view_master_chat_history davam
-- SELECT amplo do inbox do master ao vendedor, e o front buscava por TELEFONE sem
-- vinculo com lead -> conversa pessoal vazava no inbox.
--
-- Este arquivo cria os helpers + 3 RPCs SECURITY DEFINER (estado FINAL aplicado em
-- prod via MCP em 14/07). NAO altera policies (isso e um passo posterior, so apos
-- o front consumir as RPCs e validacao). Registro local = prod (sem db push).
-- ============================================================================

-- ── Chave canonica BR: 55 removido; DDD(2)+ultimos 8 (cobre 9o digito). Fallback last-8.
CREATE OR REPLACE FUNCTION public.logos_phone_key(raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  WITH a AS (SELECT regexp_replace(coalesce(raw,''),'[^0-9]','','g') AS d),
       b AS (SELECT CASE WHEN length(d)>11 AND left(d,2)='55' THEN substr(d,3) ELSE d END AS nat FROM a)
  SELECT CASE
    WHEN length(nat) BETWEEN 10 AND 11 THEN left(nat,2) || right(nat,8)
    WHEN length(nat) >= 8 THEN right(nat,8)
    ELSE nullif(nat,'')
  END FROM b;
$fn$;

-- ── Variacoes plausiveis (com/sem 55, com/sem 9o) p/ casar wa_inbox por indice.
CREATE OR REPLACE FUNCTION public.logos_phone_variants(raw text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $fn$
  WITH k AS (SELECT public.logos_phone_key(raw) AS key)
  SELECT CASE
    WHEN key IS NULL OR length(key) < 10
      THEN array_remove(array[nullif(regexp_replace(coalesce(raw,''),'[^0-9]','','g'),'')], NULL)
    ELSE array[
      left(key,2)||right(key,8),
      left(key,2)||'9'||right(key,8),
      '55'||left(key,2)||right(key,8),
      '55'||left(key,2)||'9'||right(key,8)
    ] END
  FROM k;
$fn$;

-- ── Conjunto de chaves INTERNAS de um tenant (nunca viram conversa de lead).
CREATE OR REPLACE FUNCTION public.logos_internal_keys(p_tenant uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT coalesce(array_agg(DISTINCT k), '{}')
  FROM (
    SELECT public.logos_phone_key(whatsapp_number) k FROM public.ai_team_members  WHERE user_id=p_tenant AND coalesce(whatsapp_number,'')<>''
    UNION ALL
    SELECT public.logos_phone_key(whatsapp)         FROM public.conta_responsaveis WHERE user_id=p_tenant AND coalesce(whatsapp,'')<>''
    UNION ALL
    SELECT public.logos_phone_key(phone_number)     FROM public.wa_instances       WHERE user_id=p_tenant AND coalesce(phone_number,'')<>''
  ) z WHERE k IS NOT NULL;
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- RPC 1: lista de conversas permitidas (AgentInboxTab). Internos excluidos.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_allowed_lead_conversations(
  p_agent_id uuid DEFAULT NULL,
  p_seller_member_ids uuid[] DEFAULT NULL,
  p_include_marcos boolean DEFAULT true,
  p_limit int DEFAULT 500
)
RETURNS TABLE(
  lead_id uuid, source text, phone text, lead_key text, lead_name text,
  status text, ai_paused boolean, instance_id uuid, agent_id uuid, assigned_to_id uuid,
  created_at timestamptz, arrived_at timestamptz, last_interaction_at timestamptz, summary text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_is_seller boolean := false;
  v_tenant uuid;
  v_members uuid[] := '{}';
  v_members_txt text[] := '{}';
  v_filter_txt text[] := NULL;
  v_internos text[];
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF coalesce(v_role,'') = 'seller' THEN
    v_is_seller := true;
    v_tenant := public.get_seller_master_user_id();
    SELECT coalesce(array_agg(id),'{}'), coalesce(array_agg(id::text),'{}')
      INTO v_members, v_members_txt
    FROM public.ai_team_members
    WHERE auth_user_id = v_uid AND coalesce(active_in_system,true) <> false;
  ELSE
    v_tenant := v_uid;
  END IF;
  IF v_tenant IS NULL THEN RETURN; END IF;

  IF p_seller_member_ids IS NOT NULL THEN
    SELECT array_agg(x::text) INTO v_filter_txt FROM unnest(p_seller_member_ids) x;
  END IF;

  v_internos := public.logos_internal_keys(v_tenant);

  RETURN QUERY
  WITH pedro AS (
    SELECT l.id AS lead_id, 'pedro'::text AS source,
      split_part(l.remote_jid,'@',1) AS phone,
      public.logos_phone_key(split_part(l.remote_jid,'@',1)) AS lead_key,
      l.lead_name, l.status, l.ai_paused, l.instance_id, l.agent_id, l.assigned_to_id,
      l.created_at, l.arrived_at, l.last_interaction_at, l.summary
    FROM public.ai_crm_leads l
    WHERE l.user_id = v_tenant
      AND (p_agent_id IS NULL OR l.agent_id = p_agent_id)
      AND (NOT v_is_seller OR l.assigned_to_id = ANY(v_members))
      AND (v_is_seller OR p_seller_member_ids IS NULL OR l.assigned_to_id = ANY(p_seller_member_ids))
  ),
  marcos AS (
    SELECT m.id AS lead_id, 'marcos'::text AS source,
      m.phone AS phone,
      public.logos_phone_key(m.phone) AS lead_key,
      m.name AS lead_name, NULL::text AS status, NULL::boolean AS ai_paused,
      NULL::uuid AS instance_id, NULL::uuid AS agent_id,
      (CASE WHEN m.assigned_to ~ '^[0-9a-fA-F-]{36}$' THEN m.assigned_to::uuid ELSE NULL END) AS assigned_to_id,
      m.created_at, m.arrived_at, m.arrived_at AS last_interaction_at, NULL::text AS summary
    FROM public.crm_leads m
    WHERE p_include_marcos
      AND m.user_id = v_tenant
      AND (NOT v_is_seller OR m.assigned_to = ANY(v_members_txt))
      AND (v_is_seller OR v_filter_txt IS NULL OR m.assigned_to = ANY(v_filter_txt))
  ),
  allp AS (
    SELECT * FROM pedro
    WHERE pedro.lead_key IS NOT NULL AND pedro.lead_key <> ALL(v_internos)
  ),
  allm AS (
    SELECT * FROM marcos
    WHERE marcos.lead_key IS NOT NULL AND marcos.lead_key <> ALL(v_internos)
      AND marcos.lead_key NOT IN (SELECT p.lead_key FROM allp p)
  )
  SELECT u.lead_id, u.source, u.phone, u.lead_key, u.lead_name, u.status, u.ai_paused,
         u.instance_id, u.agent_id, u.assigned_to_id, u.created_at, u.arrived_at,
         u.last_interaction_at, u.summary
  FROM (SELECT * FROM allp UNION ALL SELECT * FROM allm) u
  ORDER BY u.last_interaction_at DESC NULLS LAST, u.created_at DESC NULLS LAST
  LIMIT coalesce(p_limit, 500);
END $fn$;
REVOKE ALL ON FUNCTION public.get_allowed_lead_conversations(uuid,uuid[],boolean,int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_allowed_lead_conversations(uuid,uuid[],boolean,int) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- RPC 2: timeline de UM lead (autorizado; internos negados). p_instance_id opcional.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_allowed_lead_messages(
  p_phone text DEFAULT NULL, p_lead_id uuid DEFAULT NULL, p_source text DEFAULT NULL,
  p_instance_id uuid DEFAULT NULL, p_limit int DEFAULT 1000
)
RETURNS TABLE(
  source text, id uuid, direction text, content text, message_type text,
  media_url text, remote_message_id text, instance_id text, metadata jsonb, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_is_seller boolean := false;
  v_tenant uuid;
  v_members uuid[] := '{}';
  v_members_txt text[] := '{}';
  v_internos text[];
  v_phone text;
  v_key text;
  v_variants text[];
  v_ok boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF coalesce(v_role,'') = 'seller' THEN
    v_is_seller := true;
    v_tenant := public.get_seller_master_user_id();
    SELECT coalesce(array_agg(m.id),'{}'), coalesce(array_agg(m.id::text),'{}')
      INTO v_members, v_members_txt
    FROM public.ai_team_members m
    WHERE m.auth_user_id = v_uid AND coalesce(m.active_in_system,true) <> false;
  ELSE
    v_tenant := v_uid;
  END IF;
  IF v_tenant IS NULL THEN RETURN; END IF;

  IF p_lead_id IS NOT NULL AND p_source = 'pedro' THEN
    SELECT split_part(l.remote_jid,'@',1) INTO v_phone FROM public.ai_crm_leads l WHERE l.id = p_lead_id AND l.user_id = v_tenant;
  ELSIF p_lead_id IS NOT NULL AND p_source = 'marcos' THEN
    SELECT m.phone INTO v_phone FROM public.crm_leads m WHERE m.id = p_lead_id AND m.user_id = v_tenant;
  ELSE
    v_phone := p_phone;
  END IF;

  v_key := public.logos_phone_key(v_phone);
  IF v_key IS NULL THEN RETURN; END IF;

  v_internos := public.logos_internal_keys(v_tenant);
  IF v_key = ANY(v_internos) THEN RETURN; END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.ai_crm_leads l
     WHERE l.user_id = v_tenant
       AND public.logos_phone_key(split_part(l.remote_jid,'@',1)) = v_key
       AND (NOT v_is_seller OR l.assigned_to_id = ANY(v_members))
    UNION ALL
    SELECT 1 FROM public.crm_leads m
     WHERE m.user_id = v_tenant
       AND public.logos_phone_key(m.phone) = v_key
       AND (NOT v_is_seller OR m.assigned_to = ANY(v_members_txt))
  ) INTO v_ok;
  IF NOT v_ok THEN RETURN; END IF;

  v_variants := public.logos_phone_variants(v_phone);

  RETURN QUERY
  SELECT u.source, u.id, u.direction, u.content, u.message_type, u.media_url,
         u.remote_message_id, u.instance_id, u.metadata, u.created_at
  FROM (
    SELECT 'inbox'::text AS source, i.id, i.direction, i.content, i.message_type,
           i.media_url, i.remote_message_id, i.instance_id::text AS instance_id,
           NULL::jsonb AS metadata, i.created_at
    FROM public.wa_inbox i
    WHERE i.user_id = v_tenant AND i.phone = ANY(v_variants)
      AND (p_instance_id IS NULL OR i.instance_id = p_instance_id)
    UNION ALL
    SELECT 'chat'::text, h.id,
           CASE WHEN h.role = 'assistant' THEN 'outgoing' ELSE 'incoming' END,
           h.content, coalesce(h.metadata->>'message_type','text'),
           NULL::text, NULL::text, NULL::text, h.metadata, h.created_at
    FROM public.wa_chat_history h
    WHERE h.user_id = v_tenant AND split_part(h.remote_jid,'@',1) = ANY(v_variants)
  ) u
  ORDER BY u.created_at ASC
  LIMIT coalesce(p_limit, 1000);
END $fn$;
REVOKE ALL ON FUNCTION public.get_allowed_lead_messages(text,uuid,text,uuid,int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_allowed_lead_messages(text,uuid,text,uuid,int) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- RPC 3: listagem lead-only p/ WhatsAppInbox (preview + nao-lidas por chave).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_allowed_lead_inbox(p_limit int DEFAULT 500)
RETURNS TABLE(
  lead_id uuid, source text, phone text, lead_name text, instance_id text,
  last_message text, last_message_type text, last_media_url text, ai_category text,
  unread_count int, last_message_at timestamptz, lead_arrived_at timestamptz, lead_created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_is_seller boolean := false;
  v_tenant uuid;
  v_members uuid[] := '{}';
  v_members_txt text[] := '{}';
  v_internos text[];
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF coalesce(v_role,'') = 'seller' THEN
    v_is_seller := true;
    v_tenant := public.get_seller_master_user_id();
    SELECT coalesce(array_agg(id),'{}'), coalesce(array_agg(id::text),'{}')
      INTO v_members, v_members_txt
    FROM public.ai_team_members
    WHERE auth_user_id = v_uid AND coalesce(active_in_system,true) <> false;
  ELSE
    v_tenant := v_uid;
  END IF;
  IF v_tenant IS NULL THEN RETURN; END IF;

  v_internos := public.logos_internal_keys(v_tenant);

  RETURN QUERY
  WITH leads AS (
    SELECT l.id AS lead_id, 'pedro'::text AS source, split_part(l.remote_jid,'@',1) AS phone,
      public.logos_phone_key(split_part(l.remote_jid,'@',1)) AS lead_key,
      l.lead_name, l.instance_id::text AS instance_id, l.arrived_at, l.created_at, l.last_interaction_at
    FROM public.ai_crm_leads l
    WHERE l.user_id = v_tenant AND (NOT v_is_seller OR l.assigned_to_id = ANY(v_members))
    UNION ALL
    SELECT m.id, 'marcos', m.phone, public.logos_phone_key(m.phone),
      m.name, NULL::text, m.arrived_at, m.created_at, m.arrived_at
    FROM public.crm_leads m
    WHERE m.user_id = v_tenant AND (NOT v_is_seller OR m.assigned_to = ANY(v_members_txt))
  ),
  leads_ok AS (
    SELECT DISTINCT ON (lead_key) lead_id, source, phone, lead_key, lead_name, instance_id,
      arrived_at, created_at, last_interaction_at
    FROM leads
    WHERE lead_key IS NOT NULL AND lead_key <> ALL(v_internos)
    ORDER BY lead_key, (source='pedro') DESC, last_interaction_at DESC NULLS LAST
  ),
  inbox_last AS (
    SELECT DISTINCT ON (public.logos_phone_key(phone)) public.logos_phone_key(phone) AS k,
      content AS last_message, message_type AS last_type, media_url AS last_media,
      ai_category, instance_id::text AS last_instance, created_at AS last_at
    FROM public.wa_inbox
    WHERE user_id = v_tenant AND coalesce(is_archived,false) = false
    ORDER BY public.logos_phone_key(phone), created_at DESC
  ),
  inbox_unread AS (
    SELECT public.logos_phone_key(phone) AS k, count(*)::int AS unread
    FROM public.wa_inbox
    WHERE user_id = v_tenant AND direction = 'incoming'
      AND coalesce(is_read,false) = false AND coalesce(is_archived,false) = false
    GROUP BY public.logos_phone_key(phone)
  )
  SELECT lo.lead_id, lo.source, lo.phone, lo.lead_name,
         coalesce(lo.instance_id, il.last_instance) AS instance_id,
         il.last_message, il.last_type, il.last_media, il.ai_category,
         coalesce(iu.unread, 0) AS unread_count,
         coalesce(il.last_at, lo.last_interaction_at, lo.arrived_at, lo.created_at) AS last_message_at,
         lo.arrived_at AS lead_arrived_at, lo.created_at AS lead_created_at
  FROM leads_ok lo
  LEFT JOIN inbox_last il ON il.k = lo.lead_key
  LEFT JOIN inbox_unread iu ON iu.k = lo.lead_key
  ORDER BY coalesce(il.last_at, lo.last_interaction_at, lo.arrived_at, lo.created_at) DESC NULLS LAST
  LIMIT coalesce(p_limit, 500);
END $fn$;
REVOKE ALL ON FUNCTION public.get_allowed_lead_inbox(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_allowed_lead_inbox(int) TO authenticated;
