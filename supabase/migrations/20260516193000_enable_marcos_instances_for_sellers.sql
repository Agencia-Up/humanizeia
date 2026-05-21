-- ============================================================================
-- Marcos: libera a aba Instancias para vendedores que ja tem Marcos + CRM.
-- ============================================================================
-- O follow-up do Marcos depende de uma instancia WhatsApp por vendedor.
-- Esta migracao nao libera Marcos para quem nao tinha acesso; apenas adiciona
-- a sub-feature marcos_instancias para vendedores que ja estavam usando o CRM.

UPDATE public.ai_team_members
SET visible_features =
  (
    CASE
      WHEN jsonb_typeof(COALESCE(visible_features, '{}'::jsonb)) = 'object'
        THEN COALESCE(visible_features, '{}'::jsonb)
      ELSE '{}'::jsonb
    END
  ) || '{"marcos_instancias": true}'::jsonb
WHERE COALESCE((visible_features->>'agent_marcos')::boolean, false) = true
  AND COALESCE((visible_features->>'marcos_crm')::boolean, false) = true;
