
-- Inbox table for incoming and outgoing messages
CREATE TABLE public.wa_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  instance_id uuid REFERENCES public.wa_instances(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.wa_campaigns(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.wa_contacts(id) ON DELETE SET NULL,
  phone text NOT NULL,
  contact_name text,
  direction text NOT NULL DEFAULT 'incoming' CHECK (direction IN ('incoming', 'outgoing')),
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'video', 'audio', 'document', 'sticker')),
  content text,
  media_url text,
  ai_category text,
  ai_sentiment text,
  is_read boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  remote_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wa_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own inbox" ON public.wa_inbox
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role needs to insert from webhook (no auth context)
CREATE POLICY "Service can insert inbox" ON public.wa_inbox
  FOR INSERT TO anon
  WITH CHECK (true);

-- Enable realtime for live chat updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_inbox;

-- Indexes
CREATE INDEX idx_wa_inbox_user_phone ON public.wa_inbox (user_id, phone, created_at DESC);
CREATE INDEX idx_wa_inbox_unread ON public.wa_inbox (user_id, is_read) WHERE is_read = false;
