
ALTER TABLE public.wa_campaigns
  ADD COLUMN IF NOT EXISTS prompt_base text,
  ADD COLUMN IF NOT EXISTS rotation_messages_per_instance integer NOT NULL DEFAULT 10;
