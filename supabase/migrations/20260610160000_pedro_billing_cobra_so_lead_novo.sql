-- ============================================================================
-- Pedro: cobrar atendimento SÓ por LEAD NOVO (não por follow-up)
-- ----------------------------------------------------------------------------
-- REGRA DE NEGÓCIO (decisão do cliente):
--   O crédito de conversa só é consumido quando chega um LEAD NOVO no CRM.
--   Se o Pedro está trabalhando o MESMO lead (follow-up, retorno, continuação),
--   NÃO consome — está atendendo o mesmo lead. Exceção: se o lead ficar PARADO
--   por 60+ dias e voltar, conta como oportunidade nova e cobra 1.
--
-- O QUE MUDA em relação à versão anterior:
--   ANTES: cobrava 1x por lead POR CICLO (re-cobrava todo mês) + mais 1 no
--          "retorno após 24h". Ou seja, cobrava o mesmo lead várias vezes.
--   AGORA: cobra 1x quando o lead é NOVO (nunca cobrado, em qualquer ciclo).
--          Não cobra em follow-up/retorno/virada de mês. Só volta a cobrar se
--          o lead ficar 60 dias sem nenhuma atividade e então retornar.
--
-- Mantém: ensure_subscription_cycle (renovação do ciclo), consume_user_tokens
--   (contador + avisos de cota), a tabela pedro_billed_leads e a idempotência
--   por (user_id, lead_key, cycle_tag). NÃO toca no agente Pedro.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.bill_pedro_lead(
  p_user_id   uuid,
  p_lead_key  text,
  p_raw_tokens integer DEFAULT 0,
  p_agent     text DEFAULT 'pedro'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_renewal     TIMESTAMPTZ;
  v_cycle_tag   DATE;
  v_last        TIMESTAMPTZ;
  v_last_cycle  DATE;
  v_inserted    INT;
  v_reengage    CONSTANT INTERVAL := interval '60 days';  -- janela de "oportunidade nova"
  v_raw         INT := GREATEST(0, COALESCE(p_raw_tokens, 0));
  v_consume     JSONB;
  v_is_new      BOOLEAN;
  v_is_reengage BOOLEAN;
  v_reason      TEXT;
  v_tail        TEXT := right(regexp_replace(p_lead_key, '\D', '', 'g'), 4);
BEGIN
  -- Bypass RLS (contexto service_role tem auth.uid() NULL).
  SET LOCAL row_security = off;

  IF p_user_id IS NULL OR p_lead_key IS NULL OR length(trim(p_lead_key)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_args');
  END IF;

  -- Renova o ciclo do cliente se já venceu (zera tokens_used no aniversário).
  PERFORM ensure_subscription_cycle(p_user_id);

  SELECT renewal_date INTO v_renewal FROM user_subscriptions WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_subscription');
  END IF;
  v_cycle_tag := COALESCE(v_renewal, now())::date;

  -- Última atividade do lead na VIDA TODA (todos os ciclos) — não só neste ciclo.
  -- Trava a linha mais recente p/ serializar mensagens concorrentes do mesmo lead.
  SELECT last_activity_at, cycle_tag
    INTO v_last, v_last_cycle
  FROM pedro_billed_leads
  WHERE user_id = p_user_id AND lead_key = p_lead_key
  ORDER BY last_activity_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  v_is_new      := (v_last IS NULL);
  v_is_reengage := (v_last IS NOT NULL AND (now() - v_last) >= v_reengage);

  IF v_is_new OR v_is_reengage THEN
    -- COBRA: lead novo de verdade OU voltou após 60+ dias parado.
    -- Idempotente por ciclo (ON CONFLICT DO NOTHING) — evita cobrança dupla
    -- em corrida de mensagens simultâneas.
    INSERT INTO pedro_billed_leads (user_id, lead_key, cycle_tag, raw_tokens, charges)
    VALUES (p_user_id, p_lead_key, v_cycle_tag, v_raw, 1)
    ON CONFLICT (user_id, lead_key, cycle_tag) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted = 1 THEN
      v_reason := CASE WHEN v_is_new THEN 'new_lead' ELSE 'reengage_60d' END;
      v_consume := consume_user_tokens(
        p_user_id, 1, p_agent,
        'Pedro SDR — conversa (' ||
        CASE WHEN v_is_new THEN 'lead novo' ELSE 'retorno 60d+' END ||
        ' …' || v_tail || ')'
      );
      RETURN v_consume || jsonb_build_object(
        'billed', true, 'cycle_tag', v_cycle_tag, 'raw_tokens', v_raw, 'reason', v_reason
      );
    ELSE
      -- Já há linha neste ciclo (corrida) -> não cobra de novo.
      UPDATE pedro_billed_leads
         SET raw_tokens = raw_tokens + v_raw, last_activity_at = now()
       WHERE user_id = p_user_id AND lead_key = p_lead_key AND cycle_tag = v_cycle_tag;
      RETURN jsonb_build_object(
        'ok', true, 'billed', false, 'cycle_tag', v_cycle_tag, 'raw_tokens', v_raw, 'reason', 'already_billed_cycle'
      );
    END IF;
  ELSE
    -- LEAD JÁ EM ATENDIMENTO (follow-up / continuação dentro de 60 dias) -> NÃO COBRA.
    -- Só acumula custo e renova a "última atividade" (reinicia a janela de 60 dias).
    UPDATE pedro_billed_leads
       SET raw_tokens = raw_tokens + v_raw, last_activity_at = now()
     WHERE user_id = p_user_id AND lead_key = p_lead_key AND cycle_tag = v_last_cycle;
    RETURN jsonb_build_object(
      'ok', true, 'billed', false, 'cycle_tag', v_last_cycle, 'raw_tokens', v_raw, 'reason', 'follow_up'
    );
  END IF;
END;
$function$;
