-- ============================================================================
-- Throttle: notificação "Lead Retornou" pro vendedor — 1x a cada 24h por lead
-- ============================================================================
-- Antes: a cada mensagem que o lead enviava após retornar, o webhook
-- disparava nova notificação pro vendedor → spam.
-- Agora: nova coluna last_return_notify_at registra a última notificação.
-- O webhook checa: se < 24h, pula. Se >= 24h ou null, envia + atualiza.
-- ============================================================================

ALTER TABLE public.ai_crm_leads
  ADD COLUMN IF NOT EXISTS last_return_notify_at timestamptz;

COMMENT ON COLUMN public.ai_crm_leads.last_return_notify_at IS
  'Timestamp da última notificação enviada ao vendedor sobre retorno do lead (throttle de 24h no uazapi-webhook).';
