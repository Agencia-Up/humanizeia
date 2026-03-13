
-- Add columns to wa_queue for contact personalization and delivery tracking
ALTER TABLE public.wa_queue 
  ADD COLUMN IF NOT EXISTS contact_metadata jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS contact_name text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS message_hash text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS read_at timestamptz DEFAULT NULL;

-- Add unique constraint for deduplication (campaign_id + contact_id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wa_queue_campaign_contact_unique'
  ) THEN
    ALTER TABLE public.wa_queue 
      ADD CONSTRAINT wa_queue_campaign_contact_unique UNIQUE (campaign_id, contact_id);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Constraint may already exist or contacts can be null';
END $$;

-- Add last_message_at to wa_contacts if not exists
ALTER TABLE public.wa_contacts 
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz DEFAULT NULL;

-- Create decrement_instance_health function
CREATE OR REPLACE FUNCTION public.decrement_instance_health(instance_id uuid, decrement_value integer DEFAULT 30)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_score integer;
BEGIN
  UPDATE wa_instances
  SET health_score = GREATEST(0, health_score - decrement_value),
      updated_at = now()
  WHERE id = instance_id
  RETURNING health_score INTO new_score;
  
  -- Auto-disable instance if health too low
  IF new_score IS NOT NULL AND new_score < 20 THEN
    UPDATE wa_instances
    SET is_active = false
    WHERE id = instance_id;
  END IF;
END;
$$;

-- Create increment_campaign_delivered function
CREATE OR REPLACE FUNCTION public.increment_campaign_delivered(cid uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE wa_campaigns
  SET delivered_count = COALESCE(delivered_count, 0) + 1,
      updated_at = now()
  WHERE id = cid;
$$;

-- Add delivered_count column to wa_campaigns if not exists
ALTER TABLE public.wa_campaigns
  ADD COLUMN IF NOT EXISTS delivered_count integer DEFAULT 0;

-- Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
