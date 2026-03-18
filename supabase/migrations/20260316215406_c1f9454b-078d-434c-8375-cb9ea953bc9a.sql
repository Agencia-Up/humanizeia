
-- Add delivery tracking columns to wa_queue
ALTER TABLE public.wa_queue 
ADD COLUMN IF NOT EXISTS delivery_confirmed_at timestamptz DEFAULT NULL;

-- Add shadow ban detection columns to wa_instances
ALTER TABLE public.wa_instances 
ADD COLUMN IF NOT EXISTS shadow_ban_suspect boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS consecutive_undelivered integer DEFAULT 0;
