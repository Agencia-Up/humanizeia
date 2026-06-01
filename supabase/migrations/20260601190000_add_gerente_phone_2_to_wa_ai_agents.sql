-- Segundo gerente (opcional) por agente — tambem recebe os relatorios automaticos
-- de transferencia. Maximo de 2 gerentes. Aplicado em producao via Management API
-- em 2026-06-01 (MCP DDL estava read-only). NULL = sem 2o gerente.
ALTER TABLE public.wa_ai_agents ADD COLUMN IF NOT EXISTS gerente_phone_2 text;
COMMENT ON COLUMN public.wa_ai_agents.gerente_phone_2 IS 'Segundo gerente (opcional) que tambem recebe os relatorios automaticos de transferencia. Max 2 gerentes.';
