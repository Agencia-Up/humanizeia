-- ============================================================================
-- Prompt 11 — checkout_pending (rastreamento de tentativas de checkout Asaas)
-- ============================================================================
-- Tabela pra registrar tentativas de checkout ANTES do pagamento confirmar.
-- Vincula identificadores do Asaas (customer/subscription/payment) ao lead
-- pendente. Quando webhook PAYMENT_CONFIRMED chega, lookup por
-- asaas_subscription_id ou asaas_payment_id pra criar a conta do usuário.
--
-- NÃO armazena dados de cartão (segurança PCI). Asaas tokeniza.
--
-- Reversível: DROP TABLE.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.checkout_pending (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificação do cliente
  email                   text NOT NULL,
  full_name               text NOT NULL,
  document                text NOT NULL,            -- CPF ou CNPJ (só dígitos)
  person_type             text NOT NULL CHECK (person_type IN ('pf', 'pj')),
  phone                   text NOT NULL,             -- só dígitos com DDI

  -- Plano + cobrança
  plano                   text NOT NULL CHECK (plano IN ('mensal', 'anual')),
  payment_method          text NOT NULL CHECK (payment_method IN ('pix', 'cartao', 'boleto')),

  -- IDs do Asaas (preenchidos após criar lá)
  asaas_customer_id       text,
  asaas_subscription_id   text,                      -- recorrência da mensalidade/anuidade
  asaas_setup_payment_id  text,                      -- cobrança avulsa da taxa de implementação

  -- Status do checkout
  status                  text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'awaiting_payment', 'paid', 'cancelled', 'failed', 'expired')),

  -- Resposta do Asaas pra exibir ao usuário (QR PIX, linha boleto, etc.)
  asaas_payment_url       text,                      -- link da fatura
  asaas_pix_payload       text,                      -- copia-e-cola do PIX
  asaas_pix_qrcode        text,                      -- base64 do QR Code
  asaas_boleto_url        text,                      -- URL do PDF do boleto
  asaas_boleto_barcode    text,                      -- código de barras

  -- Vinculação com user_id (preenchido após PAYMENT_CONFIRMED + auth.users.insert)
  user_id                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Auditoria
  error_message           text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz
);

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_checkout_pending_updated_at ON public.checkout_pending;
CREATE TRIGGER trg_checkout_pending_updated_at
  BEFORE UPDATE ON public.checkout_pending
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Indexes pra lookup do webhook
CREATE INDEX IF NOT EXISTS idx_checkout_pending_asaas_customer ON public.checkout_pending(asaas_customer_id);
CREATE INDEX IF NOT EXISTS idx_checkout_pending_asaas_subscription ON public.checkout_pending(asaas_subscription_id);
CREATE INDEX IF NOT EXISTS idx_checkout_pending_asaas_setup_payment ON public.checkout_pending(asaas_setup_payment_id);
CREATE INDEX IF NOT EXISTS idx_checkout_pending_email ON public.checkout_pending(email);
CREATE INDEX IF NOT EXISTS idx_checkout_pending_status ON public.checkout_pending(status) WHERE status != 'paid';

-- ============================================================================
-- RLS — endpoint público de checkout não precisa de leitura via Supabase client
-- (só edge functions escrevem/leem via service_role)
-- ============================================================================
ALTER TABLE public.checkout_pending ENABLE ROW LEVEL SECURITY;

-- Sem policies de SELECT/INSERT/UPDATE/DELETE pra clientes anon ou authenticated.
-- Apenas service_role (edge functions) acessa.

COMMENT ON TABLE public.checkout_pending IS
  'Prompt 11 — registro de tentativas de checkout do plano PRO via Asaas. Webhook PAYMENT_CONFIRMED faz lookup por asaas_subscription_id ou asaas_setup_payment_id pra criar conta do usuário e ativar assinatura.';
