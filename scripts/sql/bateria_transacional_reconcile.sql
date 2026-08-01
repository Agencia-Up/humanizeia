-- ============================================================================
-- BATERIA TRANSACIONAL — vinculo conversa<->lead (caso Adonias)
-- Contrato NOVO: claim_ai_conv_link_batch / backfill(tenant,batch,token,dry) /
--                reconcile_backfill_rollback(batch, tenant)
--
-- TODO resultado esperado e ASSERTION DURA (RAISE EXCEPTION). Com ON_ERROR_STOP
-- o script morre na primeira divergencia — nao existe caminho em que ele "passa"
-- com resultado errado.
--
-- LIMITE HONESTO desta bateria, declarado no proprio arquivo:
--   dentro de BEGIN/ROLLBACK, o claim e a execucao ficam na MESMA transacao.
--   Logo, aqui NAO se prova a durabilidade do claim entre transacoes (a garantia
--   de "id queimado mesmo se a transacao inteira abortar"), nem concorrencia
--   real com duas sessoes. Ambas exigem a migration aplicada de verdade e ficam
--   para a etapa seguinte. O que ESTA provado aqui e a maquina de estados, o
--   gate de token/tenant/status e o comportamento do savepoint interno.
--
-- Tudo entre BEGIN/ROLLBACK. Sem backfill global, sem mensagem, sem Edge
-- Function, sem chamada externa. Somente tenant Icom / caso Adonias.
-- ============================================================================
\set ON_ERROR_STOP on

-- ── PARTE 0: RETRATO ANTES (TEMP TABLE, sobrevive ao ROLLBACK) ─────────────
CREATE TEMP TABLE _snap_reconcile (chave text PRIMARY KEY, valor text) ON COMMIT PRESERVE ROWS;

INSERT INTO _snap_reconcile (chave, valor)
SELECT 'fn:' || p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('ai_conv_index_link_pedro_lead','ai_conv_index_link_marcos_lead')
UNION ALL
SELECT 'trg:' || c.relname || '.' || t.tgname, md5(pg_get_triggerdef(t.oid))
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 WHERE NOT t.tgisinternal AND t.tgname IN ('ai_conv_index_link_pedro_trg','ai_conv_index_link_marcos_trg')
UNION ALL SELECT 'cnt:conv',   count(*)::text FROM public.ai_conversation_index
UNION ALL SELECT 'cnt:pedro',  count(*)::text FROM public.ai_crm_leads
UNION ALL SELECT 'cnt:marcos', count(*)::text FROM public.crm_leads
UNION ALL SELECT 'cnt:orfas_icom', count(*)::text FROM public.ai_conversation_index
   WHERE user_id='f49fd48a-4386-4009-95f3-26a5100b84f7' AND crm_lead_id IS NULL AND ai_line IS TRUE
UNION ALL SELECT 'adonias', coalesce(crm_lead_id::text,'NULL')||'|'||coalesce(crm_source,'NULL')||'|'||coalesce(crm_match_status,'NULL')
  FROM public.ai_conversation_index WHERE id='93cb529b-a89d-4b86-bf96-6a7d2df11394';

DO $$ BEGIN
  IF (SELECT count(*) FROM _snap_reconcile WHERE chave LIKE 'fn:%')  <> 2 THEN RAISE EXCEPTION 'A0 FALHOU: retrato sem as 2 funcoes preexistentes'; END IF;
  IF (SELECT count(*) FROM _snap_reconcile WHERE chave LIKE 'trg:%') <> 2 THEN RAISE EXCEPTION 'A0 FALHOU: retrato sem os 2 gatilhos preexistentes'; END IF;
END $$;

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

-- ── PARTE 1: MIGRATION COMPLETA ────────────────────────────────────────────
\i supabase/migrations/20260731180000_reconcile_conversa_lead_bidirecional.sql

-- ── PARTE 2: CASO ADONIAS (A1-A4) ──────────────────────────────────────────
DO $$
DECLARE r text; v record;
BEGIN
  r := public.reconcile_ai_conversation_crm_link(
        'f49fd48a-4386-4009-95f3-26a5100b84f7'::uuid,'93cb529b-a89d-4b86-bf96-6a7d2df11394'::uuid);
  IF r <> 'linked_pedro' THEN RAISE EXCEPTION 'A1 FALHOU: reconcile devolveu %', r; END IF;
  SELECT crm_lead_id, crm_source, crm_match_status INTO v
    FROM public.ai_conversation_index WHERE id='93cb529b-a89d-4b86-bf96-6a7d2df11394';
  IF v.crm_lead_id <> '018ae8af-6b68-48cf-bc1b-9ac5b6d01ac6' THEN RAISE EXCEPTION 'A2 FALHOU: lead %', v.crm_lead_id; END IF;
  IF v.crm_source <> 'pedro'  THEN RAISE EXCEPTION 'A3 FALHOU: source %', v.crm_source; END IF;
  IF v.crm_match_status <> 'linked' THEN RAISE EXCEPTION 'A4 FALHOU: status %', v.crm_match_status; END IF;
  RAISE NOTICE 'A1-A4 ok';
END $$;

-- ── PARTE 3: VISIBILIDADE (A5-A9) ──────────────────────────────────────────
DO $$
DECLARE
  v_icom uuid := 'f49fd48a-4386-4009-95f3-26a5100b84f7';
  v_monaco uuid := 'cf55ad47-4261-4a9c-8e3c-751c3f022b86';
  v_joao uuid := 'f621e6e6-69e2-4f8b-a92c-ca9cd4b1a55c';
  v_outro uuid; n int; c_id uuid := '93cb529b-a89d-4b86-bf96-6a7d2df11394';
BEGIN
  SELECT m.auth_user_id INTO v_outro FROM public.ai_team_members m
   WHERE m.user_id=v_icom AND m.auth_user_id IS NOT NULL AND m.auth_user_id<>v_joao
     AND coalesce(m.is_manager,false)=false AND m.removed_at IS NULL LIMIT 1;
  IF v_outro IS NULL THEN RAISE EXCEPTION 'A5 FALHOU: sem outro vendedor da Icom para testar'; END IF;

  SET LOCAL row_security = on;
  SET LOCAL role authenticated;
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub',v_joao,'role','authenticated')::text);
  SELECT count(*) INTO n FROM public.get_ai_conversations_v2(200,NULL,NULL) g WHERE g.conversation_id=c_id;
  IF n <> 1 THEN RAISE EXCEPTION 'A6 FALHOU: Joao deveria ver 1, viu %', n; END IF;

  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub',v_outro,'role','authenticated')::text);
  SELECT count(*) INTO n FROM public.get_ai_conversations_v2(200,NULL,NULL) g WHERE g.conversation_id=c_id;
  IF n <> 0 THEN RAISE EXCEPTION 'A7 FALHOU: outro vendedor deveria ver 0, viu %', n; END IF;

  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub',v_icom,'role','authenticated')::text);
  SELECT count(*) INTO n FROM public.get_ai_conversations_v2(200,NULL,NULL) g WHERE g.conversation_id=c_id;
  IF n <> 1 THEN RAISE EXCEPTION 'A8 FALHOU: master deveria ver 1, viu %', n; END IF;

  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub',v_monaco,'role','authenticated')::text);
  SELECT count(*) INTO n FROM public.get_ai_conversations_v2(200,NULL,NULL) g WHERE g.conversation_id=c_id;
  IF n <> 0 THEN RAISE EXCEPTION 'A9 FALHOU: outro tenant deveria ver 0, viu %', n; END IF;

  RESET role;
  RAISE NOTICE 'A5-A9 ok';
END $$;

-- ── PARTE 4: REGRAS DE VINCULO (A10-A16) ───────────────────────────────────
DO $$
DECLARE
  v_icom uuid := 'f49fd48a-4386-4009-95f3-26a5100b84f7';
  v_inst uuid; v_agent uuid; c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; l1 uuid; r text; st text;
BEGIN
  SELECT id INTO v_inst  FROM public.wa_instances WHERE user_id=v_icom AND seller_member_id IS NULL LIMIT 1;
  SELECT id INTO v_agent FROM public.wa_ai_agents WHERE user_id=v_icom LIMIT 1;

  -- A10: 2 candidatos (Pedro+Marcos). O gatilho AFTER INSERT ja reconcilia a
  -- conversa nova: verificamos o ESTADO FINAL (ambiguous, sem escolher candidato).
  INSERT INTO public.ai_crm_leads (user_id,agent_id,remote_jid,lead_name) VALUES (v_icom,v_agent,'5512970001111','A');
  INSERT INTO public.crm_leads (user_id,name,phone) VALUES (v_icom,'B','5512970001111');
  INSERT INTO public.ai_conversation_index (user_id,instance_id,phone_canonical,last_message_at,origem,ai_line)
    VALUES (v_icom,NULL,'5512970001111',now(),'v3',true) RETURNING id INTO c1;
  SELECT crm_match_status INTO st FROM public.ai_conversation_index WHERE id=c1;
  IF st <> 'ambiguous' THEN RAISE EXCEPTION 'A10 FALHOU: pedro+marcos deixou a conversa em %, esperado ambiguous', st; END IF;
  SELECT crm_lead_id::text INTO st FROM public.ai_conversation_index WHERE id=c1;
  IF st IS NOT NULL THEN RAISE EXCEPTION 'A10b FALHOU: ambiguidade escolheu candidato (%)', st; END IF;

  -- A11: lead cadastrado SEM 55; conversa com o canonico. O gatilho reconcilia no
  -- INSERT via evidencia forte (mesma instancia) => linked_pedro. Verifica estado.
  INSERT INTO public.ai_crm_leads (user_id,agent_id,instance_id,remote_jid,lead_name)
    VALUES (v_icom,v_agent,v_inst,'12970002222','SemDDI') RETURNING id INTO l1;
  INSERT INTO public.ai_conversation_index (user_id,instance_id,phone_canonical,last_message_at,origem,ai_line)
    VALUES (v_icom,v_inst,'5512970002222',now(),'v3',true) RETURNING id INTO c2;
  SELECT crm_match_status, crm_source INTO st, r FROM public.ai_conversation_index WHERE id=c2;
  IF st <> 'linked' OR r <> 'pedro' THEN RAISE EXCEPTION 'A11 FALHOU: canonico sem 55 deu estado=%/fonte=%', st, r; END IF;

  -- A12: reexecucao manual sobre conversa ja vinculada e idempotente e NAO rouba.
  r := public.reconcile_ai_conversation_crm_link(v_icom,c2);
  IF r <> 'already_linked' THEN RAISE EXCEPTION 'A12 FALHOU: reexecucao deu %', r; END IF;

  INSERT INTO public.ai_conversation_index (user_id,instance_id,phone_canonical,last_message_at,origem,ai_line)
    VALUES (v_icom,v_inst,'5512970003333',now(),'v3',true) RETURNING id INTO c3;
  INSERT INTO public.ai_crm_leads (user_id,agent_id,instance_id,remote_jid,lead_name)
    VALUES (v_icom,v_agent,v_inst,'5512970003333','LeadDepois');
  SELECT crm_match_status INTO st FROM public.ai_conversation_index WHERE id=c3;
  IF st <> 'linked' THEN RAISE EXCEPTION 'A13 FALHOU: lead depois da conversa deu %', st; END IF;

  INSERT INTO public.ai_conversation_index (user_id,instance_id,phone_canonical,last_message_at,origem,ai_line)
    VALUES (v_icom,v_inst,'5512970004444',now(),'v3',true) RETURNING id INTO c4;
  UPDATE public.ai_crm_leads SET remote_jid='5512970004444' WHERE id=l1;
  SELECT crm_match_status INTO st FROM public.ai_conversation_index WHERE id=c4;
  IF st <> 'linked' THEN RAISE EXCEPTION 'A14 FALHOU: update de telefone deu %', st; END IF;

  r := public.reconcile_ai_conversation_crm_link(v_icom, c1, NULL, '5512970009999');
  IF r <> 'retry_required' THEN RAISE EXCEPTION 'A15 FALHOU: telefone divergente deu %', r; END IF;

  INSERT INTO public.ai_conversation_index (user_id,instance_id,phone_canonical,last_message_at,origem,ai_line)
    VALUES (v_icom,v_inst,'5512970005555',now(),'v3',false) RETURNING id INTO c5;
  r := public.reconcile_ai_conversation_crm_link(v_icom,c5);
  IF r <> 'skipped' THEN RAISE EXCEPTION 'A16 FALHOU: ai_line=false deu %', r; END IF;

  RAISE NOTICE 'A10-A16 ok';
END $$;

-- ── PARTE 5: CICLO DE VIDA DO LOTE (A17-A24) ───────────────────────────────
DO $$
DECLARE
  v_icom uuid := 'f49fd48a-4386-4009-95f3-26a5100b84f7';
  v_vazio uuid := '00000000-0000-0000-0000-000000000000';
  b uuid; tk uuid; st text; r jsonb; falhou boolean;
BEGIN
  -- A17: claim cria lote em 'claimed'
  SELECT batch_id, token INTO b, tk FROM public.claim_ai_conv_link_batch(v_vazio);
  SELECT status INTO st FROM public.ai_conv_link_batches WHERE batch_id=b;
  IF st <> 'claimed' THEN RAISE EXCEPTION 'A17 FALHOU: claim criou status %', st; END IF;

  -- A18: token errado recusado
  falhou := false;
  BEGIN PERFORM public.reconcile_ai_conversations_backfill(v_vazio, b, gen_random_uuid(), false);
  EXCEPTION WHEN OTHERS THEN falhou := true; END;
  IF NOT falhou THEN RAISE EXCEPTION 'A18 FALHOU: token errado foi aceito'; END IF;

  -- A19: tenant diferente recusado
  falhou := false;
  BEGIN PERFORM public.reconcile_ai_conversations_backfill(v_icom, b, tk, false);
  EXCEPTION WHEN OTHERS THEN falhou := true; END;
  IF NOT falhou THEN RAISE EXCEPTION 'A19 FALHOU: tenant alheio foi aceito'; END IF;

  -- A20: execucao correta => lote vazio termina 'ok'
  r := public.reconcile_ai_conversations_backfill(v_vazio, b, tk, false);
  IF r->>'status' <> 'ok' THEN RAISE EXCEPTION 'A20 FALHOU: retorno %', r->>'status'; END IF;
  SELECT status INTO st FROM public.ai_conv_link_batches WHERE batch_id=b;
  IF st <> 'ok' THEN RAISE EXCEPTION 'A20b FALHOU: lote ficou em %', st; END IF;
  IF (SELECT iniciado_em IS NULL FROM public.ai_conv_link_batches WHERE batch_id=b)
  THEN RAISE EXCEPTION 'A20c FALHOU: claimed->running->ok nao registrou iniciado_em'; END IF;

  -- A21: lote concluido NAO pode ser reutilizado
  falhou := false;
  BEGIN PERFORM public.reconcile_ai_conversations_backfill(v_vazio, b, tk, false);
  EXCEPTION WHEN OTHERS THEN falhou := true; END;
  IF NOT falhou THEN RAISE EXCEPTION 'A21 FALHOU: lote ok foi reutilizado'; END IF;

  -- A22/A23: rollback de lote 'ok' marca rolled_back; segundo rollback e idempotente
  r := public.reconcile_backfill_rollback(b, v_vazio);
  IF r->>'status' <> 'rolled_back' THEN RAISE EXCEPTION 'A22 FALHOU: %', r->>'status'; END IF;
  r := public.reconcile_backfill_rollback(b, v_vazio);
  IF (r->>'conversas_restauradas')::int <> 0 THEN RAISE EXCEPTION 'A23 FALHOU: 2o rollback alterou dados'; END IF;

  -- A24: rollback com tenant errado recusado
  falhou := false;
  BEGIN PERFORM public.reconcile_backfill_rollback(b, v_icom);
  EXCEPTION WHEN OTHERS THEN falhou := true; END;
  IF NOT falhou THEN RAISE EXCEPTION 'A24 FALHOU: rollback de lote alheio foi aceito'; END IF;

  RAISE NOTICE 'A17-A24 ok';
END $$;

-- ── PARTE 6: FALHA CONTROLADA (A25-A29) ────────────────────────────────────
-- COMO A FALHA E PROVOCADA: um CHECK impossivel em ai_conv_link_audit, criado
-- com NOT VALID. O NOT VALID e obrigatorio: as partes A1-A16 JA gravaram linhas
-- de auditoria, e um CHECK(false) validado estouraria no proprio ALTER TABLE —
-- com ON_ERROR_STOP a bateria morreria ANTES de chamar o backfill, e A25-A29
-- nunca testariam nada. Com NOT VALID as linhas antigas sao ignoradas e o CHECK
-- passa a barrar apenas INSERTs NOVOS: o erro nasce onde precisamos, no meio do
-- processamento, DEPOIS de um UPDATE real e durante o INSERT da auditoria.
--
-- SOBRE O QUE A26 PROVA (e o que nao prova): aqui claim e execucao estao na
-- MESMA transacao externa, entao esta assertion prova que o lote permanece em
-- 'error' apos o rollback do SAVEPOINT INTERNO. Ela NAO prova durabilidade
-- entre transacoes commitadas — isso exige a migration aplicada e esta na lista
-- de testes obrigatorios da etapa seguinte.
-- snapshot campo a campo do tenant, ANTES da falha (fora do bloco DO)
DROP TABLE IF EXISTS _snap_icom_antes;
CREATE TEMP TABLE _snap_icom_antes AS
  SELECT id, crm_lead_id, crm_source, crm_match_status
    FROM public.ai_conversation_index
   WHERE user_id='f49fd48a-4386-4009-95f3-26a5100b84f7';

DO $$
DECLARE
  v_icom uuid := 'f49fd48a-4386-4009-95f3-26a5100b84f7';
  b uuid; tk uuid; st text; err text; r jsonb; falhou boolean;
  elegiveis int; divergentes int;
BEGIN
  -- PRE-CONDICAO (A24b): tem de existir pelo menos UMA conversa que o backfill
  -- realmente VAI ALTERAR. Nao basta ter candidato: uma conversa que ja esta
  -- 'ambiguous' retornaria 'no_change' (sem INSERT na auditoria, sem disparar o
  -- CHECK). Entao exigimos candidato E estado ainda mutavel:
  --   1 candidato + status <> 'linked'      => vira 'linked'    (INSERT auditoria)
  --   2+ candidatos + status <> 'ambiguous' => vira 'ambiguous' (INSERT auditoria)
  SELECT count(*) INTO elegiveis
    FROM (
      SELECT c.crm_match_status AS stt,
        (SELECT count(*) FROM public.ai_crm_leads l WHERE l.user_id=c.user_id
           AND public.logos_phone_canonical(l.remote_jid)=c.phone_canonical)
      + (SELECT count(*) FROM public.crm_leads m WHERE m.user_id=c.user_id
           AND public.logos_phone_canonical(m.phone)=c.phone_canonical) AS cand
      FROM public.ai_conversation_index c
      WHERE c.user_id=v_icom AND c.crm_lead_id IS NULL AND c.ai_line IS TRUE
    ) x
   WHERE (cand = 1 AND coalesce(stt,'') <> 'linked')
      OR (cand >= 2 AND coalesce(stt,'') <> 'ambiguous');
  IF elegiveis = 0 THEN
    RAISE EXCEPTION 'A24b FALHOU (pre-condicao): nenhuma conversa da Icom sofreria ALTERACAO real (todas ja no estado final ou sem candidato); o backfill nao gravaria auditoria e A25-A29 nao testariam nada';
  END IF;
  RAISE NOTICE 'A24b ok: % conversa(s) mudariam de estado — o backfill VAI tentar gravar auditoria', elegiveis;

  SELECT batch_id, token INTO b, tk FROM public.claim_ai_conv_link_batch(v_icom);
  -- NOT VALID: ignora as linhas ja existentes, barra os INSERTs novos.
  ALTER TABLE public.ai_conv_link_audit ADD CONSTRAINT _forca_erro CHECK (false) NOT VALID;

  r := public.reconcile_ai_conversations_backfill(v_icom, b, tk, false);

  -- A25: retorno diz 'error' (o chamador NUNCA pode ler isso como sucesso)
  IF r->>'status' <> 'error' THEN RAISE EXCEPTION 'A25 FALHOU: retorno % em vez de error', r->>'status'; END IF;
  IF (r->>'vinculadas_pedro')::int <> 0 OR (r->>'vinculadas_marcos')::int <> 0
  THEN RAISE EXCEPTION 'A25b FALHOU: retorno de erro trouxe contadores de sucesso'; END IF;

  -- A26: lote PERSISTIU em 'error' com a mensagem DA CONSTRAINT (nao qualquer erro)
  SELECT status, erro INTO st, err FROM public.ai_conv_link_batches WHERE batch_id=b;
  IF st <> 'error' THEN RAISE EXCEPTION 'A26 FALHOU: lote ficou em % apos falha', st; END IF;
  -- 23514 = check_violation; e a mensagem cita a constraint _forca_erro. Sem isto,
  -- um erro DIFERENTE (ex.: NULL, deadlock) faria A25-A26 passarem falsamente.
  IF err IS NULL OR position('_forca_erro' IN err) = 0 THEN
    RAISE EXCEPTION 'A26b FALHOU: erro registrado nao veio da constraint _forca_erro: %', coalesce(err,'<null>'); END IF;
  RAISE NOTICE 'A26 ok: lote em error com mensagem da constraint _forca_erro';

  -- A27: NENHUMA alteracao parcial — comparacao CAMPO A CAMPO com o snapshot.
  -- (contar crm_lead_id IS NULL nao pegaria orphan->ambiguous.)
  SELECT count(*) INTO divergentes
    FROM _snap_icom_antes s
    JOIN public.ai_conversation_index c ON c.id = s.id
   WHERE c.crm_lead_id      IS DISTINCT FROM s.crm_lead_id
      OR c.crm_source       IS DISTINCT FROM s.crm_source
      OR c.crm_match_status IS DISTINCT FROM s.crm_match_status;
  IF divergentes <> 0 THEN
    RAISE EXCEPTION 'A27 FALHOU: % conversa(s) da Icom mudaram de estado apos a falha (alteracao parcial)', divergentes; END IF;
  IF (SELECT count(*) FROM public.ai_conv_link_audit WHERE batch_id=b) <> 0
  THEN RAISE EXCEPTION 'A27b FALHOU: auditoria parcial sobrou'; END IF;
  RAISE NOTICE 'A27 ok: nenhuma alteracao parcial (comparacao campo a campo)';

  ALTER TABLE public.ai_conv_link_audit DROP CONSTRAINT _forca_erro;

  -- A28: lote em 'error' NAO pode ser executado de novo
  falhou := false;
  BEGIN PERFORM public.reconcile_ai_conversations_backfill(v_icom, b, tk, false);
  EXCEPTION WHEN OTHERS THEN falhou := true; END;
  IF NOT falhou THEN RAISE EXCEPTION 'A28 FALHOU: lote error foi reexecutado'; END IF;

  -- A29: lote em 'error' NAO e reversivel (status preservado para diagnostico)
  falhou := false;
  BEGIN PERFORM public.reconcile_backfill_rollback(b, v_icom);
  EXCEPTION WHEN OTHERS THEN falhou := true; END;
  IF NOT falhou THEN RAISE EXCEPTION 'A29 FALHOU: rollback aceitou lote em error'; END IF;
  SELECT status INTO st FROM public.ai_conv_link_batches WHERE batch_id=b;
  IF st <> 'error' THEN RAISE EXCEPTION 'A29b FALHOU: status error foi sobrescrito (%)', st; END IF;

  RAISE NOTICE 'A25-A29 ok';
END $$;

-- ── PARTE 7: rollback restaura EXATAMENTE os valores auditados (A30) ───────
DO $$
DECLARE
  v_icom uuid := 'f49fd48a-4386-4009-95f3-26a5100b84f7';
  b uuid; tk uuid; r jsonb; divergentes int;
BEGIN
  SELECT batch_id, token INTO b, tk FROM public.claim_ai_conv_link_batch(v_icom);
  r := public.reconcile_ai_conversations_backfill(v_icom, b, tk, false);
  IF r->>'status' <> 'ok' THEN RAISE EXCEPTION 'A30 FALHOU: backfill deu %', r->>'status'; END IF;

  PERFORM public.reconcile_backfill_rollback(b, v_icom);

  SELECT count(*) INTO divergentes
    FROM public.ai_conv_link_audit a JOIN public.ai_conversation_index c ON c.id=a.conversation_id
   WHERE a.batch_id=b
     AND (c.crm_lead_id IS DISTINCT FROM a.crm_lead_id_antes
       OR c.crm_source IS DISTINCT FROM a.crm_source_antes
       OR c.crm_match_status IS DISTINCT FROM a.crm_match_status_antes);
  IF divergentes <> 0 THEN RAISE EXCEPTION 'A30 FALHOU: % conversa(s) nao voltaram ao valor auditado', divergentes; END IF;
  RAISE NOTICE 'A30 ok: rollback restaurou exatamente os valores auditados';
END $$;

-- ── PARTE 8: EXPLAIN das buscas de candidato ──────────────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT l.id FROM public.ai_crm_leads l
 WHERE l.user_id='f49fd48a-4386-4009-95f3-26a5100b84f7'
   AND public.logos_phone_canonical(l.remote_jid)='5512992442214';

EXPLAIN (ANALYZE, BUFFERS)
SELECT m.id FROM public.crm_leads m
 WHERE m.user_id='f49fd48a-4386-4009-95f3-26a5100b84f7'
   AND public.logos_phone_canonical(m.phone)='5512992442214';

ROLLBACK;
-- ============================================================================

-- ── PARTE 9: PROVA POS-ROLLBACK (B1-B12) ──────────────────────────────────
DO $$
DECLARE n int; d record;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname IN ('reconcile_ai_conversation_crm_link',
     'ai_conv_index_reconcile_trg','reconcile_ai_conversations_backfill',
     'reconcile_backfill_rollback','claim_ai_conv_link_batch');
  IF n <> 0 THEN RAISE EXCEPTION 'B1 FALHOU: % funcao(oes) nova(s) persistiu', n; END IF;

  SELECT count(*) INTO n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   WHERE NOT t.tgisinternal AND (c.relname, t.tgname) IN (
     ('ai_conversation_index','ai_conv_index_reconcile_ins'),
     ('ai_conversation_index','ai_conv_index_reconcile_upd'),
     ('ai_crm_leads','ai_conv_index_link_pedro_upd'),
     ('crm_leads','ai_conv_index_link_marcos_upd'));
  IF n <> 0 THEN RAISE EXCEPTION 'B2 FALHOU: % gatilho(s) novo(s) persistiu', n; END IF;

  SELECT count(*) INTO n FROM pg_indexes WHERE schemaname='public' AND indexname IN
    ('ai_conv_link_audit_batch_idx','ai_conv_link_audit_batch_conv_uq',
     'ai_crm_leads_tenant_canon_idx','crm_leads_tenant_canon_idx');
  IF n <> 0 THEN RAISE EXCEPTION 'B3 FALHOU: % indice(s) novo(s) persistiu', n; END IF;

  SELECT count(*) INTO n FROM information_schema.tables WHERE table_schema='public'
    AND table_name IN ('ai_conv_link_audit','ai_conv_link_batches');
  IF n <> 0 THEN RAISE EXCEPTION 'B4 FALHOU: % tabela(s) nova(s) persistiu', n; END IF;

  FOR d IN SELECT s.chave, s.valor, md5(pg_get_functiondef(p.oid)) AS agora
             FROM _snap_reconcile s JOIN pg_proc p ON ('fn:'||p.oid::regprocedure::text)=s.chave
            WHERE s.chave LIKE 'fn:%'
  LOOP IF d.valor <> d.agora THEN RAISE EXCEPTION 'B5 FALHOU: funcao % mudou', d.chave; END IF; END LOOP;
  IF (SELECT count(*) FROM _snap_reconcile s JOIN pg_proc p
        ON ('fn:'||p.oid::regprocedure::text)=s.chave WHERE s.chave LIKE 'fn:%') <> 2
  THEN RAISE EXCEPTION 'B6 FALHOU: funcao preexistente sumiu'; END IF;

  FOR d IN SELECT s.chave, s.valor, md5(pg_get_triggerdef(t.oid)) AS agora
             FROM _snap_reconcile s JOIN pg_trigger t ON NOT t.tgisinternal
             JOIN pg_class c ON c.oid=t.tgrelid
            WHERE s.chave = 'trg:'||c.relname||'.'||t.tgname
  LOOP IF d.valor <> d.agora THEN RAISE EXCEPTION 'B7 FALHOU: gatilho % mudou', d.chave; END IF; END LOOP;

  IF (SELECT valor FROM _snap_reconcile WHERE chave='cnt:conv') <> (SELECT count(*)::text FROM public.ai_conversation_index)
  THEN RAISE EXCEPTION 'B8 FALHOU: contagem de conversas mudou'; END IF;
  IF (SELECT valor FROM _snap_reconcile WHERE chave='cnt:pedro') <> (SELECT count(*)::text FROM public.ai_crm_leads)
  THEN RAISE EXCEPTION 'B9 FALHOU: contagem de leads Pedro mudou'; END IF;
  IF (SELECT valor FROM _snap_reconcile WHERE chave='cnt:marcos') <> (SELECT count(*)::text FROM public.crm_leads)
  THEN RAISE EXCEPTION 'B10 FALHOU: contagem de leads Marcos mudou'; END IF;
  IF (SELECT valor FROM _snap_reconcile WHERE chave='cnt:orfas_icom') <> (SELECT count(*)::text FROM public.ai_conversation_index
      WHERE user_id='f49fd48a-4386-4009-95f3-26a5100b84f7' AND crm_lead_id IS NULL AND ai_line IS TRUE)
  THEN RAISE EXCEPTION 'B11 FALHOU: orfas da Icom mudaram'; END IF;
  IF (SELECT valor FROM _snap_reconcile WHERE chave='adonias') <> (SELECT coalesce(crm_lead_id::text,'NULL')||'|'||
        coalesce(crm_source,'NULL')||'|'||coalesce(crm_match_status,'NULL')
        FROM public.ai_conversation_index WHERE id='93cb529b-a89d-4b86-bf96-6a7d2df11394')
  THEN RAISE EXCEPTION 'B12 FALHOU: conversa do Adonias ficou alterada'; END IF;

  RAISE NOTICE 'B1-B12 ok: nada novo persistiu, preexistentes identicos, dados intactos';
END $$;
