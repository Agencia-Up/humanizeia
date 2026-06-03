-- checkout_pending: suporte a Pro (fundador/normal) + Basico.
-- A coluna `plano` ja existente continua sendo o CICLO (mensal|anual).
-- Aqui adicionamos QUAL plano foi contratado e congelamos os valores cobrados.

ALTER TABLE public.checkout_pending
  ADD COLUMN IF NOT EXISTS plan_type        text,
  ADD COLUMN IF NOT EXISTS tier             text,
  ADD COLUMN IF NOT EXISTS setup_value      numeric(10,2),
  ADD COLUMN IF NOT EXISTS recurrence_value numeric(10,2);

-- plan_type: pro | basico (null permitido p/ linhas antigas)
DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checkout_pending_plan_type_check'
  ) THEN
    ALTER TABLE public.checkout_pending
      ADD CONSTRAINT checkout_pending_plan_type_check
      CHECK (plan_type IS NULL OR plan_type IN ('pro','basico'));
  END IF;
END $mig$;

-- tier: fundador | normal (null p/ basico e linhas antigas)
DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checkout_pending_tier_check'
  ) THEN
    ALTER TABLE public.checkout_pending
      ADD CONSTRAINT checkout_pending_tier_check
      CHECK (tier IS NULL OR tier IN ('fundador','normal'));
  END IF;
END $mig$;

COMMENT ON COLUMN public.checkout_pending.plan_type IS 'Plano contratado: pro | basico. (A coluna `plano` continua sendo o CICLO mensal/anual.)';
COMMENT ON COLUMN public.checkout_pending.tier IS 'Faixa de preco do Pro: fundador (1o-10o) | normal (11o+). Null para basico.';
COMMENT ON COLUMN public.checkout_pending.setup_value IS 'Taxa de implementacao cobrada (snapshot do momento do checkout).';
COMMENT ON COLUMN public.checkout_pending.recurrence_value IS 'Valor da recorrencia cobrada — mensalidade ou anuidade (snapshot).';
