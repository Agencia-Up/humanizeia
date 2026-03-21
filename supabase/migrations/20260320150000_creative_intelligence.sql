-- ══════════════════════════════════════════════════════════════════════
-- Creative Intelligence: JOSÉ ↔ BEZALEL Integration
-- Performance tracking, A/B testing, auto-selection
-- ══════════════════════════════════════════════════════════════════════

-- 1. Creative Performance — tracks how each creative performs in Meta Ads
CREATE TABLE IF NOT EXISTS public.creative_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  creative_id UUID REFERENCES public.creative_uploads(id) ON DELETE CASCADE,
  ad_account_id TEXT,
  campaign_id_meta TEXT,
  adset_id_meta TEXT,
  ad_id_meta TEXT,
  -- Performance metrics (updated periodically)
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  spend NUMERIC(12,2) DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  revenue NUMERIC(12,2) DEFAULT 0,
  ctr NUMERIC(6,4) DEFAULT 0,
  cpc NUMERIC(8,2) DEFAULT 0,
  cpm NUMERIC(8,2) DEFAULT 0,
  cpa NUMERIC(10,2) DEFAULT 0,
  roas NUMERIC(8,4) DEFAULT 0,
  frequency NUMERIC(6,2) DEFAULT 0,
  -- Composite score (0-100) calculated by JOSÉ
  performance_score INTEGER DEFAULT 50,
  -- Status in the ad
  status TEXT DEFAULT 'pending', -- pending, active, paused, exhausted, replaced
  -- Timestamps
  first_served_at TIMESTAMPTZ,
  last_metric_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.creative_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own creative performance" ON public.creative_performance FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role full access creative_performance" ON public.creative_performance FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_creative_perf_user ON public.creative_performance(user_id);
CREATE INDEX idx_creative_perf_creative ON public.creative_performance(creative_id);
CREATE INDEX idx_creative_perf_campaign ON public.creative_performance(campaign_id_meta);

-- 2. Creative AB Tests — tracks active A/B tests between creatives
CREATE TABLE IF NOT EXISTS public.creative_ab_tests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  campaign_id_meta TEXT NOT NULL,
  adset_id_meta TEXT,
  test_name TEXT,
  -- Variants (creative_ids being tested)
  variant_a_id UUID REFERENCES public.creative_uploads(id),
  variant_b_id UUID REFERENCES public.creative_uploads(id),
  variant_a_perf_id UUID REFERENCES public.creative_performance(id),
  variant_b_perf_id UUID REFERENCES public.creative_performance(id),
  -- Test config
  test_type TEXT DEFAULT 'creative', -- creative, copy, audience
  confidence_threshold NUMERIC(5,2) DEFAULT 95.0, -- statistical significance %
  min_impressions INTEGER DEFAULT 1000,
  -- Results
  status TEXT DEFAULT 'running', -- running, concluded, cancelled
  winner TEXT, -- 'a', 'b', 'inconclusive'
  winner_creative_id UUID REFERENCES public.creative_uploads(id),
  confidence_level NUMERIC(5,2),
  improvement_pct NUMERIC(6,2),
  concluded_at TIMESTAMPTZ,
  -- Timestamps
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.creative_ab_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own ab tests" ON public.creative_ab_tests FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role full access ab_tests" ON public.creative_ab_tests FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_ab_tests_user ON public.creative_ab_tests(user_id);

-- 3. Creative Selection Log — records why JOSÉ chose each creative
CREATE TABLE IF NOT EXISTS public.creative_selection_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  creative_id UUID REFERENCES public.creative_uploads(id),
  campaign_id_meta TEXT,
  action TEXT NOT NULL, -- 'selected', 'replaced', 'promoted', 'retired'
  reason TEXT,
  previous_creative_id UUID REFERENCES public.creative_uploads(id),
  score_at_selection INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.creative_selection_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own selection log" ON public.creative_selection_log FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role full access selection_log" ON public.creative_selection_log FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_selection_log_user ON public.creative_selection_log(user_id);

-- 4. Add performance columns to creative_uploads (the main library)
ALTER TABLE public.creative_uploads
  ADD COLUMN IF NOT EXISTS performance_score INTEGER DEFAULT 50,
  ADD COLUMN IF NOT EXISTS total_impressions BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_clicks BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_spend NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_conversions INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_ctr NUMERIC(6,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_roas NUMERIC(8,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS times_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fatigue_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS best_audience TEXT,
  ADD COLUMN IF NOT EXISTS best_objective TEXT,
  ADD COLUMN IF NOT EXISTS nicho TEXT,
  ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'usuario', -- 'usuario', 'bezalel', 'jose_clone'
  ADD COLUMN IF NOT EXISTS source_creative_id UUID REFERENCES public.creative_uploads(id),
  ADD COLUMN IF NOT EXISTS variation_number INTEGER DEFAULT 0;

-- Service role bypass for all new tables
ALTER TABLE public.creative_performance FORCE ROW LEVEL SECURITY;
ALTER TABLE public.creative_ab_tests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.creative_selection_log FORCE ROW LEVEL SECURITY;
