-- ============================================================================
-- FEATURE: Atribuição de instância WhatsApp a vendedor (seller)
-- ============================================================================
-- Adiciona coluna seller_member_id em wa_instances (nullable, FK→ai_team_members).
-- Permite isolar instâncias por vendedor:
--   - Vendedor logado → vê só instâncias com seller_member_id = seu seller.id
--   - Master → vê todas (e atribui via UI)
--   - Instâncias com seller_member_id NULL → "do master" (sem dono específico)
--
-- Segurança: aditivo, todas as instâncias existentes ficam com NULL (= comporta-
-- mento legacy do master). Só impacta quando o master começar a atribuir.
-- ============================================================================

ALTER TABLE public.wa_instances
  ADD COLUMN IF NOT EXISTS seller_member_id uuid
    REFERENCES public.ai_team_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wa_instances_seller_member_id
  ON public.wa_instances(seller_member_id)
  WHERE seller_member_id IS NOT NULL;

COMMENT ON COLUMN public.wa_instances.seller_member_id IS
  'FK opcional: vendedor (ai_team_members) dono desta instância. NULL = instância do master (não atribuída a nenhum vendedor específico).';
