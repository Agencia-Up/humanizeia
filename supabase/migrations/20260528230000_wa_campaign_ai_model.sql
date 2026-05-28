-- ============================================================================
-- 28/05/2026 — Seletor de modelo OpenAI para o Disparo em Massa (Marcos)
-- ----------------------------------------------------------------------------
-- Adiciona a coluna `ai_model` em wa_campaigns para o usuario escolher entre:
--   'gpt-4o'      -> Mais Inteligente (melhor qualidade de copy, custo maior)
--   'gpt-4o-mini' -> Economico (economiza tokens, mais rapido/barato)
--
-- Default 'gpt-4o' (alinhado com a prevue preview-wa-variations atual e com a
-- demanda de "ter inteligencia" na geracao). Idempotente.
-- ============================================================================

ALTER TABLE public.wa_campaigns
  ADD COLUMN IF NOT EXISTS ai_model text NOT NULL DEFAULT 'gpt-4o';

-- CHECK idempotente (Postgres nao suporta ADD CONSTRAINT IF NOT EXISTS direto)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wa_campaigns_ai_model_check'
  ) THEN
    ALTER TABLE public.wa_campaigns
      ADD CONSTRAINT wa_campaigns_ai_model_check
      CHECK (ai_model IN ('gpt-4o', 'gpt-4o-mini'));
  END IF;
END $$;

DO $$
DECLARE
  col_count integer;
BEGIN
  SELECT count(*) INTO col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'wa_campaigns'
    AND column_name = 'ai_model';
  RAISE NOTICE 'wa_campaigns.ai_model presente: % de 1', col_count;
END $$;
