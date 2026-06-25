-- Toggle por agente (Pedro): feedback do GERENTE resumido (atual, default) vs COMPLETO.
-- COMPLETO = o gerente recebe o MESMO briefing que o vendedor + qual vendedor
-- está atendendo o cliente. Default false = nenhum comportamento muda até ligar.
ALTER TABLE public.wa_ai_agents
  ADD COLUMN IF NOT EXISTS gerente_feedback_completo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.wa_ai_agents.gerente_feedback_completo IS
  'true = gerente recebe o briefing completo (igual o vendedor) + vendedor atribuido; false (default) = relatorio resumido atual.';
