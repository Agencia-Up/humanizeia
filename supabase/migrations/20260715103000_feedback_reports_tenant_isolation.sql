-- Fecha vazamento operacional dos relatorios de feedback.
--
-- O envio oficial ao gestor deve ser o PDF diario por tenant. O antigo cron
-- feedback-nepq-diario-envio disparava um texto NEPQ separado, duplicando o
-- relatorio e aumentando o risco de confusao/vazamento entre contas.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'feedback-nepq-diario-envio') THEN
    PERFORM cron.unschedule('feedback-nepq-diario-envio');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cron_feedback_nepq_diario_runner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
BEGIN
  RAISE NOTICE 'cron_feedback_nepq_diario_runner desativado: envio NEPQ em texto foi substituido pelo PDF diario tenant-scoped.';
END;
$fn$;
