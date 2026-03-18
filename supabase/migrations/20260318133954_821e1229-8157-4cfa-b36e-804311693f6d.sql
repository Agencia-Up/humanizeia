-- Add tsvector column for full-text search
ALTER TABLE public.datastore_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Create index for fast text search
CREATE INDEX IF NOT EXISTS idx_datastore_chunks_search_vector ON public.datastore_chunks USING gin(search_vector);

-- Create trigger to auto-update search_vector on insert/update
CREATE OR REPLACE FUNCTION public.update_chunk_search_vector()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.search_vector := to_tsvector('portuguese', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_chunk_search_vector ON public.datastore_chunks;
CREATE TRIGGER trg_update_chunk_search_vector
  BEFORE INSERT OR UPDATE OF content ON public.datastore_chunks
  FOR EACH ROW EXECUTE FUNCTION public.update_chunk_search_vector();

-- Backfill existing chunks
UPDATE public.datastore_chunks SET search_vector = to_tsvector('portuguese', COALESCE(content, '')) WHERE search_vector IS NULL;

-- Create full-text search function
CREATE OR REPLACE FUNCTION public.search_datastore_fulltext(
  p_datastore_id uuid,
  p_query text,
  p_match_count integer DEFAULT 5
)
RETURNS TABLE(id uuid, content text, source_name text, similarity double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    dc.id,
    dc.content,
    ds.name as source_name,
    ts_rank_cd(dc.search_vector, websearch_to_tsquery('portuguese', p_query))::double precision as similarity
  FROM datastore_chunks dc
  JOIN datastore_sources ds ON ds.id = dc.source_id
  WHERE dc.datastore_id = p_datastore_id
    AND dc.search_vector @@ websearch_to_tsquery('portuguese', p_query)
  ORDER BY similarity DESC
  LIMIT p_match_count;
$$;