-- =============================================================================
-- PROVA DE BANCO — Fase 2 (persistPrivateInbound) — rodada em prod 28/07/2026
-- Transação abortada de propósito no final (RAISE) => NADA persiste.
-- Prova: (1) retry com a chave de fallback fb1: viola o índice único REAL
-- wa_inbox_remote_msg_unique (user_id, instance_id, remote_message_id);
-- (2) o MESMO telefone e a MESMA chave em OUTRO tenant/instância inserem
-- normalmente (isolamento por tenant no índice).
-- Resultado 28/07: "PROVA_OK_ROLLBACK" (as duas provas passaram).
-- =============================================================================
DO $$
DECLARE
  v_inst_a uuid; v_inst_b uuid;
  v_dup boolean := false;
BEGIN
  SELECT id INTO v_inst_a FROM wa_instances WHERE user_id='cf55ad47-4261-4a9c-8e3c-751c3f022b86' LIMIT 1; -- Mônaco
  SELECT id INTO v_inst_b FROM wa_instances WHERE user_id='9420eb5d-9022-47f0-b327-c9b3c888dc0a' LIMIT 1; -- WA Veículos

  INSERT INTO wa_inbox (user_id, instance_id, phone, direction, message_type, content, remote_message_id)
  VALUES ('cf55ad47-4261-4a9c-8e3c-751c3f022b86', v_inst_a, '5512980001111', 'incoming', 'text', 'teste-prova', 'fb1:incoming:5512980001111:s1784916000:text:deadbeef');

  BEGIN
    INSERT INTO wa_inbox (user_id, instance_id, phone, direction, message_type, content, remote_message_id)
    VALUES ('cf55ad47-4261-4a9c-8e3c-751c3f022b86', v_inst_a, '5512980001111', 'incoming', 'text', 'teste-prova', 'fb1:incoming:5512980001111:s1784916000:text:deadbeef');
  EXCEPTION WHEN unique_violation THEN
    v_dup := true;
  END;
  IF NOT v_dup THEN RAISE EXCEPTION 'PROVA FALHOU: retry com chave fallback NAO deduplicou'; END IF;

  INSERT INTO wa_inbox (user_id, instance_id, phone, direction, message_type, content, remote_message_id)
  VALUES ('9420eb5d-9022-47f0-b327-c9b3c888dc0a', v_inst_b, '5512980001111', 'incoming', 'text', 'teste-prova', 'fb1:incoming:5512980001111:s1784916000:text:deadbeef');

  RAISE EXCEPTION 'PROVA_OK_ROLLBACK';
END $$;
