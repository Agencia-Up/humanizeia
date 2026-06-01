-- ============================================================================
-- 20260601140000_followup_min_interval_3min.sql
-- ----------------------------------------------------------------------------
-- Request do master (Wander, 01/06/2026): no painel de Follow-up IA o usuario
-- precisa CONFIGURAR o intervalo minimo entre mensagens (uma pra outra), mas
-- com um PISO ABSOLUTO de 3 minutos que NINGUEM pode reduzir ("trava de
-- seguranca pra proteger a galera de fazer merda").
--
-- Antes: CHECK (intervalo_min_minutes >= 10) -> nao deixava configurar < 10.
-- Agora: CHECK (intervalo_min_minutes >= 3)  -> permite configurar de 3 pra
-- cima, e 3 vira o piso inviolavel (reforcado tambem server-side, hardcoded,
-- dentro da edge function pedro-trigger-followup).
--
-- IMPORTANTE: isso NAO afrouxa a protecao anti-ban. O piso de 3 min continua
-- sendo aplicado de forma HARD no envio (Math.max(3, intervalo_configurado)),
-- e a trava de 30 follow-ups/24h por cliente segue intacta.
-- ============================================================================

-- 1. Remove o CHECK antigo (>= 10). Nome segue a convencao automatica do
--    Postgres pra constraint inline de coluna unica.
ALTER TABLE public.followup_ia_config
  DROP CONSTRAINT IF EXISTS followup_ia_config_intervalo_min_minutes_check;

-- 1b. Fallback: caso o nome da constraint fuja da convencao, varre e remove
--     qualquer CHECK remanescente que ainda exija intervalo_min_minutes >= 10.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel  ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'followup_ia_config'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%intervalo_min_minutes%>=%10%'
  LOOP
    EXECUTE format('ALTER TABLE public.followup_ia_config DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE '[followup_min_interval] removida constraint antiga: %', r.conname;
  END LOOP;
END $$;

-- 2. Adiciona o novo CHECK com piso de 3 minutos.
ALTER TABLE public.followup_ia_config
  ADD CONSTRAINT followup_ia_config_intervalo_min_minutes_check
  CHECK (intervalo_min_minutes >= 3);

-- 3. Ajusta o default pra refletir o novo piso minimo permitido (nao muda
--    linhas existentes; so afeta novas linhas que nao informem o valor).
--    Mantemos 15 como sugestao conservadora; o piso e 3.
ALTER TABLE public.followup_ia_config
  ALTER COLUMN intervalo_min_minutes SET DEFAULT 15;

-- 3b. is_active passa a ser o PAUSE global do follow-up (regra Wander
--     01/06/2026). Antes desta feature is_active=false nao tinha efeito; agora
--     PAUSA tudo (inclusive funis manuais). Por isso o default vira TRUE: novas
--     linhas nascem ATIVAS, e o pause so acontece por acao explicita do master.
--     (Nao altera linhas existentes; a transicao de linhas legadas com
--     is_active=false e tratada separadamente no deploy.)
ALTER TABLE public.followup_ia_config
  ALTER COLUMN is_active SET DEFAULT true;

-- ─── Verificacao ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(con.oid) INTO v_def
  FROM pg_constraint con
  JOIN pg_class rel  ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'public'
    AND rel.relname = 'followup_ia_config'
    AND con.conname = 'followup_ia_config_intervalo_min_minutes_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '[followup_min_interval] constraint nova nao encontrada!';
  END IF;
  IF v_def NOT ILIKE '%>=%3%' THEN
    RAISE EXCEPTION '[followup_min_interval] constraint nao reflete piso de 3: %', v_def;
  END IF;
  RAISE NOTICE '[followup_min_interval] OK -> %', v_def;
END $$;
