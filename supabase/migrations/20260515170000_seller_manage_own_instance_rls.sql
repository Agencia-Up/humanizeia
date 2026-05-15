-- ============================================================================
-- RLS: Vendedor pode INSERT / UPDATE / DELETE a própria instância WhatsApp
-- ============================================================================
-- Antes: vendedor só tinha SELECT (seller_view_master_instances). Tudo o resto
-- caía na policy original "Users can manage own wa_instances" (auth.uid()=user_id),
-- que bloqueia porque wa_instances.user_id é SEMPRE do master.
--
-- Resultado prático: vendedor não conseguia deletar nem adicionar instância via
-- supabase client. As edge functions usam service_role e bypassam RLS, mas se
-- alguma chamada vier direto do client (ou se usarmos JWT do user no futuro),
-- precisamos das policies abaixo como defesa em profundidade.
--
-- Modelo: vendedor é DONO de uma instância quando:
--   user_id = master do vendedor (via get_seller_master_user_id())
--   seller_member_id ∈ ids do vendedor em ai_team_members
-- ============================================================================

-- Helper: retorna os ai_team_members.id que pertencem ao auth.uid() atual.
-- Vendedor pode ter múltiplos rows (caso raro: vinculado a mais de um master).
CREATE OR REPLACE FUNCTION public.get_my_member_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id FROM public.ai_team_members WHERE auth_user_id = auth.uid();
$$;

COMMENT ON FUNCTION public.get_my_member_ids() IS
  'Retorna os ai_team_members.id do usuário autenticado (auth.uid()). Útil em policies de tabelas que tem seller_member_id.';

-- ── 1. INSERT: vendedor pode criar instância pra si mesmo ───────────────────
DROP POLICY IF EXISTS "seller_insert_own_instance" ON public.wa_instances;
CREATE POLICY "seller_insert_own_instance" ON public.wa_instances
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = public.get_seller_master_user_id()
    AND seller_member_id IN (SELECT public.get_my_member_ids())
  );

-- ── 2. UPDATE: vendedor pode atualizar SUA instância (status, friendly_name, etc) ──
DROP POLICY IF EXISTS "seller_update_own_instance" ON public.wa_instances;
CREATE POLICY "seller_update_own_instance" ON public.wa_instances
  FOR UPDATE
  TO authenticated
  USING (
    user_id = public.get_seller_master_user_id()
    AND seller_member_id IN (SELECT public.get_my_member_ids())
  )
  WITH CHECK (
    user_id = public.get_seller_master_user_id()
    AND seller_member_id IN (SELECT public.get_my_member_ids())
  );

-- ── 3. DELETE: vendedor pode deletar SUA instância ──────────────────────────
DROP POLICY IF EXISTS "seller_delete_own_instance" ON public.wa_instances;
CREATE POLICY "seller_delete_own_instance" ON public.wa_instances
  FOR DELETE
  TO authenticated
  USING (
    user_id = public.get_seller_master_user_id()
    AND seller_member_id IN (SELECT public.get_my_member_ids())
  );
