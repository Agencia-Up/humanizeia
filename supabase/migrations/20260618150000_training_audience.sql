-- ============================================================================
-- Treinamento: PÚBLICO por aula (vendedor vê só as dele; master vê todas)
-- ----------------------------------------------------------------------------
-- A biblioteca continua global (is_global), mas cada aula ganha um público:
--   'all'    -> todos veem (padrão)
--   'seller' -> feita PRA VENDEDOR (master também vê, pois vê tudo)
--   'master' -> só dono/master (vendedor NÃO vê)
-- A filtragem por papel é feita no frontend (conteúdo educativo, não sensível):
-- vendedor vê audience IN ('all','seller'); master/owner vê tudo.
-- ============================================================================

ALTER TABLE public.training_videos
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'all';
