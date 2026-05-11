-- ============================================================
-- Adiciona campos estruturados de dados do cliente em ai_crm_leads
-- para que o agente IA possa salvar informacoes coletadas
-- durante a conversa (nome real, cidade, veiculo, pagamento, etc.)
-- Alinhado com o prompt do Carvalho (Funil Campeao)
-- ============================================================

ALTER TABLE public.ai_crm_leads
  ADD COLUMN IF NOT EXISTS client_name        TEXT,
  ADD COLUMN IF NOT EXISTS client_city        TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_interest   TEXT,
  ADD COLUMN IF NOT EXISTS payment_method     TEXT,
  ADD COLUMN IF NOT EXISTS budget             TEXT,
  ADD COLUMN IF NOT EXISTS trade_in_vehicle   TEXT,
  ADD COLUMN IF NOT EXISTS down_payment       TEXT,
  ADD COLUMN IF NOT EXISTS desired_installment TEXT,
  ADD COLUMN IF NOT EXISTS cpf                TEXT,
  ADD COLUMN IF NOT EXISTS birth_date         TEXT,
  ADD COLUMN IF NOT EXISTS funnel_stage       TEXT DEFAULT 'abordagem',
  ADD COLUMN IF NOT EXISTS temperature        TEXT DEFAULT 'morno',
  ADD COLUMN IF NOT EXISTS visit_scheduled    TEXT,
  ADD COLUMN IF NOT EXISTS additional_notes   TEXT;

-- Indice para busca por temperatura e etapa do funil
CREATE INDEX IF NOT EXISTS idx_ai_crm_leads_funnel
  ON public.ai_crm_leads(user_id, funnel_stage, temperature);
