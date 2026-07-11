-- ============================================================================
-- Marcos CRM: backfill seguro de etapas ausentes
-- ----------------------------------------------------------------------------
-- Algumas contas podem ficar sem registros em crm_pipeline_stages por drift de
-- migrations antigas: as migrations do Marcos evoluiram por detecção de sets
-- exatos ou pela existência de "Fechado", então uma conta que nasceu fora desse
-- caminho abre o CRM sem etapa e o cadastro manual quebra.
--
-- Esta migration NÃO altera contas que já têm etapas de conta (seller_auth_id
-- null). Ela só cria o pipeline padrão atual para owners completamente vazios.
-- ============================================================================

INSERT INTO public.crm_pipeline_stages (
  user_id,
  name,
  color,
  position,
  is_default,
  ativo,
  show_in_live,
  seller_auth_id
)
SELECT
  p.id,
  defaults.name,
  defaults.color,
  defaults.position,
  false,
  true,
  true,
  null
FROM public.profiles p
CROSS JOIN (
  VALUES
    ('Leads Inativos'::text, '#9ca3af'::text, 0),
    ('Marketplace'::text, '#f97316'::text, 1),
    ('Porta/loja'::text, '#14b8a6'::text, 2),
    ('Não tem no Estoque'::text, '#f43f5e'::text, 3),
    ('Agendamento'::text, '#06b6d4'::text, 4),
    ('Negociação'::text, '#8b5cf6'::text, 5),
    ('Venda concluída'::text, '#10b981'::text, 6),
    ('Consignado'::text, '#a78bfa'::text, 7),
    ('Indicação'::text, '#fb923c'::text, 8),
    ('Redes Sociais'::text, '#ec4899'::text, 9)
) AS defaults(name, color, position)
WHERE coalesce(p.role, 'owner') = 'owner'
  AND NOT EXISTS (
    SELECT 1
    FROM public.crm_pipeline_stages existing
    WHERE existing.user_id = p.id
      AND existing.seller_auth_id IS NULL
  )
ON CONFLICT (user_id, name) DO NOTHING;
