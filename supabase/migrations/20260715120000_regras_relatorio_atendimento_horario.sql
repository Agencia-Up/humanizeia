-- ============================================================================
-- REGRAS & AUTOMAÇÕES — Fase 3a: horário editável do RELATÓRIO DE ATENDIMENTO.
-- Antes o cron 'feedback-relatorio-diario' rodava 1x às 11:30 UTC (08:30 BRT) e o
-- runner disparava pra todo tenant com recebe_atendimento. Passa a: (1) config por
-- conta (on/off + hora BRT) em conta_automacao_regras; (2) cron de hora em hora;
-- (3) runner só dispara pro tenant cuja hora configurada == hora BRT atual.
-- Retrocompatível: sem config => hora=8, ligado => dispara às 08:00 BRT.
-- Aplicada em prod (seyljsqmhlopkcauhlor) via MCP em 15/07; registro local.
-- ============================================================================
ALTER TABLE public.conta_automacao_regras
  ADD COLUMN IF NOT EXISTS relatorio_atendimento_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS relatorio_atendimento_hora    integer NOT NULL DEFAULT 8;
ALTER TABLE public.conta_automacao_regras DROP CONSTRAINT IF EXISTS rel_atend_hora_chk;
ALTER TABLE public.conta_automacao_regras
  ADD CONSTRAINT rel_atend_hora_chk CHECK (relatorio_atendimento_hora BETWEEN 0 AND 23);

CREATE OR REPLACE FUNCTION public.cron_feedback_relatorio_runner()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/feedback-relatorio-enviar';
  v_k   text;
  v_tenant uuid;
  v_hora_brt int := EXTRACT(hour FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int;
  v_n int := 0;
BEGIN
  SELECT decrypted_secret INTO v_k FROM vault.decrypted_secrets WHERE name = 'feedback_view_key' LIMIT 1;
  v_k := COALESCE(v_k, 'icom-7f3a9c2e');
  FOR v_tenant IN
    SELECT DISTINCT cr.user_id
    FROM public.conta_responsaveis cr
    LEFT JOIN public.conta_automacao_regras ar ON ar.user_id = cr.user_id
    WHERE cr.recebe_atendimento = true AND cr.ativo = true
      AND COALESCE(ar.relatorio_atendimento_enabled, true) = true
      AND COALESCE(ar.relatorio_atendimento_hora, 8) = v_hora_brt
  LOOP
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('k', v_k, 'tenant_id', v_tenant),
      timeout_milliseconds := 120000
    );
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'cron_feedback_relatorio_runner: % contas disparadas (hora BRT %)', v_n, v_hora_brt;
END;
$function$;

-- Cron: de 1x (11:30) para HORARIO (todo minuto 0) — o runner filtra por hora configurada.
SELECT cron.schedule('feedback-relatorio-diario', '0 * * * *', 'SELECT public.cron_feedback_relatorio_runner()');
