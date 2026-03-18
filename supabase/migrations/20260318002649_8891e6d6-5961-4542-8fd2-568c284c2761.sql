
-- Table: meta_capi_batches (batch grouping for CAPI events)
CREATE TABLE public.meta_capi_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  pixel_id uuid REFERENCES public.meta_pixels(id) ON DELETE CASCADE NOT NULL,
  batch_size integer NOT NULL DEFAULT 0,
  events_sent integer NOT NULL DEFAULT 0,
  events_failed integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  response_body jsonb DEFAULT NULL,
  error_message text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz DEFAULT NULL
);

ALTER TABLE public.meta_capi_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own capi batches"
  ON public.meta_capi_batches FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add batch_id reference to meta_capi_events
ALTER TABLE public.meta_capi_events
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.meta_capi_batches(id) ON DELETE SET NULL;
