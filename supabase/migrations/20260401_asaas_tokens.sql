-- ============================================================
-- MIGRAÇÃO: Sistema de Tokens via Asaas
-- Execute este SQL no Supabase SQL Editor (Table Editor → SQL)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Adicionar colunas Asaas na tabela profiles existente
-- ────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS tokens            INTEGER NOT NULL DEFAULT 0;

-- Índice para lookup rápido no webhook (busca por customer Asaas)
CREATE INDEX IF NOT EXISTS idx_profiles_asaas_customer_id
  ON profiles(asaas_customer_id)
  WHERE asaas_customer_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 2. Tabela de transações de tokens
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS token_transactions (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_id   TEXT          NOT NULL UNIQUE,   -- ID do pagamento na Asaas (evita duplicidade)
  tokens_added INTEGER       NOT NULL,
  product_id   TEXT          NOT NULL,           -- ex: token_50k, token_100k ...
  price_paid   DECIMAL(10,2) NOT NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_token_tx_user_id    ON token_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_token_tx_payment_id ON token_transactions(payment_id);
CREATE INDEX IF NOT EXISTS idx_token_tx_created_at ON token_transactions(created_at DESC);

-- ────────────────────────────────────────────────────────────
-- 3. Row Level Security
-- ────────────────────────────────────────────────────────────

ALTER TABLE token_transactions ENABLE ROW LEVEL SECURITY;

-- Usuário só vê suas próprias transações
CREATE POLICY "Users can view own token transactions"
  ON token_transactions
  FOR SELECT
  USING (auth.uid() = user_id);

-- Apenas service_role pode inserir/atualizar (Edge Functions usam service_role)
CREATE POLICY "Service role can manage token transactions"
  ON token_transactions
  FOR ALL
  USING (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- 4. Função SQL auxiliar: adicionar tokens de forma atômica
--    Evita race condition quando dois webhooks chegam juntos
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION add_tokens_to_user(
  p_user_id      UUID,
  p_tokens       INTEGER,
  p_payment_id   TEXT,
  p_product_id   TEXT,
  p_price_paid   DECIMAL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Atualiza tokens (operação atômica)
  UPDATE profiles
    SET tokens = tokens + p_tokens
  WHERE id = p_user_id;

  -- Registra transação
  INSERT INTO token_transactions (user_id, payment_id, tokens_added, product_id, price_paid)
  VALUES (p_user_id, p_payment_id, p_tokens, p_product_id, p_price_paid);
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 5. Verificar resultado
-- ────────────────────────────────────────────────────────────

-- Rodar isso para confirmar que as colunas foram criadas:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'profiles' AND column_name IN ('asaas_customer_id', 'tokens');

-- Rodar isso para confirmar a tabela:
-- SELECT * FROM token_transactions LIMIT 1;
