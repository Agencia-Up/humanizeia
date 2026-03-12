
-- Add health_score and message_count to wa_instances for rotation tracking
ALTER TABLE public.wa_instances
  ADD COLUMN IF NOT EXISTS health_score integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS messages_sent_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_message_at timestamp with time zone;

-- Add index for queue processing performance
CREATE INDEX IF NOT EXISTS idx_wa_queue_pending ON public.wa_queue (status, scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_wa_queue_campaign ON public.wa_queue (campaign_id, status);
