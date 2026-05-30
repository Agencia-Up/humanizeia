-- ============================================================================
-- Cobrança por ATENDIMENTO (lead), e não por token cru
-- ----------------------------------------------------------------------------
-- Pedido do cliente: o plano deve ser vendido/medido em "atendimentos" (leads),
-- algo que o dono da loja entende — e não em "tokens" (a conta interna da
-- OpenAI). O token continua sendo medido, mas vira métrica INTERNA de custo
-- (margem), invisível para o cliente.
--
-- Modelo de cobrança:
--   1 atendimento = 1 lead atendido pelo Pedro DENTRO do ciclo de cobrança
--   (user_subscriptions.renewal_date). O MESMO lead voltando no MESMO ciclo
--   NÃO cobra de novo (acompanhamento ilimitado do mesmo lead no mês). Quando
--   o ciclo vira (renewal_date muda), o lead volta a contar.
--
-- Esta migration:
--   (a) tabela pedro_billed_leads — lembra quais leads já foram cobrados em
--       cada ciclo e acumula o gasto REAL de token por lead (margem interna);
--   (b) função bill_pedro_lead — idempotente por (user, lead, ciclo): cobra 1
--       atendimento na 1ª vez do lead no ciclo (reusando consume_user_tokens,
--       que já desconta, registra e dispara o aviso "acabando/acabou"); nas
--       vezes seguintes do mesmo lead no ciclo só acumula o custo de token,
--       sem cobrar.
--
-- Não altera consume_user_tokens nem nenhum comportamento existente: é aditivo.
-- ============================================================================

-- (a) Registro de leads já cobrados por ciclo -------------------------------
CREATE TABLE IF NOT EXISTS public.pedro_billed_leads (
  user_id          UUID        NOT NULL,
  lead_key         TEXT        NOT NULL,
  cycle_tag        DATE        NOT NULL,
  raw_tokens       INT         NOT NULL DEFAULT 0,   -- custo real acumulado (margem interna)
  charges          INT         NOT NULL DEFAULT 1,   -- quantos atendimentos cobrados (sempre 1 por ciclo)
  first_billed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lead_key, cycle_tag)
);

COMMENT ON TABLE public.pedro_billed_leads IS
  'Controle de cobrança por atendimento do Pedro: 1 lead por ciclo (renewal_date). raw_tokens = custo real interno.';

ALTER TABLE public.pedro_billed_leads ENABLE ROW LEVEL SECURITY;

-- O dono enxerga os próprios atendimentos (para relatório no painel);
-- a escrita acontece só via função SECURITY DEFINER abaixo.
DROP POLICY IF EXISTS "owner reads own billed leads" ON public.pedro_billed_leads;
CREATE POLICY "owner reads own billed leads"
  ON public.pedro_billed_leads FOR SELECT
  USING (auth.uid() = user_id);

-- (b) Função de cobrança por atendimento ------------------------------------
CREATE OR REPLACE FUNCTION public.bill_pedro_lead(
  p_user_id    UUID,
  p_lead_key   TEXT,
  p_raw_tokens INT  DEFAULT 0,
  p_agent      TEXT DEFAULT 'pedro'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_renewal    TIMESTAMPTZ;
  v_cycle_tag  DATE;
  v_inserted   INT;
  v_raw        INT := GREATEST(0, COALESCE(p_raw_tokens, 0));
  v_consume    JSONB;
BEGIN
  -- Bypass RLS (contexto service_role tem auth.uid() NULL).
  SET LOCAL row_security = off;

  IF p_user_id IS NULL OR p_lead_key IS NULL OR length(trim(p_lead_key)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_args');
  END IF;

  -- Ciclo atual da assinatura. Sem assinatura → não cobra (nada a fazer).
  SELECT renewal_date INTO v_renewal
  FROM user_subscriptions
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_subscription');
  END IF;

  v_cycle_tag := COALESCE(v_renewal, now())::date;

  -- Marca o lead no ciclo de forma atômica. Se inseriu agora (1ª vez do lead
  -- neste ciclo), ROW_COUNT = 1; se já existia, ROW_COUNT = 0.
  INSERT INTO pedro_billed_leads (user_id, lead_key, cycle_tag, raw_tokens, charges)
  VALUES (p_user_id, p_lead_key, v_cycle_tag, v_raw, 1)
  ON CONFLICT (user_id, lead_key, cycle_tag) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 1 THEN
    -- 1ª vez do lead neste ciclo → cobra 1 atendimento (com aviso embutido).
    v_consume := consume_user_tokens(
      p_user_id,
      1,
      p_agent,
      'Pedro SDR — atendimento (lead …' || right(regexp_replace(p_lead_key, '\D', '', 'g'), 4) || ')'
    );
    RETURN v_consume || jsonb_build_object('billed', true, 'cycle_tag', v_cycle_tag, 'raw_tokens', v_raw);
  ELSE
    -- Lead já cobrado neste ciclo → não desconta de novo, só acumula o custo real.
    UPDATE pedro_billed_leads
       SET raw_tokens       = raw_tokens + v_raw,
           last_activity_at = now()
     WHERE user_id = p_user_id AND lead_key = p_lead_key AND cycle_tag = v_cycle_tag;
    RETURN jsonb_build_object('ok', true, 'billed', false, 'cycle_tag', v_cycle_tag, 'raw_tokens', v_raw);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bill_pedro_lead TO service_role;
