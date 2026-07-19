-- ============================================================================
-- Conversas: passar a LER a conversa da IA do Pedro V3.
-- O V2 saiu de producao (wa_chat_history parou em 17/07); a IA agora roda no V3
-- e grava em v3_inbox (entrada do lead) / v3_effect_outbox (resposta da IA),
-- ligados ao lead por v3_conversation_state.lead_id. A RPC lia so V2 -> nas telas
-- Conversas (sidebar) e Conversas IA (Pedro) so aparecia o vendedor (wa_inbox).
-- Adiciona 2 blocos (v3in/v3out). Mantem TODA a checagem de privacidade existente.
-- ============================================================================
create or replace function public.get_allowed_lead_messages(
  p_phone text default null, p_lead_id uuid default null, p_source text default null,
  p_instance_id uuid default null, p_limit integer default 1000)
returns table(source text, id uuid, direction text, content text, message_type text,
              media_url text, remote_message_id text, instance_id text, metadata jsonb,
              created_at timestamp with time zone)
language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid(); v_role text; v_is_seller boolean := false; v_tenant uuid;
  v_members uuid[] := '{}'; v_members_txt text[] := '{}'; v_internos text[];
  v_phone text; v_key text; v_variants text[]; v_ok boolean := false;
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
    -- Vendedor <-> lead (inalterado)
    SELECT 'inbox'::text AS source, i.id, i.direction, i.content, i.message_type,
           i.media_url, i.remote_message_id, i.instance_id::text AS instance_id,
           NULL::jsonb AS metadata, i.created_at
    FROM public.wa_inbox i
    WHERE i.user_id = v_tenant AND i.phone = ANY(v_variants)
      AND (p_instance_id IS NULL OR i.instance_id = p_instance_id)
    UNION ALL
    -- IA do Pedro V2 (historico ate 17/07 — mantido)
    SELECT 'chat'::text, h.id,
           CASE WHEN h.role = 'assistant' THEN 'outgoing' ELSE 'incoming' END,
           h.content, coalesce(h.metadata->>'message_type','text'),
           NULL::text, NULL::text, NULL::text, h.metadata, h.created_at
    FROM public.wa_chat_history h
    WHERE h.user_id = v_tenant AND split_part(h.remote_jid,'@',1) = ANY(v_variants)
    UNION ALL
    -- NOVO: IA do Pedro V3 — mensagem do LEAD (v3_inbox.raw->>'text')
    SELECT 'v3'::text, md5(vi.event_id)::uuid, 'incoming'::text,
           vi.raw->>'text', 'text'::text,
           NULL::text, NULL::text, NULL::text, NULL::jsonb,
           coalesce(vi.received_at, vi.created_at)
    FROM public.v3_inbox vi
    WHERE coalesce(vi.raw->>'text','') <> ''
      AND vi.conversation_id IN (
        SELECT cs.conversation_id FROM public.v3_conversation_state cs
        JOIN public.ai_crm_leads l ON l.id::text = cs.lead_id
        WHERE l.user_id = v_tenant
          AND public.logos_phone_key(split_part(l.remote_jid,'@',1)) = v_key
      )
    UNION ALL
    -- NOVO: IA do Pedro V3 — resposta da IA (v3_effect_outbox.payload->>'text')
    SELECT 'v3'::text, md5(eo.effect_id)::uuid, 'outgoing'::text,
           eo.payload->>'text',
           CASE WHEN eo.kind = 'send_media' THEN 'image' ELSE 'text' END,
           NULL::text, NULL::text, NULL::text, NULL::jsonb, eo.created_at
    FROM public.v3_effect_outbox eo
    WHERE eo.kind IN ('send_message','send_media')
      AND coalesce(eo.payload->>'text','') <> ''
      AND eo.conversation_id IN (
        SELECT cs.conversation_id FROM public.v3_conversation_state cs
        JOIN public.ai_crm_leads l ON l.id::text = cs.lead_id
        WHERE l.user_id = v_tenant
          AND public.logos_phone_key(split_part(l.remote_jid,'@',1)) = v_key
      )
  ) u
  ORDER BY u.created_at ASC
  LIMIT coalesce(p_limit, 1000);
END $function$;
