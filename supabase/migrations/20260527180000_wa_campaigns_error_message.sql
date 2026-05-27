-- =============================================================================
-- BUG-NOVO-08 — wa_campaigns ganha error_message + status 'failed' / 'completed_with_errors'
-- =============================================================================
-- Antes: campanha com 100% itens em status='failed' era marcada como 'completed'
-- (porque o check só conta pending+processing). Master via "✅ Concluída" mesmo
-- com 0 mensagens enviadas.
--
-- Esta migration adiciona:
--   1. Coluna error_message (text NULL) pra armazenar resumo de falhas
--      (ex: "Todos os 50 itens falharam — verifique instância").
--   2. CHECK constraint expandindo status pra incluir 'failed' e
--      'completed_with_errors' (além dos atuais).
--
-- Edge function process-whatsapp-queue passa a usar essas novas opções de status.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.wa_campaigns
  ADD COLUMN IF NOT EXISTS error_message text NULL;

COMMENT ON COLUMN public.wa_campaigns.error_message IS
  'Mensagem de erro/alerta resumida quando campanha termina com falhas. NULL = sem alertas.';

-- Index parcial pra dashboard filtrar campanhas com erro (pequeno, performático)
CREATE INDEX IF NOT EXISTS idx_wa_campaigns_with_errors
  ON public.wa_campaigns (user_id, completed_at DESC)
  WHERE error_message IS NOT NULL;

-- Verifica se há CHECK constraint em wa_campaigns.status que precise ser relaxada
DO $$
DECLARE
  v_constraint_name text;
  v_constraint_def text;
BEGIN
  SELECT con.conname, pg_get_constraintdef(con.oid)
  INTO v_constraint_name, v_constraint_def
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'wa_campaigns'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    RAISE NOTICE '[BUG-NOVO-08] CHECK constraint encontrada em wa_campaigns.status: % = %', v_constraint_name, v_constraint_def;
    RAISE NOTICE '[BUG-NOVO-08] Pode ser necessario relaxar pra aceitar status=failed/completed_with_errors. Verifique manualmente.';
  ELSE
    RAISE NOTICE '[BUG-NOVO-08] Sem CHECK constraint em wa_campaigns.status — novos valores (failed, completed_with_errors) aceitos.';
  END IF;
END $$;

-- Confirmação
DO $$
DECLARE v_cols int;
BEGIN
  SELECT COUNT(*) INTO v_cols
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='wa_campaigns'
    AND column_name = 'error_message';
  RAISE NOTICE '[BUG-NOVO-08] coluna error_message criada: % de 1', v_cols;
END $$;
