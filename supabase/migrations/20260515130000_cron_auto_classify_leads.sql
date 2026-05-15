-- ============================================================================
-- Cron: roda auto-classify-leads pra cada conta master a cada hora
-- ============================================================================
-- Usa pg_cron + pg_net pra disparar a edge function periodicamente. O loop
-- itera por todos user_ids distintos em ai_crm_leads (= contas master) e
-- chama a edge function passando master_user_id no body.
--
-- A edge function tem auth obrigatória (JWT). Pra cron, precisamos service
-- role key como bearer (configurada via vault.secrets ou hardcoded local).
-- Aqui usamos a service role do projeto via Vault — caso vault não exista,
-- a função apenas pula.
-- ============================================================================

-- 1. Função RPC que faz o loop e chama a edge fn pra cada master_id
CREATE OR REPLACE FUNCTION public.cron_auto_classify_all_masters()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_master uuid;
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/auto-classify-leads';
  v_service_key text;
BEGIN
  -- Pega service role do vault (se existir)
  BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    RAISE NOTICE 'cron_auto_classify_all_masters: service_role_key não está no vault, abortando';
    RETURN;
  END IF;

  -- Loop por cada master_id (user_id distinto em ai_crm_leads)
  FOR v_master IN
    SELECT DISTINCT user_id
    FROM public.ai_crm_leads
    WHERE created_at > NOW() - INTERVAL '90 days'  -- só contas com leads recentes
  LOOP
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object('master_user_id', v_master)
    );
  END LOOP;
END;
$$;

-- 2. Agenda no pg_cron pra rodar de hora em hora
-- Remove agendamento anterior se existir (idempotência)
DO $$
BEGIN
  PERFORM cron.unschedule('auto-classify-leads-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'auto-classify-leads-hourly',
  '7 * * * *',  -- minuto 7 de cada hora (offset pra distribuir carga)
  $$SELECT public.cron_auto_classify_all_masters()$$
);

COMMENT ON FUNCTION public.cron_auto_classify_all_masters() IS
  'Cron job de hora em hora: classifica leads em Inativo/Pouco Qualif/Qualificado pra cada master.';
