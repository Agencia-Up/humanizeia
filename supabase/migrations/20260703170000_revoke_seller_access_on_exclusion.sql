-- ============================================================================
-- SEGURANÇA: vendedor excluído da equipe PERDE o acesso (login) — automático.
-- ----------------------------------------------------------------------------
-- BUG (incidente 03/07/2026 — vendedor wanzo.mudancas@gmail.com da Monaco):
--   O fluxo de exclusão de vendedor (SellerManagerTab.handleDelete e
--   AgentCrmEquipeTab) apagava APENAS as linhas de `ai_team_members` e
--   desvinculava os leads — NUNCA revogava o acesso. O login do vendedor
--   continuava ativo e, como 17 vendedores têm assinatura própria 'active'
--   (herança de billing) e/ou o paywall cai de volta no master, o vendedor
--   excluído continuava ENTRANDO na plataforma. Classe do bug: "exclusão de
--   membro não é revogação de acesso".
--
-- CORREÇÃO DEFINITIVA (fecha a classe no BANCO, não no botão):
--   Trigger AFTER DELETE em ai_team_members. Quando a ÚLTIMA linha de um
--   vendedor é apagada, o acesso é revogado no nível de LOGIN — banned_until
--   no auth.users (um usuário banido não obtém sessão, independente de
--   assinatura) + sessões ativas derrubadas. Cobre TODOS os caminhos de
--   exclusão (os dois do frontend + SQL manual) — impossível esquecer.
--
--   Trigger AFTER INSERT/UPDATE de auth_user_id: quando o vendedor é
--   RE-vinculado a uma equipe (re-contratado / re-convidado), o ban do nosso
--   mecanismo é revertido — assim re-convidar volta a funcionar sem tocar na
--   edge invite-seller.
--
-- BLINDAGEM (nunca banir a pessoa errada):
--   Só revoga quando, DEPOIS da exclusão: (a) o auth_user_id não tem NENHUMA
--   outra linha de equipe, (b) profiles.role = 'seller' (nunca um 'owner'/
--   master — hoje há 0 owners em linhas de equipe), e (c) não é dono de
--   nenhum wa_ai_agents. Qualquer dúvida => NÃO revoga (fail-safe).
--
-- FAIL-OPEN no DELETE: se a revogação falhar, ela é LOGADA (warning + tabela
--   de auditoria) mas NUNCA bloqueia a exclusão do vendedor — remover + logar
--   é melhor do que travar a operação do gestor.
--
-- SENTINELA: banned_until = 2099-12-31 marca "banido pela exclusão de equipe"
--   (mesmo valor usado no resgate manual do wanzo). O trigger de restauração
--   só reverte bans nessa faixa de futuro distante (>= 2099-01-01), nunca um
--   ban manual/curto de outra origem.
-- ============================================================================

-- ── Auditoria (rastro de toda revogação/restauração automática) ─────────────
CREATE TABLE IF NOT EXISTS public.seller_access_revocations (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auth_user_id         uuid NOT NULL,
  email                text,
  action               text NOT NULL CHECK (action IN ('revoked','restored','revoke_failed')),
  reason               text,
  team_master_user_id  uuid,
  created_at           timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.seller_access_revocations IS
  'Auditoria: acesso de vendedor revogado (exclusao da equipe) ou restaurado (re-vinculo). Escrita pelos triggers em ai_team_members.';
CREATE INDEX IF NOT EXISTS idx_seller_access_revocations_user
  ON public.seller_access_revocations(auth_user_id, created_at DESC);

-- RLS on: bloqueia leitura por authenticated/anon. O owner/definer (postgres,
-- superuser) faz bypass e escreve normalmente; service_role tambem.
ALTER TABLE public.seller_access_revocations ENABLE ROW LEVEL SECURITY;
DO $pol$
BEGIN
  BEGIN
    CREATE POLICY seller_access_revocations_superadmin_read
      ON public.seller_access_revocations FOR SELECT
      USING (public._is_caller_superadmin());
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_function THEN NULL;
  END;
END $pol$;

-- ── Trigger 1: REVOGA acesso quando o vendedor sai da equipe ────────────────
CREATE OR REPLACE FUNCTION public.tg_revoke_seller_access_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r            record;
  v_email      text;
  v_role       text;
  v_remaining  int;
  v_owns_agents int;
BEGIN
  FOR r IN
    SELECT auth_user_id, (array_agg(user_id))[1] AS master_user_id
    FROM deleted_rows
    WHERE auth_user_id IS NOT NULL
    GROUP BY auth_user_id
  LOOP
    v_email := NULL; v_role := NULL;
    BEGIN
      -- (a) ainda é membro de alguma equipe? então mantém o acesso.
      SELECT count(*) INTO v_remaining
      FROM public.ai_team_members WHERE auth_user_id = r.auth_user_id;
      IF v_remaining > 0 THEN CONTINUE; END IF;

      -- (b) só vendedores — nunca um owner/master.
      SELECT role INTO v_role FROM public.profiles WHERE id = r.auth_user_id;
      IF coalesce(v_role,'') <> 'seller' THEN CONTINUE; END IF;

      -- (c) never revoke quem é dono de agentes (blindagem extra p/ master).
      SELECT count(*) INTO v_owns_agents
      FROM public.wa_ai_agents WHERE user_id = r.auth_user_id;
      IF v_owns_agents > 0 THEN CONTINUE; END IF;

      -- REVOGA: bane o login (sentinela) + derruba sessões ativas.
      SELECT email INTO v_email FROM auth.users WHERE id = r.auth_user_id;
      UPDATE auth.users
        SET banned_until = timestamptz '2099-12-31 00:00:00+00', updated_at = now()
        WHERE id = r.auth_user_id;
      DELETE FROM auth.sessions WHERE user_id = r.auth_user_id;

      INSERT INTO public.seller_access_revocations
        (auth_user_id, email, action, reason, team_master_user_id)
        VALUES (r.auth_user_id, v_email, 'revoked',
                'excluido da equipe (ai_team_members DELETE)', r.master_user_id);
      RAISE NOTICE '[seller-access] acesso REVOGADO: % (auth %) apos exclusao da equipe',
        coalesce(v_email,'?'), r.auth_user_id;
    EXCEPTION WHEN OTHERS THEN
      -- FAIL-OPEN: nunca bloquear a exclusao do vendedor; registra a falha.
      BEGIN
        INSERT INTO public.seller_access_revocations
          (auth_user_id, email, action, reason, team_master_user_id)
          VALUES (r.auth_user_id, v_email, 'revoke_failed', SQLERRM, r.master_user_id);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      RAISE WARNING '[seller-access] FALHA ao revogar acesso (auth %): %',
        r.auth_user_id, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_revoke_seller_access_on_delete ON public.ai_team_members;
CREATE TRIGGER trg_revoke_seller_access_on_delete
  AFTER DELETE ON public.ai_team_members
  REFERENCING OLD TABLE AS deleted_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.tg_revoke_seller_access_on_delete();

-- ── Trigger 2: RESTAURA acesso quando o vendedor volta pra uma equipe ───────
CREATE OR REPLACE FUNCTION public.tg_restore_seller_access_on_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        record;
  v_email  text;
  v_banned timestamptz;
BEGIN
  FOR r IN
    SELECT DISTINCT auth_user_id FROM changed_rows WHERE auth_user_id IS NOT NULL
  LOOP
    BEGIN
      SELECT banned_until, email INTO v_banned, v_email
      FROM auth.users WHERE id = r.auth_user_id;
      -- só reverte bans do NOSSO mecanismo (sentinela de futuro distante).
      IF v_banned IS NOT NULL AND v_banned >= timestamptz '2099-01-01 00:00:00+00' THEN
        UPDATE auth.users SET banned_until = NULL, updated_at = now()
          WHERE id = r.auth_user_id;
        INSERT INTO public.seller_access_revocations
          (auth_user_id, email, action, reason)
          VALUES (r.auth_user_id, v_email, 'restored',
                  're-vinculado a uma equipe (ai_team_members INSERT/UPDATE)');
        RAISE NOTICE '[seller-access] acesso RESTAURADO: % (auth %) ao ser re-vinculado',
          coalesce(v_email,'?'), r.auth_user_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[seller-access] FALHA ao restaurar acesso (auth %): %',
        r.auth_user_id, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END;
$$;

-- NOTA: transition table (NEW TABLE) exige UM evento por trigger — por isso
-- INSERT e UPDATE são triggers separados compartilhando a MESMA função.
DROP TRIGGER IF EXISTS trg_restore_seller_access_on_insert ON public.ai_team_members;
CREATE TRIGGER trg_restore_seller_access_on_insert
  AFTER INSERT ON public.ai_team_members
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.tg_restore_seller_access_on_link();

-- Column list (UPDATE OF auth_user_id) é incompatível com transition table,
-- então dispara em todo UPDATE. É seguro: a função só reverte ban do nosso
-- mecanismo, e um vendedor banido por nós não tem linha alguma pra ser
-- atualizada — só volta a ter quando é RE-vinculado (o caso que queremos).
DROP TRIGGER IF EXISTS trg_restore_seller_access_on_update ON public.ai_team_members;
CREATE TRIGGER trg_restore_seller_access_on_update
  AFTER UPDATE ON public.ai_team_members
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.tg_restore_seller_access_on_link();
