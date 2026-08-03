-- ============================================================================
-- Meta OAuth -- CONSUMO ATOMICO DA SESSAO
--
-- Antes: handleSaveSelected fazia N upserts soltos, cada um em sua transacao,
-- e no fim devolvia ok:true mesmo com erros. Nao havia trava: duas chamadas
-- simultaneas com o mesmo session_id integravam duas vezes, e um replay tardio
-- integrava de novo porque consumed_at nunca era gravado (NULL em 100% das
-- sessoes em producao).
--
-- Agora tudo acontece dentro de UMA funcao: SELECT ... FOR UPDATE trava a
-- sessao, so um chamador vence, e qualquer falha reverte o conjunto inteiro.
-- O token NUNCA sai daqui -- nem no retorno, nem em RAISE, nem em log.
--
-- ADITIVA. Rollback no rodape.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.consume_meta_oauth_session(
  p_session_id       uuid,
  p_account_ids      text[] DEFAULT '{}',
  p_pixel_ids        text[] DEFAULT '{}',
  p_page_ids         text[] DEFAULT '{}',
  -- account_id EXTERNO da Meta que deve virar a conta do Jose. NULL = nao mexe.
  p_select_for_jose  text   DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_sess     record;
  v_org      uuid;
  v_conn     uuid;
  v_fp       text;
  v_expira   timestamptz;
  v_desc     jsonb;
  v_ids_desc text[];
  v_px_desc  text[];
  v_pg_desc  text[];
  v_fora     text[];
  v_conta    jsonb;
  v_id       text;
  v_salvas   int := 0;
  v_px       int := 0;
  v_pg       int := 0;
  v_sel_uuid uuid;
  v_agora    timestamptz := now();
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado');
  END IF;

  -- -- 1) TRAVA A SESSAO. So um vencedor. ------------------------------------
  -- FOR UPDATE serializa: a segunda chamada espera aqui e, quando entrar, ja
  -- enxerga consumed_at preenchido pela primeira.
  SELECT id, user_id, access_token_encrypted, payload, consumed_at, expires_at
    INTO v_sess
    FROM public.meta_oauth_sessions
   WHERE id = p_session_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sessao_inexistente');
  END IF;

  -- Isolamento por tenant: sessao de outro usuario nao serve, nem com o id certo.
  IF v_sess.user_id <> v_caller THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sessao_de_outro_usuario');
  END IF;
  IF v_sess.consumed_at IS NOT NULL THEN
    -- REPLAY: conflito explicito, nunca "sucesso" silencioso.
    RETURN jsonb_build_object('ok', false, 'erro', 'sessao_ja_consumida',
                              'consumed_at', v_sess.consumed_at);
  END IF;
  IF v_sess.expires_at <= v_agora THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sessao_expirada');
  END IF;
  IF v_sess.access_token_encrypted IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sessao_sem_credencial');
  END IF;

  -- -- 2) SO O QUE ESTA SESSAO DESCOBRIU -------------------------------------
  v_desc := coalesce(v_sess.payload, '{}'::jsonb);

  SELECT coalesce(array_agg(regexp_replace(coalesce(e->>'account_id', e->>'id',''), '^act_', '')), '{}')
    INTO v_ids_desc FROM jsonb_array_elements(coalesce(v_desc->'ad_accounts','[]'::jsonb)) e;
  SELECT coalesce(array_agg(e->>'id'), '{}')
    INTO v_px_desc FROM jsonb_array_elements(coalesce(v_desc->'pixels','[]'::jsonb)) e;
  SELECT coalesce(array_agg(e->>'id'), '{}')
    INTO v_pg_desc FROM jsonb_array_elements(coalesce(v_desc->'pages','[]'::jsonb)) e;

  -- Payload adulterado nao passa: qualquer id fora da descoberta derruba tudo.
  SELECT coalesce(array_agg(x), '{}') INTO v_fora
    FROM unnest(coalesce(p_account_ids,'{}')) x WHERE NOT (x = ANY(v_ids_desc));
  IF array_length(v_fora,1) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'conta_fora_da_sessao_oauth', 'itens', v_fora);
  END IF;

  SELECT coalesce(array_agg(x), '{}') INTO v_fora
    FROM unnest(coalesce(p_pixel_ids,'{}')) x WHERE NOT (x = ANY(v_px_desc));
  IF array_length(v_fora,1) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'pixel_fora_da_sessao_oauth', 'itens', v_fora);
  END IF;

  SELECT coalesce(array_agg(x), '{}') INTO v_fora
    FROM unnest(coalesce(p_page_ids,'{}')) x WHERE NOT (x = ANY(v_pg_desc));
  IF array_length(v_fora,1) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'pagina_fora_da_sessao_oauth', 'itens', v_fora);
  END IF;

  IF coalesce(array_length(p_account_ids,1),0) = 0
     AND coalesce(array_length(p_pixel_ids,1),0) = 0
     AND coalesce(array_length(p_page_ids,1),0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nada_selecionado');
  END IF;

  IF p_select_for_jose IS NOT NULL
     AND NOT (regexp_replace(p_select_for_jose,'^act_','') = ANY(coalesce(p_account_ids,'{}'))) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'conta_do_jose_precisa_estar_entre_as_selecionadas');
  END IF;

  SELECT organization_id INTO v_org FROM public.profiles WHERE id = v_caller;

  -- -- 3) CREDENCIAL ---------------------------------------------------------
  v_fp := encode(sha256(v_sess.access_token_encrypted::bytea), 'hex');
  v_expira := CASE WHEN coalesce((v_desc->>'expires_in')::bigint, 0) > 0
                   THEN v_agora + make_interval(secs => (v_desc->>'expires_in')::bigint)
                   ELSE NULL END;

  INSERT INTO public.meta_connections AS c
    (user_id, access_token_encrypted, token_fingerprint, token_expires_at,
     health_status, last_validation_at, updated_at)
  VALUES (v_caller, v_sess.access_token_encrypted, v_fp, v_expira,
          'connected', v_agora, v_agora)
  ON CONFLICT (user_id, token_fingerprint) DO UPDATE
     SET access_token_encrypted = EXCLUDED.access_token_encrypted,
         token_expires_at = EXCLUDED.token_expires_at,
         health_status = 'connected', last_validation_at = v_agora,
         last_error_code = NULL, last_error_subcode = NULL, last_error_message = NULL,
         updated_at = v_agora
  RETURNING c.id INTO v_conn;

  -- -- 4) SOMENTE AS CONTAS SELECIONADAS -------------------------------------
  FOREACH v_id IN ARRAY coalesce(p_account_ids, '{}') LOOP
    SELECT e INTO v_conta
      FROM jsonb_array_elements(coalesce(v_desc->'ad_accounts','[]'::jsonb)) e
     WHERE regexp_replace(coalesce(e->>'account_id', e->>'id',''), '^act_','') = v_id
     LIMIT 1;

    INSERT INTO public.ad_accounts AS a
      (user_id, organization_id, account_id, account_name, platform, currency, timezone,
       access_token_encrypted, connection_id, is_active,
       account_health_status, last_account_check_at, last_sync_at)
    VALUES (v_caller, v_org, v_id,
            coalesce(v_conta->>'name', 'act_'||v_id), 'meta',
            coalesce(nullif(v_conta->>'currency',''), 'BRL'),
            coalesce(nullif(v_conta->>'timezone_name',''), 'America/Sao_Paulo'),
            v_sess.access_token_encrypted, v_conn, true,
            'connected', v_agora, v_agora)
    ON CONFLICT (user_id, platform, account_id) DO UPDATE
       SET account_name = EXCLUDED.account_name,
           currency = EXCLUDED.currency, timezone = EXCLUDED.timezone,
           access_token_encrypted = EXCLUDED.access_token_encrypted,
           connection_id = EXCLUDED.connection_id,
           is_active = true,
           account_health_status = 'connected',
           last_account_check_at = v_agora, last_account_check_error = NULL,
           last_sync_at = v_agora, updated_at = v_agora;
    v_salvas := v_salvas + 1;
  END LOOP;

  FOREACH v_id IN ARRAY coalesce(p_pixel_ids, '{}') LOOP
    SELECT e INTO v_conta FROM jsonb_array_elements(coalesce(v_desc->'pixels','[]'::jsonb)) e
     WHERE e->>'id' = v_id LIMIT 1;
    INSERT INTO public.meta_pixels (user_id, pixel_id, pixel_name, access_token_encrypted, is_active, updated_at)
    VALUES (v_caller, v_id, v_conta->>'name', v_sess.access_token_encrypted, true, v_agora)
    ON CONFLICT (user_id, pixel_id) DO UPDATE
       SET pixel_name = EXCLUDED.pixel_name,
           access_token_encrypted = EXCLUDED.access_token_encrypted,
           is_active = true, updated_at = v_agora;
    v_px := v_px + 1;
  END LOOP;

  FOREACH v_id IN ARRAY coalesce(p_page_ids, '{}') LOOP
    SELECT e INTO v_conta FROM jsonb_array_elements(coalesce(v_desc->'pages','[]'::jsonb)) e
     WHERE e->>'id' = v_id LIMIT 1;
    INSERT INTO public.meta_pages (user_id, organization_id, page_id, page_name, category,
                                   fan_count, picture_url, access_token_encrypted, is_active, updated_at)
    VALUES (v_caller, v_org, v_id, v_conta->>'name', v_conta->>'category',
            coalesce((v_conta->>'fan_count')::int, 0), v_conta->>'picture_url',
            v_sess.access_token_encrypted, true, v_agora)
    ON CONFLICT (user_id, page_id) DO UPDATE
       SET page_name = EXCLUDED.page_name, category = EXCLUDED.category,
           fan_count = EXCLUDED.fan_count, picture_url = EXCLUDED.picture_url,
           access_token_encrypted = EXCLUDED.access_token_encrypted,
           is_active = true, updated_at = v_agora;
    v_pg := v_pg + 1;
  END LOOP;

  -- -- 5) SELECAO DO JOSE, NA MESMA TRANSACAO --------------------------------
  IF p_select_for_jose IS NOT NULL THEN
    SELECT id INTO v_sel_uuid FROM public.ad_accounts
     WHERE user_id = v_caller AND platform = 'meta'
       AND account_id = regexp_replace(p_select_for_jose,'^act_','');
    IF v_sel_uuid IS NULL THEN
      RAISE EXCEPTION 'conta_do_jose_nao_persistida';  -- reverte tudo
    END IF;
    UPDATE public.apollo_cron_config
       SET selected_ad_account_id = v_sel_uuid, selected_platform = 'meta',
           selected_by = v_caller, selected_at = v_agora
     WHERE user_id = v_caller;
  END IF;

  -- -- 6) CONSOME. Condicional: fecha a corrida de vez. ----------------------
  UPDATE public.meta_oauth_sessions
     SET consumed_at = v_agora
   WHERE id = p_session_id AND consumed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sessao_consumida_em_paralelo';   -- reverte tudo
  END IF;

  -- Sem token no retorno. Nunca.
  RETURN jsonb_build_object(
    'ok', true, 'contas', v_salvas, 'pixels', v_px, 'paginas', v_pg,
    'connection_id', v_conn, 'consumed_at', v_agora,
    'jose_ad_account_id', v_sel_uuid);
END $$;

REVOKE ALL ON FUNCTION public.consume_meta_oauth_session(uuid, text[], text[], text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_meta_oauth_session(uuid, text[], text[], text[], text) TO authenticated, service_role;

COMMENT ON FUNCTION public.consume_meta_oauth_session(uuid, text[], text[], text[], text) IS
  'Consome uma sessao OAuth da Meta de forma atomica: trava com FOR UPDATE, '
  'valida dono/expiracao/consumo, recusa id fora da descoberta da propria '
  'sessao, grava credencial + contas selecionadas + selecao do Jose e marca '
  'consumed_at -- tudo ou nada. Nunca devolve access_token.';

-- ============================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.consume_meta_oauth_session(uuid, text[], text[], text[], text);
-- ============================================================================
