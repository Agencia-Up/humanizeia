
-- Cache table for Meta API data
CREATE TABLE public.meta_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  cache_key text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, cache_key)
);

-- Enable RLS
ALTER TABLE public.meta_cache ENABLE ROW LEVEL SECURITY;

-- Users can only access their own cache
CREATE POLICY "Users can manage own cache"
ON public.meta_cache
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_meta_cache_user_key ON public.meta_cache(user_id, cache_key);

-- Auto-update updated_at
CREATE TRIGGER update_meta_cache_updated_at
BEFORE UPDATE ON public.meta_cache
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
