-- ============================================================================
-- RBAC Fase 1 — Fechar o furo: LIGAR RLS em ai_crm_leads e ai_team_members
-- ----------------------------------------------------------------------------
-- Diagnostico (17/06/2026): as duas tabelas estavam com RLS DESLIGADA em prod,
-- com as policies de VENDEDOR ja escritas porem inertes. Resultado: a separacao
-- "cada um ve so o seu" valia apenas no frontend; pela API, qualquer usuario
-- logado lia leads/contatos de TODAS as contas (vazamento entre tenants).
--
-- As policies de vendedor JA EXISTEM e estao corretas:
--   ai_crm_leads:     seller_view_own_leads (SELECT), seller_update_own_leads (UPDATE)
--                     -> ve/edita leads com assigned_to_id em ai_team_members dele
--   ai_team_members:  seller_view_own_member (SELECT proprio registro),
--                     seller_view_master_team_safe (SELECT time do master,
--                       via get_seller_master_user_id() = SECURITY DEFINER, sem recursao)
--
-- O que faltava nas DUAS: a policy do DONO (tenant). Sem ela, ligar a RLS
-- deixaria o owner sem acesso aos proprios dados. Esta migration adiciona a
-- policy de owner e LIGA a RLS. As edge functions usam SERVICE_ROLE (BYPASSRLS),
-- entao Pedro/crons/transferencias nao sao afetados.
--
-- Isolamento resultante:
--   - DONO  (auth.uid() = user_id): tudo da conta dele.
--   - VENDEDOR: le/edita os leads atribuidos a ele; le o time do master dele.
--   - Entre contas: bloqueado.
--
-- ROLLBACK imediato (se algo quebrar):
--   ALTER TABLE public.ai_crm_leads    DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.ai_team_members DISABLE ROW LEVEL SECURITY;
-- ============================================================================

-- ── ai_crm_leads: policy do dono ────────────────────────────────────────────
DROP POLICY IF EXISTS owner_all_leads ON public.ai_crm_leads;
CREATE POLICY owner_all_leads ON public.ai_crm_leads
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.ai_crm_leads ENABLE ROW LEVEL SECURITY;

-- ── ai_team_members: policy do dono ─────────────────────────────────────────
DROP POLICY IF EXISTS owner_all_team ON public.ai_team_members;
CREATE POLICY owner_all_team ON public.ai_team_members
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.ai_team_members ENABLE ROW LEVEL SECURITY;
