-- =============================================================================
-- FASE 4 — RPCs canônicas de "Conversas IA" (28/07/2026)
--
-- Lista pela PROJEÇÃO (ai_conversation_index — existe sem CRM) e timeline
-- consolidada por IDENTIDADE (instância+telefone), com dedupe determinístico
-- entre wa_inbox e V3. RPCs NOVAS (v2): as atuais ficam intactas até o front
-- migrar (F5) — zero quebra.
--
-- SEGURANÇA: SECURITY DEFINER + search_path fixo; auth.uid() obrigatório;
-- tenant SEMPRE resolvido pelo vínculo real (nunca vindo do cliente);
-- master/gerente veem a conta, vendedor só conversas de leads atribuídos;
-- internos excluídos; arquivadas/incertas fora; grupos/broadcast nunca entram
-- (a projeção só indexa privado plausível).
-- =============================================================================

-- Rota V3 por telefone canônico (órfãs sem lead entram na timeline por aqui).
CREATE INDEX IF NOT EXISTS v3_routing_tenant_phone_canonical_idx
  ON public.v3_conversation_routing (tenant_id, public.logos_phone_canonical(to_addr));

-- ── LISTA ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_ai_conversations_v2(integer, timestamptz, uuid);
CREATE FUNCTION public.get_ai_conversations_v2(
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS TABLE(
  conversation_id uuid, instance_id uuid, agent_id uuid,
  phone text, phone_raw text, contact_name text, profile_picture_url text,
  last_message text, last_message_type text, last_message_direction text,
  last_message_at timestamptz, message_count integer,
  crm_lead_id uuid, crm_source text, crm_match_status text,
  sem_vinculo_crm boolean, agente_inativo boolean, ia_pausada boolean,
  atendimento_manual boolean, first_seen_at timestamptz,
  assigned_to_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid(); v_role text; v_is_seller boolean := false;
  v_is_manager boolean := false; v_tenant uuid;
  v_members uuid[] := '{}'; v_members_txt text[] := '{}'; v_internos text[];
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
    SELECT coalesce(bool_or(coalesce(m2.is_manager,false)),false) INTO v_is_manager
    FROM public.ai_team_members m2
    WHERE m2.auth_user_id = v_uid AND coalesce(m2.active_in_system,true) <> false
      AND m2.removed_at IS NULL;
  ELSE
    v_tenant := v_uid;
  END IF;
  IF v_tenant IS NULL THEN RETURN; END IF;

  v_internos := public.logos_internal_keys(v_tenant);

  RETURN QUERY
  SELECT c.id, c.instance_id, c.agent_id,
         c.phone_canonical, c.phone_raw, c.contact_name, c.profile_picture_url,
         c.last_message, c.last_message_type, c.last_message_direction,
         c.last_message_at, c.message_count,
         c.crm_lead_id, c.crm_source, c.crm_match_status,
         (c.crm_lead_id IS NULL) AS sem_vinculo_crm,
         (c.instance_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.wa_ai_agents a
            WHERE a.user_id = v_tenant AND a.instance_id = c.instance_id AND a.is_active
         )) AS agente_inativo,
         coalesce(pl.ai_paused, false) AS ia_pausada,
         (coalesce(pl.ai_paused, false) OR (c.instance_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.wa_ai_agents a
            WHERE a.user_id = v_tenant AND a.instance_id = c.instance_id AND a.is_active
         ))) AS atendimento_manual,
         c.first_seen_at
  FROM public.ai_conversation_index c
  LEFT JOIN public.ai_crm_leads pl
    ON c.crm_source = 'pedro' AND pl.id = c.crm_lead_id
  WHERE c.user_id = v_tenant
    AND public.logos_phone_key(c.phone_canonical) <> ALL(v_internos)
    -- vendedor comum: SÓ conversas de leads atribuídos a ele (órfã é do gestor)
    AND (NOT v_is_seller OR v_is_manager OR (
          (c.crm_source = 'pedro' AND EXISTS (
             SELECT 1 FROM public.ai_crm_leads l
             WHERE l.id = c.crm_lead_id AND l.user_id = v_tenant
               AND l.assigned_to_id = ANY(v_members)))
          OR
          (c.crm_source = 'marcos' AND EXISTS (
             SELECT 1 FROM public.crm_leads m
             WHERE m.id = c.crm_lead_id AND m.user_id = v_tenant
               AND m.assigned_to = ANY(v_members_txt)))
        ))
    -- cursor estável (last_message_at, id) DESC
    AND (p_before IS NULL
         OR c.last_message_at < p_before
         OR (c.last_message_at = p_before AND p_before_id IS NOT NULL AND c.id < p_before_id))
  ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
  LIMIT least(greatest(coalesce(p_limit,50),1), 200);
END $function$;

REVOKE ALL ON FUNCTION public.get_ai_conversations_v2(integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_conversations_v2(integer, timestamptz, uuid) TO authenticated, service_role;

-- ── TIMELINE consolidada por identidade ──────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_ai_conversation_messages_v2(uuid, text, integer, timestamptz);
CREATE FUNCTION public.get_ai_conversation_messages_v2(
  p_instance_id uuid DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_before timestamptz DEFAULT NULL
)
RETURNS TABLE(
  source text, id uuid, direction text, actor text, content text,
  message_type text, media_url text, remote_message_id text,
  metadata jsonb, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid(); v_role text; v_is_seller boolean := false;
  v_is_manager boolean := false; v_tenant uuid;
  v_members uuid[] := '{}'; v_members_txt text[] := '{}'; v_internos text[];
  v_canon text; v_variants text[]; v_ok boolean := false;
  v_ia_instances uuid[] := '{}'; v_conv_ids text[] := '{}';
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
    SELECT coalesce(bool_or(coalesce(m2.is_manager,false)),false) INTO v_is_manager
    FROM public.ai_team_members m2
    WHERE m2.auth_user_id = v_uid AND coalesce(m2.active_in_system,true) <> false
      AND m2.removed_at IS NULL;
  ELSE
    v_tenant := v_uid;
  END IF;
  IF v_tenant IS NULL THEN RETURN; END IF;

  v_canon := public.logos_phone_canonical(p_phone);
  IF NOT public.logos_phone_plausible(v_canon) THEN RETURN; END IF;

  v_internos := public.logos_internal_keys(v_tenant);
  IF public.logos_phone_key(v_canon) = ANY(v_internos) THEN RETURN; END IF;

  -- vendedor comum: precisa de lead ATRIBUÍDO com este telefone (fail closed).
  -- Master e gerente-membro: conta inteira (inclusive órfã sem CRM).
  IF v_is_seller AND NOT v_is_manager THEN
    SELECT EXISTS(
      SELECT 1 FROM public.ai_crm_leads l
       WHERE l.user_id = v_tenant
         AND public.logos_phone_key(split_part(l.remote_jid,'@',1)) = public.logos_phone_key(v_canon)
         AND l.assigned_to_id = ANY(v_members)
      UNION ALL
      SELECT 1 FROM public.crm_leads m
       WHERE m.user_id = v_tenant
         AND public.logos_phone_key(m.phone) = public.logos_phone_key(v_canon)
         AND m.assigned_to = ANY(v_members_txt)
    ) INTO v_ok;
    IF NOT v_ok THEN RETURN; END IF;
  END IF;

  v_variants := public.logos_phone_variants(v_canon);

  SELECT coalesce(array_agg(w.id),'{}') INTO v_ia_instances
  FROM public.wa_instances w
  WHERE w.user_id = v_tenant AND w.seller_member_id IS NULL;

  -- Conversas V3 por TELEFONE (routing.to_addr = cliente, validado 213/213):
  -- cobre conversa COM lead e ÓRFÃ igualmente.
  SELECT coalesce(array_agg(r.conversation_id),'{}') INTO v_conv_ids
  FROM public.v3_conversation_routing r
  WHERE r.tenant_id = v_tenant
    AND public.logos_phone_canonical(r.to_addr) = v_canon;

  RETURN QUERY
  SELECT u.source, u.id, u.direction, u.actor, u.content, u.message_type,
         u.media_url, u.remote_message_id, u.metadata, u.created_at
  FROM (
    -- wa_inbox: humano + F2 (arquivadas/incertas FORA — spec item 10)
    SELECT 'inbox'::text AS source, i.id, i.direction,
           CASE WHEN i.direction = 'incoming' THEN 'cliente'
                WHEN i.instance_id = ANY(v_ia_instances) THEN 'ia'
                ELSE 'vendedor' END AS actor,
           i.content, i.message_type, i.media_url,
           i.remote_message_id, NULL::jsonb AS metadata, i.created_at
    FROM public.wa_inbox i
    WHERE i.user_id = v_tenant AND i.phone = ANY(v_variants)
      AND coalesce(i.is_archived, false) = false
      AND (p_instance_id IS NULL OR i.instance_id = p_instance_id)
    UNION ALL
    -- histórico Pedro V2
    SELECT 'chat'::text, h.id,
           CASE WHEN h.role = 'assistant' THEN 'outgoing' ELSE 'incoming' END,
           CASE WHEN h.role = 'assistant' THEN 'ia' ELSE 'cliente' END,
           h.content, coalesce(h.metadata->>'message_type','text'),
           NULL::text, NULL::text, h.metadata, h.created_at
    FROM public.wa_chat_history h
    WHERE h.user_id = v_tenant AND split_part(h.remote_jid,'@',1) = ANY(v_variants)
    UNION ALL
    -- V3 inbound — DEDUPE DETERMINÍSTICO contra wa_inbox (pós-deploy da F2 o
    -- mesmo inbound existe nas DUAS fontes): cai fora quando há linha wa_inbox
    -- incoming não-arquivada com o MESMO texto em janela de 120s.
    SELECT 'v3'::text, md5(vi.event_id)::uuid, 'incoming'::text, 'cliente'::text,
           coalesce(nullif(vi.raw->>'text',''),
                    nullif(vi.raw #>> '{mediaContext,text}',''),
                    nullif(vi.raw #>> '{mediaContext,summary}',''),
                    '[mídia recebida]'),
           CASE WHEN vi.raw ? 'mediaContext'
                THEN coalesce(nullif(vi.raw #>> '{mediaContext,kind}',''),'text')
                ELSE 'text' END,
           NULL::text, NULL::text, NULL::jsonb, coalesce(vi.received_at, vi.created_at)
    FROM public.v3_inbox vi
    WHERE vi.tenant_id = v_tenant
      AND vi.conversation_id = ANY(v_conv_ids)
      AND (coalesce(vi.raw->>'text','') <> '' OR vi.raw ? 'mediaContext')
      AND NOT EXISTS (
        SELECT 1 FROM public.wa_inbox w
        WHERE w.user_id = v_tenant AND w.phone = ANY(v_variants)
          AND w.direction = 'incoming'
          AND coalesce(w.is_archived,false) = false
          AND btrim(coalesce(w.content,'')) = btrim(coalesce(vi.raw->>'text',''))
          AND abs(extract(epoch FROM (w.created_at - coalesce(vi.received_at, vi.created_at)))) < 120
      )
    UNION ALL
    -- V3 outbound CONFIRMADO (status succeeded = receipt real). O eco fromMe já
    -- é barrado na gravação pela F2 (providerMessageId/conteúdo) — sem dupla.
    SELECT 'v3'::text, md5(eo.effect_id)::uuid, 'outgoing'::text, 'ia'::text,
           CASE WHEN eo.kind = 'send_media'
                THEN coalesce(nullif(eo.payload->>'text',''), '📷 Fotos do veículo enviadas')
                ELSE eo.payload->>'text' END,
           CASE WHEN eo.kind = 'send_media' THEN 'image' ELSE 'text' END,
           NULL::text, NULL::text, NULL::jsonb, coalesce(eo.dispatched_at, eo.created_at)
    FROM public.v3_effect_outbox eo
    WHERE eo.tenant_id = v_tenant
      AND eo.conversation_id = ANY(v_conv_ids)
      AND eo.kind IN ('send_message','send_media')
      AND eo.status = 'succeeded'
      AND (eo.kind = 'send_media' OR coalesce(eo.payload->>'text','') <> '')
  ) u
  WHERE (p_before IS NULL OR u.created_at < p_before)
  ORDER BY u.created_at DESC
  LIMIT least(greatest(coalesce(p_limit,200),1), 1000);
END $function$;

REVOKE ALL ON FUNCTION public.get_ai_conversation_messages_v2(uuid, text, integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_conversation_messages_v2(uuid, text, integer, timestamptz) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
