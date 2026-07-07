-- Envio diario do relatorio de atendimento (Cerebro) no WhatsApp. Itera SO as
-- contas que tem alguem com "Atendimento" ligado em conta_responsaveis (se
-- ninguem marcou, nao dispara nada). Chama feedback-relatorio-enviar (verify_jwt
-- false + guard k), que gera o PDF e manda pelo numero da IA. 08:30 BRT (apos a
-- varredura das 08:00). Aplicada em prod via MCP em 07/07/2026.
CREATE OR REPLACE FUNCTION public.cron_feedback_relatorio_runner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/feedback-relatorio-enviar';
  v_tenant uuid;
  v_n int := 0;
BEGIN
  FOR v_tenant IN
    SELECT DISTINCT user_id FROM public.conta_responsaveis
    WHERE recebe_atendimento = true AND ativo = true
  LOOP
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('k', 'icom-7f3a9c2e', 'tenant_id', v_tenant),
      timeout_milliseconds := 120000
    );
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'cron_feedback_relatorio_runner: % contas disparadas', v_n;
END;
$function$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'feedback-relatorio-diario') THEN
    PERFORM cron.unschedule('feedback-relatorio-diario');
  END IF;
  PERFORM cron.schedule('feedback-relatorio-diario', '30 11 * * *', 'SELECT public.cron_feedback_relatorio_runner()');
END $$;
