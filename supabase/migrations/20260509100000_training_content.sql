-- Tabelas para area de Treinamento (Netflix-style)

CREATE TABLE IF NOT EXISTS training_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid REFERENCES training_sections(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  description text,
  video_url text NOT NULL,
  platform text NOT NULL DEFAULT 'youtube',
  thumbnail_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE training_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY training_sections_user ON training_sections FOR ALL USING (auth.uid() = user_id);
CREATE POLICY training_videos_user ON training_videos FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_training_sections_user ON training_sections(user_id);
CREATE INDEX IF NOT EXISTS idx_training_videos_section ON training_videos(section_id);

-- Adiciona colunas extras ao profiles (caso nao existam)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS whatsapp_support text;

-- Storage bucket para avatars (ignora se ja existir)
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Politica de upload para avatars
CREATE POLICY avatars_user_upload ON storage.objects FOR ALL
  USING (bucket_id = 'avatars' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'avatars' AND (auth.uid())::text = (storage.foldername(name))[1]);
