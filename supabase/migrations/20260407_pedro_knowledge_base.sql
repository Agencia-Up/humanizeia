-- ============================================================
-- PEDRO v2.0 — Base de Conhecimento (RAG)
-- Inspirado no Chatvolt AI: bases separadas por agente
-- Aplicar no: Supabase Dashboard → SQL Editor
-- ============================================================

-- Habilitar extensão pgvector (necessário para embeddings)
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── 1. BASES DE CONHECIMENTO ───────────────────────────────
-- Repositório central, pode ser reutilizado por múltiplos agentes
CREATE TABLE IF NOT EXISTS public.knowledge_bases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.wa_ai_agents(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN DEFAULT false,
  rag_restricted BOOLEAN DEFAULT false, -- Agente responde SOMENTE com a KB
  icon TEXT DEFAULT '📚',
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

-- RLS
ALTER TABLE public.knowledge_bases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kb_select" ON public.knowledge_bases FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "kb_insert" ON public.knowledge_bases FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "kb_update" ON public.knowledge_bases FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "kb_delete" ON public.knowledge_bases FOR DELETE USING (auth.uid() = user_id);

-- ─── 2. FONTES DE DADOS ─────────────────────────────────────
-- Cada fonte pertence a uma base e pode ter vários chunks
CREATE TABLE IF NOT EXISTS public.knowledge_sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  kb_id UUID NOT NULL REFERENCES public.knowledge_bases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('text', 'qa', 'url', 'pdf', 'youtube')),
  name TEXT NOT NULL,
  content TEXT, -- Conteúdo bruto da fonte
  metadata JSONB DEFAULT '{}'::jsonb, -- url, file_path, youtube_id, etc.
  token_count INTEGER DEFAULT 0,
  chunk_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'synced', 'error')),
  error_message TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

-- RLS
ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ks_select" ON public.knowledge_sources FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ks_insert" ON public.knowledge_sources FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ks_update" ON public.knowledge_sources FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "ks_delete" ON public.knowledge_sources FOR DELETE USING (auth.uid() = user_id);

-- Índice para busca por KB
CREATE INDEX IF NOT EXISTS idx_ks_kb_id ON public.knowledge_sources(kb_id);
CREATE INDEX IF NOT EXISTS idx_ks_status ON public.knowledge_sources(status);

-- ─── 3. CHUNKS COM EMBEDDINGS (pgvector) ────────────────────
-- Cada chunk é um pedaço da fonte com seu vetor de embedding
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES public.knowledge_sources(id) ON DELETE CASCADE,
  kb_id UUID NOT NULL REFERENCES public.knowledge_bases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(1536), -- text-embedding-3-small da OpenAI
  chunk_index INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

-- RLS
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kc_select" ON public.knowledge_chunks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "kc_insert" ON public.knowledge_chunks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "kc_delete" ON public.knowledge_chunks FOR DELETE USING (auth.uid() = user_id);

-- Índice vetorial para busca semântica (cosine similarity)
CREATE INDEX IF NOT EXISTS idx_kc_embedding ON public.knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Índice para filtrar por KB
CREATE INDEX IF NOT EXISTS idx_kc_kb_id ON public.knowledge_chunks(kb_id);

-- ─── 4. VINCULAR KB AO AGENTE ───────────────────────────────
-- Um agente pode ter múltiplas KBs vinculadas (many-to-many)
CREATE TABLE IF NOT EXISTS public.agent_knowledge_bases (
  agent_id UUID NOT NULL REFERENCES public.wa_ai_agents(id) ON DELETE CASCADE,
  kb_id UUID NOT NULL REFERENCES public.knowledge_bases(id) ON DELETE CASCADE,
  priority INTEGER DEFAULT 0, -- Ordem de busca (0 = maior prioridade)
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL,
  PRIMARY KEY (agent_id, kb_id)
);

-- RLS
ALTER TABLE public.agent_knowledge_bases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "akb_select" ON public.agent_knowledge_bases FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.knowledge_bases kb WHERE kb.id = kb_id AND kb.user_id = auth.uid()));
CREATE POLICY "akb_insert" ON public.agent_knowledge_bases FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.knowledge_bases kb WHERE kb.id = kb_id AND kb.user_id = auth.uid()));
CREATE POLICY "akb_delete" ON public.agent_knowledge_bases FOR DELETE 
  USING (EXISTS (SELECT 1 FROM public.knowledge_bases kb WHERE kb.id = kb_id AND kb.user_id = auth.uid()));

-- ─── 5. FUNÇÃO DE BUSCA SEMÂNTICA ───────────────────────────
-- Função para o Pedro usar: busca os chunks mais relevantes para uma query
CREATE OR REPLACE FUNCTION public.search_knowledge(
  query_embedding vector(1536),
  kb_ids UUID[],
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  source_id UUID,
  kb_id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.source_id,
    kc.kb_id,
    kc.content,
    kc.metadata,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.kb_id = ANY(kb_ids)
    AND 1 - (kc.embedding <=> query_embedding) > match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ─── 6. TRIGGER updated_at ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kb_updated_at ON public.knowledge_bases;
CREATE TRIGGER kb_updated_at BEFORE UPDATE ON public.knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS ks_updated_at ON public.knowledge_sources;
CREATE TRIGGER ks_updated_at BEFORE UPDATE ON public.knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
