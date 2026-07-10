-- Item 6 (parte cron): o guard das edges de feedback deixa de ser string fixa no
-- codigo do cron. Guarda a chave no Vault e faz os cron runners lerem de la
-- (mesmo padrao da service_role_key). As edges continuam aceitando o env
-- FEEDBACK_VIEW_KEY (ou o fallback literal de seguranca) — MESMO valor, entao
-- nada quebra. Aplicada em prod via MCP.
-- Passo manual restante: setar o env FEEDBACK_VIEW_KEY nas edges (dashboard) OU
-- redeployar as edges pra lerem tambem do Vault, e ai remover o fallback literal.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'feedback_view_key') THEN
    PERFORM vault.create_secret('icom-7f3a9c2e', 'feedback_view_key', 'Guard (k) das edges de feedback');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cron_feedback_relatorio_runner()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/feedback-relatorio-enviar';
  v_k   text;
  v_tenant uuid;
  v_n int := 0;
BEGIN
  SELECT decrypted_secret INTO v_k FROM vault.decrypted_secrets WHERE name = 'feedback_view_key' LIMIT 1;
  v_k := COALESCE(v_k, 'icom-7f3a9c2e');
  FOR v_tenant IN
    SELECT DISTINCT user_id FROM public.conta_responsaveis
    WHERE recebe_atendimento = true AND ativo = true
  LOOP
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('k', v_k, 'tenant_id', v_tenant),
      timeout_milliseconds := 120000
    );
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'cron_feedback_relatorio_runner: % contas disparadas', v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cron_feedback_alertas_runner()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/feedback-alertas';
  v_k   text;
  v_tenant uuid;
  v_n int := 0;
BEGIN
  SELECT decrypted_secret INTO v_k FROM vault.decrypted_secrets WHERE name = 'feedback_view_key' LIMIT 1;
  v_k := COALESCE(v_k, 'icom-7f3a9c2e');
  FOR v_tenant IN
    SELECT tenant_id FROM public.feedback_config
    WHERE tenant_id IS NOT NULL AND (feature_flags->>'alertas')::boolean IS TRUE
  LOOP
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json'),
      body := jsonb_build_object('k', v_k, 'tenant_id', v_tenant),
      timeout_milliseconds := 60000
    );
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'cron_feedback_alertas_runner: % contas', v_n;
END;
$function$;
