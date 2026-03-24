-- Migration: PME (small business) modules for JOSÉ agent
-- Tables: leads, lead_interactions, sales_data, geo_performance, pme_config

-- 1. leads - Lead tracking from campaigns to WhatsApp
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.ad_accounts(id),
  campaign_id_meta TEXT,
  adset_id_meta TEXT,
  ad_id_meta TEXT,
  campaign_name TEXT,
  source TEXT DEFAULT 'meta_ads', -- meta_ads, google, organic, referral, whatsapp
  channel TEXT DEFAULT 'whatsapp', -- whatsapp, phone, store, website
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  status TEXT DEFAULT 'novo', -- novo, em_atendimento, qualificado, proposta, venda_realizada, nao_qualificado, perdido
  temperature TEXT DEFAULT 'morno', -- quente, morno, frio
  sale_value NUMERIC(12,2),
  sale_date TIMESTAMPTZ,
  notes TEXT,
  tags TEXT[],
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  first_contact_at TIMESTAMPTZ DEFAULT NOW(),
  last_interaction_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leads_user_id ON public.leads(user_id);
CREATE INDEX idx_leads_status ON public.leads(user_id, status);
CREATE INDEX idx_leads_campaign ON public.leads(user_id, campaign_id_meta);
CREATE INDEX idx_leads_created ON public.leads(user_id, created_at DESC);

-- 2. lead_interactions - Interaction history per lead
CREATE TABLE IF NOT EXISTS public.lead_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  interaction_type TEXT NOT NULL, -- message_sent, message_received, call, note, status_change, sale
  content TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lead_interactions_lead ON public.lead_interactions(lead_id, created_at DESC);

-- 3. sales_data - Imported sales for ROI calculation
CREATE TABLE IF NOT EXISTS public.sales_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id),
  campaign_id_meta TEXT,
  campaign_name TEXT,
  sale_value NUMERIC(12,2) NOT NULL,
  cost_value NUMERIC(12,2) DEFAULT 0,
  profit_value NUMERIC(12,2),
  sale_date DATE NOT NULL,
  source TEXT DEFAULT 'manual', -- manual, csv_import, api, whatsapp
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sales_user ON public.sales_data(user_id, sale_date DESC);
CREATE INDEX idx_sales_campaign ON public.sales_data(user_id, campaign_id_meta);

-- 4. geo_performance - Geographic performance snapshots
CREATE TABLE IF NOT EXISTS public.geo_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.ad_accounts(id),
  campaign_id_meta TEXT,
  region TEXT NOT NULL, -- state, city, or custom area
  region_type TEXT DEFAULT 'city', -- country, state, city, dma, zip
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  spend NUMERIC(12,2) DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  ctr NUMERIC(8,4) DEFAULT 0,
  cpc NUMERIC(8,4) DEFAULT 0,
  cpa NUMERIC(12,2) DEFAULT 0,
  roas NUMERIC(8,4) DEFAULT 0,
  date_preset TEXT DEFAULT 'last_30d',
  snapshot_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_geo_user ON public.geo_performance(user_id, snapshot_date DESC);
CREATE INDEX idx_geo_region ON public.geo_performance(user_id, region);

-- 5. pme_config - PME-specific configuration
CREATE TABLE IF NOT EXISTS public.pme_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  business_type TEXT, -- restaurante, clinica, loja, servicos, ecommerce
  monthly_revenue_range TEXT, -- 100k-300k, 300k-500k, 500k-1m
  service_radius_km INTEGER DEFAULT 30,
  target_cities TEXT[],
  target_states TEXT[],
  average_ticket NUMERIC(12,2),
  profit_margin_percent NUMERIC(5,2) DEFAULT 30,
  lead_response_time_target_minutes INTEGER DEFAULT 15,
  gmb_place_id TEXT,
  gmb_api_key TEXT,
  sales_scripts JSONB DEFAULT '[]',
  lead_stale_hours INTEGER DEFAULT 24,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Enable RLS on all tables
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geo_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pme_config ENABLE ROW LEVEL SECURITY;

-- RLS policies: authenticated users can only access their own data
CREATE POLICY "Users can manage own leads" ON public.leads FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own lead_interactions" ON public.lead_interactions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own sales_data" ON public.sales_data FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own geo_performance" ON public.geo_performance FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own pme_config" ON public.pme_config FOR ALL USING (auth.uid() = user_id);
