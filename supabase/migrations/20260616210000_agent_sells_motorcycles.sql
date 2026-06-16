-- Capacidade POR AGENTE: a loja vende motos?
-- default false => mantem TODOS os agentes atuais como car-only (comportamento inalterado,
-- ex.: Carvalho/Icom segue recusando moto). Agente com sells_motorcycles=true apresenta as
-- motos do estoque quando o lead pede (ex.: Avant Motors, que vende carros E motos).
ALTER TABLE public.wa_ai_agents
  ADD COLUMN IF NOT EXISTS sells_motorcycles boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.wa_ai_agents.sells_motorcycles IS
  'Se true, o agente apresenta motos do estoque quando o lead pede. Default false = car-only.';
