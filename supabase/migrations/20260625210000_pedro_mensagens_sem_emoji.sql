-- Toggle por agente (Pedro): enviar as mensagens de transferência (vendedor/gerente)
-- COM emojis (default, atual) ou SEM emojis. Default false = nada muda até ligar.
ALTER TABLE public.wa_ai_agents
  ADD COLUMN IF NOT EXISTS mensagens_sem_emoji boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.wa_ai_agents.mensagens_sem_emoji IS
  'true = Pedro envia as mensagens de transferencia (vendedor e gerente) SEM emojis; false (default) = com emojis (atual).';
