-- Pedro/Staging schema backfill.
-- These columns/tables existed in the live project through manual evolution, but
-- older bootstrap migrations did not fully recreate them in a fresh Supabase project.

ALTER TABLE public.ai_team_members
  ADD COLUMN IF NOT EXISTS auth_user_id UUID;

CREATE INDEX IF NOT EXISTS idx_ai_team_members_auth_user_id
  ON public.ai_team_members(auth_user_id);

ALTER TABLE public.ai_crm_leads
  ADD COLUMN IF NOT EXISTS assigned_to_id UUID REFERENCES public.ai_team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN NOT NULL DEFAULT false;

UPDATE public.ai_crm_leads
SET assigned_to_id = assigned_to_member_id
WHERE assigned_to_id IS NULL AND assigned_to_member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_crm_leads_assigned_to_id
  ON public.ai_crm_leads(assigned_to_id);

CREATE INDEX IF NOT EXISTS idx_ai_crm_leads_ai_paused
  ON public.ai_crm_leads(ai_paused);

CREATE TABLE IF NOT EXISTS public.jose_segment_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  icon TEXT,
  description TEXT,
  benchmarks JSONB DEFAULT '{}'::jsonb,
  rules JSONB DEFAULT '[]'::jsonb,
  seasonal_insights JSONB DEFAULT '[]'::jsonb,
  knowledge_base JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.jose_segment_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jose_segment_profiles_read" ON public.jose_segment_profiles;
CREATE POLICY "jose_segment_profiles_read"
  ON public.jose_segment_profiles
  FOR SELECT
  USING (true);
