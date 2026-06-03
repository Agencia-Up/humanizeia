-- ============================================================================
-- Conserto do contador de ATENDIMENTOS do painel (Meu Plano)
-- ----------------------------------------------------------------------------
-- PROBLEMA (relatado por Wander, em producao):
--   O painel mostra o contador de atendimentos errado (ex.: "8.700 / 50.000"
--   em vez de "12 / 150"). Causa: quando o produto mudou a regua de "tokens
--   crus" para "atendimentos" (Basico=150, Pro=300, Pro Max=500), a mudanca
--   foi feita SO na tela (constante PLANS em src/hooks/useSubscription.ts). No
--   banco a coluna tokens_included NUNCA foi convertida: contas legadas seguem
--   com valores da regua velha (ex.: 50000 / 150000) e tokens_used acumulou em
--   token cru. Alem disso o gatilho de cadastro (create_default_subscription)
--   ainda cria conta nova com tokens_included = 50000.
--
-- ESTA MIGRATION (so mexe na camada de assinatura/plano; NAO toca no Pedro):
--   (a) funcao plan_atendimentos(plan_id) — fonte unica do limite por plano;
--   (b) corrige o gatilho create_default_subscription p/ nascer com 150 (Basico)
--       e ajusta o DEFAULT da coluna tokens_included p/ 150;
--   (c) BACKFILL idempotente: para toda conta na regua ERRADA
--       (tokens_included fora de {150,300,500}), normaliza:
--         - tokens_included = limite do plano (150/300/500);
--         - tokens_used     = atendimentos REAIS do ciclo atual, contados na
--                             tabela pedro_billed_leads (fonte da verdade). Onde
--                             nao houver registro, 0 (limpa o lixo da regua velha);
--         - tokens_purchased = 0.
--       Contas que JA estao na regua certa (150/300/500) NAO sao tocadas, para
--       preservar saldo/uso reais e eventuais recargas.
--
-- Idempotente: CREATE OR REPLACE + WHERE por escala errada. Rodar de novo nao
-- altera contas ja corrigidas.
-- ============================================================================

-- (a) Limite de atendimentos por plano (fonte unica) -------------------------
CREATE OR REPLACE FUNCTION public.plan_atendimentos(p_plan TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_plan
    WHEN 'basico'     THEN 150
    WHEN 'pro'        THEN 300
    WHEN 'enterprise' THEN 500
    ELSE 150
  END;
$$;

-- (b) Conta nova ja nasce com o limite certo do plano ------------------------
ALTER TABLE public.user_subscriptions
  ALTER COLUMN tokens_included SET DEFAULT 150;

CREATE OR REPLACE FUNCTION public.create_default_subscription()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_subscriptions (
    user_id, plan_id, status,
    tokens_included, tokens_used, tokens_purchased,
    renewal_date
  )
  VALUES (
    NEW.id, 'basico', 'active',
    public.plan_atendimentos('basico'), 0, 0,
    now() + interval '30 days'
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'create_default_subscription error (nao critico): %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- (c) Backfill das contas na regua ERRADA ------------------------------------
UPDATE public.user_subscriptions us
SET
  tokens_included  = public.plan_atendimentos(us.plan_id),
  tokens_used      = COALESCE((
                       SELECT count(*) FROM public.pedro_billed_leads p
                       WHERE p.user_id = us.user_id
                         AND p.cycle_tag = us.renewal_date::date
                     ), 0),
  tokens_purchased = 0,
  updated_at       = now()
WHERE us.tokens_included NOT IN (150, 300, 500);
