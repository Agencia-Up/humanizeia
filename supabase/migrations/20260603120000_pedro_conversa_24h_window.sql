-- ============================================================================
-- Reformulacao da cobranca: 1 CONVERSA por lead, com janela de 24h
-- ----------------------------------------------------------------------------
-- REGRA NOVA (Wander, 03/06/2026): a cobranca passa a ser por "conversa".
--   - 1 lead novo                          = 1 conversa  (cobra 1).
--   - O MESMO lead conversando DENTRO de 24h da ultima atividade
--                                           = ainda a MESMA conversa (NAO cobra).
--   - O MESMO lead que VOLTA depois de 24h+ de silencio
--                                           = +1 conversa (cobra +1).
--
-- ANTES: 1 lead = 1 cobranca por CICLO inteiro (mes). A janela de dedup era o
-- ciclo todo (chave user_id, lead_key, cycle_tag), entao o mesmo lead voltando
-- no mesmo mes nunca cobrava de novo. AGORA a janela de dedup passa a ser de
-- 24h, medida a partir de last_activity_at (rolling): cada turno empurra o
-- relogio pra frente, entao uma conversa continua (idas e vindas com menos de
-- 24h de intervalo) conta como UMA so; so um silencio de 24h+ abre conversa nova.
--
-- Esta regra e TEMPORARIA: vale "1 conversa = 1 atendimento cobrado" enquanto
-- medimos (via monitor) o custo real por conversa funcionando. Depois ajustamos.
--
-- So altera bill_pedro_lead. Aditivo/idempotente (CREATE OR REPLACE). NAO toca
-- consume_user_tokens nem ensure_subscription_cycle (continuam iguais). O
-- contador 'charges' em pedro_billed_leads passa a refletir quantas conversas
-- distintas (janelas de 24h) o lead teve no ciclo; raw_tokens segue somando o
-- custo real interno (margem) de todas elas.
-- ============================================================================

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
  v_last       TIMESTAMPTZ;
  v_gap        CONSTANT INTERVAL := interval '24 hours';
  v_raw        INT := GREATEST(0, COALESCE(p_raw_tokens, 0));
  v_consume    JSONB;
BEGIN
  -- Bypass RLS (contexto service_role tem auth.uid() NULL).
  SET LOCAL row_security = off;

  IF p_user_id IS NULL OR p_lead_key IS NULL OR length(trim(p_lead_key)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_args');
  END IF;

  -- Renova o ciclo do cliente se ja venceu (mantem o comportamento atual).
  PERFORM ensure_subscription_cycle(p_user_id);

  -- Ciclo atual da assinatura. Sem assinatura -> nao cobra (nada a fazer).
  SELECT renewal_date INTO v_renewal
  FROM user_subscriptions
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_subscription');
  END IF;

  v_cycle_tag := COALESCE(v_renewal, now())::date;

  -- Tenta inserir a 1a aparicao do lead neste ciclo. Se inseriu (ROW_COUNT=1),
  -- e conversa nova -> cobra. Se ja existia, decide pela janela de 24h.
  INSERT INTO pedro_billed_leads (user_id, lead_key, cycle_tag, raw_tokens, charges)
  VALUES (p_user_id, p_lead_key, v_cycle_tag, v_raw, 1)
  ON CONFLICT (user_id, lead_key, cycle_tag) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 1 THEN
    -- 1a conversa do lead neste ciclo -> cobra 1 conversa (com aviso embutido).
    v_consume := consume_user_tokens(
      p_user_id,
      1,
      p_agent,
      'Pedro SDR — conversa (lead …' || right(regexp_replace(p_lead_key, '\D', '', 'g'), 4) || ')'
    );
    RETURN v_consume || jsonb_build_object(
      'billed', true, 'cycle_tag', v_cycle_tag, 'raw_tokens', v_raw, 'reason', 'new_lead'
    );
  END IF;

  -- Lead ja tem linha neste ciclo: trava a linha e olha a ultima atividade.
  SELECT last_activity_at INTO v_last
  FROM pedro_billed_leads
  WHERE user_id = p_user_id AND lead_key = p_lead_key AND cycle_tag = v_cycle_tag
  FOR UPDATE;

  IF v_last IS NOT NULL AND (now() - v_last) >= v_gap THEN
    -- Voltou depois de 24h+ de silencio -> NOVA conversa: incrementa e cobra +1.
    UPDATE pedro_billed_leads
       SET charges          = charges + 1,
           raw_tokens       = raw_tokens + v_raw,
           last_activity_at = now()
     WHERE user_id = p_user_id AND lead_key = p_lead_key AND cycle_tag = v_cycle_tag;

    v_consume := consume_user_tokens(
      p_user_id,
      1,
      p_agent,
      'Pedro SDR — conversa (retorno 24h+, lead …' || right(regexp_replace(p_lead_key, '\D', '', 'g'), 4) || ')'
    );
    RETURN v_consume || jsonb_build_object(
      'billed', true, 'cycle_tag', v_cycle_tag, 'raw_tokens', v_raw, 'reason', 'return_24h'
    );
  ELSE
    -- Mesma conversa (dentro de 24h) -> NAO cobra, so acumula custo e atividade.
    UPDATE pedro_billed_leads
       SET raw_tokens       = raw_tokens + v_raw,
           last_activity_at = now()
     WHERE user_id = p_user_id AND lead_key = p_lead_key AND cycle_tag = v_cycle_tag;
    RETURN jsonb_build_object(
      'ok', true, 'billed', false, 'cycle_tag', v_cycle_tag, 'raw_tokens', v_raw, 'reason', 'same_conversation'
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bill_pedro_lead TO service_role;
