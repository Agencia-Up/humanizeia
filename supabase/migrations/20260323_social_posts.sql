-- social_posts: DAVI Social Media agent table

CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'instagram', -- 'instagram', 'facebook', 'linkedin'
  post_type TEXT NOT NULL DEFAULT 'carousel',  -- 'carousel', 'single_image', 'video', 'story', 'reel'
  status TEXT NOT NULL DEFAULT 'draft',        -- 'draft', 'scheduled', 'published', 'failed'
  caption TEXT NOT NULL DEFAULT '',
  hashtags TEXT[] DEFAULT '{}',
  slides JSONB DEFAULT '[]'::jsonb,             -- CarouselSlide[]
  media_urls TEXT[] DEFAULT '{}',
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  ig_media_id TEXT,
  insights JSONB DEFAULT NULL,                  -- PostInsights
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own social posts"
  ON social_posts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_social_posts_user_status
  ON social_posts(user_id, status);

CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled
  ON social_posts(scheduled_at)
  WHERE status = 'scheduled';

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_social_posts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER social_posts_updated_at
  BEFORE UPDATE ON social_posts
  FOR EACH ROW EXECUTE FUNCTION update_social_posts_updated_at();
