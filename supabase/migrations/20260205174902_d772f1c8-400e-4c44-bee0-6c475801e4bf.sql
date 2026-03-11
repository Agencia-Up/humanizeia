-- Tabela para armazenar integrações de plataformas (Shopify, etc.)
CREATE TABLE public.platform_integrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL,
  api_key_encrypted TEXT,
  store_url TEXT,
  is_active BOOLEAN DEFAULT false,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  sync_status TEXT DEFAULT 'pending',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, platform)
);

-- Enable RLS
ALTER TABLE public.platform_integrations ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own integrations
CREATE POLICY "Users can manage own integrations"
ON public.platform_integrations
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_platform_integrations_updated_at
BEFORE UPDATE ON public.platform_integrations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela para armazenar dados sincronizados da Shopify
CREATE TABLE public.shopify_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  shopify_order_id TEXT NOT NULL,
  order_number TEXT,
  order_date TIMESTAMP WITH TIME ZONE,
  total_price NUMERIC DEFAULT 0,
  subtotal_price NUMERIC DEFAULT 0,
  total_discounts NUMERIC DEFAULT 0,
  total_shipping NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'BRL',
  financial_status TEXT,
  fulfillment_status TEXT,
  customer_email TEXT,
  customer_name TEXT,
  line_items JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, shopify_order_id)
);

-- Enable RLS
ALTER TABLE public.shopify_orders ENABLE ROW LEVEL SECURITY;

-- Users can only view their own orders
CREATE POLICY "Users can view own shopify orders"
ON public.shopify_orders
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own shopify orders"
ON public.shopify_orders
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Tabela para métricas diárias da Shopify
CREATE TABLE public.shopify_daily_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  date DATE NOT NULL,
  total_orders INTEGER DEFAULT 0,
  total_revenue NUMERIC DEFAULT 0,
  total_items_sold INTEGER DEFAULT 0,
  avg_order_value NUMERIC DEFAULT 0,
  new_customers INTEGER DEFAULT 0,
  returning_customers INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

-- Enable RLS
ALTER TABLE public.shopify_daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own shopify metrics"
ON public.shopify_daily_metrics
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);