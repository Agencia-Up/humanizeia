-- ============================================================================
-- Jose / Meta Ads -- UNIDADE 1: conta selecionada no servidor + saude real
--
-- Substitui a proposta anterior (tabela dedicada jose_meta_account_settings).
-- Por decisao do dono, a selecao passa a viver em apollo_cron_config, que ja e
-- a configuracao do Jose por tenant e ja garante UMA linha por tenant
-- (UNIQUE (user_id)).
--
-- POR QUE UMA COLUNA NOVA E NAO apollo_cron_config.account_id:
--   account_id e uuid, sem FK, NULL nos 4 tenants -- e o unico leitor vivo a
--   interpreta como o ID EXTERNO da Meta, nao como ad_accounts.id:
--
--     apollo-agent/index.ts:2711  (sendDailyReport)
--       if (cronCfg.account_id)
--         accQ = accQ.eq("account_id", String(cronCfg.account_id).replace(/^act_/, ""));
--
--   Ela compara com ad_accounts.account_id (texto da Meta) e ainda remove o
--   prefixo "act_". Gravar um uuid ali faria o filtro casar ZERO linhas e o
--   relatorio diario responderia "sem_conta_meta". A coluna esta SOBRECARREGADA:
--   tipo de uma coisa, uso de outra. Por isso: coluna explicita, com FK.
--
-- ADITIVA. Nenhum DROP, nenhuma coluna removida, nenhuma semantica alterada.
-- Nenhum consumidor muda de comportamento aqui. Rollback no rodape.
-- ============================================================================

COMMENT ON COLUMN public.apollo_cron_config.account_id IS
  'OBSOLETA e AMBIGUA: declarada uuid, porem lida como ID externo da Meta em '
  'apollo-agent sendDailyReport. Nunca foi populada. NAO GRAVE AQUI. '
  'A conta do Jose e apollo_cron_config.selected_ad_account_id.';

-- -- 1) A CREDENCIAL (saude do TOKEN mora aqui) ------------------------------
-- Medido em producao: a Icom tem 10 contas e apenas 2 credenciais; a conta do
-- Wander tem 3 contas e 2 credenciais. O token esta DUPLICADO por linha de
-- ad_accounts. Sem normalizar, "validar a conta" e "validar o token" viram a
-- mesma coisa -- e nao sao. Um token expirado derruba varias contas de uma vez.
CREATE TABLE IF NOT EXISTS public.meta_connections (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token_encrypted  text NOT NULL,
  -- Identifica a credencial sem expor o valor. A tabela inteira e invisivel
  -- para anon/authenticated, entao isto nunca sai do servidor.
  token_fingerprint       text NOT NULL,
  token_expires_at        timestamptz,
  scopes                  text[],
  -- Estados EXATOS do contrato pedido. 'no_account_selected' NAO aparece aqui:
  -- e derivado (selected_ad_account_id IS NULL), nao um estado da credencial.
  health_status           text NOT NULL DEFAULT 'never_validated'
    CHECK (health_status IN ('never_validated','checking','connected',
                             'expired','reconnect_required','configuration_error')),
  last_validation_at      timestamptz,
  -- Erro da Meta preservado de forma estruturada e SANITIZADA.
  -- OAuthException 190 / subcode 460 = sessao invalidada (senha trocada).
  last_error_code         int,
  last_error_subcode      int,
  last_error_message      text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_connections_user_fingerprint_uq UNIQUE (user_id, token_fingerprint)
);

COMMENT ON TABLE public.meta_connections IS
  'Credencial Meta do tenant. Varias ad_accounts compartilham a mesma conexao. '
  'Saude do TOKEN e daqui; saude/permissao da CONTA e de ad_accounts.';

ALTER TABLE public.meta_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.meta_connections FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.meta_connections TO service_role;
DROP POLICY IF EXISTS "service_role gerencia meta_connections" ON public.meta_connections;
CREATE POLICY "service_role gerencia meta_connections"
  ON public.meta_connections FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.meta_connections (user_id, access_token_encrypted, token_fingerprint, created_at)
SELECT a.user_id, a.access_token_encrypted,
       encode(sha256(a.access_token_encrypted::bytea), 'hex'), min(a.created_at)
  FROM public.ad_accounts a
 WHERE a.platform = 'meta' AND a.access_token_encrypted IS NOT NULL
 GROUP BY a.user_id, a.access_token_encrypted
ON CONFLICT (user_id, token_fingerprint) DO NOTHING;

-- -- 2) SAUDE DA CONTA DE ANUNCIOS (distinta da credencial) ------------------
ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS connection_id            uuid REFERENCES public.meta_connections(id) ON DELETE SET NULL,
  -- account_status cru da Graph API (1=ativa, 2=desativada, 3=unsettled...)
  ADD COLUMN IF NOT EXISTS account_status_meta      int,
  ADD COLUMN IF NOT EXISTS account_health_status    text NOT NULL DEFAULT 'never_validated'
    CHECK (account_health_status IN ('never_validated','checking','connected',
                                     'expired','reconnect_required','configuration_error')),
  ADD COLUMN IF NOT EXISTS last_account_check_at    timestamptz,
  ADD COLUMN IF NOT EXISTS last_account_check_error text;

COMMENT ON COLUMN public.ad_accounts.is_active IS
  'Significa DESCOBERTA/DISPONIVEL e integrada na Logos. NAO significa token '
  'valido (meta_connections.health_status) nem ativa no Jose '
  '(apollo_cron_config.selected_ad_account_id).';

UPDATE public.ad_accounts a
   SET connection_id = c.id
  FROM public.meta_connections c
 WHERE a.platform = 'meta' AND a.connection_id IS NULL
   AND c.user_id = a.user_id
   AND c.token_fingerprint = encode(sha256(a.access_token_encrypted::bytea), 'hex');

CREATE INDEX IF NOT EXISTS ad_accounts_connection_idx ON public.ad_accounts (connection_id);

-- Espelho de UMA direcao: a conexao e dona do token; ad_accounts.
-- access_token_encrypted continua existindo porque ~19 leitores dependem dela
-- (inclusive Pedro/CAPI, fora deste escopo). Assim nao existem dois estados
-- que possam divergir. Em producao este gatilho ainda nao dispara: nada
-- escreve em meta_connections ate a unidade do OAuth entrar.
CREATE OR REPLACE FUNCTION public.sync_meta_connection_token()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.access_token_encrypted IS DISTINCT FROM OLD.access_token_encrypted THEN
    UPDATE public.ad_accounts
       SET access_token_encrypted = NEW.access_token_encrypted, updated_at = now()
     WHERE connection_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_meta_connection_token ON public.meta_connections;
CREATE TRIGGER trg_sync_meta_connection_token
  AFTER UPDATE ON public.meta_connections
  FOR EACH ROW EXECUTE FUNCTION public.sync_meta_connection_token();

-- -- 3) A CONTA SELECIONADA, NO SERVIDOR -------------------------------------
-- Chave que viabiliza a FK composta (o par ja e unico; aqui e declarado).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname='ad_accounts_id_user_platform_uq'
                    AND conrelid='public.ad_accounts'::regclass) THEN
    ALTER TABLE public.ad_accounts
      ADD CONSTRAINT ad_accounts_id_user_platform_uq UNIQUE (id, user_id, platform);
  END IF;
END $$;

ALTER TABLE public.apollo_cron_config
  ADD COLUMN IF NOT EXISTS selected_ad_account_id       uuid,
  -- Coluna tecnica: existe apenas para fechar a FK composta abaixo. E o que
  -- torna IMPOSSIVEL (nao "validado") selecionar conta de outro tenant ou de
  -- outra plataforma.
  ADD COLUMN IF NOT EXISTS selected_platform            public.platform_type NOT NULL DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS selected_by                  uuid,
  ADD COLUMN IF NOT EXISTS selected_at                  timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname='apollo_cron_config_selecao_somente_meta'
                    AND conrelid='public.apollo_cron_config'::regclass) THEN
    ALTER TABLE public.apollo_cron_config
      ADD CONSTRAINT apollo_cron_config_selecao_somente_meta CHECK (selected_platform = 'meta');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname='apollo_cron_config_conta_do_tenant'
                    AND conrelid='public.apollo_cron_config'::regclass) THEN
    -- ON DELETE RESTRICT: nao se apaga a conta que o Jose esta usando sem antes
    -- trocar ou desligar. NOT VALID nao e usado: nao ha linha preenchida ainda.
    ALTER TABLE public.apollo_cron_config
      ADD CONSTRAINT apollo_cron_config_conta_do_tenant
      FOREIGN KEY (selected_ad_account_id, user_id, selected_platform)
      REFERENCES public.ad_accounts (id, user_id, platform) ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON COLUMN public.apollo_cron_config.selected_ad_account_id IS
  'FONTE UNICA da conta de anuncios que o Jose usa. Referencia ad_accounts.id '
  '(uuid interno, NAO o ID externo da Meta). NULL = no_account_selected. '
  'Gravada somente por set_jose_selected_account.';

CREATE INDEX IF NOT EXISTS apollo_cron_config_conta_idx
  ON public.apollo_cron_config (selected_ad_account_id);

-- -- 4) PAPEL DO ATOR (definicao unica usada pelas RPCs) ---------------------
-- master  = profiles.role='owner' sem vinculo ativo de equipe -> ALTERA
-- gerente = role='seller' + ai_team_members.is_manager        -> le, NAO altera
-- vendedor= role='seller'                                     -> le, NAO altera
-- superadmin = profiles.is_superadmin                         -> ALTERA (tenant explicito)
CREATE OR REPLACE FUNCTION public.jose_resolve_ator(p_tenant uuid DEFAULT NULL)
RETURNS TABLE (tenant uuid, papel text, pode_alterar boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid(); v_super boolean := false; v_role text;
  v_master uuid; v_ativos int := 0; v_gerente boolean := false;
BEGIN
  IF v_caller IS NULL THEN RETURN; END IF;
  SELECT coalesce(p.is_superadmin,false), p.role INTO v_super, v_role
    FROM public.profiles p WHERE p.id = v_caller;
  IF v_super THEN
    RETURN QUERY SELECT coalesce(p_tenant, v_caller), 'superadmin'::text, true; RETURN;
  END IF;

  SELECT count(*), bool_or(coalesce(m.is_manager,false)) INTO v_ativos, v_gerente
    FROM public.ai_team_members m
   WHERE m.auth_user_id = v_caller AND m.removed_at IS NULL
     AND coalesce(m.active_in_system, true) <> false;

  IF v_ativos > 0 THEN
    v_master := public.get_seller_master_user_id();
    RETURN QUERY SELECT v_master,
      CASE WHEN v_gerente THEN 'gerente' ELSE 'vendedor' END::text, false;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_caller,
    CASE WHEN coalesce(v_role,'') = 'owner' THEN 'master' ELSE 'sem_papel' END::text,
    coalesce(v_role,'') = 'owner';
END $$;

REVOKE ALL ON FUNCTION public.jose_resolve_ator(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jose_resolve_ator(uuid) TO authenticated, service_role;

-- -- 5) GRAVACAO ATOMICA DA SELECAO ------------------------------------------
-- UM unico UPDATE ... RETURNING. Nao ha read-then-write, e a linha unica por
-- tenant (UNIQUE user_id) torna impossivel existir duas contas selecionadas.
-- Devolve a configuracao RELIDA do banco, nunca o eco do parametro.
--
-- p_exigir_token_saudavel: por padrao TRUE (a Etapa 4 pede "valide que o token
-- esta saudavel"). Fica parametrizavel porque o saneamento inicial precisa
-- gravar a CA 04 ANTES da reconexao da Meta -- e isso e uma decisao explicita
-- de quem chama, registrada no retorno, nao um fallback silencioso.
CREATE OR REPLACE FUNCTION public.set_jose_selected_account(
  p_ad_account_id uuid,
  p_tenant        uuid DEFAULT NULL,
  p_exigir_token_saudavel boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid; v_papel text; v_pode boolean;
  v_conta record; v_saude text; v_grav uuid;
BEGIN
  SELECT t.tenant, t.papel, t.pode_alterar INTO v_tenant, v_papel, v_pode
    FROM public.jose_resolve_ator(p_tenant) t;

  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok',false,'erro','nao_autenticado');
  END IF;
  IF NOT v_pode THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_permissao_para_alterar_integracao','papel',v_papel);
  END IF;

  SELECT a.id, a.account_id, a.account_name, a.is_active, a.connection_id,
         c.health_status
    INTO v_conta
    FROM public.ad_accounts a
    LEFT JOIN public.meta_connections c ON c.id = a.connection_id
   WHERE a.id = p_ad_account_id AND a.user_id = v_tenant AND a.platform = 'meta';

  IF v_conta.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'erro','conta_nao_pertence_ao_tenant');
  END IF;
  IF NOT v_conta.is_active THEN
    RETURN jsonb_build_object('ok',false,'erro','conta_nao_disponivel',
      'detalhe','A conta precisa estar integrada antes de virar a conta do Jose.');
  END IF;

  v_saude := coalesce(v_conta.health_status, 'never_validated');
  IF p_exigir_token_saudavel AND v_saude <> 'connected' THEN
    RETURN jsonb_build_object('ok',false,'erro','credencial_nao_saudavel',
      'credencial_status', v_saude,
      'detalhe','Valide a conexao (ou reconecte a Meta) antes de selecionar esta conta.');
  END IF;

  UPDATE public.apollo_cron_config
     SET selected_ad_account_id = p_ad_account_id,
         selected_platform      = 'meta',
         selected_by            = auth.uid(),
         selected_at            = now()
   WHERE user_id = v_tenant
  RETURNING selected_ad_account_id INTO v_grav;

  IF v_grav IS NULL THEN
    RETURN jsonb_build_object('ok',false,'erro','tenant_sem_configuracao_do_jose',
      'detalhe','Nao existe linha em apollo_cron_config para este cliente.');
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'ok', true, 'papel', v_papel, 'tenant', v_tenant,
      'ad_account_id', a.id, 'meta_account_id', a.account_id, 'account_name', a.account_name,
      'credencial_status', coalesce(c.health_status,'never_validated'),
      'conta_status', a.account_health_status,
      'token_exigido_saudavel', p_exigir_token_saudavel,
      'selecionada_em', k.selected_at)
      FROM public.apollo_cron_config k
      JOIN public.ad_accounts a ON a.id = k.selected_ad_account_id
      LEFT JOIN public.meta_connections c ON c.id = a.connection_id
     WHERE k.user_id = v_tenant
  );
END $$;

REVOKE ALL ON FUNCTION public.set_jose_selected_account(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_jose_selected_account(uuid, uuid, boolean) TO authenticated, service_role;

-- -- 6) LEITURA OFICIAL (o front le DAQUI, nunca do localStorage) ------------
-- NUNCA devolve token. Devolve o estado do contrato:
--   connected | expired | reconnect_required | no_account_selected | configuration_error
CREATE OR REPLACE FUNCTION public.get_jose_selected_account(p_tenant uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tenant uuid; v_papel text; v_pode boolean; v_out jsonb;
BEGIN
  SELECT t.tenant, t.papel, t.pode_alterar INTO v_tenant, v_papel, v_pode
    FROM public.jose_resolve_ator(p_tenant) t;
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok',false,'erro','nao_autenticado');
  END IF;

  SELECT jsonb_build_object(
    'ok', true, 'papel', v_papel, 'pode_alterar', v_pode, 'tenant', v_tenant,
    'ad_account_id', a.id, 'meta_account_id', a.account_id, 'account_name', a.account_name,
    -- O selo vem DAQUI. is_active nao participa: ter linha no banco nunca mais
    -- vai significar "Conectado".
    'estado', CASE
       WHEN c.health_status = 'connected' THEN 'connected'
       WHEN c.health_status = 'expired' THEN 'expired'
       WHEN c.health_status = 'reconnect_required' THEN 'reconnect_required'
       WHEN c.health_status = 'configuration_error' THEN 'configuration_error'
       ELSE 'reconnect_required'   -- never_validated/checking: nao afirma conexao
     END,
    'credencial_validada_em', c.last_validation_at,
    'erro_code', c.last_error_code, 'erro_subcode', c.last_error_subcode,
    'conta_status', a.account_health_status, 'conta_validada_em', a.last_account_check_at,
    'selecionada_em', k.selected_at)
    INTO v_out
    FROM public.apollo_cron_config k
    JOIN public.ad_accounts a ON a.id = k.selected_ad_account_id
    LEFT JOIN public.meta_connections c ON c.id = a.connection_id
   WHERE k.user_id = v_tenant;

  RETURN coalesce(v_out, jsonb_build_object(
    'ok', true, 'papel', v_papel, 'pode_alterar', v_pode, 'tenant', v_tenant,
    'ad_account_id', NULL, 'estado', 'no_account_selected'));
END $$;

REVOKE ALL ON FUNCTION public.get_jose_selected_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_jose_selected_account(uuid) TO authenticated, service_role;

-- -- 7) DESLIGAR (libera a conta para remocao) -------------------------------
CREATE OR REPLACE FUNCTION public.clear_jose_selected_account(p_tenant uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tenant uuid; v_papel text; v_pode boolean; v_n int;
BEGIN
  SELECT t.tenant, t.papel, t.pode_alterar INTO v_tenant, v_papel, v_pode
    FROM public.jose_resolve_ator(p_tenant) t;
  IF v_tenant IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT v_pode THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_permissao_para_alterar_integracao','papel',v_papel);
  END IF;

  UPDATE public.apollo_cron_config
     SET selected_ad_account_id = NULL, selected_by = auth.uid(), selected_at = NULL
   WHERE user_id = v_tenant AND selected_ad_account_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok',true,'limpou',v_n,'estado','no_account_selected');
END $$;

REVOKE ALL ON FUNCTION public.clear_jose_selected_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_jose_selected_account(uuid) TO authenticated, service_role;

-- ============================================================================
-- ROLLBACK (nao executar junto)
-- ----------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.clear_jose_selected_account(uuid);
-- DROP FUNCTION IF EXISTS public.get_jose_selected_account(uuid);
-- DROP FUNCTION IF EXISTS public.set_jose_selected_account(uuid, uuid, boolean);
-- DROP FUNCTION IF EXISTS public.jose_resolve_ator(uuid);
-- ALTER TABLE public.apollo_cron_config
--   DROP CONSTRAINT IF EXISTS apollo_cron_config_conta_do_tenant,
--   DROP CONSTRAINT IF EXISTS apollo_cron_config_selecao_somente_meta;
-- DROP INDEX IF EXISTS public.apollo_cron_config_conta_idx;
-- ALTER TABLE public.apollo_cron_config
--   DROP COLUMN IF EXISTS selected_at, DROP COLUMN IF EXISTS selected_by,
--   DROP COLUMN IF EXISTS selected_platform, DROP COLUMN IF EXISTS selected_ad_account_id;
-- ALTER TABLE public.ad_accounts DROP CONSTRAINT IF EXISTS ad_accounts_id_user_platform_uq;
-- DROP TRIGGER IF EXISTS trg_sync_meta_connection_token ON public.meta_connections;
-- DROP FUNCTION IF EXISTS public.sync_meta_connection_token();
-- DROP INDEX IF EXISTS public.ad_accounts_connection_idx;
-- ALTER TABLE public.ad_accounts
--   DROP COLUMN IF EXISTS last_account_check_error, DROP COLUMN IF EXISTS last_account_check_at,
--   DROP COLUMN IF EXISTS account_health_status, DROP COLUMN IF EXISTS account_status_meta,
--   DROP COLUMN IF EXISTS connection_id;
-- DROP TABLE IF EXISTS public.meta_connections;
-- Nenhum dado de negocio e perdido: tudo aqui apenas agrega.
-- ============================================================================
