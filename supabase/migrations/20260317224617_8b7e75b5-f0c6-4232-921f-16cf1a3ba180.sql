
-- Table: meta_pixels
CREATE TABLE public.meta_pixels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  pixel_id TEXT NOT NULL,
  pixel_name TEXT NOT NULL,
  access_token_encrypted TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  domain TEXT,
  last_event_at TIMESTAMPTZ,
  events_today INTEGER DEFAULT 0,
  events_total INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, pixel_id)
);

ALTER TABLE public.meta_pixels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own pixels"
  ON public.meta_pixels FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Table: meta_capi_events
CREATE TABLE public.meta_capi_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  pixel_id UUID NOT NULL REFERENCES public.meta_pixels(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_source_url TEXT,
  action_source TEXT NOT NULL DEFAULT 'website',
  user_data JSONB DEFAULT '{}'::jsonb,
  custom_data JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  response_code INTEGER,
  response_body JSONB,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_capi_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own capi events"
  ON public.meta_capi_events FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger for updated_at on meta_pixels
CREATE TRIGGER update_meta_pixels_updated_at
  BEFORE UPDATE ON public.meta_pixels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
