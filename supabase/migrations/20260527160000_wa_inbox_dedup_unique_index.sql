-- =============================================================================
-- BUG-NOVO-01 — Race condition em wa_inbox permite IA responder 2x
-- =============================================================================
-- Hoje uazapi-webhook e wa-inbox-webhook fazem SELECT-then-INSERT pra dedup
-- por remote_message_id. Quando UazAPI repete o mesmo evento (retry de
-- entrega), ambos os webhooks podem ver "lead não existe ainda" no SELECT
-- (race), e ambos INSERT, e a IA processa 2x — cliente recebe 2 respostas
-- idênticas.
--
-- Solução: UNIQUE INDEX em (user_id, instance_id, remote_message_id) pra
-- garantir dedup ATÔMICA no banco. Inserts subsequentes do mesmo
-- remote_message_id falharão (ou no-op se usar ON CONFLICT DO NOTHING no
-- código — vai ser feito em commit separado nos handlers).
--
-- Por que essas 3 colunas:
--   - user_id: leads de masters diferentes podem ter mesmo remote_message_id
--   - instance_id: 2 instâncias do mesmo master podem ter conversas com mesmo
--     número, gerando mesmo remote_message_id em paralelo
--   - remote_message_id: identificador UazAPI da mensagem
--
-- WHERE remote_message_id IS NOT NULL: mensagens locais (manuais via UI)
-- podem não ter ID externo — não bloqueia esses inserts.
--
-- Idempotente — IF NOT EXISTS.
-- =============================================================================

-- Sanity check: rows existentes com duplicatas conhecidas. Se houver, a
-- criação do índice vai FALHAR e precisamos limpar antes. Vamos rodar uma
-- consulta diagnóstica primeiro (não bloqueante).
DO $$
DECLARE v_dups int;
BEGIN
  SELECT COUNT(*) INTO v_dups
  FROM (
    SELECT user_id, instance_id, remote_message_id, COUNT(*) AS qty
    FROM public.wa_inbox
    WHERE remote_message_id IS NOT NULL
    GROUP BY user_id, instance_id, remote_message_id
    HAVING COUNT(*) > 1
  ) t;
  IF v_dups > 0 THEN
    RAISE NOTICE '[BUG-NOVO-01] ATENÇÃO: % combinações duplicadas em wa_inbox antes do índice. Removendo duplicatas (mantém a mais antiga).', v_dups;

    -- Remove duplicatas mantendo a mais antiga (a 1ª que entrou).
    -- Justificativa: o cliente recebeu a resposta da 1ª; remover é só limpar registro
    -- duplicado de auditoria sem perder informação operacional.
    DELETE FROM public.wa_inbox a
    USING public.wa_inbox b
    WHERE a.id > b.id
      AND a.user_id = b.user_id
      AND a.instance_id IS NOT DISTINCT FROM b.instance_id
      AND a.remote_message_id = b.remote_message_id
      AND a.remote_message_id IS NOT NULL;
  ELSE
    RAISE NOTICE '[BUG-NOVO-01] OK: nenhuma duplicata por remote_message_id encontrada em wa_inbox.';
  END IF;
END $$;

-- Cria o índice único parcial.
CREATE UNIQUE INDEX IF NOT EXISTS wa_inbox_remote_msg_unique
  ON public.wa_inbox (user_id, instance_id, remote_message_id)
  WHERE remote_message_id IS NOT NULL;

COMMENT ON INDEX public.wa_inbox_remote_msg_unique IS
  'Dedup ATÔMICA pra evitar IA responder 2x quando UazAPI repete evento. BUG-NOVO-01 da auditoria 27/05/2026.';

-- Confirmação
DO $$
DECLARE v_exists int;
BEGIN
  SELECT COUNT(*) INTO v_exists
  FROM pg_indexes
  WHERE schemaname='public' AND tablename='wa_inbox' AND indexname='wa_inbox_remote_msg_unique';
  RAISE NOTICE '[BUG-NOVO-01] Índice criado: % de 1', v_exists;
END $$;
