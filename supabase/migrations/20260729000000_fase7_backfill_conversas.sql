-- =============================================================================
-- FASE 7 — Backfill controlado da projeção ai_conversation_index
--
-- Regras do dono:
--   * dry-run por tenant ANTES de escrever (contagens: indexáveis, órfãs,
--     duplicadas, ambíguas, ignoradas);
--   * piloto em tenant de baixo risco, depois lotes com checkpoint
--     (ai_conv_index_backfill_runs guarda cada execução);
--   * NUNCA cria lead/CRM, NUNCA envia mensagem, NUNCA dispara transferência —
--     a função só escreve em ai_conversation_index e no log de runs;
--   * linhas criadas pelo backfill levam origem='backfill' (rollback:
--     DELETE ... WHERE origem='backfill'); linhas vivas atualizadas mantêm
--     a origem original.
--
-- Semântica (espelho dos alimentadores da F3):
--   * wa_inbox = ÚNICA fonte contadora: linhas não-arquivadas de instâncias de
--     IA RESOLVÍVEIS (seller_member_id IS NULL) com telefone plausível. Linha
--     sem instance_id fica de fora — medição em prod (28/07) mostrou que essas
--     linhas NÃO são da IA (Icom/45d: 960 identidades sem instância, só 56 na
--     linha de IA, 188 em linha de vendedor, 729 em lugar nenhum; a linha de IA
--     inteira tem 167). O alimentador vivo recebeu a mesma guarda.
--   * v3 = existência/preview: conversas do v3_conversation_routing (to_addr =
--     telefone do cliente, validado 213/213); mensagens v3 SEM par na wa_inbox
--     (mesmo texto aparado, ±120s — mesma regra da timeline F4) contam como
--     extra (união dedupada, recompõe o histórico pré-F2);
--   * identidade v3 sem instância (lead ausente) => órfã NULL; se o MESMO
--     telefone já tem identidade com instância, NÃO cria órfã (duplicada);
--   * vínculo CRM: só leads EXISTENTES (prioridade instância → candidata única
--     → 'ambiguous' sem escolha silenciosa; pedro depois marcos) — criação de
--     lead continua proibida no backfill;
--   * cada identidade é processada sob ai_conv_index_lock => serializa com os
--     alimentadores vivos, sem corrida.
--
-- Perf: as fontes são materializadas em temporárias indexadas. A primeira
-- versão recomputava subconsultas correlacionadas por conversa sobre a
-- wa_inbox inteira e estourava o tempo na Icom (195k linhas).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_conv_index_backfill_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dry_run boolean NOT NULL,
  counts jsonb NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_conv_index_backfill_runs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ai_conv_index_backfill(
  p_tenant uuid,
  p_dry_run boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_counts jsonb;
  v_novas int := 0; v_atualizadas int := 0;
  v_orfas int := 0; v_duplicadas int := 0; v_ambiguas int := 0;
  v_linked_pedro int := 0; v_linked_marcos int := 0; v_sem_vinculo int := 0;
  v_ignoradas_implausiveis int; v_ignoradas_arquivadas int;
  v_total int := 0;
  v_ids uuid[];
  v_lead uuid; v_src text; v_status text;
  v_existed boolean;
BEGIN
  IF p_tenant IS NULL THEN RAISE EXCEPTION 'tenant obrigatorio'; END IF;

  -- execuções encadeadas na MESMA transação (loop de tenants) não colidem
  DROP TABLE IF EXISTS _bf_ident;
  DROP TABLE IF EXISTS _bf_wa;
  DROP TABLE IF EXISTS _bf_v3msgs;
  DROP TABLE IF EXISTS _bf_v3;

  -- ── wa_inbox da(s) linha(s) de IA (ÚNICA fonte contadora) ────────────────
  CREATE TEMP TABLE _bf_wa ON COMMIT DROP AS
  SELECT w.instance_id,
         public.logos_phone_canonical(w.phone) AS canon,
         w.phone, w.contact_name, w.content, w.message_type, w.direction, w.created_at,
         btrim(coalesce(w.content,'')) AS txt_trim
  FROM public.wa_inbox w
  JOIN public.wa_instances i ON i.id = w.instance_id AND i.seller_member_id IS NULL
  WHERE w.user_id = p_tenant
    AND w.instance_id IS NOT NULL
    AND i.user_id = p_tenant
    AND coalesce(w.is_archived, false) = false;
  DELETE FROM _bf_wa WHERE NOT public.logos_phone_plausible(canon);
  CREATE INDEX ON _bf_wa (canon, created_at);

  CREATE TEMP TABLE _bf_ident ON COMMIT DROP AS
  WITH agg AS (
    SELECT instance_id, canon, count(*)::int AS wa_cnt,
           min(created_at) AS first_at, max(created_at) AS last_at
    FROM _bf_wa GROUP BY 1,2
  ),
  last AS (
    SELECT DISTINCT ON (instance_id, canon)
           instance_id, canon, phone, contact_name, content, message_type, direction
    FROM _bf_wa ORDER BY instance_id, canon, created_at DESC
  )
  SELECT a.instance_id, a.canon,
         l.phone AS phone_raw, l.contact_name,
         l.content AS last_message, l.message_type AS last_message_type,
         l.direction AS last_message_direction, a.last_at AS last_message_at,
         a.wa_cnt, a.first_at, NULL::uuid AS agent_id
  FROM agg a JOIN last l USING (instance_id, canon);

  -- ── mensagens v3 (existência/preview) ────────────────────────────────────
  CREATE TEMP TABLE _bf_v3msgs ON COMMIT DROP AS
  WITH conv AS (
    SELECT r2.conversation_id,
           public.logos_phone_canonical(r2.to_addr) AS canon,
           r2.to_addr AS phone_raw,
           li.instance_id, li.agent_id
    FROM public.v3_conversation_routing r2
    LEFT JOIN LATERAL (
      SELECT l.instance_id, l.agent_id
      FROM public.v3_conversation_state cs
      JOIN public.ai_crm_leads l ON l.id::text = cs.lead_id
      WHERE cs.tenant_id = r2.tenant_id AND cs.conversation_id = r2.conversation_id
      LIMIT 1
    ) li ON true
    WHERE r2.tenant_id = p_tenant AND r2.to_addr IS NOT NULL
  )
  SELECT c.conversation_id, c.canon, c.phone_raw, c.instance_id, c.agent_id,
         coalesce(nullif(vi.raw->>'text',''), nullif(vi.raw #>> '{mediaContext,text}',''), '[mídia recebida]') AS txt,
         CASE WHEN vi.raw ? 'mediaContext'
              THEN coalesce(nullif(vi.raw #>> '{mediaContext,kind}',''),'text') ELSE 'text' END AS mtype,
         coalesce(vi.received_at, vi.created_at) AS at,
         nullif(vi.raw->>'leadNameHint','') AS name_hint
  FROM conv c
  JOIN public.v3_inbox vi
    ON vi.tenant_id = p_tenant AND vi.conversation_id = c.conversation_id
  WHERE public.logos_phone_plausible(c.canon);
  CREATE INDEX ON _bf_v3msgs (canon);

  -- por conversa: extras (sem par na wa_inbox, ±120s, mesma regra da F4)
  CREATE TEMP TABLE _bf_v3 ON COMMIT DROP AS
  SELECT m.conversation_id, min(m.canon) AS canon, min(m.phone_raw) AS phone_raw,
         min(m.instance_id::text)::uuid AS instance_id,
         min(m.agent_id::text)::uuid AS agent_id,
         count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM _bf_wa w
           WHERE w.canon = m.canon AND w.direction = 'incoming'
             AND w.txt_trim = btrim(coalesce(m.txt,''))
             AND w.created_at BETWEEN m.at - interval '120 seconds' AND m.at + interval '120 seconds'
         ))::int AS extra_cnt,
         count(*)::int AS msg_cnt,
         min(m.at) AS first_at,
         max(m.at) AS last_message_at,
         (array_agg(m.txt ORDER BY m.at DESC))[1] AS last_message,
         (array_agg(m.mtype ORDER BY m.at DESC))[1] AS last_message_type,
         max(m.name_hint) AS contact_name
  FROM _bf_v3msgs m
  GROUP BY m.conversation_id;

  -- v3 com instância conhecida: soma extras na identidade (instância, canon);
  -- cria a identidade se a wa_inbox nunca a viu (conversa v3 pré-F2).
  INSERT INTO _bf_ident (instance_id, canon, phone_raw, contact_name, last_message,
                         last_message_type, last_message_direction, last_message_at,
                         wa_cnt, first_at, agent_id)
  SELECT v.instance_id, v.canon, max(v.phone_raw), max(v.contact_name),
         (array_agg(v.last_message ORDER BY v.last_message_at DESC))[1],
         (array_agg(v.last_message_type ORDER BY v.last_message_at DESC))[1],
         'incoming', max(v.last_message_at),
         0, min(v.first_at), max(v.agent_id::text)::uuid
  FROM _bf_v3 v
  WHERE v.instance_id IS NOT NULL AND v.msg_cnt > 0
    AND NOT EXISTS (SELECT 1 FROM _bf_ident b
                    WHERE b.instance_id = v.instance_id AND b.canon = v.canon)
  GROUP BY v.instance_id, v.canon;

  UPDATE _bf_ident b SET
    wa_cnt = b.wa_cnt + x.extra,
    agent_id = coalesce(b.agent_id, x.agent_id),
    contact_name = coalesce(b.contact_name, x.contact_name),
    last_message = CASE WHEN x.last_at > coalesce(b.last_message_at,'-infinity') THEN x.last_message ELSE b.last_message END,
    last_message_type = CASE WHEN x.last_at > coalesce(b.last_message_at,'-infinity') THEN x.last_message_type ELSE b.last_message_type END,
    last_message_direction = CASE WHEN x.last_at > coalesce(b.last_message_at,'-infinity') THEN 'incoming' ELSE b.last_message_direction END,
    last_message_at = greatest(coalesce(b.last_message_at,'-infinity'), coalesce(x.last_at,'-infinity')),
    first_at = least(b.first_at, coalesce(x.first_at, b.first_at))
  FROM (
    SELECT v.instance_id, v.canon, sum(v.extra_cnt)::int AS extra,
           max(v.agent_id::text)::uuid AS agent_id, max(v.contact_name) AS contact_name,
           max(v.last_message_at) AS last_at, min(v.first_at) AS first_at,
           (array_agg(v.last_message ORDER BY v.last_message_at DESC))[1] AS last_message,
           (array_agg(v.last_message_type ORDER BY v.last_message_at DESC))[1] AS last_message_type
    FROM _bf_v3 v WHERE v.instance_id IS NOT NULL GROUP BY 1, 2
  ) x
  WHERE b.instance_id = x.instance_id AND b.canon = x.canon;

  -- v3 SEM instância: órfã NULL — mas se o telefone JÁ tem identidade com
  -- instância (neste backfill OU viva na projeção), é duplicada (não cria).
  SELECT count(*)::int INTO v_duplicadas
  FROM _bf_v3 v
  WHERE v.instance_id IS NULL
    AND (EXISTS (SELECT 1 FROM _bf_ident b WHERE b.canon = v.canon)
         OR EXISTS (SELECT 1 FROM public.ai_conversation_index i
                    WHERE i.user_id = p_tenant AND i.phone_canonical = v.canon));

  INSERT INTO _bf_ident (instance_id, canon, phone_raw, contact_name, last_message,
                         last_message_type, last_message_direction, last_message_at,
                         wa_cnt, first_at, agent_id)
  SELECT NULL, v.canon, max(v.phone_raw), max(v.contact_name),
         (array_agg(v.last_message ORDER BY v.last_message_at DESC))[1],
         (array_agg(v.last_message_type ORDER BY v.last_message_at DESC))[1],
         'incoming', max(v.last_message_at),
         sum(v.msg_cnt)::int, min(v.first_at), NULL
  FROM _bf_v3 v
  WHERE v.instance_id IS NULL AND v.msg_cnt > 0
    AND NOT EXISTS (SELECT 1 FROM _bf_ident b WHERE b.canon = v.canon)
    AND NOT EXISTS (SELECT 1 FROM public.ai_conversation_index i
                    WHERE i.user_id = p_tenant AND i.phone_canonical = v.canon)
  GROUP BY v.canon;

  SELECT count(*)::int INTO v_orfas FROM _bf_ident WHERE instance_id IS NULL;
  SELECT count(*)::int INTO v_total FROM _bf_ident;

  -- ── ignoradas (relatório) ────────────────────────────────────────────────
  SELECT count(*)::int INTO v_ignoradas_implausiveis
  FROM public.wa_inbox w
  JOIN public.wa_instances i ON i.id = w.instance_id AND i.seller_member_id IS NULL
  WHERE w.user_id = p_tenant AND coalesce(w.is_archived,false) = false
    AND NOT public.logos_phone_plausible(public.logos_phone_canonical(w.phone));
  SELECT count(*)::int INTO v_ignoradas_arquivadas
  FROM public.wa_inbox w
  JOIN public.wa_instances i ON i.id = w.instance_id AND i.seller_member_id IS NULL
  WHERE w.user_id = p_tenant AND coalesce(w.is_archived,false) = true;

  -- ── vínculo CRM (APENAS leads existentes; nunca cria) ────────────────────
  -- contagem no dry-run e aplicação na escrita usam a MESMA regra.
  FOR r IN SELECT * FROM _bf_ident LOOP
    v_lead := NULL; v_src := NULL; v_status := 'orphan';

    IF r.instance_id IS NOT NULL THEN
      SELECT coalesce(array_agg(l.id), '{}') INTO v_ids
      FROM public.ai_crm_leads l
      WHERE l.user_id = p_tenant AND l.instance_id = r.instance_id
        AND public.logos_phone_canonical(l.remote_jid) = r.canon;
      IF array_length(v_ids,1) = 1 THEN v_lead := v_ids[1]; v_src := 'pedro'; v_status := 'linked';
      ELSIF array_length(v_ids,1) > 1 THEN v_status := 'ambiguous';
      END IF;
    END IF;

    IF v_lead IS NULL AND v_status <> 'ambiguous' THEN
      SELECT coalesce(array_agg(l.id), '{}') INTO v_ids
      FROM public.ai_crm_leads l
      WHERE l.user_id = p_tenant
        AND public.logos_phone_canonical(l.remote_jid) = r.canon;
      IF array_length(v_ids,1) = 1 THEN v_lead := v_ids[1]; v_src := 'pedro'; v_status := 'linked';
      ELSIF array_length(v_ids,1) > 1 THEN v_status := 'ambiguous';
      END IF;
    END IF;

    IF v_lead IS NULL AND v_status <> 'ambiguous' THEN
      SELECT coalesce(array_agg(c.id), '{}') INTO v_ids
      FROM public.crm_leads c
      WHERE c.user_id = p_tenant
        AND public.logos_phone_canonical(c.phone) = r.canon;
      IF array_length(v_ids,1) = 1 THEN v_lead := v_ids[1]; v_src := 'marcos'; v_status := 'linked';
      ELSIF array_length(v_ids,1) > 1 THEN v_status := 'ambiguous';
      END IF;
    END IF;

    IF v_status = 'ambiguous' THEN v_ambiguas := v_ambiguas + 1;
    ELSIF v_src = 'pedro' THEN v_linked_pedro := v_linked_pedro + 1;
    ELSIF v_src = 'marcos' THEN v_linked_marcos := v_linked_marcos + 1;
    ELSE v_sem_vinculo := v_sem_vinculo + 1;
    END IF;

    IF NOT p_dry_run THEN
      -- mesmo lock dos alimentadores vivos: sem corrida com o webhook/v3.
      PERFORM public.ai_conv_index_lock(p_tenant, r.canon);

      SELECT EXISTS (
        SELECT 1 FROM public.ai_conversation_index i
        WHERE i.user_id = p_tenant AND i.instance_id IS NOT DISTINCT FROM r.instance_id
          AND i.phone_canonical = r.canon
      ) INTO v_existed;

      INSERT INTO public.ai_conversation_index AS i (
        user_id, instance_id, agent_id, phone_raw, phone_canonical, contact_name,
        last_message, last_message_type, last_message_direction, last_message_at,
        message_count, origem, first_seen_at,
        crm_lead_id, crm_source, crm_match_status
      ) VALUES (
        p_tenant, r.instance_id, r.agent_id, r.phone_raw, r.canon, r.contact_name,
        r.last_message, r.last_message_type, r.last_message_direction, r.last_message_at,
        coalesce(r.wa_cnt, 0), 'backfill', coalesce(r.first_at, now()),
        v_lead, v_src, CASE WHEN v_lead IS NOT NULL THEN 'linked' WHEN v_status='ambiguous' THEN 'ambiguous' ELSE 'orphan' END
      )
      ON CONFLICT (user_id, instance_id, phone_canonical) DO UPDATE SET
        -- recomputo é a verdade completa (inclui o que os triggers já contaram)
        message_count = greatest(i.message_count, EXCLUDED.message_count),
        agent_id = coalesce(i.agent_id, EXCLUDED.agent_id),
        contact_name = coalesce(i.contact_name, EXCLUDED.contact_name),
        phone_raw = coalesce(i.phone_raw, EXCLUDED.phone_raw),
        last_message = CASE WHEN EXCLUDED.last_message_at > coalesce(i.last_message_at,'-infinity') THEN EXCLUDED.last_message ELSE i.last_message END,
        last_message_type = CASE WHEN EXCLUDED.last_message_at > coalesce(i.last_message_at,'-infinity') THEN EXCLUDED.last_message_type ELSE i.last_message_type END,
        last_message_direction = CASE WHEN EXCLUDED.last_message_at > coalesce(i.last_message_at,'-infinity') THEN EXCLUDED.last_message_direction ELSE i.last_message_direction END,
        last_message_at = nullif(greatest(coalesce(i.last_message_at,'-infinity'), coalesce(EXCLUDED.last_message_at,'-infinity')), '-infinity'::timestamptz),
        first_seen_at = least(i.first_seen_at, EXCLUDED.first_seen_at),
        -- vínculo: NUNCA sobrescreve um vínculo existente
        crm_lead_id = coalesce(i.crm_lead_id, EXCLUDED.crm_lead_id),
        crm_source = coalesce(i.crm_source, EXCLUDED.crm_source),
        crm_match_status = CASE WHEN i.crm_lead_id IS NOT NULL THEN i.crm_match_status ELSE EXCLUDED.crm_match_status END,
        -- origem: linha viva mantém a origem original
        updated_at = now();

      IF v_existed THEN v_atualizadas := v_atualizadas + 1; ELSE v_novas := v_novas + 1; END IF;
    END IF;
  END LOOP;

  v_counts := jsonb_build_object(
    'tenant', p_tenant, 'dry_run', p_dry_run,
    'indexaveis', v_total, 'novas', v_novas, 'atualizadas', v_atualizadas,
    'orfas_v3', v_orfas, 'duplicadas_v3', v_duplicadas, 'ambiguas', v_ambiguas,
    'linked_pedro', v_linked_pedro, 'linked_marcos', v_linked_marcos,
    'sem_vinculo', v_sem_vinculo,
    'ignoradas_implausiveis', v_ignoradas_implausiveis,
    'ignoradas_arquivadas', v_ignoradas_arquivadas
  );

  INSERT INTO public.ai_conv_index_backfill_runs (user_id, dry_run, counts)
  VALUES (p_tenant, p_dry_run, v_counts);

  DROP TABLE IF EXISTS _bf_ident;
  DROP TABLE IF EXISTS _bf_wa;
  DROP TABLE IF EXISTS _bf_v3msgs;
  DROP TABLE IF EXISTS _bf_v3;
  RETURN v_counts;
END;
$$;

-- Ferramenta de operador: NÃO exposta ao app.
REVOKE ALL ON FUNCTION public.ai_conv_index_backfill(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_conv_index_backfill(uuid, boolean) TO service_role;
