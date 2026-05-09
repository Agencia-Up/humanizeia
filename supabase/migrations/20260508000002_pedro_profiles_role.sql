-- ============================================================
-- Pedro CRM Upgrade — Fase 2.5
-- Adiciona role hierárquico e manager_id à tabela profiles,
-- compatível com o controle de acesso do módulo Pedro.
--
-- Roles:
--   'owner'   → dono da conta LogosIA (padrão para todos os existentes)
--   'manager' → gerente que supervisiona vendedores
--   'seller'  → vendedor vinculado a um manager/owner
-- ============================================================

-- ── 1. Novas colunas em profiles ────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role       TEXT    NOT NULL DEFAULT 'owner'
    CHECK (role IN ('owner', 'manager', 'seller')),
  ADD COLUMN IF NOT EXISTS manager_id UUID    REFERENCES auth.users(id) ON DELETE SET NULL;

-- Índices para queries de hierarquia
CREATE INDEX IF NOT EXISTS profiles_role_idx       ON public.profiles(role);
CREATE INDEX IF NOT EXISTS profiles_manager_id_idx ON public.profiles(manager_id);

-- ── 2. Sincroniza sellers já existentes em ai_team_members ──────────────────
-- Todo vendedor que já tem auth_user_id em ai_team_members recebe role='seller'
-- e manager_id apontando para o dono (user_id) do seu registro.
UPDATE public.profiles p
SET
  role       = 'seller',
  manager_id = atm.user_id
FROM public.ai_team_members atm
WHERE atm.auth_user_id = p.id
  AND p.role = 'owner';   -- só atualiza quem ainda não foi classificado

-- ── 3. Função helper: get_user_role() ───────────────────────────────────────
-- SECURITY DEFINER → roda como dono da função, sem acesso ao RLS de profiles.
-- Retorna o role do usuário autenticado atual.
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(role, 'owner')
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

-- ── 4. Função helper: get_my_manager_id() ───────────────────────────────────
-- Retorna o manager_id do usuário atual (para sellers verificarem o gerente).
CREATE OR REPLACE FUNCTION public.get_my_manager_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT manager_id
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

-- ── 5. Política RLS: sellers veem o perfil do próprio gerente ────────────────
-- Necessário para o frontend exibir nome/avatar do gerente ao vendedor.
DROP POLICY IF EXISTS "seller_view_manager_profile" ON public.profiles;
CREATE POLICY "seller_view_manager_profile" ON public.profiles
  FOR SELECT
  USING (
    -- O próprio usuário sempre vê o próprio perfil
    id = auth.uid()
    OR
    -- Gerentes/owners veem os perfis dos seus vendedores
    (public.get_user_role() IN ('owner', 'manager') AND manager_id = auth.uid())
    OR
    -- Sellers veem o perfil do seu gerente
    (id = public.get_my_manager_id())
  );

-- ── 6. Policy em pedro_manager_feedback: gerente vê feedbacks dos seus sellers
-- (Complementa a policy já criada em 20260508000001 que usa user_id do lead)
DROP POLICY IF EXISTS "manager_read_team_feedback" ON public.pedro_manager_feedback;
CREATE POLICY "manager_read_team_feedback" ON public.pedro_manager_feedback
  FOR SELECT
  USING (
    -- Gerentes com role='manager' veem todos os feedbacks dos seus sellers
    public.get_user_role() IN ('owner', 'manager')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = pedro_manager_feedback.user_id
         OR p.manager_id = auth.uid()
    )
  );
