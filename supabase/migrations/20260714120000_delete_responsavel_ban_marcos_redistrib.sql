-- ============================================================================
-- Remocao definitiva de responsavel/vendedor (Pedro + Marcos):
--  1) revoke_seller_login  — ban SEGURO do login no soft-delete (reutilizavel).
--  2) redistribute_marcos_leads_on_remove — round-robin dos leads ATIVOS do Marcos.
--  3) tg_restore_seller_access_on_link — so restaura acesso se REATIVADO (nao em qualquer UPDATE).
--  4) marcos_lead_redistribution_log — auditoria da redistribuicao do Marcos.
-- Nada apaga historico. Bans so com todas as travas. Idempotente (CREATE OR REPLACE).
-- Aplicada em prod (seyljsqmhlopkcauhlor) via MCP apply_migration em 14/07; este
-- arquivo e o registro local (sem `db push`). Chamada pela edge delete-responsavel.
-- ============================================================================

-- ── 4) LOG da redistribuicao do Marcos ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marcos_lead_redistribution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  from_member_id uuid,
  to_member_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.marcos_lead_redistribution_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marcos_redis_log_master_read ON public.marcos_lead_redistribution_log;
CREATE POLICY marcos_redis_log_master_read ON public.marcos_lead_redistribution_log
  FOR SELECT USING (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_marcos_redis_log_user ON public.marcos_lead_redistribution_log (user_id, created_at DESC);

-- ── 1) BAN SEGURO do login (soft-delete) — so se nao sobrar vinculo ativo ────
CREATE OR REPLACE FUNCTION public.revoke_seller_login(p_auth uuid, p_master uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_email text; v_role text; v_ativos int; v_agents int;
BEGIN
  IF p_auth IS NULL THEN RETURN jsonb_build_object('banned', false, 'motivo', 'sem auth_user_id'); END IF;
  IF p_auth = p_master THEN RETURN jsonb_build_object('banned', false, 'motivo', 'e o master'); END IF;

  -- vinculo ativo em QUALQUER conta => nao bane
  SELECT count(*) INTO v_ativos FROM public.ai_team_members
    WHERE auth_user_id = p_auth AND coalesce(active_in_system, true) <> false;
  IF v_ativos > 0 THEN RETURN jsonb_build_object('banned', false, 'motivo', 'tem vinculo ativo'); END IF;

  -- so vendedor (nunca master/gerente com role diferente)
  SELECT role INTO v_role FROM public.profiles WHERE id = p_auth;
  IF coalesce(v_role, '') <> 'seller' THEN
    RETURN jsonb_build_object('banned', false, 'motivo', 'role nao-seller: ' || coalesce(v_role, 'null'));
  END IF;

  -- dono de agentes (master) => nao bane
  SELECT count(*) INTO v_agents FROM public.wa_ai_agents WHERE user_id = p_auth;
  IF v_agents > 0 THEN RETURN jsonb_build_object('banned', false, 'motivo', 'dono de agentes'); END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_auth;
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
END $fn$;
REVOKE ALL ON FUNCTION public.revoke_seller_login(uuid, uuid, text) FROM public, anon, authenticated;

-- ── 2) REDISTRIBUICAO MARCOS (round-robin dos leads ATIVOS) ──────────────────
CREATE OR REPLACE FUNCTION public.redistribute_marcos_leads_on_remove(p_master uuid, p_removed uuid[], p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_removed_txt text[];
  v_elegiveis uuid[];
  v_lead record;
  v_idx int := 0;
  v_alvo uuid;
  v_alvo_nome text;
  v_redis int := 0;
  v_sem int := 0;
  v_recebidos uuid[] := '{}';
BEGIN
  IF p_removed IS NULL OR array_length(p_removed,1) IS NULL THEN
    RETURN jsonb_build_object('redistribuidos', 0, 'sem_vendedor', 0, 'elegiveis', 0);
  END IF;
  SELECT array_agg(x::text) INTO v_removed_txt FROM unnest(p_removed) x;

  -- Vendedores elegiveis do Marcos: ativos, is_active, nao-manager, nao-removidos; dedup por telefone; rodizio por last_lead.
  SELECT array_agg(id ORDER BY last_lead_received_at ASC NULLS FIRST) INTO v_elegiveis
  FROM (
    SELECT DISTINCT ON (fone) id, last_lead_received_at
    FROM (
      SELECT id, last_lead_received_at, regexp_replace(coalesce(whatsapp_number,''),'[^0-9]','','g') AS fone
      FROM public.ai_team_members
      WHERE user_id = p_master
        AND coalesce(active_in_system, true) <> false
        AND coalesce(is_active, false) = true
        AND coalesce(is_manager, false) = false
        AND id <> ALL(p_removed)
    ) z
    ORDER BY fone, last_lead_received_at ASC NULLS FIRST
  ) e;

  -- Leads ATIVOS do Marcos atribuidos aos removidos (etapa != 'saida'); fechados ficam no historico.
  FOR v_lead IN
    SELECT l.id, l.assigned_to AS old_assigned
    FROM public.crm_leads l
    LEFT JOIN public.crm_pipeline_stages s ON s.id = l.stage_id
    WHERE l.user_id = p_master
      AND l.assigned_to = ANY(v_removed_txt)
      AND coalesce(s.tipo, '') <> 'saida'
  LOOP
    IF v_elegiveis IS NULL OR array_length(v_elegiveis,1) IS NULL THEN
      -- sem vendedor ativo: solta pro bolsao (visivel) + limpa o denormalizado
      UPDATE public.crm_leads
        SET assigned_to = NULL,
            custom_fields = (coalesce(custom_fields,'{}'::jsonb) - 'seller_member_id' - 'seller_name'),
            updated_at = now()
        WHERE id = v_lead.id;
      v_sem := v_sem + 1;
    ELSE
      v_alvo := v_elegiveis[(v_idx % array_length(v_elegiveis,1)) + 1];
      v_idx := v_idx + 1;
      SELECT name INTO v_alvo_nome FROM public.ai_team_members WHERE id = v_alvo;
      UPDATE public.crm_leads
        SET assigned_to = v_alvo::text,
            custom_fields = jsonb_set(
              jsonb_set(coalesce(custom_fields,'{}'::jsonb), '{seller_member_id}', to_jsonb(v_alvo::text), true),
              '{seller_name}', to_jsonb(coalesce(v_alvo_nome,'')), true),
            updated_at = now()
        WHERE id = v_lead.id;
      INSERT INTO public.marcos_lead_redistribution_log (user_id, lead_id, from_member_id, to_member_id, reason)
        VALUES (p_master, v_lead.id,
                CASE WHEN v_lead.old_assigned ~* '^[0-9a-f-]{36}$' THEN v_lead.old_assigned::uuid ELSE NULL END,
                v_alvo, p_reason);
      IF NOT (v_alvo = ANY(v_recebidos)) THEN v_recebidos := array_append(v_recebidos, v_alvo); END IF;
      v_redis := v_redis + 1;
    END IF;
  END LOOP;

  -- rodizio: quem recebeu vai pro fim da fila
  IF array_length(v_recebidos,1) IS NOT NULL THEN
    UPDATE public.ai_team_members SET last_lead_received_at = now() WHERE id = ANY(v_recebidos);
  END IF;

  RETURN jsonb_build_object('redistribuidos', v_redis, 'sem_vendedor', v_sem,
                            'elegiveis', coalesce(array_length(v_elegiveis,1),0),
                            'destinos', coalesce(array_length(v_recebidos,1),0));
END $fn$;
REVOKE ALL ON FUNCTION public.redistribute_marcos_leads_on_remove(uuid, uuid[], text) FROM public, anon, authenticated;

-- ── 3) FIX do trigger de restore: so reativa se houver vinculo ATIVO agora ───
CREATE OR REPLACE FUNCTION public.tg_restore_seller_access_on_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r record; v_email text; v_banned timestamptz; v_ativos int;
BEGIN
  FOR r IN SELECT DISTINCT auth_user_id FROM changed_rows WHERE auth_user_id IS NOT NULL LOOP
    BEGIN
      -- SO restaura quando o vendedor esta REATIVADO (tem membership ativa agora).
      -- Assim um soft-delete (active_in_system=false) ou qualquer UPDATE de linha
      -- inativa NAO reabre o acesso de quem foi removido.
      SELECT count(*) INTO v_ativos FROM public.ai_team_members
        WHERE auth_user_id = r.auth_user_id AND coalesce(active_in_system, true) <> false;
      IF v_ativos = 0 THEN CONTINUE; END IF;

      SELECT banned_until, email INTO v_banned, v_email FROM auth.users WHERE id = r.auth_user_id;
      IF v_banned IS NOT NULL AND v_banned >= timestamptz '2099-01-01 00:00:00+00' THEN
        UPDATE auth.users SET banned_until = NULL, updated_at = now() WHERE id = r.auth_user_id;
        INSERT INTO public.seller_access_revocations (auth_user_id, email, action, reason)
          VALUES (r.auth_user_id, v_email, 'restored', 're-vinculado a equipe ATIVA (active_in_system<>false)');
        RAISE NOTICE '[seller-access] acesso RESTAURADO: % (auth %) ao ser reativado', coalesce(v_email,'?'), r.auth_user_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[seller-access] FALHA ao restaurar (auth %): %', r.auth_user_id, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END $fn$;
