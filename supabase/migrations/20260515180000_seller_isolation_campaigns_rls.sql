-- ============================================================================
-- RLS: Vendedor pode SELECT/INSERT/UPDATE/DELETE suas próprias campanhas
-- ============================================================================
-- Antes: wa_campaigns só tinha "Users can manage own wa_campaigns"
-- (auth.uid() = user_id) — bloqueia vendedor porque user_id é SEMPRE do master.
--
-- Resultado prático: vendedor não via suas campanhas no painel + edge functions
-- usando service_role bypassavam RLS no INSERT (mas com seller_member_id NULL,
-- pois o frontend não passava). Bug duplo.
--
-- Modelo: vendedor é DONO de uma campanha quando:
--   user_id = master do vendedor (via get_seller_master_user_id())
--   seller_member_id ∈ get_my_member_ids() (ai_team_members.id do vendedor)
-- ============================================================================

-- ── 1. SELECT: vendedor vê suas campanhas ───────────────────────────────────
DROP POLICY IF EXISTS "seller_view_own_campaigns" ON public.wa_campaigns;
CREATE POLICY "seller_view_own_campaigns" ON public.wa_campaigns
  FOR SELECT
  TO authenticated
  USING (
    user_id = public.get_seller_master_user_id()
    AND seller_member_id IN (SELECT public.get_my_member_ids())
  );

-- ── 2. INSERT: vendedor cria campanha pra si mesmo ──────────────────────────
DROP POLICY IF EXISTS "seller_insert_own_campaign" ON public.wa_campaigns;
CREATE POLICY "seller_insert_own_campaign" ON public.wa_campaigns
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = public.get_seller_master_user_id()
    AND seller_member_id IN (SELECT public.get_my_member_ids())
  );

-- ── 3. UPDATE: vendedor edita SUA campanha ──────────────────────────────────
DROP POLICY IF EXISTS "seller_update_own_campaign" ON public.wa_campaigns;
CREATE POLICY "seller_update_own_campaign" ON public.wa_campaigns
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

-- ── 4. DELETE: vendedor deleta SUA campanha ─────────────────────────────────
DROP POLICY IF EXISTS "seller_delete_own_campaign" ON public.wa_campaigns;
CREATE POLICY "seller_delete_own_campaign" ON public.wa_campaigns
  FOR DELETE
  TO authenticated
  USING (
    user_id = public.get_seller_master_user_id()
    AND seller_member_id IN (SELECT public.get_my_member_ids())
  );

-- ============================================================================
-- BONUS: wa_queue (fila de envios) — vendedor precisa ver status do disparo
-- ============================================================================
-- Quando vendedor abrir a campanha pra ver progresso, vai querer ler wa_queue.
-- Sem essa policy, a contagem de enviados/falhos sempre vai dar zero pro vendedor.

DROP POLICY IF EXISTS "seller_view_own_queue" ON public.wa_queue;
CREATE POLICY "seller_view_own_queue" ON public.wa_queue
  FOR SELECT
  TO authenticated
  USING (
    user_id = public.get_seller_master_user_id()
    AND campaign_id IN (
      SELECT id FROM public.wa_campaigns
      WHERE seller_member_id IN (SELECT public.get_my_member_ids())
    )
  );
