ALTER TABLE public.wa_campaigns
  ADD COLUMN IF NOT EXISTS reply_auto_tag text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reply_auto_message text DEFAULT NULL;