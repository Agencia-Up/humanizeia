-- ============================================================================
-- "Gerente" = a conta master como destinatário de lead. Serve pra SEGURAR um
-- lead com o dono/gerente (não repassa a vendedor, não fica órfão). Aplicada em
-- prod via MCP em 06/07/2026; arquivo versionado depois.
--   - is_manager: marca o membro especial (não é vendedor).
--   - Cria 1 "Gerente" por tenant (agent_id null = vale nos 2 agentes; is_active
--     false = FORA da fila/redistribuição automática; active_in_system true =
--     visível e atribuível no CRM). whatsapp_number único por tenant, nunca usado
--     pra disparo (o Gerente não tem número de vendedor).
-- ============================================================================
ALTER TABLE public.ai_team_members
  ADD COLUMN IF NOT EXISTS is_manager boolean NOT NULL DEFAULT false;

INSERT INTO public.ai_team_members (user_id, name, whatsapp_number, is_manager, agent_id, active_in_system, is_active)
SELECT DISTINCT m.user_id, 'Gerente'::text, ('gerente-' || m.user_id::text), true, NULL::uuid, true, false
FROM public.ai_team_members m
WHERE m.is_manager = false
  AND NOT EXISTS (
    SELECT 1 FROM public.ai_team_members g WHERE g.user_id = m.user_id AND g.is_manager = true
  );
