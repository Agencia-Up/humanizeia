
-- Tabela de webhooks externos
CREATE TABLE IF NOT EXISTS external_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  slug TEXT NOT NULL UNIQUE,
  platform TEXT DEFAULT 'custom',
  field_mapping JSONB DEFAULT '{"name":["name","nome","full_name","buyer_name","customer_name","subscriber_name"],"email":["email","e_mail","buyer_email","customer_email","subscriber_email"],"phone":["phone","telefone","whatsapp","cel","celular","phone_number","buyer_phone","customer_phone","subscriber_phone"]}',
  wa_instance_id UUID REFERENCES wa_instances(id) ON DELETE SET NULL,
  wa_message_template TEXT DEFAULT 'Olá {nome}! 👋 Bem-vindo(a)! 🎉 Seu cadastro foi confirmado com sucesso.',
  wa_delay_seconds INTEGER DEFAULT 10,
  send_whatsapp BOOLEAN DEFAULT true,
  auto_tags TEXT[] DEFAULT '{}',
  total_received INTEGER DEFAULT 0,
  total_processed INTEGER DEFAULT 0,
  total_errors INTEGER DEFAULT 0,
  last_received_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_external_webhooks_user ON external_webhooks(user_id);
CREATE INDEX idx_external_webhooks_slug ON external_webhooks(slug);

-- Log de webhooks recebidos
CREATE TABLE IF NOT EXISTS webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID REFERENCES external_webhooks(id) ON DELETE CASCADE NOT NULL,
  raw_payload JSONB NOT NULL,
  extracted_data JSONB,
  contact_id UUID REFERENCES wa_contacts(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'received',
  error_message TEXT,
  whatsapp_sent BOOLEAN DEFAULT false,
  whatsapp_sent_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_webhook_logs_webhook ON webhook_logs(webhook_id);
CREATE INDEX idx_webhook_logs_status ON webhook_logs(status);
CREATE INDEX idx_webhook_logs_date ON webhook_logs(created_at DESC);

-- RLS
ALTER TABLE external_webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own webhooks" ON external_webhooks
  FOR ALL USING (auth.uid() = user_id);

ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own webhook logs" ON webhook_logs
  FOR SELECT USING (
    webhook_id IN (SELECT id FROM external_webhooks WHERE user_id = auth.uid())
  );

-- Insert policy for webhook_logs (anon for external webhooks)
CREATE POLICY "Anyone can insert webhook logs" ON webhook_logs
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Trigger para estatísticas
CREATE OR REPLACE FUNCTION update_webhook_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE external_webhooks SET
    total_received = total_received + 1,
    last_received_at = now()
  WHERE id = NEW.webhook_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_webhook_stats_trigger
  AFTER INSERT ON webhook_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_webhook_stats();

-- Trigger updated_at
CREATE TRIGGER update_external_webhooks_updated_at
  BEFORE UPDATE ON external_webhooks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
