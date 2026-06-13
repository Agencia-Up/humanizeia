-- 20260613120000_checkout_enterprise_plan.sql
-- Pro Max (enterprise) no checkout publico.
--
-- A coluna checkout_pending.plan_type tinha um CHECK que so aceitava
-- ('pro','basico'). Pra vender o Pro Max via checkout (plano=enterprise) o
-- insert precisa aceitar 'enterprise'. Sem isso, a cobranca do Pro Max falha
-- com violacao de constraint. Migracao aditiva e idempotente.

ALTER TABLE public.checkout_pending
  DROP CONSTRAINT IF EXISTS checkout_pending_plan_type_check;

ALTER TABLE public.checkout_pending
  ADD CONSTRAINT checkout_pending_plan_type_check
  CHECK (plan_type IS NULL OR plan_type IN ('pro','basico','enterprise'));

COMMENT ON COLUMN public.checkout_pending.plan_type IS
  'Plano contratado: pro | enterprise (Pro Max) | basico. (A coluna `plano` continua sendo o CICLO mensal/anual.)';
COMMENT ON COLUMN public.checkout_pending.tier IS
  'Faixa de preco do Pro/Pro Max: fundador (1o-10o) | normal (11o+). Null para basico.';
