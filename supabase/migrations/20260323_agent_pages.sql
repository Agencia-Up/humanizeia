-- email_drafts: JOÃO Email Marketing agent

CREATE TABLE IF NOT EXISTS email_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '',
  preview_text TEXT DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  goal TEXT DEFAULT 'nurturing',
  tone TEXT DEFAULT 'amigavel',
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'scheduled', 'sent'
  open_rate NUMERIC(5,2),
  click_rate NUMERIC(5,2),
  sent_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE email_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own email drafts"
  ON email_drafts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_email_drafts_user_status
  ON email_drafts(user_id, status);

-- strategy_plans: DANIEL Estratégia agent

CREATE TABLE IF NOT EXISTS strategy_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  strategy_type TEXT NOT NULL,
  plan_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE strategy_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own strategy plans"
  ON strategy_plans FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
