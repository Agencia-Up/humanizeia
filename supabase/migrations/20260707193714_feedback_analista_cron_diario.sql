-- Varredura automatica do Cerebro de Feedback (Timoteo): 1 disparo por lead
-- (fan-out) pra feedback-analista. O batch nao persiste neste ambiente, por isso
-- o loop. feedback_leads_pendentes ja filtra SO tenants com flag analise=on
-- (hoje so a Icom) + EXISTS wa_inbox + mes atual, entao roda com custo zero p/
-- quem nao optou. Cost gate (feedback_cost_gate) trava o teto por dia/mes.
-- Aplicada em prod via MCP em 07/07/2026 (arquivo versionado depois).
CREATE OR REPLACE FUNCTION public.cron_feedback_analista_runner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/feedback-analista';
  v_service_key text;
  v_lead record;
  v_n int := 0;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    RAISE NOTICE 'cron_feedback_analista_runner: service_role_key ausente no vault — abortando';
    RETURN;
  END IF;

  FOR v_lead IN
    SELECT lead_source, lead_id FROM public.feedback_leads_pendentes(60, 6)
  LOOP
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object('lead_id', v_lead.lead_id, 'lead_source', v_lead.lead_source),
      timeout_milliseconds := 120000
    );
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'cron_feedback_analista_runner: % leads disparados', v_n;
END;
$function$;

-- Agenda diaria as 11:00 UTC = 08:00 BRT. Reagenda de forma idempotente.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'feedback-analista-diario') THEN
    PERFORM cron.unschedule('feedback-analista-diario');
  END IF;
  PERFORM cron.schedule('feedback-analista-diario', '0 11 * * *', 'SELECT public.cron_feedback_analista_runner()');
END $$;
