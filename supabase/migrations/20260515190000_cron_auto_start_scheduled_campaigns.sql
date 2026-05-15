-- ============================================================================
-- Cron: auto-start de campanhas SCHEDULED quando o horário chega
-- ============================================================================
-- Antes: campanha criada com start_time virava status='scheduled', mas NUNCA
-- saía sozinha desse status. Usuário tinha que clicar manualmente em "Iniciar"
-- — e como o botão Play não aparecia pra scheduled, ficava travada pra sempre.
--
-- Agora: a cada 5 minutos, este cron busca campanhas scheduled cujo
-- scheduled_at já passou (mas não +24h pra evitar disparar fantasmas) e chama
-- a edge function enqueue-campaign passando __cron=true + Bearer service_role.
--
-- A edge function tem branch especial pra isso: usa wa_campaigns.user_id e
-- wa_campaigns.seller_member_id direto do banco (sem auth.getUser).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cron_auto_start_scheduled_campaigns_runner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/enqueue-campaign';
  v_service_key text;
  v_campaign record;
  v_dispatched int := 0;
BEGIN
  -- Pega service_role_key do vault
  BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    RAISE NOTICE 'cron_auto_start_scheduled_campaigns_runner: service_role_key não está no vault — abortando';
    RETURN;
  END IF;

  -- Pra cada campaign scheduled cujo horário já passou (mas não muito antiga)
  FOR v_campaign IN
    SELECT id FROM public.wa_campaigns
    WHERE status = 'scheduled'
      AND scheduled_at IS NOT NULL
      AND scheduled_at <= now()
      AND scheduled_at >= (now() - interval '24 hours')
    ORDER BY scheduled_at ASC
    LIMIT 50
  LOOP
    BEGIN
      PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_key
        ),
        body := jsonb_build_object(
          'campaign_id', v_campaign.id,
          '__cron', true
        )
      );
      v_dispatched := v_dispatched + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Erro ao disparar campanha %: %', v_campaign.id, SQLERRM;
    END;
  END LOOP;

  IF v_dispatched > 0 THEN
    RAISE NOTICE 'cron_auto_start_scheduled_campaigns: % campanha(s) iniciadas', v_dispatched;
  END IF;
END;
$$;

-- Reagenda o cron (idempotente)
DO $$
BEGIN
  PERFORM cron.unschedule('auto-start-scheduled-campaigns-5min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'auto-start-scheduled-campaigns-5min',
  '*/5 * * * *',
  $$SELECT public.cron_auto_start_scheduled_campaigns_runner()$$
);

COMMENT ON FUNCTION public.cron_auto_start_scheduled_campaigns_runner() IS
  'Cron 5min: auto-inicia campanhas scheduled cujo scheduled_at já passou. Chama enqueue-campaign com __cron=true.';
