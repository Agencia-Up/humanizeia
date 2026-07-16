-- ============================================================================
-- REGRA: banimento só nasce de REMOÇÃO EXPLÍCITA, nunca de ausência de vínculo.
-- Passo 3/3 (a trava). Passo 1 = coluna removed_at; passo 2 = delete-responsavel
-- carimba removed_at (deployado ANTES desta migration, pra não abrir brecha).
--
-- Incidente (Lucas Montoani / Mônaco, 16/07): usuário de MARKETING (__restrito +
-- agent_jose + agent_pedro) NUNCA tem vínculo de VENDAS ativo — é da natureza do
-- papel. A regra antiga lia "sem vínculo ativo" => "foi removido" => ban permanente.
-- Isso baniria, por construção, TODO usuário de marketing/tráfego.
--
-- Agora: se o usuário AINDA TEM linha na equipe e NENHUMA tem removed_at, a RPC
-- RECUSA banir e deixa rastro ('skipped') — em vez de estragar calado.
-- Caminhos que CONTINUAM banindo (sem brecha):
--   a) delete-responsavel -> carimba removed_at -> RPC bane;
--   b) exclusão da linha (DELETE) -> tg_revoke_seller_access_on_delete (não usa
--      esta RPC; bane quando não sobra nenhuma linha) -> intocado.
--
-- Testado em prod (rollback proposital) em 16/07:
--   Teste 1 (linha sem removed_at)  => {"banned": false, "motivo": "sem remocao explicita (removed_at nulo)"}
--   Teste 2 (removed_at carimbado)  => {"banned": true}  + banned_until 2099 + log 'revoked'
-- Aplicada em prod (seyljsqmhlopkcauhlor) via MCP em 16/07; registro local.
-- ============================================================================

-- rastro 'skipped' precisa ser aceito pela auditoria
ALTER TABLE public.seller_access_revocations DROP CONSTRAINT IF EXISTS seller_access_revocations_action_check;
ALTER TABLE public.seller_access_revocations ADD CONSTRAINT seller_access_revocations_action_check
  CHECK (action = ANY (ARRAY['revoked'::text, 'restored'::text, 'revoke_failed'::text, 'skipped'::text]));

CREATE OR REPLACE FUNCTION public.revoke_seller_login(p_auth uuid, p_master uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_email text; v_role text; v_ativos int; v_agents int; v_linhas int; v_removidos int;
BEGIN
  IF p_auth IS NULL THEN RETURN jsonb_build_object('banned', false, 'motivo', 'sem auth_user_id'); END IF;
  IF p_auth = p_master THEN RETURN jsonb_build_object('banned', false, 'motivo', 'e o master'); END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_auth;

  -- vínculo ativo em QUALQUER conta => não bane
  SELECT count(*) INTO v_ativos FROM public.ai_team_members
    WHERE auth_user_id = p_auth AND coalesce(active_in_system, true) <> false;
  IF v_ativos > 0 THEN RETURN jsonb_build_object('banned', false, 'motivo', 'tem vinculo ativo'); END IF;

  -- ── TRAVA (16/07): sem REMOÇÃO EXPLÍCITA não bane ──────────────────────────
  SELECT count(*) INTO v_linhas FROM public.ai_team_members WHERE auth_user_id = p_auth;
  SELECT count(*) INTO v_removidos FROM public.ai_team_members
    WHERE auth_user_id = p_auth AND removed_at IS NOT NULL;
  IF v_linhas > 0 AND v_removidos = 0 THEN
    INSERT INTO public.seller_access_revocations (auth_user_id, email, action, reason, team_master_user_id)
      VALUES (p_auth, v_email, 'skipped',
              'NAO banido: ainda tem vinculo na equipe e nenhuma remocao explicita (removed_at nulo). '
              || 'Ausencia de vinculo de vendas NAO e remocao (ex.: usuario de marketing/trafego). Motivo pedido: '
              || coalesce(p_reason, '-'),
              p_master);
    RETURN jsonb_build_object('banned', false, 'motivo', 'sem remocao explicita (removed_at nulo)');
  END IF;

  -- só vendedor (nunca master/gerente com role diferente)
  SELECT role INTO v_role FROM public.profiles WHERE id = p_auth;
  IF coalesce(v_role, '') <> 'seller' THEN
    RETURN jsonb_build_object('banned', false, 'motivo', 'role nao-seller: ' || coalesce(v_role, 'null'));
  END IF;

  -- dono de agentes (master) => não bane
  SELECT count(*) INTO v_agents FROM public.wa_ai_agents WHERE user_id = p_auth;
  IF v_agents > 0 THEN RETURN jsonb_build_object('banned', false, 'motivo', 'dono de agentes'); END IF;

  UPDATE auth.users SET banned_until = timestamptz '2099-12-31 00:00:00+00', updated_at = now() WHERE id = p_auth;
  DELETE FROM auth.sessions WHERE user_id = p_auth;
  INSERT INTO public.seller_access_revocations (auth_user_id, email, action, reason, team_master_user_id)
    VALUES (p_auth, v_email, 'revoked', coalesce('soft-delete: ' || p_reason, 'soft-delete (delete-responsavel)'), p_master);
  RETURN jsonb_build_object('banned', true, 'email', v_email);
EXCEPTION WHEN OTHERS THEN
  BEGIN
    INSERT INTO public.seller_access_revocations (auth_user_id, email, action, reason, team_master_user_id)
      VALUES (p_auth, v_email, 'revoke_failed', SQLERRM, p_master);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('banned', false, 'motivo', 'erro: ' || SQLERRM);
END $function$;
