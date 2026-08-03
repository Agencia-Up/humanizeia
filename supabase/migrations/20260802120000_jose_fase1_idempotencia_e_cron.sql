-- ============================================================================
-- JOSÉ — FASE 1/2: idempotência de ações + observabilidade real do cron
--
-- NÃO APLICADA. Arquivo versionado para revisão; aplicar só com autorização.
--
-- Por que existe:
--   1) Toda ação do José que muta a Meta gasta dinheiro. Sem chave de
--      idempotência, um retry/duplo clique dobra orçamento ou clona campanha 2x.
--   2) O cron hoje reporta sucesso porque o net.http_post foi aceito. Não há
--      onde gravar status real, tentativa, erro, duração — então falha do
--      apollo-agent some e o cliente perde o relatório do dia em silêncio.
--
-- Aditiva: nenhuma coluna existente é alterada ou removida.
-- Rollback ao final do arquivo (comentado).
-- ============================================================================

-- ── 1) IDEMPOTÊNCIA DE AÇÕES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.jose_action_idempotency (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,               -- tenant (escopo de cobrança)
  idempotency_key  text NOT NULL,
  action_type      text NOT NULL,
  resource_ref     text,                        -- campaign_id / adset_id / ad_id
  request_hash     text NOT NULL,               -- detecta reuso da chave com corpo diferente
  status           text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','succeeded','failed')),
  response         jsonb,                       -- resposta devolvida no replay
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

-- A unicidade é o coração da garantia: duas requisições simultâneas com a mesma
-- chave -> a segunda recebe 23505 e NÃO executa.
CREATE UNIQUE INDEX IF NOT EXISTS jose_action_idem_user_key_uq
  ON public.jose_action_idempotency (user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS jose_action_idem_criado_idx
  ON public.jose_action_idempotency (user_id, created_at DESC);

ALTER TABLE public.jose_action_idempotency ENABLE ROW LEVEL SECURITY;

-- Leitura só do próprio tenant; escrita é exclusiva do servidor (service_role
-- ignora RLS). Sem policy de INSERT/UPDATE para authenticated de propósito.
DROP POLICY IF EXISTS jose_action_idem_owner_read ON public.jose_action_idempotency;
CREATE POLICY jose_action_idem_owner_read ON public.jose_action_idempotency
  FOR SELECT USING (auth.uid() = user_id);

-- ── 2) OBSERVABILIDADE DO CRON (colunas aditivas) ───────────────────────────
ALTER TABLE public.apollo_cron_config
  ADD COLUMN IF NOT EXISTS last_status        text,      -- queued|running|succeeded|failed|retrying
  ADD COLUMN IF NOT EXISTS last_error         text,
  ADD COLUMN IF NOT EXISTS last_http_status   int,
  ADD COLUMN IF NOT EXISTS last_duration_ms   int,
  ADD COLUMN IF NOT EXISTS attempt_count      int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_success_at    timestamptz,
  ADD COLUMN IF NOT EXISTS retry_after        timestamptz,
  ADD COLUMN IF NOT EXISTS last_runner_version text,
  -- Token do LEASE: identifica QUAL worker fez o claim. A finalização é
  -- condicional a este valor, então um worker cujo lease já venceu (e cujo
  -- trabalho foi assumido por outro tick) não sobrescreve o estado do novo.
  ADD COLUMN IF NOT EXISTS lease_token        uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at   timestamptz;

-- ── 3) HISTÓRICO DE EXECUÇÕES (auditoria do agendador) ──────────────────────
CREATE TABLE IF NOT EXISTS public.jose_cron_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  job            text NOT NULL,                 -- 'daily_report' | 'measure_outcomes'
  status         text NOT NULL
    CHECK (status IN ('queued','running','succeeded','failed','retrying','skipped')),
  attempt        int  NOT NULL DEFAULT 1,
  http_status    int,
  erro           text,
  duracao_ms     int,
  runner_version text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);
CREATE INDEX IF NOT EXISTS jose_cron_runs_user_idx ON public.jose_cron_runs (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS jose_cron_runs_job_idx  ON public.jose_cron_runs (job, started_at DESC);
ALTER TABLE public.jose_cron_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jose_cron_runs_owner_read ON public.jose_cron_runs;
CREATE POLICY jose_cron_runs_owner_read ON public.jose_cron_runs
  FOR SELECT USING (auth.uid() = user_id);

-- ── 4) TRAVA DE EXECUÇÃO DIÁRIA (impede o measure-outcomes rodar 60x/hora) ──
-- O runner disparava a medição sempre que utcHour==6, sem marcar que já rodou.
-- Rodando a cada minuto, isso são até 60 disparos na mesma hora.
-- A marca NÃO é gravada como "feito" antes da confirmação: ela nasce
-- 'em_andamento' (reserva o dia contra disparo múltiplo) e só vira 'concluido'
-- depois de HTTP + payload validados. Em falha volta a ficar disponível para
-- retry, com backoff e limite — o dia não é consumido por uma tentativa que
-- não funcionou.
CREATE TABLE IF NOT EXISTS public.jose_cron_daily_marks (
  job          text NOT NULL,
  dia          date NOT NULL,
  status       text NOT NULL DEFAULT 'em_andamento'
    CHECK (status IN ('em_andamento','concluido','falhou')),
  tentativas   int  NOT NULL DEFAULT 1,
  ultimo_erro  text,
  http_status  int,
  proxima_em   timestamptz,               -- backoff: antes disso não retenta
  marcado_em   timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz,
  -- LEASE: sem isto, um processo que morre logo após reservar o dia deixa a
  -- marca em 'em_andamento' PARA SEMPRE e a medição nunca mais roda. Com lease
  -- expirável, outro worker recupera o trabalho abandonado — e a finalização é
  -- condicional ao token, então o processo zumbi não sobrescreve quem assumiu.
  lease_token      uuid,
  lease_owner      text,                  -- versão/instância do runner
  lease_expires_at timestamptz,
  PRIMARY KEY (job, dia)
);

-- CREATE TABLE IF NOT EXISTS não adiciona coluna em tabela preexistente. A
-- inspeção read-only de 02/08/2026 mostrou que a tabela NÃO existe em produção
-- (to_regclass = NULL), mas estes ALTERs garantem convergência caso o objeto
-- já exista em outro ambiente ou tenha sido criado por uma versão anterior.
ALTER TABLE public.jose_cron_daily_marks
  ADD COLUMN IF NOT EXISTS status           text NOT NULL DEFAULT 'em_andamento',
  ADD COLUMN IF NOT EXISTS tentativas       int  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS ultimo_erro      text,
  ADD COLUMN IF NOT EXISTS http_status      int,
  ADD COLUMN IF NOT EXISTS proxima_em       timestamptz,
  ADD COLUMN IF NOT EXISTS concluido_em     timestamptz,
  ADD COLUMN IF NOT EXISTS lease_token      uuid,
  ADD COLUMN IF NOT EXISTS lease_owner      text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

ALTER TABLE public.jose_cron_daily_marks ENABLE ROW LEVEL SECURITY;
-- sem policy: só service_role (servidor) enxerga/escreve

-- ── CLAIM ATÔMICO DO JOB DIÁRIO ─────────────────────────────────────────────
-- Por que uma RPC, e não read-then-write no TypeScript:
--   O runner comparava `!lease_expires_at` em JavaScript (onde NULL conta como
--   vencido) e depois filtrava com `.lte("lease_expires_at", now)` no SQL — onde
--   `NULL <= now()` é NULL, e a linha NÃO casa. Resultado: uma marca antiga com
--   status='em_andamento' e lease_expires_at IS NULL ficaria PRESA PARA SEMPRE:
--   o JS decidia recuperar, o UPDATE não achava nada, e a medição nunca mais
--   rodava. Aqui a decisão inteira acontece num único statement, com o predicado
--   completo e RETURNING — sem janela entre ler e escrever, e sem divergência de
--   semântica de NULL entre as duas linguagens.
-- A troca de tipo de retorno (text/boolean -> jsonb) exige DROP antes do CREATE.
DROP FUNCTION IF EXISTS public.claim_jose_daily_job(text, date, uuid, text, int, int);
DROP FUNCTION IF EXISTS public.finish_jose_daily_job(text, date, uuid, boolean, int, text, int);

CREATE OR REPLACE FUNCTION public.claim_jose_daily_job(
  p_job            text,
  p_dia            date,
  p_token          uuid,
  p_owner          text,
  p_lease_min      int DEFAULT 15,
  p_max_tentativas int DEFAULT 3,
  p_backoff_min    int[] DEFAULT ARRAY[5, 20]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_now   timestamptz := now();
  v_exp   timestamptz := now() + make_interval(mins => p_lease_min);
  v_ver   text;
  v_tent  int;
  v_st    text;
  v_prox  timestamptz;
BEGIN
  INSERT INTO public.jose_cron_daily_marks AS m
    (job, dia, status, tentativas, lease_token, lease_owner, lease_expires_at)
  VALUES (p_job, p_dia, 'em_andamento', 1, p_token, p_owner, v_exp)
  ON CONFLICT (job, dia) DO UPDATE
     SET status           = 'em_andamento',
         tentativas       = m.tentativas + 1,
         lease_token      = p_token,
         lease_owner      = p_owner,
         lease_expires_at = v_exp,
         marcado_em       = v_now
   WHERE m.status <> 'concluido'
     AND m.tentativas < p_max_tentativas
     AND (
           -- lease NULL **ou** vencido -> recuperavel (o ponto que estava furado)
           (m.status = 'em_andamento'
              AND (m.lease_expires_at IS NULL OR m.lease_expires_at <= v_now))
        OR (m.status = 'falhou'
              AND (m.proxima_em IS NULL OR m.proxima_em <= v_now))
       )
  RETURNING CASE WHEN m.xmax::text = '0' THEN 'reservado' ELSE 'lease_recuperado' END,
            m.tentativas
  INTO v_ver, v_tent;

  IF v_ver IS NOT NULL THEN
    RETURN jsonb_build_object(
      'veredito',     v_ver,
      'venceu',       true,
      'tentativas',   v_tent,
      'lease_token',  p_token,
      'lease_expira', v_exp,
      -- backoff que a PROXIMA falha desta tentativa vai agendar (informativo:
      -- quem decide de fato e finish_jose_daily_job, fonte unica).
      'backoff_min',  p_backoff_min[least(v_tent, coalesce(array_length(p_backoff_min, 1), 1))]
    );
  END IF;

  -- Perdeu a disputa. Leitura APENAS para explicar (decisao ja foi atomica).
  SELECT status, tentativas, proxima_em INTO v_st, v_tent, v_prox
    FROM public.jose_cron_daily_marks WHERE job = p_job AND dia = p_dia;

  v_ver := CASE
    WHEN v_st IS NULL                 THEN 'nao_disparado:linha_ausente'
    WHEN v_st = 'concluido'           THEN 'ja_concluido_hoje'
    WHEN v_tent >= p_max_tentativas   THEN 'falhou_limite_de_tentativas'
    WHEN v_st = 'em_andamento'        THEN 'em_andamento_por_outro_worker'
    WHEN v_st = 'falhou' AND v_prox IS NOT NULL AND v_prox > v_now THEN 'aguardando_backoff'
    ELSE 'nao_disparado:estado_' || v_st
  END;

  RETURN jsonb_build_object(
    'veredito',   v_ver,
    'venceu',     false,
    'tentativas', v_tent,
    'proxima_em', v_prox
  );
END $$;

REVOKE ALL ON FUNCTION public.claim_jose_daily_job(text, date, uuid, text, int, int, int[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jose_daily_job(text, date, uuid, text, int, int, int[]) TO service_role;

-- ── FINALIZACAO CONDICIONAL AO TOKEN + BACKOFF PROGRESSIVO ──────────────────
-- FONTE UNICA DO BACKOFF. O TypeScript calculava
--   BACKOFF_MIN[Math.min(MAX_TENT - 1, len - 1)]
-- que e uma CONSTANTE: com MAX=3 e [5,20] dava sempre indice 1 -> 20 min,
-- inclusive na primeira falha. Agora o escalonamento sai da tentativa REAL da
-- linha, num unico UPDATE atomico:
--   tentativa 1 -> 5 min | tentativa 2 -> 20 min | tentativa 3 -> sem novo retry
--   (o claim barra com m.tentativas < p_max_tentativas)
CREATE OR REPLACE FUNCTION public.finish_jose_daily_job(
  p_job         text,
  p_dia         date,
  p_token       uuid,
  p_ok          boolean,
  p_http        int   DEFAULT NULL,
  p_erro        text  DEFAULT NULL,
  p_backoff_min int[] DEFAULT ARRAY[5, 20],
  p_max_tentativas int DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tent int;
  v_prox timestamptz;
  v_bk   int;
  v_n    int;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('finalizado', false, 'motivo', 'token_nulo');
  END IF;

  UPDATE public.jose_cron_daily_marks AS m
     SET status       = CASE WHEN p_ok THEN 'concluido' ELSE 'falhou' END,
         concluido_em = CASE WHEN p_ok THEN now() ELSE m.concluido_em END,
         http_status  = p_http,
         ultimo_erro  = CASE WHEN p_ok THEN NULL ELSE left(coalesce(p_erro, ''), 300) END,
         -- backoff pela tentativa ATUAL (m.tentativas = valor antigo da linha).
         -- Na ultima tentativa nao ha proximo retry: o claim ja barra.
         proxima_em   = CASE
                          WHEN p_ok THEN NULL
                          WHEN m.tentativas >= p_max_tentativas THEN NULL
                          ELSE now() + make_interval(
                                 mins => p_backoff_min[least(m.tentativas, coalesce(array_length(p_backoff_min, 1), 1))])
                        END,
         lease_token      = NULL,
         lease_expires_at = NULL
   WHERE m.job = p_job
     AND m.dia = p_dia
     AND m.status = 'em_andamento'
     AND m.lease_token = p_token     -- NULL nunca casa: zumbi nao finaliza
  RETURNING m.tentativas, m.proxima_em INTO v_tent, v_prox;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('finalizado', false, 'motivo', 'lease_perdido_ou_nao_em_andamento');
  END IF;

  v_bk := CASE WHEN p_ok OR v_tent >= p_max_tentativas THEN NULL
               ELSE p_backoff_min[least(v_tent, coalesce(array_length(p_backoff_min, 1), 1))] END;

  RETURN jsonb_build_object(
    'finalizado',  true,
    'status',      CASE WHEN p_ok THEN 'concluido' ELSE 'falhou' END,
    'tentativas',  v_tent,
    'backoff_min', v_bk,
    'proxima_em',  v_prox,
    'limite_atingido', (NOT p_ok AND v_tent >= p_max_tentativas)
  );
END $$;

REVOKE ALL ON FUNCTION public.finish_jose_daily_job(text, date, uuid, boolean, int, text, int[], int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_jose_daily_job(text, date, uuid, boolean, int, text, int[], int) TO service_role;

-- ── 5) SAÚDE POR TENANT (Fase 2) ────────────────────────────────────────────
-- Responde, por cliente: última sincronização, último relatório, última
-- recomendação, último erro, idade do dado e a versão que processou.
--
-- ISOLAMENTO (corrigido após auditoria): uma VIEW comum executa com os
-- privilégios do DONO dela, e as tabelas-base (apollo_cron_config,
-- jose_dashboard_snapshots, ...) seriam lidas SEM aplicar a RLS de quem
-- consulta — vazando a saúde de todos os tenants para qualquer authenticated.
-- Duas medidas, cumulativas:
--   a) security_invoker = true  -> a view passa a respeitar a RLS do chamador
--      (PostgreSQL 15+; produção roda 17);
--   b) REVOKE do acesso direto + RPC tenant-safe abaixo, para que o front nunca
--      dependa só do (a).
CREATE OR REPLACE VIEW public.jose_tenant_health
WITH (security_invoker = true) AS
SELECT
  c.user_id,
  c.is_enabled,
  c.auto_execute,
  c.last_status,
  c.last_error,
  c.last_http_status,
  c.last_duration_ms,
  c.attempt_count,
  c.last_run_at,
  c.last_success_at,
  c.next_run_at,
  c.last_runner_version,
  -- destinatário configurado? (relatório ligado sem número é falha silenciosa)
  (c.send_daily_report AND c.whatsapp_report_number IS NULL) AS relatorio_sem_destinatario,
  -- jose_dashboard_snapshots usa computed_at (verificado no schema vivo), nao created_at
  (SELECT max(s.computed_at) FROM public.jose_dashboard_snapshots s WHERE s.user_id = c.user_id) AS ultimo_snapshot_em,
  (SELECT max(m.created_at) FROM public.apollo_metric_snapshots m WHERE m.user_id = c.user_id) AS ultima_metrica_meta_em,
  (SELECT max(l.executed_at) FROM public.apollo_action_log l WHERE l.user_id = c.user_id) AS ultima_acao_em,
  (SELECT count(*) FROM public.jose_action_approvals a
     WHERE a.user_id = c.user_id AND a.status = 'pendente') AS aprovacoes_pendentes,
  EXTRACT(EPOCH FROM (now() - c.last_success_at))/3600 AS horas_desde_ultimo_sucesso
FROM public.apollo_cron_config c;

COMMENT ON VIEW public.jose_tenant_health IS
  'Saúde do José por cliente: última execução com sucesso, último erro real, idade do dado, aprovações pendentes e se o relatório está ligado sem destinatário. Acesso direto REVOGADO: use get_jose_tenant_health().';

-- (b) Ninguém acessa a view diretamente pela API.
REVOKE ALL ON public.jose_tenant_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.jose_tenant_health TO service_role;

-- RPC tenant-safe: devolve SOMENTE o tenant do chamador. Um membro só enxerga
-- a conta à qual está ativamente vinculado; superadmin comprovado pode passar
-- p_tenant explicitamente. Sem sessão -> nada.
CREATE OR REPLACE FUNCTION public.get_jose_tenant_health(p_tenant uuid DEFAULT NULL)
RETURNS SETOF public.jose_tenant_health
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_super  boolean := false;
  v_alvo   uuid;
  v_qtd    int := 0;
BEGIN
  IF v_caller IS NULL THEN RETURN; END IF;   -- anon não recebe nada

  SELECT coalesce(is_superadmin, false) INTO v_super FROM public.profiles WHERE id = v_caller;

  IF v_super AND p_tenant IS NOT NULL THEN
    v_alvo := p_tenant;
  ELSE
    -- SEM SELEÇÃO ARBITRÁRIA. Conta quantos tenants ATIVOS o chamador tem.
    -- Pegar "o primeiro" (ORDER BY ... LIMIT 1) seria o banco decidir sozinho
    -- em nome de qual empresa a pessoa está olhando — inaceitável em multi-tenant.
    SELECT count(DISTINCT m.user_id) INTO v_qtd
      FROM public.ai_team_members m
     WHERE m.auth_user_id = v_caller
       AND m.removed_at IS NULL
       AND coalesce(m.active_in_system, true) <> false;

    IF v_qtd = 0 THEN
      -- Não é membro de ninguém: só a própria conta.
      v_alvo := v_caller;
    ELSIF v_qtd = 1 THEN
      SELECT DISTINCT m.user_id INTO v_alvo
        FROM public.ai_team_members m
       WHERE m.auth_user_id = v_caller
         AND m.removed_at IS NULL
         AND coalesce(m.active_in_system, true) <> false;
    ELSE
      -- Ambíguo: exige p_tenant explícito E vínculo ativo comprovado nele.
      IF p_tenant IS NULL THEN
        RAISE EXCEPTION 'associacao_ambigua: informe p_tenant (usuario tem % tenants ativos)', v_qtd
          USING ERRCODE = 'check_violation';
      END IF;
      PERFORM 1 FROM public.ai_team_members m
        WHERE m.auth_user_id = v_caller AND m.user_id = p_tenant
          AND m.removed_at IS NULL AND coalesce(m.active_in_system, true) <> false;
      IF NOT FOUND THEN RETURN; END IF;   -- sem vínculo ativo no tenant pedido
      v_alvo := p_tenant;
    END IF;

    -- Pedido explícito divergente do único vínculo: recusa.
    IF p_tenant IS NOT NULL AND p_tenant <> v_alvo THEN RETURN; END IF;
  END IF;

  RETURN QUERY SELECT * FROM public.jose_tenant_health h WHERE h.user_id = v_alvo;
END $$;

REVOKE ALL ON FUNCTION public.get_jose_tenant_health(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_jose_tenant_health(uuid) TO authenticated, service_role;

-- ============================================================================
-- ROLLBACK (executar em bloco único se precisar reverter):
--
--   DROP FUNCTION IF EXISTS public.finish_jose_daily_job(text, date, uuid, boolean, int, text, int[], int);
--   DROP FUNCTION IF EXISTS public.claim_jose_daily_job(text, date, uuid, text, int, int, int[]);
--   DROP FUNCTION IF EXISTS public.get_jose_tenant_health(uuid);
--   DROP VIEW IF EXISTS public.jose_tenant_health;
--   DROP TABLE IF EXISTS public.jose_cron_daily_marks;
--   DROP TABLE IF EXISTS public.jose_cron_runs;
--   DROP TABLE IF EXISTS public.jose_action_idempotency;
--   ALTER TABLE public.apollo_cron_config
--     DROP COLUMN IF EXISTS last_status,
--     DROP COLUMN IF EXISTS last_error,
--     DROP COLUMN IF EXISTS last_http_status,
--     DROP COLUMN IF EXISTS last_duration_ms,
--     DROP COLUMN IF EXISTS attempt_count,
--     DROP COLUMN IF EXISTS last_success_at,
--     DROP COLUMN IF EXISTS retry_after,
--     DROP COLUMN IF EXISTS last_runner_version,
--     DROP COLUMN IF EXISTS lease_token,
--     DROP COLUMN IF EXISTS lease_expires_at;
--
-- Nenhum dado operacional é perdido: as tabelas são novas e as colunas são
-- aditivas (o comportamento anterior não lia nenhuma delas).
-- ============================================================================
