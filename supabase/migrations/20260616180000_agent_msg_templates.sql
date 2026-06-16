-- ============================================================================
-- Templates personalizados de mensagem por agente (vendedor / gerente)
-- ----------------------------------------------------------------------------
-- O dono do agente pode escrever a mensagem entregue ao VENDEDOR (na
-- transferencia do lead) e o relatorio entregue ao GERENTE, usando "etiquetas"
-- (ex.: {nome}, {interesse}, {link}) que o uazapi-webhook troca pelo dado real.
-- NULL/vazio = usa o texto automatico de sempre (zero mudanca p/ quem nao mexer).
-- Aditivo e idempotente.
-- ============================================================================

ALTER TABLE public.wa_ai_agents
  ADD COLUMN IF NOT EXISTS briefing_template_vendedor text,
  ADD COLUMN IF NOT EXISTS briefing_template_gerente  text;
