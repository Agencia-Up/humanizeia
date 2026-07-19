-- ════════════════════════════════════════════════════════════════════════════
-- Aba "Conversas IA" do Pedro: listar lead COM conversa, não lead qualquer
-- ════════════════════════════════════════════════════════════════════════════
--
-- MESMO BUG da `20260718190000_inbox_lista_so_lead_com_conversa.sql`, na OUTRA
-- RPC de listagem. São DUAS telas com DUAS RPCs distintas, e a correção
-- anterior cobriu só uma:
--
--   /conversas (menu WhatsApp)   -> get_allowed_lead_inbox         (já corrigida)
--   aba "Conversas IA" do Pedro  -> get_allowed_lead_conversations (esta)
--
-- Achado depois que o dono voltou dizendo "continua sem aparecer": eu havia
-- lido os dois arquivos do front e visto que ambos usam RPC segura, mas não
-- conferi que eram RPCs DIFERENTES — medi só a primeira e dei por resolvido.
--
-- MEDIDO (Avant, master): das 500 linhas devolvidas, só 84 tinham conversa —
-- 416 vagas ocupadas por lead sem mensagem nenhuma, empurrando conversa real
-- para fora do LIMIT.
--
-- POR QUE O FILTRO É CORRETO AQUI: esta aba é INBOX DE CONVERSA, não fila de
-- trabalho — o estado vazio do componente diz "Nenhuma conversa encontrada", e
-- as ações (Transferir / Reativar IA) agem sobre a conversa aberta, não sobre
-- lead que nunca trocou mensagem. Lead sem conversa se trabalha pelo CRM.
--
-- MUDANÇA (só isto): CTE `conv` com os telefones que têm mensagem em wa_inbox
-- OU wa_chat_history, e `lead_key IN (SELECT k FROM conv)` nos dois ramos
-- (allp/allm). O LIMIT passa a ser aplicado depois de filtrar.
--
-- O QUE NÃO MUDA: filtro de permissão byte a byte igual (tenant, agent_id,
-- assigned_to_id/assigned_to, p_seller_member_ids, logos_internal_keys) e a
-- precedência Pedro sobre Marcos (`allm ... NOT IN allp`) fica como estava.
-- O filtro novo só RESTRINGE.
--
-- VALIDADO EM BEGIN/ROLLBACK COM DADO REAL (JWT simulado, Avant):
--   master  : 500 linhas /  84 com conversa  ->  147 / 147   (+63)
--   vendedor:  67 linhas                     ->   41
--   Conversas perdidas: 0 | sem conversa que vazou: 0 | interno que vazou: 0
--   Vendedor fora do master: 0
--
-- NÃO TOCA: get_allowed_lead_messages (conferida: devolve 1000/4/174 mensagens
-- em 3 conversas reais, com IA e vendedor), front, policies, edge functions.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_allowed_lead_conversations(
  p_agent_id uuid DEFAULT NULL::uuid,
  p_seller_member_ids uuid[] DEFAULT NULL::uuid[],
  p_include_marcos boolean DEFAULT true,
  p_limit integer DEFAULT 500)
 RETURNS TABLE(lead_id uuid, source text, phone text, lead_key text, lead_name text,
               status text, ai_paused boolean, instance_id uuid, agent_id uuid,
               assigned_to_id uuid, created_at timestamp with time zone,
               arrived_at timestamp with time zone, last_interaction_at timestamp with time zone,
               summary text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
  -- ── Preâmbulo de permissão: IDÊNTICO ao anterior ─────────────────────────
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
  -- Telefones que REALMENTE têm conversa, das duas fontes.
  WITH conv AS (
    SELECT DISTINCT public.logos_phone_key(i.phone) AS k
    FROM public.wa_inbox i
    WHERE i.user_id = v_tenant AND coalesce(i.is_archived,false) = false
    UNION
    SELECT DISTINCT public.logos_phone_key(split_part(h.remote_jid,'@',1))
    FROM public.wa_chat_history h
    WHERE h.user_id = v_tenant
  ),
  pedro AS (
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
    SELECT * FROM pedro
    WHERE pedro.lead_key IS NOT NULL
      AND pedro.lead_key <> ALL(v_internos)
      AND pedro.lead_key IN (SELECT k FROM conv)          -- ← só com conversa
  ),
  allm AS (
    SELECT * FROM marcos
    WHERE marcos.lead_key IS NOT NULL
      AND marcos.lead_key <> ALL(v_internos)
      AND marcos.lead_key IN (SELECT k FROM conv)         -- ← só com conversa
      AND marcos.lead_key NOT IN (SELECT p.lead_key FROM allp p)
  )
  SELECT u.lead_id, u.source, u.phone, u.lead_key, u.lead_name, u.status, u.ai_paused,
         u.instance_id, u.agent_id, u.assigned_to_id, u.created_at, u.arrived_at,
         u.last_interaction_at, u.summary
  FROM (SELECT * FROM allp UNION ALL SELECT * FROM allm) u
  ORDER BY u.last_interaction_at DESC NULLS LAST, u.created_at DESC NULLS LAST
  LIMIT coalesce(p_limit, 500);
END
$function$;

COMMENT ON FUNCTION public.get_allowed_lead_conversations(uuid, uuid[], boolean, integer) IS
  'Aba Conversas IA do Pedro: SOMENTE lead (Pedro ou Marcos) que tem conversa real em wa_inbox/wa_chat_history. Exclui numero interno. Vendedor ve so o atribuido a ele.';
