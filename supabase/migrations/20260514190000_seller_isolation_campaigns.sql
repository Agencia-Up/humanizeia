-- ============================================================================
-- SELLER ISOLATION: wa_campaigns
-- ============================================================================
-- Adiciona seller_member_id em wa_campaigns para isolar campanhas por vendedor.
-- Modelo:
--   - Vendedor logado: vê só campanhas com seller_member_id = seller.id
--   - Master logado: vê TODAS (suas + dos vendedores) — supervisor
--
-- Aditivo, nullable. Campanhas existentes ficam com NULL = "do master".
-- ============================================================================

ALTER TABLE public.wa_campaigns
  ADD COLUMN IF NOT EXISTS seller_member_id uuid
    REFERENCES public.ai_team_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wa_campaigns_seller_member_id
  ON public.wa_campaigns(seller_member_id)
  WHERE seller_member_id IS NOT NULL;

COMMENT ON COLUMN public.wa_campaigns.seller_member_id IS
  'FK opcional: vendedor (ai_team_members) dono desta campanha. NULL = campanha do master.';
