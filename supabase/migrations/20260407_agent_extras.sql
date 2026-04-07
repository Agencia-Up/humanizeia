-- ============================================================
-- PEDRO v2.0 — Extras: Mensagens Rápidas + Colunas Extras
-- Aplicar no: Supabase Dashboard → SQL Editor
-- ============================================================

-- ─── 1. MENSAGENS RÁPIDAS ────────────────────────────────────
-- Atalhos de resposta configuráveis por agente
CREATE TABLE IF NOT EXISTS public.quick_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.wa_ai_agents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

ALTER TABLE public.quick_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qm_select" ON public.quick_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "qm_insert" ON public.quick_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "qm_update" ON public.quick_messages FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "qm_delete" ON public.quick_messages FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_qm_agent_id ON public.quick_messages(agent_id);

-- ─── 2. NOVAS COLUNAS EM wa_ai_agents ────────────────────────
-- Colunas inspiradas no Chatvolt para controle avançado
ALTER TABLE public.wa_ai_agents
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS rag_restricted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS markdown_output BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS prompt_protection BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_messages_per_user INTEGER DEFAULT 0, -- 0 = sem limite
  ADD COLUMN IF NOT EXISTS context_size TEXT DEFAULT 'regular' 
    CHECK (context_size IN ('lite', 'regular', 'medium', 'large', 'extended')),
  ADD COLUMN IF NOT EXISTS enrichment_url TEXT, -- GET request para enriquecer dados do usuário
  ADD COLUMN IF NOT EXISTS widget_enabled BOOLEAN DEFAULT false;
