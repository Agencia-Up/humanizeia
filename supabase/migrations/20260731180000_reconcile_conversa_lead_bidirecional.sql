-- ============================================================================
-- VINCULO CONVERSA <-> LEAD NOS DOIS SENTIDOS (caso Adonias, 31/07/2026)
--
-- SINTOMA: master enxerga a conversa, o vendedor dono do lead nao.
-- CAUSA RAIZ: os gatilhos de vinculo eram AFTER INSERT nas tabelas de LEAD, e so
--   cobriam "lead criado depois da conversa". Quando a CONVERSA nasce depois do
--   lead (Adonias: lead 09/07, conversa 31/07), ninguem procurava o lead que ja
--   existia — a conversa ficava orphan, e get_ai_conversations_v2_base (com
--   razao) exige vinculo para o vendedor enxergar.
--
-- ATENCAO OPERACIONAL: aplicar esta migration JA MUDA o comportamento das
-- conversas NOVAS, mesmo sem rodar o backfill. Nao e uma migration inerte.
--
-- DECISAO CENTRALIZADA DE VERDADE: os gatilhos antigos de Pedro e Marcos foram
-- reescritos para DELEGAR. Nenhuma logica de vinculo sobra fora desta funcao.
--
-- REGRA DE FONTE (sem prioridade cega Pedro > Marcos):
--   * EVIDENCIA FORTE: lead Pedro no mesmo tenant + MESMA INSTANCIA + telefone
--     canonico, candidato unico => vincula (a instancia e prova de que a conversa
--     nasceu naquele atendimento);
--   * fora disso, monta um conjunto UNIFICADO de candidatos Pedro + Marcos:
--       1 candidato  => vincula (a fonte vem de quem e o candidato);
--       2+           => 'ambiguous', NAO escolhe;
--       0            => segue 'orphan'.
--   * nunca escolhe Pedro so por ser consultado antes.
--
-- INVARIANTES: sempre por tenant; nunca cruza empresas; telefone canonico
-- oficial (logos_phone_canonical), NUNCA last-8; nunca rouba vinculo existente;
-- serializa pelo advisory lock da projecao; toda mudanca fica auditada.
--
-- NAO altera a visibilidade: get_ai_conversations_v2_base continua exigindo
-- vinculo + atribuicao ATUAL do lead (por isso reatribuir muda o acesso na hora).
-- NAO toca em follow-up, transferencia, "Ok", V3, Jose ou feedbacks.
-- ============================================================================

-- ── AUDITORIA: antes/depois de cada mudanca, com lote para rollback ──────────
CREATE TABLE IF NOT EXISTS public.ai_conv_link_audit (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              uuid,                    -- NULL = mudanca vinda de gatilho
  conversation_id       uuid NOT NULL,
  tenant_id             uuid NOT NULL,
  crm_lead_id_antes     uuid,
  crm_source_antes      text,
  crm_match_status_antes text,
  crm_lead_id_depois    uuid,
  crm_source_depois     text,
  crm_match_status_depois text,
  evidencia             text,                    -- por que decidiu assim
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_conv_link_audit_batch_idx ON public.ai_conv_link_audit (batch_id, created_at);
-- ROLLBACK DETERMINISTICO: no maximo UMA auditoria por conversa em cada lote,
-- para reconcile_backfill_rollback sempre achar exatamente um estado anterior.
-- (batch_id NULL = mudanca de gatilho; essas podem repetir ao longo do tempo.)
CREATE UNIQUE INDEX IF NOT EXISTS ai_conv_link_audit_batch_conv_uq
  ON public.ai_conv_link_audit (batch_id, conversation_id) WHERE batch_id IS NOT NULL;
ALTER TABLE public.ai_conv_link_audit ENABLE ROW LEVEL SECURITY;

-- ── LOTES: identificador de execucao, unico para sempre ────────────────────
-- Nao basta olhar a auditoria: um lote pode terminar sem alterar nenhuma linha
-- (e portanto sem auditoria) e ser reutilizado depois; e duas execucoes
-- concorrentes com o mesmo id passariam juntas pelo EXISTS. A PK aqui resolve
-- os dois: a segunda insercao falha atomicamente. O registro NUNCA e apagado,
-- nem apos rollback funcional — o identificador fica queimado para sempre.
CREATE TABLE IF NOT EXISTS public.ai_conv_link_batches (
  batch_id     uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  token        uuid NOT NULL,                  -- lease: so quem reivindicou executa
  status       text NOT NULL DEFAULT 'claimed' -- claimed -> running -> ok|error|rolled_back
    CHECK (status IN ('claimed','running','ok','error','rolled_back')),
  reivindicado_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em  timestamptz,
  concluido_em timestamptz,
  vinculadas   int NOT NULL DEFAULT 0,
  ambiguas     int NOT NULL DEFAULT 0,
  sem_match    int NOT NULL DEFAULT 0,
  erro         text,
  revertido_em timestamptz
);
ALTER TABLE public.ai_conv_link_batches ENABLE ROW LEVEL SECURITY;

-- ── REIVINDICACAO DO LOTE (transacao SEPARADA do processamento) ────────────
-- Por que separado: se o INSERT do lote acontecesse dentro do backfill e o
-- backfill levantasse excecao, o Postgres desfaria a invocacao INTEIRA — o
-- INSERT do lote junto. O identificador voltaria a ficar livre e a promessa de
-- "queimado para sempre" seria falsa. Reivindicar numa chamada propria, que
-- COMMITA antes, garante que o id existe independentemente do que acontecer
-- depois. O caller faz: SELECT claim... ; depois SELECT backfill(...).
CREATE OR REPLACE FUNCTION public.claim_ai_conv_link_batch(p_tenant uuid)
RETURNS TABLE(batch_id uuid, token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_b uuid := gen_random_uuid(); v_t uuid := gen_random_uuid();
BEGIN
  IF p_tenant IS NULL THEN RAISE EXCEPTION 'tenant obrigatorio para reivindicar um lote'; END IF;
  -- id gerado AQUI: o caller nao escolhe, entao nao existe como reapresentar um id velho.
  INSERT INTO public.ai_conv_link_batches (batch_id, tenant_id, token, status)
  VALUES (v_b, p_tenant, v_t, 'claimed');
  RETURN QUERY SELECT v_b, v_t;
END $$;

REVOKE ALL ON FUNCTION public.claim_ai_conv_link_batch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_conv_link_batch(uuid) TO service_role;

-- ── FUNCAO CANONICA: o unico lugar que decide vinculo ───────────────────────
CREATE OR REPLACE FUNCTION public.reconcile_ai_conversation_crm_link(
  p_tenant uuid,
  p_conversation_id uuid,
  p_instance_id uuid DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_conv   public.ai_conversation_index%ROWTYPE;
  v_canon  text; v_inst uuid;
  v_p_inst uuid[]; v_p_all uuid[]; v_mk uuid[];
  v_lead   uuid; v_src text; v_status text; v_evid text;
  v_rows   int;
BEGIN
  IF p_tenant IS NULL OR p_conversation_id IS NULL THEN RETURN 'skipped'; END IF;

  -- ── PASSO 1: dados MINIMOS so para calcular a chave do lock ───────────────
  -- (leitura sem lock; nada e decidido com base nela)
  SELECT c.phone_canonical INTO v_canon FROM public.ai_conversation_index c
   WHERE c.id = p_conversation_id AND c.user_id = p_tenant;
  IF v_canon IS NULL THEN RETURN 'skipped'; END IF;
  v_canon := coalesce(public.logos_phone_canonical(p_phone), v_canon);
  IF NOT public.logos_phone_plausible(v_canon) THEN RETURN 'skipped'; END IF;

  -- ── PASSO 2: adquire o lock do par (tenant, telefone) ─────────────────────
  PERFORM public.ai_conv_index_lock(p_tenant, v_canon);

  -- ── PASSO 3: RELE com FOR UPDATE e revalida DEPOIS do lock ────────────────
  -- Sem isto, duas execucoes concorrentes leriam "orfa", a primeira vincularia e
  -- a segunda seguiria com estado velho: auditoria falsa e UPDATE de zero linhas
  -- retornando 'linked'. Agora a segunda ve o vinculo e sai em 'already_linked'.
  SELECT * INTO v_conv FROM public.ai_conversation_index
   WHERE id = p_conversation_id AND user_id = p_tenant
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'skipped'; END IF;
  IF v_conv.crm_lead_id IS NOT NULL THEN RETURN 'already_linked'; END IF;  -- nunca rouba
  IF v_conv.ai_line IS NOT TRUE THEN RETURN 'skipped'; END IF;

  -- ── FONTE OFICIAL DEPOIS DO LOCK = A LINHA, nunca os parametros ──────────
  -- p_phone/p_instance_id foram calculados ANTES do lock e podem estar velhos.
  -- Se a conversa mudou de telefone enquanto esperavamos, a chave do advisory
  -- lock que seguramos nao protege mais a identidade correta: NAO vinculamos
  -- com chave antiga. Devolvemos 'retry_required', observavel, e quem chamou
  -- reprocessa com o estado novo.
  IF v_conv.phone_canonical IS DISTINCT FROM v_canon THEN
    RETURN 'retry_required';
  END IF;
  v_canon := v_conv.phone_canonical;
  v_inst  := v_conv.instance_id;
  IF v_canon IS NULL OR NOT public.logos_phone_plausible(v_canon) THEN RETURN 'skipped'; END IF;

  -- Conjunto de candidatos (uma passada por fonte; sem prioridade cega).
  IF v_inst IS NOT NULL THEN
    SELECT coalesce(array_agg(l.id), '{}') INTO v_p_inst FROM public.ai_crm_leads l
     WHERE l.user_id = p_tenant AND l.instance_id = v_inst
       AND public.logos_phone_canonical(l.remote_jid) = v_canon;
  ELSE
    v_p_inst := '{}';
  END IF;

  SELECT coalesce(array_agg(l.id), '{}') INTO v_p_all FROM public.ai_crm_leads l
   WHERE l.user_id = p_tenant AND public.logos_phone_canonical(l.remote_jid) = v_canon;

  SELECT coalesce(array_agg(m.id), '{}') INTO v_mk FROM public.crm_leads m
   WHERE m.user_id = p_tenant AND public.logos_phone_canonical(m.phone) = v_canon;

  IF coalesce(array_length(v_p_inst,1),0) = 1 THEN
    -- EVIDENCIA FORTE: mesma instancia. Vence mesmo havendo lead Marcos homonimo.
    v_lead := v_p_inst[1]; v_src := 'pedro'; v_status := 'linked';
    v_evid := 'pedro_mesma_instancia';
  ELSIF coalesce(array_length(v_p_inst,1),0) > 1 THEN
    v_status := 'ambiguous'; v_evid := 'pedro_mesma_instancia_multiplos';
  ELSIF (coalesce(array_length(v_p_all,1),0) + coalesce(array_length(v_mk,1),0)) = 1 THEN
    -- Conjunto UNIFICADO: a fonte vem de quem e o unico candidato.
    IF coalesce(array_length(v_p_all,1),0) = 1 THEN
      v_lead := v_p_all[1]; v_src := 'pedro'; v_evid := 'candidato_unico_pedro';
    ELSE
      v_lead := v_mk[1]; v_src := 'marcos'; v_evid := 'candidato_unico_marcos';
    END IF;
    v_status := 'linked';
  ELSIF (coalesce(array_length(v_p_all,1),0) + coalesce(array_length(v_mk,1),0)) > 1 THEN
    v_status := 'ambiguous';
    v_evid := format('multiplos_candidatos pedro=%s marcos=%s',
                     coalesce(array_length(v_p_all,1),0), coalesce(array_length(v_mk,1),0));
  ELSE
    RETURN 'orphan';   -- zero candidatos: nada muda, nada a auditar
  END IF;

  -- Nada a fazer se o estado calculado ja e o estado atual (ex.: reprocessar uma
  -- conversa que ja esta marcada 'ambiguous'). Sem UPDATE e sem auditoria.
  IF v_lead IS NULL AND coalesce(v_conv.crm_match_status,'') = v_status THEN
    RETURN 'no_change';
  END IF;

  -- ── UPDATE PRIMEIRO, auditoria SO se a linha mudou de verdade ─────────────
  UPDATE public.ai_conversation_index
     SET crm_lead_id = coalesce(v_lead, crm_lead_id),
         crm_source = coalesce(v_src, crm_source),
         crm_match_status = v_status,
         updated_at = now()
   WHERE id = p_conversation_id AND crm_lead_id IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    -- Alguem vinculou entre o lock e o UPDATE (nao deveria acontecer com o
    -- FOR UPDATE acima, mas e a rede de seguranca): nao inventa auditoria e
    -- NAO devolve 'linked'.
    RETURN 'no_change';
  END IF;

  INSERT INTO public.ai_conv_link_audit (
    batch_id, conversation_id, tenant_id,
    crm_lead_id_antes, crm_source_antes, crm_match_status_antes,
    crm_lead_id_depois, crm_source_depois, crm_match_status_depois, evidencia)
  VALUES (p_batch_id, p_conversation_id, p_tenant,
          v_conv.crm_lead_id, v_conv.crm_source, v_conv.crm_match_status,
          v_lead, v_src, v_status, v_evid)
  ;   -- sem ON CONFLICT: lote reutilizado tem de ESTOURAR, nunca ser escondido

  RETURN CASE WHEN v_status = 'ambiguous' THEN 'ambiguous' ELSE 'linked_' || v_src END;
EXCEPTION WHEN OTHERS THEN
  -- Chamada de BACKFILL (lote informado): falha alto. Backfill nunca pode
  -- terminar "ok" escondendo erro numa string de retorno.
  IF p_batch_id IS NOT NULL THEN
    RAISE;
  END IF;
  -- Chamada de GATILHO (sem lote): registra e segue. A escrita operacional que
  -- disparou a reconciliacao NUNCA pode cair por causa do vinculo.
  BEGIN
    INSERT INTO public.ai_conv_index_deadletter (origem, ref, user_id, erro)
    VALUES ('reconcile_link', p_conversation_id::text, p_tenant, left(SQLERRM, 300));
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'reconcile deadletter falhou: %', SQLERRM;
  END;
  RETURN 'error';
END $$;

REVOKE ALL ON FUNCTION public.reconcile_ai_conversation_crm_link(uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_ai_conversation_crm_link(uuid, uuid, uuid, text, uuid) TO service_role;

-- ── SENTIDO B: conversa nasce/muda => procura lead existente (caso Adonias) ──
CREATE OR REPLACE FUNCTION public.ai_conv_index_reconcile_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.crm_lead_id IS NULL AND NEW.ai_line IS TRUE THEN
    PERFORM public.reconcile_ai_conversation_crm_link(
      NEW.user_id, NEW.id, NEW.instance_id, NEW.phone_canonical, NULL);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS ai_conv_index_reconcile_ins ON public.ai_conversation_index;
CREATE TRIGGER ai_conv_index_reconcile_ins
  AFTER INSERT ON public.ai_conversation_index
  FOR EACH ROW EXECUTE FUNCTION public.ai_conv_index_reconcile_trg();

DROP TRIGGER IF EXISTS ai_conv_index_reconcile_upd ON public.ai_conversation_index;
CREATE TRIGGER ai_conv_index_reconcile_upd
  AFTER UPDATE OF instance_id, phone_canonical ON public.ai_conversation_index
  FOR EACH ROW
  WHEN (NEW.crm_lead_id IS NULL
        AND (NEW.instance_id IS DISTINCT FROM OLD.instance_id
             OR NEW.phone_canonical IS DISTINCT FROM OLD.phone_canonical))
  EXECUTE FUNCTION public.ai_conv_index_reconcile_trg();

-- ── SENTIDO A: lead nasce/muda => reconcilia orfas do tenant (DELEGANDO) ─────
-- Os gatilhos antigos tinham logica propria de vinculo e concorriam com a nova.
-- Agora eles so preservam o que e responsabilidade deles (adocao de instancia no
-- Pedro) e DELEGAM a decisao de vinculo para a funcao canonica.
CREATE OR REPLACE FUNCTION public.ai_conv_index_link_pedro_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_canon text; r record;
BEGIN
  BEGIN
    v_canon := public.logos_phone_canonical(split_part(NEW.remote_jid, '@', 1));
    IF v_canon IS NULL OR NOT public.logos_phone_plausible(v_canon) THEN RETURN NULL; END IF;
    PERFORM public.ai_conv_index_lock(NEW.user_id, v_canon);

    -- Responsabilidade propria: adotar a identidade orfa para a instancia do lead.
    IF NEW.instance_id IS NOT NULL THEN
      PERFORM public.ai_conv_index_adopt_instance(NEW.user_id, v_canon, NEW.instance_id, NEW.agent_id);
    END IF;

    FOR r IN
      SELECT c.id, c.instance_id, c.phone_canonical FROM public.ai_conversation_index c
       WHERE c.user_id = NEW.user_id AND c.phone_canonical = v_canon
         AND c.crm_lead_id IS NULL AND c.ai_line IS TRUE
    LOOP
      PERFORM public.reconcile_ai_conversation_crm_link(
        NEW.user_id, r.id, r.instance_id, r.phone_canonical, NULL);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.ai_conv_index_deadletter (origem, ref, user_id, erro)
      VALUES ('link_pedro', NEW.id::text, NEW.user_id, left(SQLERRM, 300));
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'deadletter falhou: %', SQLERRM;
    END;
  END;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.ai_conv_index_link_marcos_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_canon text; r record;
BEGIN
  BEGIN
    v_canon := public.logos_phone_canonical(NEW.phone);
    IF v_canon IS NULL OR NOT public.logos_phone_plausible(v_canon) THEN RETURN NULL; END IF;
    PERFORM public.ai_conv_index_lock(NEW.user_id, v_canon);

    FOR r IN
      SELECT c.id, c.instance_id, c.phone_canonical FROM public.ai_conversation_index c
       WHERE c.user_id = NEW.user_id AND c.phone_canonical = v_canon
         AND c.crm_lead_id IS NULL AND c.ai_line IS TRUE
    LOOP
      PERFORM public.reconcile_ai_conversation_crm_link(
        NEW.user_id, r.id, r.instance_id, r.phone_canonical, NULL);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.ai_conv_index_deadletter (origem, ref, user_id, erro)
      VALUES ('link_marcos', NEW.id::text, NEW.user_id, left(SQLERRM, 300));
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'deadletter falhou: %', SQLERRM;
    END;
  END;
  RETURN NULL;
END $$;

-- Lead que MUDA telefone/instancia tambem reconcilia (mesma funcao dos INSERTs).
DROP TRIGGER IF EXISTS ai_conv_index_link_pedro_upd ON public.ai_crm_leads;
CREATE TRIGGER ai_conv_index_link_pedro_upd
  AFTER UPDATE OF remote_jid, instance_id ON public.ai_crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.ai_conv_index_link_pedro_lead();

DROP TRIGGER IF EXISTS ai_conv_index_link_marcos_upd ON public.crm_leads;
CREATE TRIGGER ai_conv_index_link_marcos_upd
  AFTER UPDATE OF phone ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.ai_conv_index_link_marcos_lead();

-- ── INDICES DE EXPRESSAO (hoje NAO existe nenhum; toda busca era seq scan) ───
CREATE INDEX IF NOT EXISTS ai_crm_leads_tenant_canon_idx
  ON public.ai_crm_leads (user_id, (public.logos_phone_canonical(remote_jid)), instance_id);
CREATE INDEX IF NOT EXISTS crm_leads_tenant_canon_idx
  ON public.crm_leads (user_id, (public.logos_phone_canonical(phone)));

-- ── BACKFILL controlado (dry-run NAO escreve nada) ──────────────────────────
CREATE OR REPLACE FUNCTION public.reconcile_ai_conversations_backfill(
  p_tenant uuid,
  p_batch_id uuid DEFAULT NULL,        -- NULL = dry-run (nao exige lote)
  p_token uuid DEFAULT NULL,
  p_dry_run boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r record; v_res text; v_b public.ai_conv_link_batches%ROWTYPE;
  v_p int := 0; v_m int := 0; v_amb int := 0; v_orf int := 0; v_legado int := 0;
  v_erro text;
BEGIN
  SELECT count(*) INTO v_legado FROM public.ai_conversation_index c
   WHERE c.crm_lead_id IS NULL AND c.ai_line IS NULL
     AND (p_tenant IS NULL OR c.user_id = p_tenant);

  -- DRY-RUN: nao exige lote e NAO escreve absolutamente nada.
  IF p_dry_run THEN
    FOR r IN
      SELECT c.id, c.user_id, c.instance_id, c.phone_canonical
        FROM public.ai_conversation_index c
       WHERE c.crm_lead_id IS NULL AND c.ai_line IS TRUE
         AND (p_tenant IS NULL OR c.user_id = p_tenant)
    LOOP
      SELECT CASE
        WHEN (SELECT count(*) FROM public.ai_crm_leads l WHERE l.user_id=r.user_id
                AND r.instance_id IS NOT NULL AND l.instance_id=r.instance_id
                AND public.logos_phone_canonical(l.remote_jid)=r.phone_canonical) = 1 THEN 'linked_pedro'
        WHEN (SELECT count(*) FROM public.ai_crm_leads l WHERE l.user_id=r.user_id
                AND r.instance_id IS NOT NULL AND l.instance_id=r.instance_id
                AND public.logos_phone_canonical(l.remote_jid)=r.phone_canonical) > 1 THEN 'ambiguous'
        WHEN ((SELECT count(*) FROM public.ai_crm_leads l WHERE l.user_id=r.user_id
                 AND public.logos_phone_canonical(l.remote_jid)=r.phone_canonical)
            + (SELECT count(*) FROM public.crm_leads m WHERE m.user_id=r.user_id
                 AND public.logos_phone_canonical(m.phone)=r.phone_canonical)) = 1
          THEN CASE WHEN (SELECT count(*) FROM public.ai_crm_leads l WHERE l.user_id=r.user_id
                            AND public.logos_phone_canonical(l.remote_jid)=r.phone_canonical) = 1
                    THEN 'linked_pedro' ELSE 'linked_marcos' END
        WHEN ((SELECT count(*) FROM public.ai_crm_leads l WHERE l.user_id=r.user_id
                 AND public.logos_phone_canonical(l.remote_jid)=r.phone_canonical)
            + (SELECT count(*) FROM public.crm_leads m WHERE m.user_id=r.user_id
                 AND public.logos_phone_canonical(m.phone)=r.phone_canonical)) > 1 THEN 'ambiguous'
        ELSE 'orphan' END INTO v_res;
      IF    v_res='linked_pedro'  THEN v_p := v_p+1;
      ELSIF v_res='linked_marcos' THEN v_m := v_m+1;
      ELSIF v_res='ambiguous'     THEN v_amb := v_amb+1;
      ELSE  v_orf := v_orf+1; END IF;
    END LOOP;
    RETURN jsonb_build_object('dry_run', true, 'tenant', p_tenant, 'batch_id', NULL,
      'status','dry_run','vinculadas_pedro',v_p,'vinculadas_marcos',v_m,
      'marcadas_ambiguas',v_amb,'sem_correspondencia',v_orf,
      'legado_ai_line_null_fora_do_automatico', v_legado);
  END IF;

  -- EXECUCAO REAL: exige lote JA REIVINDICADO em transacao anterior.
  IF p_batch_id IS NULL OR p_token IS NULL THEN
    RAISE EXCEPTION 'execucao real exige batch_id + token vindos de claim_ai_conv_link_batch()';
  END IF;

  -- serializa: duas chamadas do MESMO lote nunca processam juntas
  PERFORM pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 77));

  SELECT * INTO v_b FROM public.ai_conv_link_batches WHERE batch_id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lote % nao foi reivindicado', p_batch_id; END IF;
  IF v_b.tenant_id <> p_tenant THEN
    RAISE EXCEPTION 'lote % pertence a outro tenant', p_batch_id; END IF;
  IF v_b.token <> p_token THEN
    RAISE EXCEPTION 'token invalido para o lote %', p_batch_id; END IF;
  IF v_b.status <> 'claimed' THEN
    RAISE EXCEPTION 'lote % ja esta em status %; identificador nunca e reutilizado', p_batch_id, v_b.status; END IF;

  UPDATE public.ai_conv_link_batches
     SET status='running', iniciado_em=now() WHERE batch_id=p_batch_id;

  -- Bloco com EXCEPTION = SAVEPOINT implicito. Se algo estourar aqui dentro,
  -- TODAS as alteracoes em conversas/auditoria deste bloco sao desfeitas, mas a
  -- linha do lote (inserida numa transacao ANTERIOR, ja commitada) permanece —
  -- e o handler grava status='error' de forma persistente. E por isso que a
  -- reivindicacao tem de ser uma chamada separada.
  BEGIN
    FOR r IN
      SELECT c.id, c.user_id, c.instance_id, c.phone_canonical
        FROM public.ai_conversation_index c
       WHERE c.crm_lead_id IS NULL AND c.ai_line IS TRUE AND c.user_id = p_tenant
    LOOP
      v_res := public.reconcile_ai_conversation_crm_link(
                 r.user_id, r.id, r.instance_id, r.phone_canonical, p_batch_id);
      IF    v_res='linked_pedro'  THEN v_p := v_p+1;
      ELSIF v_res='linked_marcos' THEN v_m := v_m+1;
      ELSIF v_res='ambiguous'     THEN v_amb := v_amb+1;
      ELSE  v_orf := v_orf+1; END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    v_erro := left(SQLERRM, 500);
    UPDATE public.ai_conv_link_batches
       SET status='error', erro=v_erro, concluido_em=now() WHERE batch_id=p_batch_id;
    RETURN jsonb_build_object('dry_run', false, 'tenant', p_tenant, 'batch_id', p_batch_id,
      'status','error','erro',v_erro,'vinculadas_pedro',0,'vinculadas_marcos',0,
      'marcadas_ambiguas',0,'sem_correspondencia',0);
  END;

  UPDATE public.ai_conv_link_batches
     SET status='ok', concluido_em=now(),
         vinculadas=v_p+v_m, ambiguas=v_amb, sem_match=v_orf
   WHERE batch_id=p_batch_id;

  RETURN jsonb_build_object('dry_run', false, 'tenant', p_tenant, 'batch_id', p_batch_id,
    'status','ok','vinculadas_pedro',v_p,'vinculadas_marcos',v_m,
    'marcadas_ambiguas',v_amb,'sem_correspondencia',v_orf,
    'legado_ai_line_null_fora_do_automatico', v_legado);
END $$;

REVOKE ALL ON FUNCTION public.reconcile_ai_conversations_backfill(uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_ai_conversations_backfill(uuid, uuid, uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_backfill_rollback(
  p_batch_id uuid, p_tenant uuid          -- tenant OBRIGATORIO: nunca reverter as cegas
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_b public.ai_conv_link_batches%ROWTYPE; v_n int := 0;
BEGIN
  IF p_batch_id IS NULL OR p_tenant IS NULL THEN
    RAISE EXCEPTION 'batch_id e tenant sao obrigatorios para reverter um lote';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 77));

  SELECT * INTO v_b FROM public.ai_conv_link_batches WHERE batch_id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lote % nao existe', p_batch_id; END IF;
  IF v_b.tenant_id <> p_tenant THEN
    RAISE EXCEPTION 'lote % pertence a outro tenant', p_batch_id; END IF;

  -- IDEMPOTENTE: reverter de novo nao altera dado nenhum.
  IF v_b.status = 'rolled_back' THEN
    RETURN jsonb_build_object('batch_id', p_batch_id, 'status','rolled_back',
      'conversas_restauradas', 0, 'nota', 'ja revertido; nada a fazer');
  END IF;

  -- SO lote concluido com sucesso e reversivel.
  --   claimed/running: nao houve conclusao; reverter seria adivinhar.
  --   error: o bloco interno JA desfez conversas e auditoria; o status fica
  --          preservado para diagnostico e nao deve ser sobrescrito.
  IF v_b.status <> 'ok' THEN
    RAISE EXCEPTION 'lote % esta em status % e nao pode ser revertido (somente ok e reversivel)',
      p_batch_id, v_b.status;
  END IF;

  UPDATE public.ai_conversation_index c
     SET crm_lead_id = a.crm_lead_id_antes,
         crm_source = a.crm_source_antes,
         crm_match_status = a.crm_match_status_antes,
         updated_at = now()
    FROM public.ai_conv_link_audit a
   WHERE a.batch_id = p_batch_id AND c.id = a.conversation_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- lote NUNCA e apagado: fica marcado e jamais podera ser executado de novo.
  UPDATE public.ai_conv_link_batches
     SET status='rolled_back', revertido_em=now() WHERE batch_id=p_batch_id;

  RETURN jsonb_build_object('batch_id', p_batch_id, 'status','rolled_back',
    'conversas_restauradas', v_n);
END $$;

REVOKE ALL ON FUNCTION public.reconcile_backfill_rollback(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_backfill_rollback(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.reconcile_ai_conversation_crm_link(uuid, uuid, uuid, text, uuid) IS
  'Unico lugar que decide vinculo conversa<->lead. Evidencia forte = Pedro na mesma instancia (candidato unico). Fora disso, conjunto unificado Pedro+Marcos: 1 vincula, 2+ vira ambiguous sem escolher, 0 segue orphan. Sempre por tenant e telefone canonico; nunca last-8; nunca rouba vinculo; tudo auditado em ai_conv_link_audit.';
