-- ============================================================================
-- Agenda configuravel do Relatorio de Feedback (frequencia, dias, multiplos
-- horarios, janela de analise) — SEM quebrar o padrao atual.
--
-- Compatibilidade (fallback legado, nenhuma acao do usuario necessaria):
--   * relatorio_atendimento_horarios NULL -> usa relatorio_atendimento_hora (8)
--   * relatorio_atendimento_frequencia default 'diario'
--   * relatorio_janela_tipo default 'padrao_atual' (mesmo comportamento de hoje)
--   * tenant sem linha em conta_automacao_regras -> diario 08:00 BRT (COALESCE)
--
-- Convencao de dias da semana: 0=domingo ... 6=sabado (padrao EXTRACT(dow)).
-- ============================================================================

ALTER TABLE public.conta_automacao_regras
  ADD COLUMN IF NOT EXISTS relatorio_atendimento_frequencia text NOT NULL DEFAULT 'diario',
  ADD COLUMN IF NOT EXISTS relatorio_atendimento_dias       int[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS relatorio_atendimento_horarios   int[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS relatorio_janela_tipo            text NOT NULL DEFAULT 'padrao_atual';

DO $$ BEGIN
  ALTER TABLE public.conta_automacao_regras
    ADD CONSTRAINT car_rel_freq_chk CHECK (relatorio_atendimento_frequencia IN ('diario','semanal','dias_especificos'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.conta_automacao_regras
    ADD CONSTRAINT car_rel_dias_chk CHECK (
      relatorio_atendimento_dias IS NULL
      OR relatorio_atendimento_dias <@ ARRAY[0,1,2,3,4,5,6]
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.conta_automacao_regras
    ADD CONSTRAINT car_rel_horarios_chk CHECK (
      relatorio_atendimento_horarios IS NULL
      OR relatorio_atendimento_horarios <@ ARRAY[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.conta_automacao_regras
    ADD CONSTRAINT car_rel_janela_chk CHECK (relatorio_janela_tipo IN (
      'padrao_atual','ultimas_24h','ultimos_2_dias','ultimos_3_dias','ultimos_7_dias','semana_atual','desde_chegada_lead'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.conta_automacao_regras.relatorio_atendimento_dias IS
  'Dias da semana do relatorio (0=domingo..6=sabado). Usado quando frequencia=dias_especificos; em semanal usa o 1o elemento (default segunda=1).';
COMMENT ON COLUMN public.conta_automacao_regras.relatorio_atendimento_horarios IS
  'Horarios de envio em BRT (0-23). NULL = fallback legado relatorio_atendimento_hora (08:00).';
COMMENT ON COLUMN public.conta_automacao_regras.relatorio_janela_tipo IS
  'Janela de analise do relatorio. padrao_atual = comportamento historico. desde_chegada_lead: reservado (tratado como 7 dias ate implementacao incremental).';

-- ── Runner: roda de hora em hora (cron existente '0 * * * *') e agora respeita
--    frequencia + dias + MULTIPLOS horarios, mantendo o fallback 08:00 diario. ──
CREATE OR REPLACE FUNCTION public.cron_feedback_relatorio_runner()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/feedback-relatorio-enviar';
  v_k   text;
  v_tenant uuid;
  v_hora_brt int := EXTRACT(hour FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int;
  v_dow_brt  int := EXTRACT(dow  FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int; -- 0=domingo
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
      -- HORARIO: array novo quando definido; senao hora unica legada (default 8)
      AND (
        (ar.relatorio_atendimento_horarios IS NOT NULL
          AND array_length(ar.relatorio_atendimento_horarios, 1) > 0
          AND v_hora_brt = ANY(ar.relatorio_atendimento_horarios))
        OR ((ar.relatorio_atendimento_horarios IS NULL
          OR array_length(ar.relatorio_atendimento_horarios, 1) IS NULL)
          AND COALESCE(ar.relatorio_atendimento_hora, 8) = v_hora_brt)
      )
      -- FREQUENCIA/DIA: diario sempre; semanal = 1o dia configurado (default segunda=1);
      -- dias_especificos = dow dentro do array (se vazio, nao envia).
      AND (
        COALESCE(ar.relatorio_atendimento_frequencia, 'diario') = 'diario'
        OR (COALESCE(ar.relatorio_atendimento_frequencia, 'diario') = 'semanal'
            AND v_dow_brt = COALESCE((ar.relatorio_atendimento_dias)[1], 1))
        OR (COALESCE(ar.relatorio_atendimento_frequencia, 'diario') = 'dias_especificos'
            AND ar.relatorio_atendimento_dias IS NOT NULL
            AND v_dow_brt = ANY(ar.relatorio_atendimento_dias))
      )
  LOOP
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('k', v_k, 'tenant_id', v_tenant),
      timeout_milliseconds := 120000
    );
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'cron_feedback_relatorio_runner: % contas disparadas (hora BRT %, dow %)', v_n, v_hora_brt, v_dow_brt;
END;
$function$;

COMMENT ON FUNCTION public.cron_feedback_relatorio_runner() IS
  'Dispara o relatorio de Feedback por tenant respeitando frequencia (diario/semanal/dias_especificos), multiplos horarios BRT e fallback legado (diario 08:00 quando nada configurado).';
