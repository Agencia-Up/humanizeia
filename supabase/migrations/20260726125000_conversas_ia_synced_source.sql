-- ============================================================================
-- F4 — Timeline consolidando a fonte SINCRONIZADA (wa_synced_messages).
--
-- ADITIVO: get_ai_conversations_v2 (lista) NAO muda — ja le ai_conversation_index,
-- que o syncer popula (conversas sem CRM / agente inativo ja aparecem).
-- get_ai_conversation_messages_v2 (timeline) ganha:
--   - a fonte 'synced' (historico importado da UAZAPI);
--   - colunas actor_source (cliente|ia_v3|humano_manual|desconhecido) e
--     ingestion_source (webhook|v3|painel|sincronizacao_uazapi) — por EVIDENCIA;
--   - dedup do synced pelo ID REAL do provedor (vs wa_inbox) e, como FALLBACK,
--     por assinatura determinista (texto+janela) vs v3.
-- Mensagem manual NUNCA e marcada IA so por sair de instancia de IA: wa_inbox
-- outgoing vira actor_source='desconhecido' (exibido como "Enviado"); a autoria
-- ia_v3/humano_manual precisa da evidencia do outbox (que o synced ja resolveu).
-- ============================================================================

-- Indice funcional para o lookup por telefone canonico do projeto (sem last-8 puro).
create index if not exists wa_synced_messages_phonekey_idx
  on public.wa_synced_messages (tenant_id, (public.logos_phone_key(phone_canonical)), wa_timestamp);

drop function if exists public.get_ai_conversation_messages_v2(uuid, text, integer, timestamptz);

create function public.get_ai_conversation_messages_v2(
  p_instance_id uuid default null,
  p_phone text default null,
  p_limit integer default 200,
  p_before timestamptz default null
) returns table(
  source text, id uuid, direction text, actor text, content text, message_type text,
  media_url text, remote_message_id text, metadata jsonb, created_at timestamptz,
  actor_source text, ingestion_source text
)
language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid(); v_role text; v_is_seller boolean := false;
  v_is_manager boolean := false; v_tenant uuid;
  v_members uuid[] := '{}'; v_members_txt text[] := '{}'; v_internos text[];
  v_canon text; v_variants text[]; v_ok boolean := false;
  v_ia_instances uuid[] := '{}'; v_conv_ids text[] := '{}'; v_key text;
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
  v_key := public.logos_phone_key(v_canon);

  v_internos := public.logos_internal_keys(v_tenant);
  IF v_key = ANY(v_internos) THEN RETURN; END IF;

  IF v_is_seller AND NOT v_is_manager THEN
    SELECT EXISTS(
      SELECT 1 FROM public.ai_crm_leads l
       WHERE l.user_id = v_tenant
         AND public.logos_phone_key(split_part(l.remote_jid,'@',1)) = v_key
         AND l.assigned_to_id = ANY(v_members)
      UNION ALL
      SELECT 1 FROM public.crm_leads m
       WHERE m.user_id = v_tenant
         AND public.logos_phone_key(m.phone) = v_key
         AND m.assigned_to = ANY(v_members_txt)
    ) INTO v_ok;
    IF NOT v_ok THEN RETURN; END IF;
  END IF;

  v_variants := public.logos_phone_variants(v_canon);

  SELECT coalesce(array_agg(w.id),'{}') INTO v_ia_instances
  FROM public.wa_instances w
  WHERE w.user_id = v_tenant AND w.seller_member_id IS NULL;

  SELECT coalesce(array_agg(r.conversation_id),'{}') INTO v_conv_ids
  FROM public.v3_conversation_routing r
  WHERE r.tenant_id = v_tenant
    AND public.logos_phone_canonical(r.to_addr) = v_canon;

  RETURN QUERY
  SELECT u.source, u.id, u.direction, u.actor, u.content, u.message_type,
         u.media_url, u.remote_message_id, u.metadata, u.created_at,
         u.actor_source, u.ingestion_source
  FROM (
    -- Webhook (wa_inbox): incoming=cliente; outgoing=desconhecido (nao inferir IA pela instancia)
    SELECT 'inbox'::text AS source, i.id, i.direction,
           CASE WHEN i.direction = 'incoming' THEN 'cliente'
                WHEN i.instance_id = ANY(v_ia_instances) THEN 'ia'
                ELSE 'vendedor' END AS actor,
           i.content, i.message_type, i.media_url,
           i.remote_message_id, NULL::jsonb AS metadata, i.created_at,
           CASE WHEN i.direction = 'incoming' THEN 'cliente' ELSE 'desconhecido' END AS actor_source,
           'webhook'::text AS ingestion_source
    FROM public.wa_inbox i
    WHERE i.user_id = v_tenant AND i.phone = ANY(v_variants)
      AND coalesce(i.is_archived, false) = false
      AND (p_instance_id IS NULL OR i.instance_id = p_instance_id)
    UNION ALL
    -- V2 historico (wa_chat_history)
    SELECT 'chat'::text, h.id,
           CASE WHEN h.role = 'assistant' THEN 'outgoing' ELSE 'incoming' END,
           CASE WHEN h.role = 'assistant' THEN 'ia' ELSE 'cliente' END,
           h.content, coalesce(h.metadata->>'message_type','text'),
           NULL::text, NULL::text, h.metadata, h.created_at,
           CASE WHEN h.role = 'assistant' THEN 'ia_v3' ELSE 'cliente' END,
           'webhook'::text
    FROM public.wa_chat_history h
    WHERE h.user_id = v_tenant AND split_part(h.remote_jid,'@',1) = ANY(v_variants)
    UNION ALL
    -- V3 entrada (cliente)
    SELECT 'v3'::text, md5(vi.event_id)::uuid, 'incoming'::text, 'cliente'::text,
           coalesce(nullif(vi.raw->>'text',''),
                    nullif(vi.raw #>> '{mediaContext,text}',''),
                    nullif(vi.raw #>> '{mediaContext,summary}',''),
                    '[mídia recebida]'),
           CASE WHEN vi.raw ? 'mediaContext'
                THEN coalesce(nullif(vi.raw #>> '{mediaContext,kind}',''),'text')
                ELSE 'text' END,
           NULL::text, NULL::text, NULL::jsonb, coalesce(vi.received_at, vi.created_at),
           'cliente'::text, 'v3'::text
    FROM public.v3_inbox vi
    WHERE vi.tenant_id = v_tenant
      AND vi.conversation_id = ANY(v_conv_ids)
      AND (coalesce(vi.raw->>'text','') <> '' OR vi.raw ? 'mediaContext')
      AND NOT EXISTS (
        SELECT 1 FROM public.wa_inbox w
        WHERE w.user_id = v_tenant AND w.phone = ANY(v_variants)
          AND w.direction = 'incoming' AND coalesce(w.is_archived,false) = false
          AND btrim(coalesce(w.content,'')) = btrim(coalesce(vi.raw->>'text',''))
          AND abs(extract(epoch FROM (w.created_at - coalesce(vi.received_at, vi.created_at)))) < 120
      )
    UNION ALL
    -- V3 saida (IA)
    SELECT 'v3'::text, md5(eo.effect_id)::uuid, 'outgoing'::text, 'ia'::text,
           CASE WHEN eo.kind = 'send_media'
                THEN coalesce(nullif(eo.payload->>'text',''), '📷 Fotos do veículo enviadas')
                ELSE eo.payload->>'text' END,
           CASE WHEN eo.kind = 'send_media' THEN 'image' ELSE 'text' END,
           NULL::text, NULL::text, NULL::jsonb, coalesce(eo.dispatched_at, eo.created_at),
           'ia_v3'::text, 'v3'::text
    FROM public.v3_effect_outbox eo
    WHERE eo.tenant_id = v_tenant
      AND eo.conversation_id = ANY(v_conv_ids)
      AND eo.kind IN ('send_message','send_media')
      AND eo.status = 'succeeded'
      AND (eo.kind = 'send_media' OR coalesce(eo.payload->>'text','') <> '')
    UNION ALL
    -- SINCRONIZADO (historico importado da UAZAPI). Autoria por evidencia (gravada).
    -- Dedup: pelo ID REAL do provedor vs wa_inbox; e, como fallback, por assinatura vs V3.
    SELECT 'synced'::text, s.id, s.direction,
           CASE s.actor_source WHEN 'ia_v3' THEN 'ia' WHEN 'humano_manual' THEN 'vendedor'
                WHEN 'cliente' THEN 'cliente' ELSE 'desconhecido' END,
           s.content, s.message_type, s.media_url, s.provider_message_id, s.raw, s.wa_timestamp,
           s.actor_source, s.ingestion_source
    FROM public.wa_synced_messages s
    WHERE s.tenant_id = v_tenant
      AND public.logos_phone_key(s.phone_canonical) = v_key
      AND (p_instance_id IS NULL OR s.instance_id = p_instance_id)
      AND NOT EXISTS (  -- dedup por ID do provedor (webhook ja tem esta mensagem)
        SELECT 1 FROM public.wa_inbox w
        WHERE w.user_id = v_tenant AND w.phone = ANY(v_variants)
          AND w.remote_message_id = s.provider_message_id
      )
      AND NOT EXISTS (  -- fallback: mesma mensagem ja vinda do V3 (ids diferentes)
        SELECT 1 FROM public.v3_effect_outbox eo2
        WHERE eo2.tenant_id = v_tenant AND eo2.conversation_id = ANY(v_conv_ids)
          AND eo2.kind IN ('send_message','send_media')
          AND btrim(lower(coalesce(eo2.payload->>'text',''))) = btrim(lower(coalesce(s.content,'')))
          AND coalesce(s.content,'') <> ''
          AND abs(extract(epoch FROM (coalesce(eo2.dispatched_at,eo2.created_at) - s.wa_timestamp))) < 180
      )
      AND NOT EXISTS (  -- fallback: mesma entrada ja vinda do V3
        SELECT 1 FROM public.v3_inbox vi2
        WHERE vi2.tenant_id = v_tenant AND vi2.conversation_id = ANY(v_conv_ids)
          AND btrim(lower(coalesce(vi2.raw->>'text',''))) = btrim(lower(coalesce(s.content,'')))
          AND coalesce(s.content,'') <> ''
          AND abs(extract(epoch FROM (coalesce(vi2.received_at,vi2.created_at) - s.wa_timestamp))) < 180
      )
  ) u
  WHERE (p_before IS NULL OR u.created_at < p_before)
  ORDER BY u.created_at DESC
  LIMIT least(greatest(coalesce(p_limit,200),1), 1000);
END $function$;
