-- Runner + cron do alerta "bom cliente em risco". So dispara pra tenants com
-- feature_flags.alertas = true -> DORMENTE ate o dono ligar. Roda de 30 em 30
-- min na janela comercial (10-23 UTC ~= 07-20:30 BRT). Idempotente e so envia
-- quando ha caso NOVO: no-op quando nao ha nada (nao floda). Chama a edge
-- feedback-alertas (verify_jwt=false, guard k) via pg_net. Aplicado em prod via MCP.
CREATE OR REPLACE FUNCTION public.cron_feedback_alertas_runner()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/feedback-alertas';
  v_tenant uuid;
  v_n int := 0;
BEGIN
  FOR v_tenant IN
    SELECT tenant_id FROM public.feedback_config
    WHERE tenant_id IS NOT NULL AND (feature_flags->>'alertas')::boolean IS TRUE
  LOOP
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json'),
      body := jsonb_build_object('k','icom-7f3a9c2e','tenant_id',v_tenant),
      timeout_milliseconds := 60000
    );
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'cron_feedback_alertas_runner: % contas', v_n;
END;
$function$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'feedback-alertas-tempo-real';
SELECT cron.schedule('feedback-alertas-tempo-real', '*/30 10-23 * * *', 'SELECT public.cron_feedback_alertas_runner()');
