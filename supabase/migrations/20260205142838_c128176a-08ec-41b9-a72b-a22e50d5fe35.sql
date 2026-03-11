-- =====================================================
-- TRAFFICAI PRO - BANCO DE DADOS DE INTELIGÊNCIA
-- Sistema completo para aprendizado contínuo de IA
-- =====================================================

-- ENUMS para padronização
CREATE TYPE public.platform_type AS ENUM ('meta', 'google', 'tiktok', 'linkedin');
CREATE TYPE public.campaign_status AS ENUM ('active', 'paused', 'ended', 'draft');
CREATE TYPE public.creative_type AS ENUM ('image', 'video', 'carousel', 'stories', 'reels');
CREATE TYPE public.copy_type AS ENUM ('headline', 'description', 'cta', 'full_ad');
CREATE TYPE public.test_status AS ENUM ('running', 'paused', 'completed', 'winner_selected');
CREATE TYPE public.insight_type AS ENUM ('warning', 'opportunity', 'success', 'critical', 'info');
CREATE TYPE public.insight_category AS ENUM ('performance', 'budget', 'audience', 'creative', 'copy', 'timing');
CREATE TYPE public.rule_action_type AS ENUM ('pause', 'activate', 'increase_budget', 'decrease_budget', 'notify', 'change_bid');

-- =====================================================
-- 1. PERFIS DE USUÁRIO
-- =====================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  company_name TEXT,
  industry TEXT,
  monthly_ad_spend_range TEXT,
  experience_level TEXT DEFAULT 'intermediate',
  timezone TEXT DEFAULT 'America/Sao_Paulo',
  preferred_language TEXT DEFAULT 'pt-BR',
  onboarding_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. CONTAS DE ANÚNCIOS CONECTADAS
-- =====================================================
CREATE TABLE public.ad_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  platform platform_type NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  access_token_encrypted TEXT,
  last_sync_at TIMESTAMPTZ,
  currency TEXT DEFAULT 'BRL',
  timezone TEXT DEFAULT 'America/Sao_Paulo',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform, account_id)
);

-- =====================================================
-- 3. CAMPANHAS (Dados importados das plataformas)
-- =====================================================
CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  ad_account_id UUID REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  external_id TEXT, -- ID na plataforma original
  platform platform_type NOT NULL,
  name TEXT NOT NULL,
  status campaign_status DEFAULT 'draft',
  objective TEXT, -- conversions, traffic, awareness, etc
  daily_budget DECIMAL(12,2),
  lifetime_budget DECIMAL(12,2),
  start_date DATE,
  end_date DATE,
  
  -- Configurações de targeting
  target_audience JSONB DEFAULT '{}',
  placements JSONB DEFAULT '[]',
  
  -- Tags e categorização interna
  tags TEXT[] DEFAULT '{}',
  category TEXT,
  notes TEXT,
  
  -- Flags de IA
  ai_optimized BOOLEAN DEFAULT FALSE,
  ai_score INTEGER, -- 0-100
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 4. MÉTRICAS DE CAMPANHAS (Histórico diário)
-- =====================================================
CREATE TABLE public.campaign_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  
  -- Métricas de custo
  spend DECIMAL(12,2) DEFAULT 0,
  
  -- Métricas de alcance
  impressions INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  frequency DECIMAL(6,2) DEFAULT 0,
  
  -- Métricas de engajamento
  clicks INTEGER DEFAULT 0,
  ctr DECIMAL(6,4) DEFAULT 0, -- Click-through rate
  cpc DECIMAL(8,4) DEFAULT 0, -- Cost per click
  cpm DECIMAL(8,4) DEFAULT 0, -- Cost per mille
  
  -- Métricas de conversão
  conversions INTEGER DEFAULT 0,
  conversion_value DECIMAL(12,2) DEFAULT 0,
  cpa DECIMAL(10,4) DEFAULT 0, -- Cost per acquisition
  roas DECIMAL(8,4) DEFAULT 0, -- Return on ad spend
  
  -- Métricas de vídeo
  video_views INTEGER DEFAULT 0,
  video_views_25 INTEGER DEFAULT 0,
  video_views_50 INTEGER DEFAULT 0,
  video_views_75 INTEGER DEFAULT 0,
  video_views_100 INTEGER DEFAULT 0,
  
  -- Métricas de engajamento social
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  
  -- Métricas por hora do dia (para análise de timing)
  hourly_data JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, date)
);

-- =====================================================
-- 5. CRIATIVOS (Imagens e Vídeos)
-- =====================================================
CREATE TABLE public.creatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  name TEXT NOT NULL,
  type creative_type NOT NULL,
  platform platform_type,
  
  -- Arquivos
  file_url TEXT NOT NULL,
  thumbnail_url TEXT,
  file_size_bytes INTEGER,
  dimensions TEXT, -- ex: "1080x1080"
  duration_seconds INTEGER, -- para vídeos
  
  -- Conteúdo
  primary_text TEXT,
  headline TEXT,
  description TEXT,
  cta_text TEXT,
  
  -- Análise de IA
  ai_analysis JSONB DEFAULT '{}', -- cores, objetos, sentimento, etc
  ai_score INTEGER, -- 0-100
  ai_suggestions TEXT[],
  
  -- Categorização
  tags TEXT[] DEFAULT '{}',
  category TEXT,
  style TEXT, -- minimal, bold, lifestyle, etc
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  is_template BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 6. PERFORMANCE DE CRIATIVOS (Histórico)
-- =====================================================
CREATE TABLE public.creative_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id UUID REFERENCES public.creatives(id) ON DELETE CASCADE NOT NULL,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  ctr DECIMAL(6,4) DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  cpa DECIMAL(10,4) DEFAULT 0,
  spend DECIMAL(12,2) DEFAULT 0,
  roas DECIMAL(8,4) DEFAULT 0,
  
  -- Engajamento
  engagement_rate DECIMAL(6,4) DEFAULT 0,
  thumb_stop_rate DECIMAL(6,4) DEFAULT 0, -- para vídeos
  hook_rate DECIMAL(6,4) DEFAULT 0, -- 3s video views / impressions
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(creative_id, campaign_id, date)
);

-- =====================================================
-- 7. COPIES (Textos de Anúncios)
-- =====================================================
CREATE TABLE public.copies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  type copy_type NOT NULL,
  platform platform_type,
  
  -- Conteúdo
  content TEXT NOT NULL,
  headline TEXT,
  description TEXT,
  cta TEXT,
  
  -- Contexto
  product_name TEXT,
  product_category TEXT,
  target_audience TEXT,
  tone TEXT, -- professional, casual, urgent, etc
  objective TEXT, -- conversion, awareness, engagement
  
  -- Análise de IA
  ai_score INTEGER, -- 0-100
  ai_feedback TEXT,
  readability_score DECIMAL(5,2),
  sentiment_score DECIMAL(5,2),
  power_words TEXT[],
  character_count INTEGER,
  word_count INTEGER,
  
  -- Fórmula usada
  formula TEXT, -- AIDA, PAS, BAB, etc
  
  -- Categorização
  tags TEXT[] DEFAULT '{}',
  is_template BOOLEAN DEFAULT FALSE,
  is_favorite BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 8. PERFORMANCE DE COPIES (Histórico)
-- =====================================================
CREATE TABLE public.copy_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  copy_id UUID REFERENCES public.copies(id) ON DELETE CASCADE NOT NULL,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  creative_id UUID REFERENCES public.creatives(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  ctr DECIMAL(6,4) DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  cpa DECIMAL(10,4) DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(copy_id, campaign_id, date)
);

-- =====================================================
-- 9. TESTES A/B
-- =====================================================
CREATE TABLE public.ab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  
  name TEXT NOT NULL,
  hypothesis TEXT,
  test_type TEXT, -- creative, copy, audience, placement, etc
  status test_status DEFAULT 'running',
  
  -- Configuração do teste
  start_date DATE,
  end_date DATE,
  min_sample_size INTEGER DEFAULT 1000,
  confidence_level DECIMAL(5,2) DEFAULT 95.00,
  
  -- Resultados
  winner_variant_id UUID,
  statistical_significance DECIMAL(5,2),
  lift_percentage DECIMAL(8,2),
  
  -- Insights gerados
  insights TEXT[],
  learnings TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 10. VARIANTES DE TESTES A/B
-- =====================================================
CREATE TABLE public.ab_test_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID REFERENCES public.ab_tests(id) ON DELETE CASCADE NOT NULL,
  
  name TEXT NOT NULL, -- ex: "Variante A", "Controle"
  description TEXT,
  is_control BOOLEAN DEFAULT FALSE,
  
  -- Referências ao conteúdo
  creative_id UUID REFERENCES public.creatives(id) ON DELETE SET NULL,
  copy_id UUID REFERENCES public.copies(id) ON DELETE SET NULL,
  audience_config JSONB DEFAULT '{}',
  
  -- Métricas acumuladas
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  spend DECIMAL(12,2) DEFAULT 0,
  ctr DECIMAL(6,4) DEFAULT 0,
  cpa DECIMAL(10,4) DEFAULT 0,
  roas DECIMAL(8,4) DEFAULT 0,
  
  -- Análise estatística
  conversion_rate DECIMAL(8,6) DEFAULT 0,
  confidence_interval_lower DECIMAL(8,6),
  confidence_interval_upper DECIMAL(8,6),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 11. INSIGHTS DA IA (Recomendações automáticas)
-- =====================================================
CREATE TABLE public.ai_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  type insight_type NOT NULL,
  category insight_category NOT NULL,
  
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  detailed_analysis TEXT,
  
  -- Referências
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  creative_id UUID REFERENCES public.creatives(id) ON DELETE SET NULL,
  copy_id UUID REFERENCES public.copies(id) ON DELETE SET NULL,
  
  -- Impacto estimado
  impact_metric TEXT, -- ex: "CPA", "ROAS", "CTR"
  impact_value TEXT, -- ex: "-15%", "+R$ 500/dia"
  confidence_score DECIMAL(5,2), -- 0-100
  priority INTEGER DEFAULT 5, -- 1-10
  
  -- Ação recomendada
  recommended_action TEXT,
  action_taken BOOLEAN DEFAULT FALSE,
  action_date TIMESTAMPTZ,
  action_result TEXT,
  
  -- Status
  is_read BOOLEAN DEFAULT FALSE,
  is_dismissed BOOLEAN DEFAULT FALSE,
  is_pinned BOOLEAN DEFAULT FALSE,
  
  -- Validade
  valid_until TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 12. REGRAS AUTOMATIZADAS
-- =====================================================
CREATE TABLE public.automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Escopo
  apply_to_campaigns UUID[] DEFAULT '{}',
  apply_to_platforms platform_type[] DEFAULT '{}',
  
  -- Condições (JSONB para flexibilidade)
  conditions JSONB NOT NULL, -- ex: [{"metric": "cpa", "operator": ">", "value": 30}]
  condition_logic TEXT DEFAULT 'AND', -- AND, OR
  
  -- Ação
  action_type rule_action_type NOT NULL,
  action_config JSONB DEFAULT '{}', -- ex: {"percentage": 20} para budget changes
  
  -- Frequência
  check_frequency TEXT DEFAULT '1h', -- 15m, 30m, 1h, 6h, 24h
  last_triggered_at TIMESTAMPTZ,
  trigger_count INTEGER DEFAULT 0,
  
  -- Notificações
  notify_on_trigger BOOLEAN DEFAULT TRUE,
  notification_channels TEXT[] DEFAULT '{"email"}',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 13. LOG DE EXECUÇÃO DE REGRAS
-- =====================================================
CREATE TABLE public.rule_execution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES public.automation_rules(id) ON DELETE CASCADE NOT NULL,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  conditions_met JSONB NOT NULL, -- Snapshot das condições que acionaram
  action_taken TEXT NOT NULL,
  action_result TEXT,
  success BOOLEAN DEFAULT TRUE,
  error_message TEXT,
  
  -- Métricas no momento do trigger
  metrics_snapshot JSONB DEFAULT '{}'
);

-- =====================================================
-- 14. AUDIÊNCIAS (Públicos salvos)
-- =====================================================
CREATE TABLE public.audiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  name TEXT NOT NULL,
  description TEXT,
  platform platform_type,
  external_id TEXT, -- ID na plataforma
  
  -- Configuração
  audience_type TEXT, -- custom, lookalike, saved, interest
  source TEXT, -- website, customer_list, engagement, etc
  size_estimate INTEGER,
  
  -- Targeting detalhado
  targeting_config JSONB DEFAULT '{}',
  
  -- Performance histórica
  avg_cpa DECIMAL(10,4),
  avg_roas DECIMAL(8,4),
  avg_ctr DECIMAL(6,4),
  total_spend DECIMAL(14,2) DEFAULT 0,
  total_conversions INTEGER DEFAULT 0,
  
  -- Análise de IA
  ai_score INTEGER, -- 0-100
  ai_insights TEXT[],
  
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 15. ANÁLISE DE CONCORRENTES (Swipe File)
-- =====================================================
CREATE TABLE public.competitor_ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  competitor_name TEXT,
  platform platform_type,
  
  -- Conteúdo capturado
  image_url TEXT,
  video_url TEXT,
  headline TEXT,
  description TEXT,
  cta TEXT,
  landing_page_url TEXT,
  
  -- Análise
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  ai_analysis JSONB DEFAULT '{}',
  
  -- Inspiração
  is_favorite BOOLEAN DEFAULT FALSE,
  inspiration_notes TEXT,
  
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 16. HISTÓRICO DE APRENDIZADOS DA IA
-- =====================================================
CREATE TABLE public.ai_learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  category TEXT NOT NULL, -- creative, copy, audience, timing, budget
  subcategory TEXT,
  
  learning TEXT NOT NULL,
  evidence JSONB DEFAULT '{}', -- dados que suportam o aprendizado
  confidence_score DECIMAL(5,2), -- 0-100
  
  -- Contexto
  campaigns_analyzed INTEGER DEFAULT 0,
  data_points INTEGER DEFAULT 0,
  date_range_start DATE,
  date_range_end DATE,
  
  -- Aplicabilidade
  applicable_to JSONB DEFAULT '{}', -- produtos, audiências, etc
  
  -- Status
  is_validated BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 17. RELATÓRIOS SALVOS
-- =====================================================
CREATE TABLE public.saved_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  name TEXT NOT NULL,
  description TEXT,
  report_type TEXT, -- performance, creative, audience, comparison
  
  -- Configuração
  config JSONB NOT NULL, -- métricas, filtros, período, etc
  
  -- Agendamento
  is_scheduled BOOLEAN DEFAULT FALSE,
  schedule_frequency TEXT, -- daily, weekly, monthly
  schedule_day INTEGER, -- dia da semana ou mês
  schedule_time TIME,
  recipients TEXT[],
  
  last_generated_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 18. NOTIFICAÇÕES DO SISTEMA
-- =====================================================
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  type TEXT NOT NULL, -- insight, rule, alert, report, system
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  
  -- Referências
  reference_type TEXT, -- campaign, creative, copy, rule, etc
  reference_id UUID,
  
  -- Status
  is_read BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  
  -- Ação
  action_url TEXT,
  action_label TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 19. ATIVIDADES DO USUÁRIO (Audit Log)
-- =====================================================
CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  action TEXT NOT NULL, -- created, updated, deleted, generated, optimized
  entity_type TEXT NOT NULL, -- campaign, creative, copy, rule, etc
  entity_id UUID,
  entity_name TEXT,
  
  details JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- ÍNDICES PARA PERFORMANCE
-- =====================================================

-- Campanhas
CREATE INDEX idx_campaigns_user ON public.campaigns(user_id);
CREATE INDEX idx_campaigns_platform ON public.campaigns(platform);
CREATE INDEX idx_campaigns_status ON public.campaigns(status);
CREATE INDEX idx_campaigns_dates ON public.campaigns(start_date, end_date);

-- Métricas de campanha
CREATE INDEX idx_campaign_metrics_date ON public.campaign_metrics(date);
CREATE INDEX idx_campaign_metrics_campaign_date ON public.campaign_metrics(campaign_id, date);

-- Criativos
CREATE INDEX idx_creatives_user ON public.creatives(user_id);
CREATE INDEX idx_creatives_type ON public.creatives(type);
CREATE INDEX idx_creatives_tags ON public.creatives USING GIN(tags);

-- Copies
CREATE INDEX idx_copies_user ON public.copies(user_id);
CREATE INDEX idx_copies_type ON public.copies(type);
CREATE INDEX idx_copies_tags ON public.copies USING GIN(tags);

-- Insights
CREATE INDEX idx_insights_user ON public.ai_insights(user_id);
CREATE INDEX idx_insights_type ON public.ai_insights(type);
CREATE INDEX idx_insights_unread ON public.ai_insights(user_id, is_read) WHERE NOT is_read;

-- Notificações
CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id, is_read) WHERE NOT is_read;

-- Activity log
CREATE INDEX idx_activity_user ON public.activity_log(user_id);
CREATE INDEX idx_activity_date ON public.activity_log(created_at);

-- =====================================================
-- RLS POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creative_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copy_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ab_test_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rule_execution_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_learnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Ad accounts policies
CREATE POLICY "Users can manage own ad accounts" ON public.ad_accounts
  FOR ALL USING (auth.uid() = user_id);

-- Campaigns policies
CREATE POLICY "Users can manage own campaigns" ON public.campaigns
  FOR ALL USING (auth.uid() = user_id);

-- Campaign metrics policies (users can view metrics for their campaigns)
CREATE POLICY "Users can view own campaign metrics" ON public.campaign_metrics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c 
      WHERE c.id = campaign_id AND c.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can insert own campaign metrics" ON public.campaign_metrics
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.campaigns c 
      WHERE c.id = campaign_id AND c.user_id = auth.uid()
    )
  );

-- Creatives policies
CREATE POLICY "Users can manage own creatives" ON public.creatives
  FOR ALL USING (auth.uid() = user_id);

-- Creative performance policies
CREATE POLICY "Users can view own creative performance" ON public.creative_performance
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.creatives cr 
      WHERE cr.id = creative_id AND cr.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can insert own creative performance" ON public.creative_performance
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.creatives cr 
      WHERE cr.id = creative_id AND cr.user_id = auth.uid()
    )
  );

-- Copies policies
CREATE POLICY "Users can manage own copies" ON public.copies
  FOR ALL USING (auth.uid() = user_id);

-- Copy performance policies
CREATE POLICY "Users can view own copy performance" ON public.copy_performance
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.copies cp 
      WHERE cp.id = copy_id AND cp.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can insert own copy performance" ON public.copy_performance
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.copies cp 
      WHERE cp.id = copy_id AND cp.user_id = auth.uid()
    )
  );

-- AB tests policies
CREATE POLICY "Users can manage own ab tests" ON public.ab_tests
  FOR ALL USING (auth.uid() = user_id);

-- AB test variants policies
CREATE POLICY "Users can view own test variants" ON public.ab_test_variants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.ab_tests t 
      WHERE t.id = test_id AND t.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can insert own test variants" ON public.ab_test_variants
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ab_tests t 
      WHERE t.id = test_id AND t.user_id = auth.uid()
    )
  );

-- AI insights policies
CREATE POLICY "Users can manage own insights" ON public.ai_insights
  FOR ALL USING (auth.uid() = user_id);

-- Automation rules policies
CREATE POLICY "Users can manage own rules" ON public.automation_rules
  FOR ALL USING (auth.uid() = user_id);

-- Rule execution log policies
CREATE POLICY "Users can view own rule logs" ON public.rule_execution_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.automation_rules r 
      WHERE r.id = rule_id AND r.user_id = auth.uid()
    )
  );

-- Audiences policies
CREATE POLICY "Users can manage own audiences" ON public.audiences
  FOR ALL USING (auth.uid() = user_id);

-- Competitor ads policies
CREATE POLICY "Users can manage own competitor ads" ON public.competitor_ads
  FOR ALL USING (auth.uid() = user_id);

-- AI learnings policies
CREATE POLICY "Users can manage own learnings" ON public.ai_learnings
  FOR ALL USING (auth.uid() = user_id);

-- Saved reports policies
CREATE POLICY "Users can manage own reports" ON public.saved_reports
  FOR ALL USING (auth.uid() = user_id);

-- Notifications policies
CREATE POLICY "Users can manage own notifications" ON public.notifications
  FOR ALL USING (auth.uid() = user_id);

-- Activity log policies
CREATE POLICY "Users can view own activity" ON public.activity_log
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own activity" ON public.activity_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- TRIGGERS PARA UPDATED_AT
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ad_accounts_updated_at BEFORE UPDATE ON public.ad_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_creatives_updated_at BEFORE UPDATE ON public.creatives
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_copies_updated_at BEFORE UPDATE ON public.copies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ab_tests_updated_at BEFORE UPDATE ON public.ab_tests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_automation_rules_updated_at BEFORE UPDATE ON public.automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_audiences_updated_at BEFORE UPDATE ON public.audiences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ai_learnings_updated_at BEFORE UPDATE ON public.ai_learnings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_saved_reports_updated_at BEFORE UPDATE ON public.saved_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- TRIGGER PARA CRIAR PERFIL AUTOMATICAMENTE
-- =====================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();