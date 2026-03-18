ALTER TABLE meta_capi_events
  ADD COLUMN IF NOT EXISTS event_id TEXT,
  ADD COLUMN IF NOT EXISTS user_email_hash TEXT,
  ADD COLUMN IF NOT EXISTS user_phone_hash TEXT,
  ADD COLUMN IF NOT EXISTS user_fbp TEXT,
  ADD COLUMN IF NOT EXISTS user_fbc TEXT,
  ADD COLUMN IF NOT EXISTS user_external_id TEXT,
  ADD COLUMN IF NOT EXISTS user_ip TEXT,
  ADD COLUMN IF NOT EXISTS user_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS user_country TEXT,
  ADD COLUMN IF NOT EXISTS user_city TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS value DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS content_name TEXT,
  ADD COLUMN IF NOT EXISTS content_category TEXT,
  ADD COLUMN IF NOT EXISTS content_ids TEXT[],
  ADD COLUMN IF NOT EXISTS content_type TEXT,
  ADD COLUMN IF NOT EXISTS order_id TEXT,
  ADD COLUMN IF NOT EXISTS predicted_ltv DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS num_items INTEGER,
  ADD COLUMN IF NOT EXISTS meta_response JSONB;

CREATE INDEX IF NOT EXISTS idx_capi_events_pixel ON meta_capi_events(pixel_id);
CREATE INDEX IF NOT EXISTS idx_capi_events_status ON meta_capi_events(status);
CREATE INDEX IF NOT EXISTS idx_capi_events_event_time ON meta_capi_events(event_time);
CREATE INDEX IF NOT EXISTS idx_capi_events_event_id ON meta_capi_events(event_id);