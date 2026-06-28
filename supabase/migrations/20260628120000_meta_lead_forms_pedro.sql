-- ============================================================================
-- Meta Lead Ads -> Pedro SDR
-- ----------------------------------------------------------------------------
-- Entrada segura para formularios nativos do Facebook/Instagram. O webhook salva
-- evento bruto, busca o lead completo na Graph API, deduplica e cria/atualiza o
-- lead no CRM do Pedro sem misturar com os formularios proprios da Logos.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.meta_lead_form_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ad_account_id uuid REFERENCES public.ad_accounts(id) ON DELETE SET NULL,
  page_id text NOT NULL,
  page_name text,
  form_id text NOT NULL,
  form_name text NOT NULL,
  agent_id uuid REFERENCES public.wa_ai_agents(id) ON DELETE SET NULL,
  instance_id uuid REFERENCES public.wa_instances(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  auto_contact_enabled boolean NOT NULL DEFAULT false,
  initial_message_template text NOT NULL DEFAULT 'Oi, {nome}. Aqui e da {empresa}. Recebemos seu cadastro no Facebook sobre {interesse}. Posso te ajudar por aqui?',
  processing_mode text NOT NULL DEFAULT 'pedro_qualifica' CHECK (processing_mode IN ('pedro_qualifica', 'manual')),
  raw_form jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, form_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_lead_form_configs_user
  ON public.meta_lead_form_configs(user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_meta_lead_form_configs_form
  ON public.meta_lead_form_configs(form_id)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.meta_leadgen_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  config_id uuid REFERENCES public.meta_lead_form_configs(id) ON DELETE SET NULL,
  page_id text,
  form_id text,
  leadgen_id text NOT NULL,
  ad_id text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (leadgen_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_leadgen_events_unprocessed
  ON public.meta_leadgen_events(created_at)
  WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.meta_form_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config_id uuid REFERENCES public.meta_lead_form_configs(id) ON DELETE SET NULL,
  ad_account_id uuid REFERENCES public.ad_accounts(id) ON DELETE SET NULL,
  ai_crm_lead_id uuid REFERENCES public.ai_crm_leads(id) ON DELETE SET NULL,
  page_id text,
  form_id text NOT NULL,
  form_name text,
  leadgen_id text NOT NULL,
  lead_name text,
  email text,
  phone text,
  field_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  status text NOT NULL DEFAULT 'received' CHECK (status IN (
    'received',
    'crm_created',
    'contacted',
    'waiting_reply',
    'failed',
    'ignored'
  )),
  first_contact_sent_at timestamptz,
  last_error text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_time_meta timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (leadgen_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_form_leads_user_created
  ON public.meta_form_leads(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_meta_form_leads_form
  ON public.meta_form_leads(user_id, form_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_meta_form_leads_crm
  ON public.meta_form_leads(ai_crm_lead_id)
  WHERE ai_crm_lead_id IS NOT NULL;

ALTER TABLE public.meta_lead_form_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_leadgen_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_form_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own meta lead form configs" ON public.meta_lead_form_configs;
CREATE POLICY "Users manage own meta lead form configs"
  ON public.meta_lead_form_configs FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own meta leadgen events" ON public.meta_leadgen_events;
CREATE POLICY "Users read own meta leadgen events"
  ON public.meta_leadgen_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own meta form leads" ON public.meta_form_leads;
CREATE POLICY "Users read own meta form leads"
  ON public.meta_form_leads FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manage meta lead form configs" ON public.meta_lead_form_configs;
CREATE POLICY "Service role manage meta lead form configs"
  ON public.meta_lead_form_configs FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role manage meta leadgen events" ON public.meta_leadgen_events;
CREATE POLICY "Service role manage meta leadgen events"
  ON public.meta_leadgen_events FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role manage meta form leads" ON public.meta_form_leads;
CREATE POLICY "Service role manage meta form leads"
  ON public.meta_form_leads FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_meta_lead_form_configs_updated_at ON public.meta_lead_form_configs;
CREATE TRIGGER trg_meta_lead_form_configs_updated_at
  BEFORE UPDATE ON public.meta_lead_form_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_meta_form_leads_updated_at ON public.meta_form_leads;
CREATE TRIGGER trg_meta_form_leads_updated_at
  BEFORE UPDATE ON public.meta_form_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.meta_lead_form_configs IS
  'Configuracao por formulario Meta Lead Ads: qual Pedro/agente/instancia atende e se faz primeiro contato automatico.';

COMMENT ON TABLE public.meta_leadgen_events IS
  'Inbox bruto/idempotente dos eventos leadgen recebidos via webhook Meta.';

COMMENT ON TABLE public.meta_form_leads IS
  'Leads completos de formularios Meta ja normalizados e ligados ao ai_crm_leads.';
