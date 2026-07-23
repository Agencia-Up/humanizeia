-- =============================================================================
-- CONVERSAS 100% NATIVAS PEDRO V3 — camada canônica de leitura (23/07/2026)
--
-- PROBLEMA: o Pedro v3 grava em v3_inbox / v3_effect_outbox / v3_conversation_state,
-- mas as RPCs de conversa liam quase só wa_inbox / wa_chat_history. Resultado:
-- 35 conversas v3 "puras" (sem nenhuma linha nas fontes antigas) SUMIAM do
-- WhatsApp>Conversas (o preview era INNER JOIN só nas fontes antigas), a timeline
-- v3 não distinguia IA de vendedor e mostrava efeitos nunca despachados.
--
-- ESTRATÉGIA (menor risco): atualizar as 3 RPCs IN-PLACE mantendo assinatura de
-- argumentos e a ORDEM das colunas existentes, APENDANDO colunas novas no fim.
-- O front deployado ignora campos extras -> passa a enxergar v3 na hora, sem
-- Rebuild. O front novo consome actor/preview/has_v3_activity.
--
-- SEGURANÇA (inalterada e reforçada):
--   * SECURITY DEFINER + validação manual: auth.uid() -> profiles.role;
--     seller -> tenant = get_seller_master_user_id() + membros por auth_user_id;
--     master -> tenant = auth.uid(). Fail-closed (uid/tenant nulos => vazio).
--   * Internos excluídos via logos_internal_keys(tenant).
--   * Conversa sem lead no CRM não aparece (tudo parte de ai_crm_leads/crm_leads).
--   * v3: NUNCA expõe raw/payload inteiros — extrai SÓ raw->>'text',
--     mediaContext->>'kind'/'text'/'summary' e payload->>'text'. O campo
--     'sensitive' jamais é lido. Tudo tenant-scoped (vi.tenant_id/eo.tenant_id).
--   * Outbound v3 só entra com dispatched_at NOT NULL e status fora de
--     failed/skipped (mesmo critério do ingestor do feedback: diálogo real).
-- =============================================================================

-- ── 1. Índices v3 para leitura por conversa/lead (tabelas pequenas hoje) ─────
CREATE INDEX IF NOT EXISTS v3_conversation_state_tenant_lead_idx
  ON public.v3_conversation_state (tenant_id, lead_id)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS v3_inbox_conversation_all_idx
  ON public.v3_inbox (conversation_id, received_at DESC);

CREATE INDEX IF NOT EXISTS v3_outbox_conversation_created_idx
  ON public.v3_effect_outbox (conversation_id, created_at DESC)
  WHERE kind IN ('send_message','send_media');

-- ── 2. Realtime: tabelas v3 entram na publication como SINAL ─────────────────
-- (o front NUNCA usa o payload do evento; só re-chama a RPC segura. RLS continua
-- valendo no realtime: só o master do tenant recebe eventos v3.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND tablename='v3_inbox') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.v3_inbox;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND tablename='v3_effect_outbox') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.v3_effect_outbox;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND tablename='v3_conversation_state') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.v3_conversation_state;
  END IF;
END $$;

-- ── 3. TIMELINE: get_allowed_lead_messages (+actor, mídia v3, gate dispatched) ─
DROP FUNCTION IF EXISTS public.get_allowed_lead_messages(text, uuid, text, uuid, integer);

CREATE FUNCTION public.get_allowed_lead_messages(
  p_phone text DEFAULT NULL,
  p_lead_id uuid DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_instance_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 1000
)
RETURNS TABLE(
  source text, id uuid, direction text, content text, message_type text,
  media_url text, remote_message_id text, instance_id text, metadata jsonb,
  created_at timestamptz,
  actor text                                   -- NOVO: 'cliente' | 'ia' | 'vendedor'
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid(); v_role text; v_is_seller boolean := false; v_tenant uuid;
  v_members uuid[] := '{}'; v_members_txt text[] := '{}'; v_internos text[];
  v_phone text; v_key text; v_variants text[]; v_ok boolean := false;
  v_ia_instances uuid[] := '{}';
  v_conv_ids text[] := '{}';
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

  -- Permissão: precisa existir lead permitido (vendedor: atribuído a ele).
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

  -- Instâncias da IA (seller_member_id NULL) — separa 'ia' de 'vendedor' no wa_inbox.
  SELECT coalesce(array_agg(w.id),'{}') INTO v_ia_instances
  FROM public.wa_instances w
  WHERE w.user_id = v_tenant AND w.seller_member_id IS NULL;

  -- Conversas v3 deste lead (tenant-scoped; lead_id do v3 é o uuid do ai_crm_leads em texto).
  SELECT coalesce(array_agg(cs.conversation_id),'{}') INTO v_conv_ids
  FROM public.v3_conversation_state cs
  WHERE cs.tenant_id = v_tenant
    AND cs.lead_id IN (
      SELECT l.id::text FROM public.ai_crm_leads l
      WHERE l.user_id = v_tenant
        AND public.logos_phone_key(split_part(l.remote_jid,'@',1)) = v_key
    );

  RETURN QUERY
  SELECT u.source, u.id, u.direction, u.content, u.message_type, u.media_url,
         u.remote_message_id, u.instance_id, u.metadata, u.created_at, u.actor
  FROM (
    -- Vendedor/humano <-> lead (wa_inbox). outgoing de instância da IA = 'ia'.
    SELECT 'inbox'::text AS source, i.id, i.direction, i.content, i.message_type,
           i.media_url, i.remote_message_id, i.instance_id::text AS instance_id,
           NULL::jsonb AS metadata, i.created_at,
           CASE WHEN i.direction = 'incoming' THEN 'cliente'
                WHEN i.instance_id = ANY(v_ia_instances) THEN 'ia'
                ELSE 'vendedor' END AS actor
    FROM public.wa_inbox i
    WHERE i.user_id = v_tenant AND i.phone = ANY(v_variants)
      AND (p_instance_id IS NULL OR i.instance_id = p_instance_id)
    UNION ALL
    -- IA do Pedro V2 (histórico wa_chat_history — mantido).
    SELECT 'chat'::text, h.id,
           CASE WHEN h.role = 'assistant' THEN 'outgoing' ELSE 'incoming' END,
           h.content, coalesce(h.metadata->>'message_type','text'),
           NULL::text, NULL::text, NULL::text, h.metadata, h.created_at,
           CASE WHEN h.role = 'assistant' THEN 'ia' ELSE 'cliente' END
    FROM public.wa_chat_history h
    WHERE h.user_id = v_tenant AND split_part(h.remote_jid,'@',1) = ANY(v_variants)
    UNION ALL
    -- Pedro V3 — mensagem do LEAD (texto e mídia com transcrição/resumo do mediaContext).
    -- NUNCA devolve raw inteiro; 'sensitive' jamais é lido.
    SELECT 'v3'::text, md5(vi.event_id)::uuid, 'incoming'::text,
           coalesce(
             nullif(vi.raw->>'text',''),
             nullif(vi.raw #>> '{mediaContext,text}',''),
             nullif(vi.raw #>> '{mediaContext,summary}',''),
             '[mídia recebida]'
           ),
           CASE WHEN vi.raw ? 'mediaContext'
                THEN coalesce(nullif(vi.raw #>> '{mediaContext,kind}',''),'text')
                ELSE 'text' END,
           NULL::text, NULL::text, NULL::text, NULL::jsonb,
           coalesce(vi.received_at, vi.created_at),
           'cliente'::text
    FROM public.v3_inbox vi
    WHERE vi.tenant_id = v_tenant
      AND vi.conversation_id = ANY(v_conv_ids)
      AND (coalesce(vi.raw->>'text','') <> '' OR vi.raw ? 'mediaContext')
    UNION ALL
    -- Pedro V3 — resposta da IA. SÓ efeitos despachados e não falhos/pulados
    -- (dispatched_at é carimbado no claim; failed/skipped nunca chegaram ao lead).
    SELECT 'v3'::text, md5(eo.effect_id)::uuid, 'outgoing'::text,
           CASE WHEN eo.kind = 'send_media'
                THEN coalesce(nullif(eo.payload->>'text',''), '📷 Fotos do veículo enviadas')
                ELSE eo.payload->>'text' END,
           CASE WHEN eo.kind = 'send_media' THEN 'image' ELSE 'text' END,
           NULL::text, NULL::text, NULL::text, NULL::jsonb, eo.created_at,
           'ia'::text
    FROM public.v3_effect_outbox eo
    WHERE eo.tenant_id = v_tenant
      AND eo.conversation_id = ANY(v_conv_ids)
      AND eo.kind IN ('send_message','send_media')
      AND eo.dispatched_at IS NOT NULL
      AND eo.status NOT IN ('failed','skipped')
      AND (eo.kind = 'send_media' OR coalesce(eo.payload->>'text','') <> '')
  ) u
  ORDER BY u.created_at ASC
  LIMIT coalesce(p_limit, 1000);
END $function$;

REVOKE ALL ON FUNCTION public.get_allowed_lead_messages(text, uuid, text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_allowed_lead_messages(text, uuid, text, uuid, integer) TO authenticated, service_role;

-- ── 4. LISTA: get_allowed_lead_conversations (+preview/unread/has_v3_activity) ─
DROP FUNCTION IF EXISTS public.get_allowed_lead_conversations(uuid, uuid[], boolean, integer);

CREATE FUNCTION public.get_allowed_lead_conversations(
  p_agent_id uuid DEFAULT NULL,
  p_seller_member_ids uuid[] DEFAULT NULL,
  p_include_marcos boolean DEFAULT true,
  p_limit integer DEFAULT 500
)
RETURNS TABLE(
  lead_id uuid, source text, phone text, lead_key text, lead_name text,
  status text, ai_paused boolean, instance_id uuid, agent_id uuid,
  assigned_to_id uuid, created_at timestamptz, arrived_at timestamptz,
  last_interaction_at timestamptz, summary text,
  last_message text,                            -- NOVO (preview, inclui v3)
  last_message_type text,                       -- NOVO
  last_message_at timestamptz,                  -- NOVO
  unread_count integer,                         -- NOVO (wa_inbox; v3 não tem leitura)
  has_v3_activity boolean                       -- NOVO
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    SELECT m.id AS lead_id, 'marcos'::text AS source, m.phone AS phone,
      public.logos_phone_key(m.phone) AS lead_key, m.name AS lead_name,
      NULL::text AS status, NULL::boolean AS ai_paused,
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
    SELECT * FROM pedro p
    WHERE p.lead_key IS NOT NULL
      AND p.lead_key <> ALL(v_internos)
      AND (
        EXISTS (SELECT 1 FROM public.wa_inbox i
                 WHERE i.user_id = v_tenant
                   AND public.logos_phone_key(i.phone) = p.lead_key
                   AND coalesce(i.is_archived,false) = false)
        OR EXISTS (SELECT 1 FROM public.wa_chat_history h
                 WHERE h.user_id = v_tenant
                   AND public.logos_phone_key(split_part(h.remote_jid,'@',1)) = p.lead_key)
        -- Pedro V3 — conversa que mora só no V3 (agora tenant-scoped).
        OR EXISTS (SELECT 1 FROM public.v3_conversation_state cs
                 WHERE cs.tenant_id = v_tenant
                   AND cs.lead_id = p.lead_id::text)
      )
  ),
  allm AS (
    SELECT * FROM marcos m
    WHERE m.lead_key IS NOT NULL
      AND m.lead_key <> ALL(v_internos)
      AND m.lead_key NOT IN (SELECT p.lead_key FROM allp p)
      AND (
        EXISTS (SELECT 1 FROM public.wa_inbox i
                 WHERE i.user_id = v_tenant
                   AND public.logos_phone_key(i.phone) = m.lead_key
                   AND coalesce(i.is_archived,false) = false)
        OR EXISTS (SELECT 1 FROM public.wa_chat_history h
                 WHERE h.user_id = v_tenant
                   AND public.logos_phone_key(split_part(h.remote_jid,'@',1)) = m.lead_key)
      )
  )
  SELECT u.lead_id, u.source, u.phone, u.lead_key, u.lead_name, u.status, u.ai_paused,
         u.instance_id, u.agent_id, u.assigned_to_id, u.created_at, u.arrived_at,
         u.last_interaction_at, u.summary,
         lm.content    AS last_message,
         lm.mtype      AS last_message_type,
         lm.at         AS last_message_at,
         coalesce(un.n, 0) AS unread_count,
         (u.source = 'pedro' AND EXISTS (
            SELECT 1 FROM public.v3_conversation_state cs
            WHERE cs.tenant_id = v_tenant AND cs.lead_id = u.lead_id::text
         )) AS has_v3_activity
  FROM (SELECT * FROM allp UNION ALL SELECT * FROM allm) u
  LEFT JOIN LATERAL (
    SELECT z.content, z.mtype, z.at
    FROM (
      (SELECT i.content, i.message_type AS mtype, i.created_at AS at
       FROM public.wa_inbox i
       WHERE i.user_id = v_tenant AND coalesce(i.is_archived,false) = false
         AND public.logos_phone_key(i.phone) = u.lead_key
       ORDER BY i.created_at DESC LIMIT 1)
      UNION ALL
      (SELECT h.content, coalesce(h.metadata->>'message_type','text'), h.created_at
       FROM public.wa_chat_history h
       WHERE h.user_id = v_tenant
         AND public.logos_phone_key(split_part(h.remote_jid,'@',1)) = u.lead_key
       ORDER BY h.created_at DESC LIMIT 1)
      UNION ALL
      (SELECT coalesce(nullif(vi.raw->>'text',''),
                       nullif(vi.raw #>> '{mediaContext,text}',''),
                       '[mídia recebida]'),
              CASE WHEN vi.raw ? 'mediaContext'
                   THEN coalesce(nullif(vi.raw #>> '{mediaContext,kind}',''),'text')
                   ELSE 'text' END,
              coalesce(vi.received_at, vi.created_at)
       FROM public.v3_inbox vi
       WHERE u.source = 'pedro'
         AND vi.tenant_id = v_tenant
         AND vi.conversation_id IN (
           SELECT cs.conversation_id FROM public.v3_conversation_state cs
           WHERE cs.tenant_id = v_tenant AND cs.lead_id = u.lead_id::text)
         AND (coalesce(vi.raw->>'text','') <> '' OR vi.raw ? 'mediaContext')
       ORDER BY coalesce(vi.received_at, vi.created_at) DESC LIMIT 1)
      UNION ALL
      (SELECT CASE WHEN eo.kind = 'send_media'
                   THEN coalesce(nullif(eo.payload->>'text',''), '📷 Fotos do veículo enviadas')
                   ELSE eo.payload->>'text' END,
              CASE WHEN eo.kind = 'send_media' THEN 'image' ELSE 'text' END,
              eo.created_at
       FROM public.v3_effect_outbox eo
       WHERE u.source = 'pedro'
         AND eo.tenant_id = v_tenant
         AND eo.conversation_id IN (
           SELECT cs.conversation_id FROM public.v3_conversation_state cs
           WHERE cs.tenant_id = v_tenant AND cs.lead_id = u.lead_id::text)
         AND eo.kind IN ('send_message','send_media')
         AND eo.dispatched_at IS NOT NULL
         AND eo.status NOT IN ('failed','skipped')
         AND (eo.kind = 'send_media' OR coalesce(eo.payload->>'text','') <> '')
       ORDER BY eo.created_at DESC LIMIT 1)
    ) z
    ORDER BY z.at DESC
    LIMIT 1
  ) lm ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS n
    FROM public.wa_inbox w
    WHERE w.user_id = v_tenant AND w.direction = 'incoming'
      AND coalesce(w.is_read,false) = false AND coalesce(w.is_archived,false) = false
      AND public.logos_phone_key(w.phone) = u.lead_key
  ) un ON true
  ORDER BY u.last_interaction_at DESC NULLS LAST, u.lead_id
  LIMIT coalesce(p_limit, 500);
END $function$;

REVOKE ALL ON FUNCTION public.get_allowed_lead_conversations(uuid, uuid[], boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_allowed_lead_conversations(uuid, uuid[], boolean, integer) TO authenticated, service_role;

-- ── 5. INBOX/PREVIEW: get_allowed_lead_inbox (preview enxerga v3 => conversa
--       v3 pura volta a aparecer). Colunas e assinatura INALTERADAS. ──────────
DROP FUNCTION IF EXISTS public.get_allowed_lead_inbox(integer);

CREATE FUNCTION public.get_allowed_lead_inbox(p_limit integer DEFAULT 500)
RETURNS TABLE(
  lead_id uuid, source text, phone text, lead_name text, instance_id text,
  last_message text, last_message_type text, last_media_url text,
  ai_category text, unread_count integer, last_message_at timestamptz,
  lead_arrived_at timestamptz, lead_created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    WHERE lead_key IS NOT NULL
      AND lead_key <> ALL(v_internos)
    ORDER BY lead_key, (source='pedro') DESC, last_interaction_at DESC NULLS LAST, lead_id
  )
  SELECT lo.lead_id, lo.source, lo.phone, lo.lead_name,
         coalesce(lo.instance_id, lm.inst) AS instance_id,
         lm.content, lm.mtype, lm.media, lm.ai_cat,
         coalesce(un.n, 0) AS unread_count,
         lm.created_at AS last_message_at,
         lo.arrived_at AS lead_arrived_at, lo.created_at AS lead_created_at
  FROM leads_ok lo
  JOIN LATERAL (
    SELECT z.content, z.mtype, z.media, z.ai_cat, z.inst, z.created_at
    FROM (
      (SELECT i.content, i.message_type AS mtype, i.media_url AS media,
              i.ai_category AS ai_cat, i.instance_id::text AS inst, i.created_at
       FROM public.wa_inbox i
       WHERE i.user_id = v_tenant AND coalesce(i.is_archived,false) = false
         AND public.logos_phone_key(i.phone) = lo.lead_key
       ORDER BY i.created_at DESC LIMIT 1)
      UNION ALL
      (SELECT h.content, coalesce(h.metadata->>'message_type','text'),
              NULL::text, NULL::text, h.instance_id::text, h.created_at
       FROM public.wa_chat_history h
       WHERE h.user_id = v_tenant
         AND public.logos_phone_key(split_part(h.remote_jid,'@',1)) = lo.lead_key
       ORDER BY h.created_at DESC LIMIT 1)
      UNION ALL
      -- Pedro V3 — última mensagem do LEAD (só campos seguros do raw).
      (SELECT coalesce(nullif(vi.raw->>'text',''),
                       nullif(vi.raw #>> '{mediaContext,text}',''),
                       '[mídia recebida]'),
              CASE WHEN vi.raw ? 'mediaContext'
                   THEN coalesce(nullif(vi.raw #>> '{mediaContext,kind}',''),'text')
                   ELSE 'text' END,
              NULL::text, NULL::text, NULL::text,
              coalesce(vi.received_at, vi.created_at)
       FROM public.v3_inbox vi
       WHERE lo.source = 'pedro'
         AND vi.tenant_id = v_tenant
         AND vi.conversation_id IN (
           SELECT cs.conversation_id FROM public.v3_conversation_state cs
           WHERE cs.tenant_id = v_tenant AND cs.lead_id = lo.lead_id::text)
         AND (coalesce(vi.raw->>'text','') <> '' OR vi.raw ? 'mediaContext')
       ORDER BY coalesce(vi.received_at, vi.created_at) DESC LIMIT 1)
      UNION ALL
      -- Pedro V3 — última resposta da IA efetivamente despachada.
      (SELECT CASE WHEN eo.kind = 'send_media'
                   THEN coalesce(nullif(eo.payload->>'text',''), '📷 Fotos do veículo enviadas')
                   ELSE eo.payload->>'text' END,
              CASE WHEN eo.kind = 'send_media' THEN 'image' ELSE 'text' END,
              NULL::text, NULL::text, NULL::text, eo.created_at
       FROM public.v3_effect_outbox eo
       WHERE lo.source = 'pedro'
         AND eo.tenant_id = v_tenant
         AND eo.conversation_id IN (
           SELECT cs.conversation_id FROM public.v3_conversation_state cs
           WHERE cs.tenant_id = v_tenant AND cs.lead_id = lo.lead_id::text)
         AND eo.kind IN ('send_message','send_media')
         AND eo.dispatched_at IS NOT NULL
         AND eo.status NOT IN ('failed','skipped')
         AND (eo.kind = 'send_media' OR coalesce(eo.payload->>'text','') <> '')
       ORDER BY eo.created_at DESC LIMIT 1)
    ) z
    ORDER BY z.created_at DESC
    LIMIT 1
  ) lm ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS n
    FROM public.wa_inbox w
    WHERE w.user_id = v_tenant AND w.direction = 'incoming'
      AND coalesce(w.is_read,false) = false AND coalesce(w.is_archived,false) = false
      AND public.logos_phone_key(w.phone) = lo.lead_key
  ) un ON true
  ORDER BY lm.created_at DESC NULLS LAST, lo.lead_id
  LIMIT coalesce(p_limit, 500);
END $function$;

REVOKE ALL ON FUNCTION public.get_allowed_lead_inbox(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_allowed_lead_inbox(integer) TO authenticated, service_role;

-- ── 6. PostgREST: recarrega o schema cache na hora ───────────────────────────
NOTIFY pgrst, 'reload schema';
