-- ============================================================================
-- TRAVA DA SAUDE DOS NUMEROS (wa_instances.health_score)
-- ----------------------------------------------------------------------------
-- Dor do dono: numeros "descontando sozinho". Causas encontradas:
--   1. decrement_instance_health: alem de -30 por falha de envio em massa,
--      DESATIVAVA o numero (is_active=false) quando saude < 20. Falha de envio
--      (contato invalido / UAZAPI instavel / timeout) NAO e problema do numero,
--      mas derrubava o numero ate dos briefings/repasse de lead.
--   2. increment_consecutive_undelivered: aos 10 seguidos tambem DESATIVAVA.
--   3. DEADLOCK: numero com contador >=5 e PULADO na selecao de campanha e o
--      contador so zerava com envio bem-sucedido (que nunca mais acontecia)
--      -> ficava fora do disparo em massa PARA SEMPRE. Nenhum check zerava.
-- A trava: falha de envio NUNCA mais desativa numero (desativacao so por
-- desconexao real, que continua nos checks de status); e a recuperacao
-- (conectado, saude volta a 100) zera o contador e destrava o numero.
-- Aplicada em prod via MCP em 08/07/2026 (arquivo versionado depois).
-- ============================================================================

-- 1) Desconto de saude SEM auto-desativacao (o skip de campanha por saude<20
--    continua no selector do process-whatsapp-queue; briefings ficam vivos).
CREATE OR REPLACE FUNCTION public.decrement_instance_health(instance_id uuid, decrement_value integer DEFAULT 30)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE wa_instances
  SET health_score = GREATEST(0, health_score - decrement_value),
      updated_at = now()
  WHERE id = instance_id;
END;
$function$;

-- 2) Suspeita de shadow-ban continua marcando (flag + -50 na saude, 1x), mas
--    NAO desativa mais o numero.
CREATE OR REPLACE FUNCTION public.increment_consecutive_undelivered(iid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_count integer;
BEGIN
  UPDATE wa_instances
  SET consecutive_undelivered = COALESCE(consecutive_undelivered, 0) + 1,
      updated_at = now()
  WHERE id = iid
  RETURNING consecutive_undelivered INTO new_count;

  IF new_count IS NOT NULL AND new_count >= 10 THEN
    UPDATE wa_instances
    SET shadow_ban_suspect = true,
        health_score = GREATEST(0, health_score - 50)
    WHERE id = iid AND shadow_ban_suspect = false;
  END IF;
END;
$function$;

-- 3) Recuperacao destrava o contador: quando a saude VOLTA a 100 com a
--    instancia conectada (health-check de 5 em 5 min / Verificar Todos),
--    zera consecutive_undelivered -> o numero volta pro disparo em massa.
--    (So dispara quando a saude SOBE pra 100; o +1 do contador nao mexe na
--    saude, entao a contagem de falhas continua funcionando normalmente.)
CREATE OR REPLACE FUNCTION public.tg_wa_instances_saude_recupera()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'connected' AND NEW.health_score = 100
     AND OLD.health_score IS DISTINCT FROM 100 THEN
    NEW.consecutive_undelivered := 0;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wa_instances_saude_recupera ON public.wa_instances;
CREATE TRIGGER trg_wa_instances_saude_recupera
  BEFORE UPDATE ON public.wa_instances
  FOR EACH ROW EXECUTE FUNCTION public.tg_wa_instances_saude_recupera();

-- Self-check: as funcoes nao podem mais conter auto-desativacao.
DO $$
BEGIN
  IF pg_get_functiondef('public.decrement_instance_health(uuid,integer)'::regprocedure) ILIKE '%is_active%' THEN
    RAISE EXCEPTION 'decrement_instance_health ainda desativa instancia';
  END IF;
  IF pg_get_functiondef('public.increment_consecutive_undelivered(uuid)'::regprocedure) ILIKE '%is_active%' THEN
    RAISE EXCEPTION 'increment_consecutive_undelivered ainda desativa instancia';
  END IF;
END $$;
