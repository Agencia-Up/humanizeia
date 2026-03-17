
-- Parte 1: Add UTM/fbclid fields to wa_contacts for attribution tracking
ALTER TABLE public.wa_contacts
  ADD COLUMN IF NOT EXISTS fbclid text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS funnel_stage text DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS funnel_updated_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS capi_events_sent jsonb DEFAULT '[]'::jsonb;

-- Create wa_capi_funnel table for tracking full funnel per contact
CREATE TABLE IF NOT EXISTS public.wa_capi_funnel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  contact_id uuid REFERENCES public.wa_contacts(id) ON DELETE CASCADE,
  phone text NOT NULL,
  pixel_id uuid REFERENCES public.meta_pixels(id) ON DELETE SET NULL,
  funnel_stage text NOT NULL DEFAULT 'lead',
  event_name text NOT NULL,
  event_sent boolean DEFAULT false,
  meta_response jsonb,
  custom_data jsonb DEFAULT '{}'::jsonb,
  value numeric,
  currency text DEFAULT 'BRL',
  fbclid text,
  utm_source text,
  utm_campaign text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  sent_at timestamp with time zone
);

ALTER TABLE public.wa_capi_funnel ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own funnel events"
  ON public.wa_capi_funnel
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
