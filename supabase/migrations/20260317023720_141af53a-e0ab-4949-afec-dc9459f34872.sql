
-- Create creative_uploads table for user-uploaded marketing materials
CREATE TABLE public.creative_uploads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id),
  name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  thumbnail_url TEXT,
  file_type TEXT NOT NULL DEFAULT 'image', -- image, video, carousel, document
  mime_type TEXT,
  file_size_bytes INTEGER,
  dimensions TEXT, -- e.g. "1080x1080"
  duration_seconds INTEGER, -- for videos
  tags TEXT[] DEFAULT '{}',
  category TEXT DEFAULT 'geral', -- produto, lifestyle, prova_social, depoimento, oferta, institucional
  style TEXT, -- minimalista, colorido, dark, clean, etc.
  description TEXT,
  ai_analysis JSONB DEFAULT '{}', -- AI-generated analysis of the creative
  ai_score INTEGER, -- 0-100 quality score
  ai_recommendations TEXT[], -- AI suggestions for improvement
  is_favorite BOOLEAN DEFAULT false,
  used_in_campaigns INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.creative_uploads ENABLE ROW LEVEL SECURITY;

-- RLS policy: users can manage their own uploads
CREATE POLICY "Users can manage own creative uploads"
  ON public.creative_uploads
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for common queries
CREATE INDEX idx_creative_uploads_user_id ON public.creative_uploads(user_id);
CREATE INDEX idx_creative_uploads_category ON public.creative_uploads(category);
CREATE INDEX idx_creative_uploads_file_type ON public.creative_uploads(file_type);
