-- RPCs de admin para a tela de feedback_config por tenant (superadmin).
-- Gate: public._is_caller_superadmin() (profiles.is_superadmin). SECURITY DEFINER.
-- Só mexe em feedback_config (flags/caps/canais) — NÃO toca em transferência/CRM/follow-up.
-- Consumidas pela aba "Feedbacks" em /administracao (AdminFeedbackConfigTab.tsx).
-- Aplicada em prod via MCP (10/07); este arquivo é a versão fiel em Git.

-- 1) Lista: 1 linha por tenant (conta com wa_ai_agents) + a global (tenant null),
--    com a config EFETIVA (a do tenant OU o fallback global).
CREATE OR REPLACE FUNCTION public.feedback_config_admin_list()
RETURNS TABLE(
  tenant_id uuid, email text, tem_config boolean,
  analise boolean, alertas boolean, relatorio boolean, feed_jose boolean,
  cap_analises_dia int, cap_custo_mes_usd numeric, canais_alerta jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE gflags jsonb; gca int; gcu numeric; gcan jsonb;
BEGIN
  IF NOT public._is_caller_superadmin() THEN RETURN; END IF;
  SELECT coalesce(feature_flags,'{}'::jsonb), cap_analises_dia, cap_custo_mes_usd, canais_alerta
    INTO gflags, gca, gcu, gcan
    FROM public.feedback_config WHERE tenant_id IS NULL LIMIT 1;
  gflags := coalesce(gflags,'{}'::jsonb); gca := coalesce(gca,300); gcu := coalesce(gcu,30);
  gcan := coalesce(gcan,'["whatsapp","painel_flag"]'::jsonb);
  RETURN QUERY
  WITH tids AS (
    SELECT NULL::uuid AS tid
    UNION
    SELECT DISTINCT a.user_id FROM public.wa_ai_agents a WHERE a.user_id IS NOT NULL
  )
  SELECT t.tid,
    (SELECT u.email::text FROM auth.users u WHERE u.id = t.tid),
    EXISTS(SELECT 1 FROM public.feedback_config fc WHERE fc.tenant_id IS NOT DISTINCT FROM t.tid),
    coalesce((fc.feature_flags->>'analise')::boolean, (gflags->>'analise')::boolean, false),
    coalesce((fc.feature_flags->>'alertas')::boolean, (gflags->>'alertas')::boolean, false),
    coalesce((fc.feature_flags->>'relatorio')::boolean, (gflags->>'relatorio')::boolean, false),
    coalesce((fc.feature_flags->>'feed_jose')::boolean, (gflags->>'feed_jose')::boolean, false),
    coalesce(fc.cap_analises_dia, gca),
    coalesce(fc.cap_custo_mes_usd, gcu),
    coalesce(fc.canais_alerta, gcan)
  FROM tids t
  LEFT JOIN public.feedback_config fc ON fc.tenant_id = t.tid
  ORDER BY (t.tid IS NOT NULL), (SELECT u.email FROM auth.users u WHERE u.id = t.tid) NULLS FIRST;
END; $$;
REVOKE ALL ON FUNCTION public.feedback_config_admin_list() FROM public;
GRANT EXECUTE ON FUNCTION public.feedback_config_admin_list() TO authenticated;

-- 2) Upsert null-safe (global = tenant null). Merge das 4 flags conhecidas.
CREATE OR REPLACE FUNCTION public.feedback_config_admin_set(
  p_tenant uuid, p_analise boolean, p_alertas boolean, p_relatorio boolean, p_feed_jose boolean,
  p_cap_analises int, p_cap_custo numeric, p_canais jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_flags jsonb;
BEGIN
  IF NOT public._is_caller_superadmin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_flags := jsonb_build_object(
    'analise', coalesce(p_analise,false), 'alertas', coalesce(p_alertas,false),
    'relatorio', coalesce(p_relatorio,false), 'feed_jose', coalesce(p_feed_jose,false));
  IF EXISTS(SELECT 1 FROM public.feedback_config WHERE tenant_id IS NOT DISTINCT FROM p_tenant) THEN
    UPDATE public.feedback_config
       SET feature_flags = coalesce(feature_flags,'{}'::jsonb) || v_flags,
           cap_analises_dia = coalesce(p_cap_analises, cap_analises_dia),
           cap_custo_mes_usd = coalesce(p_cap_custo, cap_custo_mes_usd),
           canais_alerta = coalesce(p_canais, canais_alerta),
           updated_at = now()
     WHERE tenant_id IS NOT DISTINCT FROM p_tenant;
  ELSE
    INSERT INTO public.feedback_config (tenant_id, feature_flags, cap_analises_dia, cap_custo_mes_usd, canais_alerta)
    VALUES (p_tenant, v_flags, coalesce(p_cap_analises,300), coalesce(p_cap_custo,30),
            coalesce(p_canais,'["whatsapp","painel_flag"]'::jsonb));
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.feedback_config_admin_set(uuid,boolean,boolean,boolean,boolean,int,numeric,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.feedback_config_admin_set(uuid,boolean,boolean,boolean,boolean,int,numeric,jsonb) TO authenticated;

-- 3) Responsáveis de entrega do tenant (quem recebe relatório diário / alerta).
CREATE OR REPLACE FUNCTION public.feedback_config_admin_responsaveis(p_tenant uuid)
RETURNS TABLE(nome text, whatsapp text, recebe_atendimento boolean, recebe_alertas boolean, ativo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT r.nome, r.whatsapp, r.recebe_atendimento, r.recebe_alertas, r.ativo
  FROM public.conta_responsaveis r
  WHERE public._is_caller_superadmin() AND r.user_id = p_tenant
  ORDER BY r.recebe_atendimento DESC, r.recebe_alertas DESC, r.nome;
$$;
REVOKE ALL ON FUNCTION public.feedback_config_admin_responsaveis(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.feedback_config_admin_responsaveis(uuid) TO authenticated;
