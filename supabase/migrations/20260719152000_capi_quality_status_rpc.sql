-- ============================================================================
-- Observabilidade do CAPI de qualidade — RPC de LEITURA (nao muda o envio).
--
-- public.capi_quality_status(p_user uuid default null) -> jsonb
--   * authenticated: enxerga SOMENTE a propria conta (billing owner resolvido
--     por resolve_billing_owner_user_id(auth.uid())); p_user e IGNORADO.
--   * service_role: pode consultar explicitamente qualquer conta via p_user.
--   * Filtra meta_capi_events.event_name IN (LeadQualificado,
--     LeadPoucoQualificado, LeadRuim, Purchase).
-- NAO altera o envio CAPI, NAO toca em wa-capi-process-queue, NAO cria fila.
--
-- NOTA (Custom Conversions): os eventos de qualidade sao EVENTOS CUSTOMIZADOS
-- do Pixel via CAPI. O envio NAO cria automaticamente uma Custom Conversion no
-- Business Manager — criacao automatica via Graph API fica para fase futura.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.capi_quality_status(p_user uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target uuid;
  v_result jsonb;
BEGIN
  -- Resolucao do alvo com seguranca:
  --   usuario logado -> sempre a PROPRIA conta (ignora p_user);
  --   service_role (sem auth.uid) -> exige p_user explicito.
  IF v_uid IS NOT NULL THEN
    v_target := public.resolve_billing_owner_user_id(v_uid);
  ELSIF auth.role() = 'service_role' OR current_user IN ('postgres', 'service_role') THEN
    v_target := p_user;
  END IF;
  IF v_target IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem conta alvo');
  END IF;

  WITH ev AS (
    SELECT event_name, status, sent_at, created_at, error_message
    FROM public.meta_capi_events
    WHERE user_id = v_target
      AND event_name IN ('LeadQualificado', 'LeadPoucoQualificado', 'LeadRuim', 'Purchase')
  ),
  por_evento AS (
    SELECT jsonb_object_agg(event_name, cnts) AS j
    FROM (
      SELECT event_name, jsonb_build_object(
        'pending', count(*) FILTER (WHERE status = 'pending'),
        'sent',    count(*) FILTER (WHERE status = 'sent'),
        'failed',  count(*) FILTER (WHERE status = 'failed')
      ) AS cnts
      FROM ev GROUP BY event_name
    ) x
  )
  SELECT jsonb_build_object(
    'ok', true,
    'user_id', v_target,
    'pending', (SELECT count(*) FROM ev WHERE status = 'pending'),
    'sent',    (SELECT count(*) FROM ev WHERE status = 'sent'),
    'failed',  (SELECT count(*) FROM ev WHERE status = 'failed'),
    'last_sent_at',   (SELECT max(sent_at) FROM ev WHERE status = 'sent'),
    'last_failed_at', (SELECT max(created_at) FROM ev WHERE status = 'failed'),
    'last_error', (SELECT error_message FROM ev WHERE status = 'failed'
                     ORDER BY created_at DESC LIMIT 1),
    'por_evento', COALESCE((SELECT j FROM por_evento), '{}'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.capi_quality_status(uuid) IS
  'Status (somente leitura) dos eventos CAPI de qualidade (LeadQualificado/LeadPoucoQualificado/LeadRuim/Purchase): pending/sent/failed, ultimos envios/falhas e contagem por evento. Authenticated ve so a propria conta; service_role consulta via p_user. Nao altera o envio.';

REVOKE ALL ON FUNCTION public.capi_quality_status(uuid) FROM public;
REVOKE ALL ON FUNCTION public.capi_quality_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.capi_quality_status(uuid) TO authenticated;
