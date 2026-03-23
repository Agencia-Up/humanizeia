-- Phase 1: Agent Integration (Maria, Paulo, José)
-- Ad Copies table: links copywriter output to campaign usage
CREATE TABLE IF NOT EXISTS ad_copies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  copy_id uuid REFERENCES copies(id) ON DELETE SET NULL, -- link to original copy
  creative_id uuid REFERENCES creative_uploads(id) ON DELETE SET NULL, -- paired creative

  -- Content
  headline text NOT NULL,
  description text,
  primary_text text, -- main body text for Meta ads
  cta text,

  -- Metadata
  platform text DEFAULT 'meta' CHECK (platform IN ('meta', 'google', 'linkedin', 'instagram')),
  ad_type text, -- feed, stories, reels, carousel, search, display
  tone text,
  objective text,
  tags text[] DEFAULT '{}',

  -- AI Scoring
  ai_score integer DEFAULT 0 CHECK (ai_score >= 0 AND ai_score <= 100),
  readability_score integer DEFAULT 0,

  -- Usage tracking
  status text DEFAULT 'available' CHECK (status IN ('available', 'in_use', 'exhausted', 'archived')),
  times_used integer DEFAULT 0,
  used_in_campaigns text[] DEFAULT '{}',

  -- Performance (aggregated)
  performance_score integer DEFAULT 0,
  total_impressions bigint DEFAULT 0,
  total_clicks bigint DEFAULT 0,
  avg_ctr numeric(6,3) DEFAULT 0,
  avg_cpa numeric(10,2) DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Creative-Copy pairing table for smart combinations
CREATE TABLE IF NOT EXISTS creative_copy_pairs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  creative_id uuid REFERENCES creative_uploads(id) ON DELETE CASCADE NOT NULL,
  ad_copy_id uuid REFERENCES ad_copies(id) ON DELETE CASCADE NOT NULL,

  -- Performance when used together
  combined_score integer DEFAULT 0,
  impressions bigint DEFAULT 0,
  clicks bigint DEFAULT 0,
  conversions integer DEFAULT 0,
  ctr numeric(6,3) DEFAULT 0,
  roas numeric(8,3) DEFAULT 0,

  -- Usage
  campaign_id_meta text,
  ad_id_meta text,
  status text DEFAULT 'active',

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(creative_id, ad_copy_id, campaign_id_meta)
);

-- RLS policies
ALTER TABLE ad_copies ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_copy_pairs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own ad_copies" ON ad_copies FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own pairs" ON creative_copy_pairs FOR ALL USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_ad_copies_user_status ON ad_copies(user_id, status);
CREATE INDEX idx_ad_copies_platform ON ad_copies(user_id, platform);
CREATE INDEX idx_ad_copies_performance ON ad_copies(user_id, performance_score DESC);
CREATE INDEX idx_pairs_creative ON creative_copy_pairs(creative_id);
CREATE INDEX idx_pairs_copy ON creative_copy_pairs(ad_copy_id);
