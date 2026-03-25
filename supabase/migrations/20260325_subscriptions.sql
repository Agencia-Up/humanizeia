-- Migration: 20260325_subscriptions.sql
-- Creates user_subscriptions and token_transactions tables with full RLS

-- user_subscriptions
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  plan_id text NOT NULL DEFAULT 'basico', -- 'basico' | 'pro' | 'enterprise'
  status text NOT NULL DEFAULT 'active', -- 'active' | 'suspended' | 'cancelled'
  tokens_included integer NOT NULL DEFAULT 50000,
  tokens_used integer NOT NULL DEFAULT 0,
  tokens_purchased integer NOT NULL DEFAULT 0,
  renewal_date timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- token_transactions (purchases + consumption logs)
CREATE TABLE IF NOT EXISTS token_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type text NOT NULL, -- 'purchase' | 'consume' | 'refund' | 'renewal'
  amount integer NOT NULL, -- positive = credit, negative = debit
  description text,
  agent text, -- which agent consumed: 'davi' | 'joao' | 'daniel' | 'copywriter' etc
  balance_after integer,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_subscriptions' AND policyname='users_own_subscription') THEN
    CREATE POLICY users_own_subscription ON user_subscriptions FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='token_transactions' AND policyname='users_own_transactions') THEN
    CREATE POLICY users_own_transactions ON token_transactions FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_token_tx_user_id ON token_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_token_tx_created_at ON token_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);

-- Function: auto-create subscription on user signup
CREATE OR REPLACE FUNCTION create_default_subscription()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_subscriptions (user_id, plan_id, status, tokens_included, tokens_used, tokens_purchased, renewal_date)
  VALUES (NEW.id, 'basico', 'active', 50000, 0, 0, now() + interval '30 days')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_subscription ON auth.users;
CREATE TRIGGER on_auth_user_created_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_default_subscription();
