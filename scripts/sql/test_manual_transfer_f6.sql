-- =============================================================================
-- PROVA DE BANCO — Fase 6 (manual_transfer_conversation) — rodada em prod 28/07/2026
-- Transação abortada de propósito no final (RAISE) => NADA persiste.
-- Resultado real 28/07:
--   T1 created=true paused=true pause_reason=transferencia_manual_no_painel
--      followup_nulls=true linked=linked/true
--   T2 same_lead=true created=false lead_count=1
--   T3 ambigua_ok=true leads_ainda=2
--   T4 vendedor_barrado=true
--   T5 cross_tenant_barrado=true
--   T6 created=false paused_agora=true nome=Ja Existia
-- Cobertura: criação atômica a partir de conversa órfã; idempotência do clique
-- repetido; ambiguidade => exceção explícita sem escolha silenciosa; vendedor
-- comum barrado; isolamento entre tenants; lead existente volta a pausado.
-- Nenhum follow-up possível: lead criado tem last_agent_reply_at,
-- last_user_reply_at e next_followup_at NULL (fora de todos os seletores do
-- cron-lead-followup, que ainda exige assigned_to_id IS NULL).
-- =============================================================================
DO $$
DECLARE
  v_icom uuid := 'f49fd48a-4386-4009-95f3-26a5100b84f7';
  v_monaco uuid := 'cf55ad47-4261-4a9c-8e3c-751c3f022b86';
  v_seller uuid := 'fbbc1346-a200-4090-9df7-5fa21b6c2814';
  v_agent uuid; v_inst uuid;
  v_conv1 uuid; v_conv2 uuid; v_conv3 uuid;
  v_r1 jsonb; v_r2 jsonb; v_r6 jsonb;
  v_lead record; v_n int;
  v_log text := '';
BEGIN
  SELECT id INTO v_agent FROM wa_ai_agents WHERE user_id = v_icom LIMIT 1;
  SELECT id INTO v_inst FROM wa_instances WHERE user_id = v_icom AND seller_member_id IS NULL LIMIT 1;

  INSERT INTO ai_conversation_index (user_id, instance_id, agent_id, phone_canonical, phone_raw, contact_name, last_message, last_message_at, message_count, origem)
  VALUES (v_icom, v_inst, v_agent, '5512980003331', '5512980003331', 'Teste F6 Orfa', 'oi, quero saber do consorcio', now(), 4, 'v3')
  RETURNING id INTO v_conv1;

  INSERT INTO ai_crm_leads (user_id, agent_id, remote_jid, lead_name) VALUES (v_icom, v_agent, '5512980003332', 'Dup A');
  INSERT INTO ai_crm_leads (user_id, agent_id, remote_jid, lead_name) VALUES (v_icom, v_agent, '12980003332', 'Dup B');
  INSERT INTO ai_conversation_index (user_id, instance_id, phone_canonical, contact_name, last_message_at, origem)
  VALUES (v_icom, NULL, '5512980003332', 'Teste F6 Ambigua', now(), 'v3')
  RETURNING id INTO v_conv2;

  INSERT INTO ai_crm_leads (user_id, agent_id, remote_jid, lead_name, ai_paused) VALUES (v_icom, v_agent, '5512980003333', 'Ja Existia', false);
  INSERT INTO ai_conversation_index (user_id, instance_id, phone_canonical, contact_name, last_message_at, origem, crm_lead_id, crm_source, crm_match_status)
  SELECT v_icom, v_inst, '5512980003333', 'Ja Existia', now(), 'webhook', l.id, 'pedro', 'linked'
  FROM ai_crm_leads l WHERE l.user_id=v_icom AND l.remote_jid='5512980003333'
  RETURNING id INTO v_conv3;

  -- T1: master Icom cria lead a partir da orfa
  EXECUTE 'SET LOCAL request.jwt.claims = ''{"sub":"' || v_icom || '","role":"authenticated"}''';
  v_r1 := manual_transfer_conversation(v_conv1, 'teste F6');
  SELECT * INTO v_lead FROM ai_crm_leads WHERE id = (v_r1->>'lead_id')::uuid;
  v_log := v_log || 'T1 created=' || (v_r1->>'created')
    || ' paused=' || v_lead.ai_paused
    || ' pause_reason=' || coalesce(v_lead.pause_reason,'?')
    || ' followup_nulls=' || (v_lead.last_agent_reply_at IS NULL AND v_lead.last_user_reply_at IS NULL AND v_lead.next_followup_at IS NULL)
    || ' linked=' || (SELECT crm_match_status || '/' || (crm_lead_id = v_lead.id) FROM ai_conversation_index WHERE crm_lead_id = v_lead.id AND user_id=v_icom LIMIT 1);

  -- T2: idempotencia (mesmo clique de novo)
  v_r2 := manual_transfer_conversation(v_conv1, 'teste F6 repetido');
  SELECT count(*) INTO v_n FROM ai_crm_leads WHERE user_id=v_icom AND logos_phone_canonical(remote_jid)='5512980003331';
  v_log := v_log || ' | T2 same_lead=' || ((v_r1->>'lead_id') = (v_r2->>'lead_id')) || ' created=' || (v_r2->>'created') || ' lead_count=' || v_n;

  -- T3: ambiguidade => excecao explicita, nada criado
  BEGIN
    PERFORM manual_transfer_conversation(v_conv2, NULL);
    v_log := v_log || ' | T3 FALHOU_sem_excecao';
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || ' | T3 ambigua_ok=' || (SQLERRM LIKE 'AMBIGUO%');
  END;
  SELECT count(*) INTO v_n FROM ai_crm_leads WHERE user_id=v_icom AND logos_phone_canonical(remote_jid)='5512980003332';
  v_log := v_log || ' leads_ainda=' || v_n;

  -- T4: vendedor comum barrado
  EXECUTE 'SET LOCAL request.jwt.claims = ''{"sub":"' || v_seller || '","role":"authenticated"}''';
  BEGIN
    PERFORM manual_transfer_conversation(v_conv1, NULL);
    v_log := v_log || ' | T4 FALHOU_vendedor_passou';
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || ' | T4 vendedor_barrado=' || (SQLERRM LIKE 'sem permissao%');
  END;

  -- T5: outro tenant nao acessa
  EXECUTE 'SET LOCAL request.jwt.claims = ''{"sub":"' || v_monaco || '","role":"authenticated"}''';
  BEGIN
    PERFORM manual_transfer_conversation(v_conv1, NULL);
    v_log := v_log || ' | T5 FALHOU_cross_tenant';
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || ' | T5 cross_tenant_barrado=' || (SQLERRM LIKE '%nao encontrada%');
  END;

  -- T6: lead existente despausado volta a pausado (IA permanece pausada)
  EXECUTE 'SET LOCAL request.jwt.claims = ''{"sub":"' || v_icom || '","role":"authenticated"}''';
  v_r6 := manual_transfer_conversation(v_conv3, NULL);
  SELECT * INTO v_lead FROM ai_crm_leads WHERE id = (v_r6->>'lead_id')::uuid;
  v_log := v_log || ' | T6 created=' || (v_r6->>'created') || ' paused_agora=' || v_lead.ai_paused || ' nome=' || v_lead.lead_name;

  RAISE EXCEPTION 'TESTES_F6 >> % << ROLLBACK', v_log;
END $$;
