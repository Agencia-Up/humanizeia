-- ============================================================================
-- Cron: checkout-reconcile a cada 3 minutos — REDE DE SEGURANÇA do checkout
-- ----------------------------------------------------------------------------
-- PROBLEMA: o provisionamento (conta + assinatura + e-mail de acesso) depende
-- 100% do checkout-asaas-webhook disparar e completar. Se o webhook do Asaas
-- não é entregue ou erra, o cliente PAGA e fica com NADA, em silêncio (ocorreu
-- com o cliente Mônaco em 03/07).
--
-- SOLUÇÃO: este cron chama a edge `checkout-reconcile`, que confirma o pagamento
-- DIRETO no Asaas (GET, produção) e provisiona igual ao webhook, idempotente.
--
-- PADRÃO (igual cron_rescue_orphan_transfers_hourly):
--   - URL default = PROD; override via GUC app.checkout_reconcile_url.
--   - service_role_key lido do Vault (nunca hardcoded); enviado no Bearer.
-- Idempotente: CREATE OR REPLACE + unschedule defensivo + reschedule.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cron_checkout_reconcile()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/checkout-reconcile';
  v_service_key text;
BEGIN
  BEGIN
    v_url := COALESCE(NULLIF(current_setting('app.checkout_reconcile_url', true), ''), v_url);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    RAISE WARNING '[cron_checkout_reconcile] service_role_key nao esta no Vault - abortando.';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key,
      'apikey', v_service_key
    ),
    body := jsonb_build_object('limit', 50)
  );
END;
$$;

COMMENT ON FUNCTION public.cron_checkout_reconcile() IS
  'Cron de 3min: rede de seguranca do checkout — confirma pagamento no Asaas e provisiona checkout_pending presos em awaiting_payment (auto-corrige webhook perdido).';

DO $$
BEGIN
  PERFORM cron.unschedule('checkout-reconcile-3min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'checkout-reconcile-3min',
  '*/3 * * * *',
  $$SELECT public.cron_checkout_reconcile()$$
);

DO $$
DECLARE v_jobs int;
BEGIN
  SELECT COUNT(*) INTO v_jobs FROM cron.job WHERE jobname = 'checkout-reconcile-3min';
  RAISE NOTICE '[checkout-reconcile] cron agendado: % job(s) ativos', v_jobs;
END $$;
