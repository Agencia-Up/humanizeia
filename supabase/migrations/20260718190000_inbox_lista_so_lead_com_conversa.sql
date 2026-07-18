-- ════════════════════════════════════════════════════════════════════════════
-- Conversas: a lista passa a trazer LEAD COM CONVERSA, não lead qualquer
-- ════════════════════════════════════════════════════════════════════════════
--
-- SINTOMA (dono): "a tela de Conversas não está puxando as conversas".
--
-- CAUSA RAIZ: `get_allowed_lead_inbox` listava LEAD, não CONVERSA. Fazia
-- LEFT JOIN com o inbox e aplicava `LIMIT 500` sobre TODOS os leads do tenant,
-- inclusive os que nunca trocaram mensagem. Como o ORDER BY cai para
-- `created_at` quando não há mensagem, lead recém-cadastrado sem conversa
-- ocupava as primeiras vagas e empurrava conversa real para fora do limite.
--
-- MEDIDO ANTES DE MEXER (Avant, master): das 500 linhas devolvidas, só 114
-- tinham conversa — 386 vagas gastas com lead sem mensagem nenhuma.
--
-- Também medido e DESCARTADO como causa (não é isto):
--   • perda de mensagem na timeline — `get_allowed_lead_messages` devolve
--     100% do bruto: Pedro 47/47 leads e Marcos 105/105, ZERO mensagem perdida;
--   • falha de normalização de telefone — 1297/1300 (chat) e 2952/2960 (inbox)
--     dos telefones são reproduzíveis pela própria função de variantes.
-- Por isso esta migration NÃO toca em `get_allowed_lead_messages`.
--
-- O QUE MUDA (só isto):
--   1. CTE `conv` = última mensagem por telefone, unindo wa_inbox E
--      wa_chat_history. O JOIN com ela vira o filtro "tem conversa real", e o
--      LIMIT passa a ser aplicado DEPOIS de filtrar.
--      Incluir wa_chat_history importa: 20 leads do Pedro v2 na Avant só têm
--      conversa lá e hoje apareciam sem prévia nenhuma.
--   2. Desempate determinístico: `, lead_id` no fim do ORDER BY do DISTINCT ON.
--      Motivo real: existem 8 telefones na Avant com DOIS leads no Marcos e
--      `arrived_at` idêntico — com empate total o DISTINCT ON escolhia de forma
--      não-determinística e o mesmo telefone podia devolver lead_id diferente a
--      cada carregamento. Não muda a preferência Pedro/Marcos (decisão do dono
--      de adiar essa parte); só torna o resultado estável.
--
-- O QUE NÃO MUDA: o filtro de permissão é byte a byte o mesmo — tenant,
-- vendedor (assigned_to_id / assigned_to) e exclusão de número interno
-- (`logos_internal_keys`). O filtro novo só RESTRINGE. Conversa sem lead e
-- número interno continuam fora.
--
-- VALIDADO EM BEGIN/ROLLBACK COM DADO REAL (JWT simulado):
--   Avant master  : 500 linhas / 114 com conversa  ->  137 / 137  (+23)
--   Avant vendedor:  67 linhas /  33 com conversa  ->   41 /  41  (+8)
--   Icom  master  : 500 linhas / 315 com conversa  ->  500 / 500  (+185)
--   Icom  vendedor: 304 linhas / 140 com conversa  ->  155 / 155  (+15)
--   Conversas perdidas (por telefone): 0 em todos os casos.
--   Vendedor é subconjunto estrito do master (155 de 1561): 0 fora.
--   Segurança (Icom master): 0 número interno, 0 sem conversa, 0 sem lead.
--
-- ── DEIXADO DE FORA DE PROPÓSITO (decisão do dono, itens separados) ──────────
--
-- 1. ÍNDICE: `wa_chat_history` não tem índice em `user_id` — a CTE `conv` faz
--    seq scan nela. Hoje são ~15k linhas e a Icom (183k msgs no inbox) rodou
--    sem timeout, então NÃO foi criado índice. Quando essa tabela crescer,
--    avaliar `CREATE INDEX ON public.wa_chat_history(user_id)`.
--
-- 2. LIMIT 500: o front pede 500. A Icom tem 1561 conversas reais, então o
--    master vê só as 500 mais recentes. É limitação do FRONT (fora do escopo
--    desta correção), não desta RPC — que aceita o limite que receber.
--
-- 3. LEAD DUPLICADO / PREFERÊNCIA PEDRO×MARCOS: 8 telefones da Avant têm dois
--    leads no Marcos com `arrived_at` idêntico. O `lead_id` agora é estável,
--    mas a duplicata segue no CRM — é limpeza de DADO. E telefone que existe
--    nos dois CRMs continua abrindo como Pedro: mudar isso é regra de produto
--    e exige validar o front junto (transferir / reativar IA agem por origem).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_allowed_lead_inbox(p_limit integer DEFAULT 500)
 RETURNS TABLE(lead_id uuid, source text, phone text, lead_name text, instance_id text,
               last_message text, last_message_type text, last_media_url text, ai_category text,
               unread_count integer, last_message_at timestamp with time zone,
               lead_arrived_at timestamp with time zone, lead_created_at timestamp with time zone)
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
  v_internos text[];
BEGIN
  -- ── Preâmbulo de permissão: IDÊNTICO ao anterior, não afrouxa nada ────────
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
  -- Última mensagem por telefone, das DUAS fontes. É esta CTE que define
  -- "existe conversa": o JOIN com ela é o filtro, e o LIMIT vem depois.
  WITH conv AS (
    SELECT DISTINCT ON (k) k, last_at, last_message, last_type, last_media, ai_cat, last_instance
    FROM (
      SELECT public.logos_phone_key(i.phone) AS k, i.created_at AS last_at,
             i.content AS last_message, i.message_type AS last_type,
             i.media_url AS last_media, i.ai_category AS ai_cat,
             i.instance_id::text AS last_instance
      FROM public.wa_inbox i
      WHERE i.user_id = v_tenant AND coalesce(i.is_archived,false) = false
      UNION ALL
      SELECT public.logos_phone_key(split_part(h.remote_jid,'@',1)), h.created_at,
             h.content, coalesce(h.metadata->>'message_type','text'),
             NULL::text, NULL::text, h.instance_id::text
      FROM public.wa_chat_history h
      WHERE h.user_id = v_tenant
    ) z
    WHERE k IS NOT NULL
    ORDER BY k, last_at DESC
  ),
  leads AS (
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
      AND lead_key IN (SELECT k FROM conv)          -- ← só lead COM conversa
    -- `lead_id` no fim = desempate determinístico (ver cabeçalho).
    ORDER BY lead_key, (source='pedro') DESC, last_interaction_at DESC NULLS LAST, lead_id
  ),
  unread AS (
    SELECT public.logos_phone_key(phone) AS k, count(*)::int AS n
    FROM public.wa_inbox
    WHERE user_id = v_tenant AND direction = 'incoming'
      AND coalesce(is_read,false) = false AND coalesce(is_archived,false) = false
    GROUP BY public.logos_phone_key(phone)
  )
  SELECT lo.lead_id, lo.source, lo.phone, lo.lead_name,
         coalesce(lo.instance_id, c.last_instance) AS instance_id,
         c.last_message, c.last_type, c.last_media, c.ai_cat,
         coalesce(u.n, 0) AS unread_count,
         c.last_at AS last_message_at,
         lo.arrived_at AS lead_arrived_at, lo.created_at AS lead_created_at
  FROM leads_ok lo
  JOIN conv c ON c.k = lo.lead_key                  -- ← JOIN, não LEFT JOIN
  LEFT JOIN unread u ON u.k = lo.lead_key
  ORDER BY c.last_at DESC NULLS LAST
  LIMIT coalesce(p_limit, 500);
END
$function$;

COMMENT ON FUNCTION public.get_allowed_lead_inbox(integer) IS
  'Lista de Conversas: SOMENTE lead (Pedro ou Marcos) que tem conversa real em wa_inbox/wa_chat_history. Exclui numero interno e conversa sem lead. Vendedor ve so o que esta atribuido a ele.';
