
-- Module 1: Multi-Integration - Add provider and meta_config to wa_instances
ALTER TABLE public.wa_instances 
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'evolution',
  ADD COLUMN IF NOT EXISTS meta_config jsonb DEFAULT '{}'::jsonb;

-- Module 2: Smart Switcher - Add last_used_at to wa_instances
ALTER TABLE public.wa_instances 
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz DEFAULT NULL;

-- Module 3: Message Polymorphism - Add variation_level to wa_campaigns
ALTER TABLE public.wa_campaigns 
  ADD COLUMN IF NOT EXISTS variation_level text NOT NULL DEFAULT 'medium';

-- Comment for clarity
COMMENT ON COLUMN public.wa_instances.provider IS 'API provider: evolution or meta';
COMMENT ON COLUMN public.wa_instances.meta_config IS 'Meta API config: phone_number_id, waba_id, access_token_encrypted';
COMMENT ON COLUMN public.wa_instances.last_used_at IS 'Last time this instance was used to send a message';
COMMENT ON COLUMN public.wa_campaigns.variation_level IS 'AI variation level: low, medium, high';
