-- ============================================================================
-- REGRA DE OURO — "Conversas IA" mostra SOMENTE conversa de linha de IA.
--
-- Incidente 30/07: 251 conversas de linha de VENDEDOR (4 contas) apareceram na
-- aba "Conversas IA". Causa: o sincronizador passou a importar linha de vendedor
-- (regra 1 do dono) e grava na projecao com ai_line=false — CORRETO —, mas a RPC
-- da lista nunca filtrou por esse campo, entao devolvia tudo do tenant.
--
-- Correcao em duas camadas (defesa em profundidade):
--   1) a flag: coalesce(c.ai_line, true);
--   2) o fato: a instancia da conversa NAO pode ter seller_member_id.
-- A camada 2 protege mesmo que algum gravador esqueca de setar a flag.
--
-- ADITIVO: nao apaga nem altera dado nenhum. As conversas de vendedor continuam
-- na projecao e seguem validas para a aba de Conversas do WhatsApp, que e onde a
-- regra 1 manda elas aparecerem.
-- ============================================================================

-- ── 1. LISTA (get_ai_conversations_v2_base) ─────────────────────────────────
-- Texto identico ao que esta em producao + os dois predicados. O wrapper
-- get_ai_conversations_v2 (que sobrepoe ai_paused) NAO e tocado.
CREATE OR REPLACE FUNCTION public.get_ai_conversations_v2_base(
  p_limit integer DEFAULT 50,
  p_before timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_before_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(conversation_id uuid, instance_id uuid, agent_id uuid, phone text, phone_raw text, contact_name text, profile_picture_url text, last_message text, last_message_type text, last_message_direction text, last_message_at timestamp with time zone, message_count integer, crm_lead_id uuid, crm_source text, crm_match_status text, sem_vinculo_crm boolean, agente_inativo boolean, ia_pausada boolean, atendimento_manual boolean, first_seen_at timestamp with time zone, assigned_to_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
         c.first_seen_at,
         coalesce(pl.assigned_to_id, ml.assigned_member_id) AS assigned_to_id
  FROM public.ai_conversation_index c
  LEFT JOIN public.ai_crm_leads pl
    ON c.crm_source = 'pedro' AND pl.id = c.crm_lead_id
  LEFT JOIN LATERAL (
    SELECT CASE WHEN m.assigned_to ~ '^[0-9a-fA-F-]{36}$' THEN m.assigned_to::uuid END AS assigned_member_id
    FROM public.crm_leads m
    WHERE c.crm_source = 'marcos' AND m.id = c.crm_lead_id AND m.user_id = v_tenant
    LIMIT 1
  ) ml ON true
  WHERE c.user_id = v_tenant
    -- REGRA DE OURO (camada 1): a flag da projecao.
    AND coalesce(c.ai_line, true)
    -- REGRA DE OURO (camada 2): o fato. Linha de vendedor nunca entra aqui,
    -- mesmo que a flag venha errada de algum gravador.
    AND NOT EXISTS (
      SELECT 1 FROM public.wa_instances wi
      WHERE wi.id = c.instance_id AND wi.seller_member_id IS NOT NULL
    )
    AND public.logos_phone_key(c.phone_canonical) <> ALL(v_internos)
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
    AND (p_before IS NULL
         OR c.last_message_at < p_before
         OR (c.last_message_at = p_before AND p_before_id IS NOT NULL AND c.id < p_before_id))
  ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
  LIMIT least(greatest(coalesce(p_limit,50),1), 200);
END $function$;

-- ── 2. TIMELINE (get_ai_conversation_messages_v2) ───────────────────────────
-- A fonte 'synced' passa a excluir mensagem vinda de linha de vendedor. Feito por
-- substituicao VERIFICADA do texto vivo (a funcao tem 8k+ caracteres e e mantida
-- por mais de uma mao; retranscrever seria convite a erro). Aborta se a ancora
-- nao existir exatamente uma vez, e nao faz nada se a guarda ja estiver la.
DO $$
DECLARE
  v_def text;
  v_anchor text := 'AND (p_instance_id IS NULL OR s.instance_id = p_instance_id)';
  v_guard text := 'AND NOT EXISTS (SELECT 1 FROM public.wa_instances wis WHERE wis.id = s.instance_id AND wis.seller_member_id IS NOT NULL)';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_ai_conversation_messages_v2'
  LIMIT 1;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_ai_conversation_messages_v2 nao existe';
  END IF;

  IF position(v_guard in v_def) > 0 THEN
    RAISE NOTICE 'guarda de linha de vendedor ja presente na timeline; nada a fazer';
    RETURN;
  END IF;

  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'ancora da fonte synced nao encontrada exatamente uma vez — revisar manualmente';
  END IF;

  EXECUTE replace(v_def, v_anchor, v_anchor || E'\n      ' || v_guard);
END $$;

REVOKE ALL ON FUNCTION public.get_ai_conversations_v2_base(integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_conversations_v2_base(integer, timestamptz, uuid) TO authenticated, service_role;
