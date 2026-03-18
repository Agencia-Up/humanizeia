
-- Enable vector extension in public schema so operators work
CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;

-- 1. Datastores table
CREATE TABLE public.datastores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  total_documents integer NOT NULL DEFAULT 0,
  total_chunks integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.datastores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own datastores"
  ON public.datastores FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_datastores_updated_at
  BEFORE UPDATE ON public.datastores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Datastore sources table
CREATE TABLE public.datastore_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  datastore_id uuid NOT NULL REFERENCES public.datastores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  name text NOT NULL,
  source_type text NOT NULL DEFAULT 'text',
  content text,
  url text,
  file_path text,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  chunks_count integer NOT NULL DEFAULT 0,
  tokens_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.datastore_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own datastore sources"
  ON public.datastore_sources FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_datastore_sources_updated_at
  BEFORE UPDATE ON public.datastore_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 3. Datastore chunks table
CREATE TABLE public.datastore_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.datastore_sources(id) ON DELETE CASCADE,
  datastore_id uuid NOT NULL REFERENCES public.datastores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  content text NOT NULL,
  chunk_index integer NOT NULL DEFAULT 0,
  tokens_count integer NOT NULL DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  embedding vector(768),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.datastore_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own datastore chunks"
  ON public.datastore_chunks FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. Similarity search function
CREATE OR REPLACE FUNCTION public.search_datastore_chunks(
  p_datastore_id uuid,
  p_query_embedding vector(768),
  p_match_count integer DEFAULT 5,
  p_match_threshold float DEFAULT 0.5
)
RETURNS TABLE (
  id uuid,
  content text,
  source_name text,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    dc.id,
    dc.content,
    ds.name as source_name,
    1 - (dc.embedding <=> p_query_embedding) as similarity
  FROM datastore_chunks dc
  JOIN datastore_sources ds ON ds.id = dc.source_id
  WHERE dc.datastore_id = p_datastore_id
    AND dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> p_query_embedding) > p_match_threshold
  ORDER BY dc.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

-- 5. Storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('datastore-files', 'datastore-files', false, 10485760, ARRAY['text/plain', 'text/markdown', 'text/csv']);

-- 6. Storage RLS
CREATE POLICY "Users can upload datastore files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'datastore-files' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can read own datastore files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'datastore-files' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own datastore files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'datastore-files' AND (storage.foldername(name))[1] = auth.uid()::text);
