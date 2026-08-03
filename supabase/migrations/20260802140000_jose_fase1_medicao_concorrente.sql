-- ============================================================================
-- JOSÉ — FASE 1: medição de resultados concorrente e idempotente
--
-- NÃO APLICADA. Arquivo versionado para revisão; aplicar só com autorização.
--
-- ─── CAUSA-RAIZ (verificada em produção, read-only, 02/08/2026) ─────────────
--
-- (a) CANCELAR ≠ PARAR. O runner aborta a chamada HTTP com AbortController após
--     8 min, mas isso encerra só a CONEXÃO. A execução do apollo-measure-outcomes
--     continua no servidor. Como o runner agenda retry em 5 min, duas execuções
--     passam a percorrer os MESMOS apollo_action_outcomes ao mesmo tempo. O
--     timeout do cliente nunca poderia, sozinho, garantir exclusão mútua: a
--     defesa tem de estar DENTRO da medição, com estado durável.
--
-- (b) A AGREGAÇÃO DE APRENDIZADO NUNCA FUNCIONOU. `updateLearningTable` filtra
--     por `pattern_type` e grava `occurrence_count`, `success_count`,
--     `avg_improvement_score`, `success_rate`, `confidence_score`, `last_seen`.
--     NENHUMA dessas colunas existe: a tabela real é
--       (id, user_id, category, insight, evidence jsonb, confidence numeric,
--        times_validated int, is_active, source_campaigns, created_at, updated_at)
--     O SELECT falha, cai no ramo de INSERT, o INSERT falha, e `.catch(() => {})`
--     engole o erro. Resultado observado: apollo_learning = 0 linhas.
--     Esta migration NÃO inventa as colunas do código: adapta o agregado ao
--     schema REAL, que é o correto e já tem RLS/policy.
--
-- (c) `measured++` era incrementado sem conferir o erro do UPDATE, então o
--     contador retornado não representava persistência.
--
-- Aditiva: nenhuma coluna existente é alterada ou removida.
-- Rollback ao final do arquivo (comentado).
-- ============================================================================

-- ── 1) ESTADO DE MEDIÇÃO POR OUTCOME (claim durável) ────────────────────────
ALTER TABLE public.apollo_action_outcomes
  ADD COLUMN IF NOT EXISTS measurement_status  text NOT NULL DEFAULT 'pendente'
    CHECK (measurement_status IN ('pendente','medindo','medido','falhou')),
  ADD COLUMN IF NOT EXISTS lease_token         uuid,
  ADD COLUMN IF NOT EXISTS lease_owner         text,
  ADD COLUMN IF NOT EXISTS lease_expires_at    timestamptz,
  ADD COLUMN IF NOT EXISTS measure_attempts    int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_measure_error  text,
  -- Backoff de FALHA. Sem isto, 'falhou' voltava a ser elegível no mesmo
  -- instante e o retry batia na Meta em laço até estourar as tentativas.
  ADD COLUMN IF NOT EXISTS measure_retry_at    timestamptz;

-- Índice do caminho quente do claim (quem está elegível agora).
CREATE INDEX IF NOT EXISTS apollo_outcomes_claim_idx
  ON public.apollo_action_outcomes (measurement_status, lease_expires_at, created_at);

-- Linhas antigas (antes deste schema) já vêm com o DEFAULT 'pendente'; as que
-- já tinham after_ctr preenchido são marcadas como medidas para não reprocessar.
UPDATE public.apollo_action_outcomes
   SET measurement_status = 'medido'
 WHERE after_ctr IS NOT NULL AND measurement_status = 'pendente';

-- ── 2) CLAIM ATÔMICO DE OUTCOMES ────────────────────────────────────────────
-- Um único UPDATE ... FOR UPDATE SKIP LOCKED ... RETURNING. Duas execuções
-- simultâneas NUNCA pegam o mesmo outcome: quem não conseguir o lock pula a
-- linha (SKIP LOCKED) e o predicado de status/lease impede roubo.
CREATE OR REPLACE FUNCTION public.claim_apollo_outcomes(
  p_token      uuid,
  p_owner      text,
  p_limit      int DEFAULT 50,
  p_lease_min  int DEFAULT 10,
  p_dias       int DEFAULT 7,
  p_max_tentativas int DEFAULT 3
) RETURNS SETOF public.apollo_action_outcomes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_now timestamptz := now();
BEGIN
  RETURN QUERY
  UPDATE public.apollo_action_outcomes AS o
     SET measurement_status = 'medindo',
         lease_token        = p_token,
         lease_owner        = p_owner,
         lease_expires_at   = v_now + make_interval(mins => p_lease_min),
         measure_attempts   = o.measure_attempts + 1
   WHERE o.id IN (
     SELECT c.id FROM public.apollo_action_outcomes c
      WHERE c.created_at <= v_now - make_interval(days => p_dias)
        AND c.measure_attempts < p_max_tentativas
        AND (
              c.measurement_status = 'pendente'
              -- 'medindo' com lease NULL **ou** vencido = trabalho abandonado
           OR (c.measurement_status = 'medindo'
                 AND (c.lease_expires_at IS NULL OR c.lease_expires_at <= v_now))
           OR (c.measurement_status = 'falhou'
                 AND (c.measure_retry_at IS NULL OR c.measure_retry_at <= v_now))
        )
      ORDER BY c.created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED      -- exclusão mútua real entre execuções
   )
  RETURNING o.*;
END $$;

REVOKE ALL ON FUNCTION public.claim_apollo_outcomes(uuid, text, int, int, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_apollo_outcomes(uuid, text, int, int, int, int) TO service_role;

-- ── 3) FINALIZAÇÃO CONDICIONAL AO TOKEN ─────────────────────────────────────
-- Só o dono do lease grava o resultado. Um worker cuja execução continuou no
-- servidor depois do abort do cliente perde o lease e altera ZERO linhas.
CREATE OR REPLACE FUNCTION public.finish_apollo_outcome(
  p_id      uuid,
  p_token   uuid,
  p_ok      boolean,
  p_after   jsonb DEFAULT NULL,   -- {health_score, roas, ctr, cpc, spend}
  p_outcome text  DEFAULT NULL,   -- improved | neutral | declined
  p_score   int   DEFAULT NULL,
  p_erro    text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_n int; v_user uuid; v_acao text;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('finalizado', false, 'motivo', 'token_nulo');
  END IF;

  UPDATE public.apollo_action_outcomes AS o
     SET measurement_status = CASE WHEN p_ok THEN 'medido' ELSE 'falhou' END,
         after_health_score = CASE WHEN p_ok THEN (p_after->>'health_score')::int ELSE o.after_health_score END,
         after_roas         = CASE WHEN p_ok THEN (p_after->>'roas')::numeric     ELSE o.after_roas END,
         after_ctr          = CASE WHEN p_ok THEN (p_after->>'ctr')::numeric      ELSE o.after_ctr END,
         after_cpc          = CASE WHEN p_ok THEN (p_after->>'cpc')::numeric      ELSE o.after_cpc END,
         after_spend        = CASE WHEN p_ok THEN (p_after->>'spend')::numeric    ELSE o.after_spend END,
         outcome            = CASE WHEN p_ok THEN p_outcome ELSE o.outcome END,
         improvement_score  = CASE WHEN p_ok THEN p_score   ELSE o.improvement_score END,
         measured_at        = CASE WHEN p_ok THEN now()     ELSE o.measured_at END,
         last_measure_error = CASE WHEN p_ok THEN NULL ELSE left(coalesce(p_erro,''), 300) END,
         lease_token        = NULL,
         lease_expires_at   = NULL
   WHERE o.id = p_id
     AND o.measurement_status = 'medindo'
     AND o.lease_token = p_token          -- NULL nunca casa
  RETURNING o.user_id, o.action_type INTO v_user, v_acao;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('finalizado', false, 'motivo', 'lease_perdido_ou_nao_medindo');
  END IF;

  RETURN jsonb_build_object('finalizado', true, 'user_id', v_user, 'action_type', v_acao,
                            'status', CASE WHEN p_ok THEN 'medido' ELSE 'falhou' END);
END $$;

REVOKE ALL ON FUNCTION public.finish_apollo_outcome(uuid, uuid, boolean, jsonb, text, int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_apollo_outcome(uuid, uuid, boolean, jsonb, text, int, text) TO service_role;

-- ── 4) AGREGAÇÃO DE APRENDIZADO — ATÔMICA E NO SCHEMA REAL ──────────────────
-- Chave única do padrão agregado. Sem ela não há como fazer upsert atômico, e
-- era por isso que o código caía no read-then-write (com risco de contar duas
-- vezes). `category='action_outcome'` + `insight=<action_type>` identifica o
-- padrão; os contadores vivem no `evidence` jsonb, que já existe na tabela.
CREATE UNIQUE INDEX IF NOT EXISTS apollo_learning_padrao_uq
  ON public.apollo_learning (user_id, category, insight);

CREATE OR REPLACE FUNCTION public.apply_apollo_learning(
  p_user    uuid,
  p_acao    text,
  p_outcome text,
  p_score   int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_ocorr int; v_suc int; v_media numeric; v_conf numeric;
BEGIN
  INSERT INTO public.apollo_learning AS l
    (user_id, category, insight, evidence, confidence, times_validated, is_active)
  VALUES (
    p_user, 'action_outcome', p_acao,
    jsonb_build_object(
      'ocorrencias', 1,
      'sucessos',    CASE WHEN p_outcome = 'improved' THEN 1 ELSE 0 END,
      'media_melhoria', coalesce(p_score, 0)
    ),
    0.05, 1, true
  )
  ON CONFLICT (user_id, category, insight) DO UPDATE
     SET times_validated = l.times_validated + 1,
         evidence = jsonb_build_object(
           'ocorrencias', coalesce((l.evidence->>'ocorrencias')::int, 0) + 1,
           'sucessos',    coalesce((l.evidence->>'sucessos')::int, 0)
                          + CASE WHEN p_outcome = 'improved' THEN 1 ELSE 0 END,
           -- média incremental: (media * n + score) / (n + 1)
           'media_melhoria', round(
             ((coalesce((l.evidence->>'media_melhoria')::numeric, 0) * coalesce((l.evidence->>'ocorrencias')::int, 0))
              + coalesce(p_score, 0))::numeric
             / (coalesce((l.evidence->>'ocorrencias')::int, 0) + 1), 2)
         ),
         -- confiança cresce com a amostra, teto em 1.0
         confidence = least(1.0, (coalesce((l.evidence->>'ocorrencias')::int, 0) + 1) * 0.05),
         updated_at = now()
  RETURNING (l.evidence->>'ocorrencias')::int, (l.evidence->>'sucessos')::int,
            (l.evidence->>'media_melhoria')::numeric, l.confidence
  INTO v_ocorr, v_suc, v_media, v_conf;

  RETURN jsonb_build_object('ok', true, 'ocorrencias', v_ocorr, 'sucessos', v_suc,
                            'media_melhoria', v_media, 'confianca', v_conf);
END $$;

REVOKE ALL ON FUNCTION public.apply_apollo_learning(uuid, text, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_apollo_learning(uuid, text, text, int) TO service_role;

-- ── 3b) FINALIZAÇÃO ATÔMICA: outcome + aprendizado na MESMA transação ───────
-- POR QUE ESTA FUNÇÃO EXISTE
-- O edge chamava finish_apollo_outcome e, DEPOIS, apply_apollo_learning — duas
-- transações. Se a segunda falhasse, o outcome ficava 'medido' sem aprendizado;
-- e como item medido não volta para a fila, a perda era DEFINITIVA e silenciosa.
-- Aqui as duas escritas vivem no mesmo statement: uma função plpgsql roda dentro
-- da transação do chamador, e NÃO há bloco EXCEPTION aqui de propósito — se o
-- UPSERT do aprendizado levantar erro, o UPDATE do outcome é revertido junto e
-- a linha continua elegível para uma nova tentativa.
CREATE OR REPLACE FUNCTION public.finish_apollo_outcome_atomic(
  p_id          uuid,
  p_token       uuid,
  p_ok          boolean,
  p_after       jsonb DEFAULT NULL,
  p_outcome     text  DEFAULT NULL,   -- improved | neutral | declined
  p_score       int   DEFAULT NULL,
  p_erro        text  DEFAULT NULL,
  p_backoff_min int[] DEFAULT ARRAY[5, 20, 60]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_n int; v_user uuid; v_acao text; v_tent int;
  v_aprend jsonb := NULL;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('finalizado', false, 'motivo', 'token_nulo', 'aprendizado_aplicado', false);
  END IF;

  UPDATE public.apollo_action_outcomes AS o
     SET measurement_status = CASE WHEN p_ok THEN 'medido' ELSE 'falhou' END,
         after_health_score = CASE WHEN p_ok THEN (p_after->>'health_score')::int ELSE o.after_health_score END,
         after_roas         = CASE WHEN p_ok THEN (p_after->>'roas')::numeric     ELSE o.after_roas END,
         after_ctr          = CASE WHEN p_ok THEN (p_after->>'ctr')::numeric      ELSE o.after_ctr END,
         after_cpc          = CASE WHEN p_ok THEN (p_after->>'cpc')::numeric      ELSE o.after_cpc END,
         after_spend        = CASE WHEN p_ok THEN (p_after->>'spend')::numeric    ELSE o.after_spend END,
         outcome            = CASE WHEN p_ok THEN p_outcome ELSE o.outcome END,
         improvement_score  = CASE WHEN p_ok THEN p_score   ELSE o.improvement_score END,
         measured_at        = CASE WHEN p_ok THEN now()     ELSE o.measured_at END,
         last_measure_error = CASE WHEN p_ok THEN NULL ELSE left(coalesce(p_erro, ''), 300) END,
         -- backoff progressivo por tentativa (5, 20, 60); no sucesso, limpo
         measure_retry_at   = CASE
                                WHEN p_ok THEN NULL
                                ELSE now() + make_interval(
                                       mins => p_backoff_min[least(o.measure_attempts, coalesce(array_length(p_backoff_min,1),1))])
                              END,
         lease_token        = NULL,
         lease_owner        = NULL,
         lease_expires_at   = NULL
   WHERE o.id = p_id
     AND o.measurement_status = 'medindo'
     AND o.lease_token = p_token
  RETURNING o.user_id, o.action_type, o.measure_attempts INTO v_user, v_acao, v_tent;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('finalizado', false, 'motivo', 'lease_perdido_ou_nao_medindo', 'aprendizado_aplicado', false);
  END IF;

  -- MESMA TRANSAÇÃO. Sem EXCEPTION: qualquer erro aqui derruba o UPDATE acima.
  IF p_ok THEN
    v_aprend := public.apply_apollo_learning(v_user, v_acao, p_outcome, p_score);
  END IF;

  RETURN jsonb_build_object(
    'finalizado', true,
    'status', CASE WHEN p_ok THEN 'medido' ELSE 'falhou' END,
    'user_id', v_user,
    'action_type', v_acao,
    'tentativas', v_tent,
    'aprendizado_aplicado', (v_aprend IS NOT NULL),
    'aprendizado', v_aprend
  );
END $$;

REVOKE ALL ON FUNCTION public.finish_apollo_outcome_atomic(uuid, uuid, boolean, jsonb, text, int, text, int[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_apollo_outcome_atomic(uuid, uuid, boolean, jsonb, text, int, text, int[]) TO service_role;

-- ============================================================================
-- ROLLBACK (bloco único):
--
--   DROP FUNCTION IF EXISTS public.finish_apollo_outcome_atomic(uuid, uuid, boolean, jsonb, text, int, text, int[]);
--   DROP FUNCTION IF EXISTS public.apply_apollo_learning(uuid, text, text, int);
--   DROP FUNCTION IF EXISTS public.finish_apollo_outcome(uuid, uuid, boolean, jsonb, text, int, text);
--   DROP FUNCTION IF EXISTS public.claim_apollo_outcomes(uuid, text, int, int, int, int);
--   DROP INDEX IF EXISTS public.apollo_learning_padrao_uq;
--   DROP INDEX IF EXISTS public.apollo_outcomes_claim_idx;
--   ALTER TABLE public.apollo_action_outcomes
--     DROP COLUMN IF EXISTS measurement_status,
--     DROP COLUMN IF EXISTS lease_token,
--     DROP COLUMN IF EXISTS lease_owner,
--     DROP COLUMN IF EXISTS lease_expires_at,
--     DROP COLUMN IF EXISTS measure_attempts,
--     DROP COLUMN IF EXISTS last_measure_error,
--     DROP COLUMN IF EXISTS measure_retry_at;
--
-- O UPDATE de linhas antigas (after_ctr NOT NULL -> 'medido') não é revertido
-- porque a coluna deixa de existir. Nenhum dado operacional é perdido:
-- apollo_action_outcomes tem 0 linhas em produção hoje.
-- ============================================================================
