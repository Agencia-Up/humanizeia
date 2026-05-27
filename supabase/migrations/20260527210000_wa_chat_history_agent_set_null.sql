-- =============================================================================
-- EXTRA-1 — wa_chat_history.agent_id muda CASCADE → SET NULL
-- =============================================================================
-- Hoje: FK wa_chat_history_agent_id_fkey usa ON DELETE CASCADE.
-- Problema: quando master deleta agente IA, todo o histórico de conversas
-- daquele agente some junto. Pior: se um INSERT chega DEPOIS da deleção
-- (followup atrasado, queue lag), FK violation 23503 ocorre — schedule
-- vira 'failed' e lead perde a mensagem.
--
-- Solução: SET NULL no delete. Histórico de chat preservado (importante
-- pra auditoria + reconstrução de contexto se agente for recriado), agent_id
-- vira NULL nos rows. Próximos INSERTs com agent_id de agente deletado vão
-- continuar falhando — mas o cron de followup já trata FK errors no commit
-- anterior (BUG-NOVO-06: retry exponencial em failed).
--
-- Idempotente.
-- =============================================================================

-- Remove constraint atual (CASCADE)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wa_chat_history_agent_id_fkey'
      AND conrelid = 'public.wa_chat_history'::regclass
  ) THEN
    ALTER TABLE public.wa_chat_history
      DROP CONSTRAINT wa_chat_history_agent_id_fkey;
    RAISE NOTICE '[EXTRA-1] Constraint antiga (CASCADE) removida';
  ELSE
    RAISE NOTICE '[EXTRA-1] Constraint wa_chat_history_agent_id_fkey nao existia (talvez ja recriada)';
  END IF;
END $$;

-- Recria com SET NULL
ALTER TABLE public.wa_chat_history
  ADD CONSTRAINT wa_chat_history_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES public.wa_ai_agents(id)
  ON DELETE SET NULL;

COMMENT ON CONSTRAINT wa_chat_history_agent_id_fkey ON public.wa_chat_history IS
  'SET NULL on delete pra preservar histórico de mensagens quando agente IA é removido. EXTRA-1 da auditoria 27/05/2026.';

-- Confirmação
DO $$
DECLARE v_rule text;
BEGIN
  SELECT rc.delete_rule INTO v_rule
  FROM information_schema.referential_constraints rc
  WHERE rc.constraint_name = 'wa_chat_history_agent_id_fkey';
  RAISE NOTICE '[EXTRA-1] delete_rule agora: %', COALESCE(v_rule, 'NAO ENCONTRADA');
END $$;
