
-- =============================================
-- MÓDULO HUMANIZE LEADS & DISPARO
-- =============================================

-- 1. wa_instances - Instâncias WhatsApp conectadas
CREATE TABLE public.wa_instances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  friendly_name TEXT NOT NULL,
  api_url TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  phone_number TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected',
  is_active BOOLEAN NOT NULL DEFAULT false,
  last_connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wa_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own wa_instances"
  ON public.wa_instances FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. wa_contact_lists - Listas de contatos
CREATE TABLE public.wa_contact_lists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  contact_count INTEGER NOT NULL DEFAULT 0,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wa_contact_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own wa_contact_lists"
  ON public.wa_contact_lists FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. wa_contacts - Contatos individuais
CREATE TABLE public.wa_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  list_id UUID REFERENCES public.wa_contact_lists(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT,
  group_name TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  tags TEXT[] DEFAULT '{}',
  is_valid BOOLEAN DEFAULT true,
  last_message_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wa_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own wa_contacts"
  ON public.wa_contacts FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. wa_campaigns - Campanhas de disparo em massa
CREATE TABLE public.wa_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_id UUID REFERENCES public.wa_instances(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  message_template TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT,
  list_ids UUID[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  total_contacts INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  min_delay_seconds INTEGER NOT NULL DEFAULT 5,
  max_delay_seconds INTEGER NOT NULL DEFAULT 15,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wa_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own wa_campaigns"
  ON public.wa_campaigns FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 5. wa_queue - Fila de mensagens individuais
CREATE TABLE public.wa_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  campaign_id UUID REFERENCES public.wa_campaigns(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.wa_contacts(id) ON DELETE SET NULL,
  instance_id UUID REFERENCES public.wa_instances(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  scheduled_for TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wa_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own wa_queue"
  ON public.wa_queue FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_wa_contacts_list_id ON public.wa_contacts(list_id);
CREATE INDEX idx_wa_contacts_phone ON public.wa_contacts(phone);
CREATE INDEX idx_wa_queue_campaign_id ON public.wa_queue(campaign_id);
CREATE INDEX idx_wa_queue_status ON public.wa_queue(status);
CREATE INDEX idx_wa_campaigns_status ON public.wa_campaigns(status);
CREATE INDEX idx_wa_instances_user_id ON public.wa_instances(user_id);
