-- =============================================================================
-- Fix: handle_new_user() ignorava role/manager_id do user_metadata, fazendo
-- seller convidado virar 'owner' por default → caía em /onboarding ao logar.
--
-- Fluxo correto pra seller:
-- 1. Master convida via Pedro → SellerManagerTab → invite-seller edge function
-- 2. Edge function cria auth.users com raw_user_meta_data = {
--      role: 'seller', master_user_id: <uuid>, full_name: <name>
--    }
-- 3. Trigger on_auth_user_created roda handle_new_user() e cria profile
-- 4. Profile DEVE ter role='seller' + manager_id=master_user_id, NÃO 'owner'
-- =============================================================================

-- 1) Replace handle_new_user pra copiar role + manager_id do metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_manager uuid;
BEGIN
  -- Detecta role explicitamente: se metadata diz 'seller', honra; senão default 'owner'
  v_role := CASE
    WHEN NEW.raw_user_meta_data->>'role' = 'seller' THEN 'seller'
    ELSE 'owner'
  END;

  -- master_user_id eh UUID; NULLIF protege contra string vazia
  v_manager := NULLIF(NEW.raw_user_meta_data->>'master_user_id', '')::uuid;

  INSERT INTO public.profiles (id, full_name, role, manager_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NULL),
    v_role,
    v_manager
  )
  ON CONFLICT (id) DO UPDATE SET
    -- Se profile ja existe (delete+recreate do auth user), atualiza role/manager
    -- pra refletir o novo metadata. NUNCA "downgrade" um seller pra owner via
    -- conflict path (so atualiza se o novo metadata DIZ seller).
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    role      = CASE
                  WHEN EXCLUDED.role = 'seller' THEN 'seller'
                  ELSE profiles.role
                END,
    manager_id = COALESCE(EXCLUDED.manager_id, profiles.manager_id);

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Loga mas nao bloqueia o cadastro (mesmo comportamento que antes)
    RAISE WARNING 'handle_new_user error (não crítico): %', SQLERRM;
    RETURN NEW;
END;
$function$;

-- 2) Backfill profiles dos sellers EXISTENTES que ficaram com role='owner'
-- por causa do bug. Usa ai_team_members.auth_user_id pra identificar quem
-- eh seller e qual o master (atm.user_id).
DO $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.profiles p
  SET
    role = 'seller',
    manager_id = atm.user_id
  FROM public.ai_team_members atm
  WHERE atm.auth_user_id = p.id
    AND atm.auth_user_id IS NOT NULL
    AND (p.role IS DISTINCT FROM 'seller' OR p.manager_id IS DISTINCT FROM atm.user_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '[fix_seller_role] Profiles backfillados: %', v_count;
END $$;

-- 3) Confirmacao
DO $$
DECLARE
  v_sellers_ok int;
  v_sellers_total int;
BEGIN
  SELECT count(*) INTO v_sellers_total
  FROM ai_team_members WHERE auth_user_id IS NOT NULL;

  SELECT count(*) INTO v_sellers_ok
  FROM ai_team_members atm
  JOIN profiles p ON p.id = atm.auth_user_id
  WHERE p.role = 'seller' AND p.manager_id = atm.user_id;

  RAISE NOTICE '[fix_seller_role] Sellers com profile correto: % de %', v_sellers_ok, v_sellers_total;
END $$;
