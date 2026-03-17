
-- ============================================
-- APOLLO DIAGNOSTIC SYSTEM - 7 Tables
-- ============================================

-- 1. Health Scores: Score de saúde do funil por estágio
CREATE TABLE public.apollo_health_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE,
  stage text NOT NULL, -- 'topo', 'meio', 'fundo', 'pos_venda'
  score integer NOT NULL DEFAULT 50,
  previous_score integer,
  metrics jsonb DEFAULT '{}'::jsonb,
  trend text DEFAULT 'stable', -- 'up', 'down', 'stable'
  calculated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.apollo_health_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own health scores" ON public.apollo_health_scores FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. Benchmarks: Referências de mercado por segmento
CREATE TABLE public.apollo_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  industry text,
  metric_name text NOT NULL, -- 'ctr', 'cpa', 'roas', 'cpc', 'conversion_rate'
  stage text NOT NULL,
  benchmark_value numeric NOT NULL,
  source text DEFAULT 'internal', -- 'internal', 'industry', 'custom'
  platform text, -- 'meta', 'google', 'tiktok'
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.apollo_benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own benchmarks" ON public.apollo_benchmarks FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. Diagnostics: Problemas identificados pela IA
CREATE TABLE public.apollo_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  health_score_id uuid REFERENCES public.apollo_health_scores(id) ON DELETE SET NULL,
  problem text NOT NULL,
  diagnosis text NOT NULL,
  cause text NOT NULL,
  stage text NOT NULL,
  severity text NOT NULL DEFAULT 'medium', -- 'critical', 'high', 'medium', 'low'
  category text, -- 'creative_fatigue', 'audience_saturation', 'budget_waste', 'landing_page', 'bid_strategy'
  evidence jsonb DEFAULT '{}'::jsonb,
  is_resolved boolean DEFAULT false,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.apollo_diagnostics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own diagnostics" ON public.apollo_diagnostics FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. Recommendations: Ações recomendadas pela IA
CREATE TABLE public.apollo_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  diagnostic_id uuid REFERENCES public.apollo_diagnostics(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL,
  action_type text NOT NULL, -- 'pause', 'adjust_budget', 'change_creative', 'adjust_audience', 'change_bid', 'manual'
  action_config jsonb DEFAULT '{}'::jsonb,
  priority integer DEFAULT 5,
  impact_estimate text,
  status text DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'executed', 'failed'
  executed_at timestamp with time zone,
  result text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.apollo_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own recommendations" ON public.apollo_recommendations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 5. Alerts: Alertas inteligentes em tempo real
CREATE TABLE public.apollo_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  diagnostic_id uuid REFERENCES public.apollo_diagnostics(id) ON DELETE SET NULL,
  level text NOT NULL DEFAULT 'warning', -- 'critical', 'warning', 'info', 'success'
  title text NOT NULL,
  description text NOT NULL,
  metric text,
  current_value text,
  benchmark_value text,
  deviation text,
  actions text[] DEFAULT '{}',
  is_read boolean DEFAULT false,
  is_dismissed boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.apollo_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own alerts" ON public.apollo_alerts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Enable realtime for alerts
ALTER PUBLICATION supabase_realtime ADD TABLE public.apollo_alerts;

-- 6. Action Log: Histórico de ações executadas
CREATE TABLE public.apollo_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  recommendation_id uuid REFERENCES public.apollo_recommendations(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  action_details jsonb DEFAULT '{}'::jsonb,
  before_state jsonb DEFAULT '{}'::jsonb,
  after_state jsonb DEFAULT '{}'::jsonb,
  success boolean DEFAULT true,
  error_message text,
  executed_by text DEFAULT 'user', -- 'user', 'auto', 'apollo'
  executed_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.apollo_action_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own action log" ON public.apollo_action_log FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 7. Learning: Aprendizados acumulados do Apollo
CREATE TABLE public.apollo_learning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category text NOT NULL, -- 'creative', 'audience', 'budget', 'timing', 'copy'
  insight text NOT NULL,
  evidence jsonb DEFAULT '{}'::jsonb,
  confidence numeric DEFAULT 0.5,
  times_validated integer DEFAULT 0,
  is_active boolean DEFAULT true,
  source_campaigns uuid[] DEFAULT '{}',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.apollo_learning ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own learning" ON public.apollo_learning FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Index for performance
CREATE INDEX idx_apollo_health_user_stage ON public.apollo_health_scores(user_id, stage);
CREATE INDEX idx_apollo_diagnostics_user ON public.apollo_diagnostics(user_id, is_resolved);
CREATE INDEX idx_apollo_alerts_user ON public.apollo_alerts(user_id, is_read);
CREATE INDEX idx_apollo_recommendations_user ON public.apollo_recommendations(user_id, status);
