-- Regras de automacao (follow-up + transferencia) configuraveis por agente (Pedro v2).
-- Aplicado em producao via Management API em 2026-06-01 (MCP DDL estava read-only).
-- NULL = comportamento LEGADO preservado: follow-up 5/8/12 min, 3o transfere,
-- timeout de resposta do vendedor 15min, janela de repasse fixa (10:11-19:29 etc).
ALTER TABLE public.wa_ai_agents ADD COLUMN IF NOT EXISTS automation_rules jsonb;
COMMENT ON COLUMN public.wa_ai_agents.automation_rules IS 'Regras de follow-up e transferencia por agente (Pedro v2). NULL = comportamento legado.';
