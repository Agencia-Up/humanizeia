-- ============================================================================
-- DATA MIGRATION: unificar pool de instâncias dos vendedores no master_id
-- ============================================================================
-- Antes: cada vendedor criava wa_instances com user_id = seu próprio auth.uid
--   → master não enxergava (RLS bloqueava) e o pool não era contado direito.
-- Agora: instâncias dos vendedores ficam com:
--   - user_id = master_id  (mesma conta)
--   - seller_member_id = ai_team_members.id (vendedor dono)
--
-- Idempotente: WHERE wi.user_id <> r.master_id (não re-aplica em quem já está
-- correto). Só migra instâncias cujo user_id atual bate com algum
-- ai_team_members.auth_user_id — não toca em instâncias avulsas (ex.
-- "WhatsApp - Agente IA (572m/f1gw)" que pertencem a outras contas master).
-- ============================================================================

WITH ranked AS (
  SELECT
    tm.id AS new_seller_member_id,
    tm.user_id AS master_id,
    tm.auth_user_id,
    ROW_NUMBER() OVER (PARTITION BY tm.auth_user_id ORDER BY tm.created_at DESC NULLS LAST) AS rn
  FROM public.ai_team_members tm
  WHERE tm.auth_user_id IS NOT NULL
)
UPDATE public.wa_instances wi
SET
  user_id = r.master_id,
  seller_member_id = r.new_seller_member_id
FROM ranked r
WHERE r.auth_user_id = wi.user_id
  AND r.rn = 1
  AND wi.user_id <> r.master_id;
