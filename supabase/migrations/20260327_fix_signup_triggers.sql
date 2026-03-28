-- =====================================================================
-- FIX: Signup triggers com tratamento de exceção robusto
-- Diagnóstico: "Database error saving new user" causado por triggers
-- que lançam exceção durante INSERT em auth.users
-- =====================================================================

-- 1. Garante que user_subscriptions existe (caso migration anterior não tenha rodado)
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  plan_id text NOT NULL DEFAULT 'basico',
  status text NOT NULL DEFAULT 'active',
  tokens_included integer NOT NULL DEFAULT 50000,
  tokens_used integer NOT NULL DEFAULT 0,
  tokens_purchased integer NOT NULL DEFAULT 0,
  renewal_date timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_subscriptions'
    AND policyname = 'users_own_subscription'
  ) THEN
    CREATE POLICY users_own_subscription
      ON public.user_subscriptions FOR ALL
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- 2. handle_new_user: cria perfil com EXCEPTION handler para nunca bloquear o cadastro
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NULL)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Loga o erro mas NÃO bloqueia o cadastro
    RAISE WARNING 'handle_new_user error (não crítico): %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Recria o trigger principal
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. create_default_subscription: cria assinatura gratuita com EXCEPTION handler
CREATE OR REPLACE FUNCTION public.create_default_subscription()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_subscriptions (
    user_id, plan_id, status,
    tokens_included, tokens_used, tokens_purchased,
    renewal_date
  )
  VALUES (
    NEW.id, 'basico', 'active',
    50000, 0, 0,
    now() + interval '30 days'
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'create_default_subscription error (não crítico): %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Recria o trigger de subscription
DROP TRIGGER IF EXISTS on_auth_user_created_subscription ON auth.users;
CREATE TRIGGER on_auth_user_created_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_default_subscription();

-- 4. Cria perfis e subscriptions para usuários que já existem mas estão sem eles
INSERT INTO public.profiles (id, full_name)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', NULL)
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_subscriptions (user_id, plan_id, status, tokens_included, tokens_used, tokens_purchased, renewal_date)
SELECT
  u.id, 'basico', 'active', 50000, 0, 0, now() + interval '30 days'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_subscriptions s WHERE s.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;

