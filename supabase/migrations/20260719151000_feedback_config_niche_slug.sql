-- ============================================================================
-- Vincula feedback_config ao perfil de nicho — SEM mudar comportamento.
--
-- feedback_config ja possui a coluna legada `nicho` (text, default logico
-- 'automotivo' no analista) que CONTINUA funcionando e sendo a fonte lida pelo
-- analista hoje. Esta migration apenas disponibiliza a relacao formal com
-- niche_profiles para uso futuro:
--   * niche_slug NOT NULL DEFAULT 'automotive' (backfill automatico das linhas
--     existentes pelo proprio DEFAULT do ADD COLUMN);
--   * FK para niche_profiles(slug) — segura: o seed 'automotive' ja existe.
-- O analista NAO passa a depender de niche_profiles nesta fase.
-- ============================================================================

ALTER TABLE public.feedback_config
  ADD COLUMN IF NOT EXISTS niche_slug text NOT NULL DEFAULT 'automotive';

DO $$ BEGIN
  ALTER TABLE public.feedback_config
    ADD CONSTRAINT feedback_config_niche_slug_fkey
    FOREIGN KEY (niche_slug) REFERENCES public.niche_profiles(slug);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.feedback_config.niche_slug IS
  'Perfil de nicho da conta (FK niche_profiles.slug). Base preparatoria para multi-nicho: o analista ainda usa a coluna legada `nicho` e o comportamento em producao segue automotivo por padrao.';
