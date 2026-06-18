-- ============================================================================
-- Disparo em Massa (Marcos): auto-excluir campanhas CONCLUÍDAS há +24h
-- ----------------------------------------------------------------------------
-- "Concluída" = status terminal que o process-whatsapp-queue grava com completed_at:
--   'completed' | 'completed_with_errors' | 'failed'.
-- Apaga a campanha 24h depois da conclusão. A fila (wa_queue) cai junto pela FK
-- ON DELETE CASCADE (campaign_id). Cron de hora em hora.
--
-- OBS: ao excluir a campanha, o relatório de entregas dela (baseado em wa_queue)
-- também some — é o comportamento pedido (limpar o painel).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cron_cleanup_completed_campaigns()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted int;
BEGIN
  DELETE FROM public.wa_campaigns
  WHERE status IN ('completed', 'completed_with_errors', 'failed')
    AND completed_at IS NOT NULL
    AND completed_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE '[cleanup-campaigns] % campanha(s) concluida(s) ha +24h removida(s)', v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cron_cleanup_completed_campaigns() TO service_role;

-- (re)agenda de hora em hora — idempotente
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-completed-campaigns');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cleanup-completed-campaigns',
  '0 * * * *',
  $$SELECT public.cron_cleanup_completed_campaigns()$$
);
