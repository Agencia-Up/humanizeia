-- ============================================================================
-- Cobranca por conversa LIVE: trigger em pedro_v2_turn_logs (PRODUCAO)
-- ----------------------------------------------------------------------------
-- CONTEXTO: a regra de cobranca por conversa (1 credito por conversa, com
-- janela de 24h) ja existia na funcao bill_pedro_lead, MAS o Pedro v33 que
-- roda em producao NUNCA chamava essa funcao -> nenhuma cobranca acontecia.
--
-- Este trigger liga a cobranca SEM TOCAR no codigo do agente Pedro. Toda vez
-- que o Pedro grava um turno em pedro_v2_turn_logs, o trigger decide se aquele
-- turno representa uma conversa cobravel e, em caso afirmativo, chama
-- bill_pedro_lead(master_id, telefone_do_lead). A janela de 24h dentro de
-- bill_pedro_lead garante que multiplos turnos da MESMA conversa contem como 1.
--
-- SEGURANCA (intocavel): o trigger e EXCEPTION-hardened (EXCEPTION WHEN OTHERS
-- -> RETURN NEW). Se qualquer coisa der errado na cobranca, o INSERT do Pedro
-- continua normalmente. A cobranca NUNCA pode quebrar nem atrasar o Pedro.
--
-- O QUE COBRA (todos verdadeiros):
--   * dry_run = false           (turno real, nao simulacao)
--   * remote_jid termina em @s.whatsapp.net (conversa 1:1; exclui
--     grupos @g.us, broadcast e newsletter automaticamente)
--   * intent <> 'seller_ack'    (seller_ack e o lado do vendedor, nao cobra)
--   * telefone com 8..15 digitos
--   * telefone NAO e de um vendedor (ai_team_members.whatsapp_number)
--   * telefone NAO e de uma instancia/linha conectada (wa_instances.phone_number)
--   * user_id (conta master que paga) presente
--
-- Cobra SEMPRE na conta master (NEW.user_id ja e o master). Vendedores estao
-- conectados a conta master e nao tem assinatura propria; bill_pedro_lead so
-- cobra quem tem assinatura, entao numeros sem master/assinatura nao geram nada.
--
-- Idempotente: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.bill_pedro_turn_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits TEXT;
BEGIN
  -- Filtros: so cobra turno real de conversa 1:1 com um cliente.
  IF COALESCE(NEW.dry_run, false) THEN RETURN NEW; END IF;
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.remote_jid IS NULL OR NEW.remote_jid NOT LIKE '%@s.whatsapp.net' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.intent, '') = 'seller_ack' THEN RETURN NEW; END IF;

  v_digits := regexp_replace(split_part(NEW.remote_jid, '@', 1), '\D', '', 'g');
  IF length(v_digits) < 8 OR length(v_digits) > 15 THEN RETURN NEW; END IF;

  -- Nao cobra numeros de vendedores (membros do time).
  IF EXISTS (
    SELECT 1 FROM ai_team_members m
    WHERE right(regexp_replace(COALESCE(m.whatsapp_number, ''), '\D', '', 'g'), 8) = right(v_digits, 8)
  ) THEN RETURN NEW; END IF;

  -- Nao cobra numeros de instancias/linhas conectadas.
  IF EXISTS (
    SELECT 1 FROM wa_instances w
    WHERE w.phone_number IS NOT NULL
      AND right(regexp_replace(w.phone_number, '\D', '', 'g'), 8) = right(v_digits, 8)
  ) THEN RETURN NEW; END IF;

  -- Cobra a conversa (bill_pedro_lead aplica a dedup de 24h por conta+telefone).
  PERFORM bill_pedro_lead(NEW.user_id, v_digits, 0, 'pedro');
  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- NUNCA propaga erro pro INSERT do Pedro.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bill_pedro_turn_log ON public.pedro_v2_turn_logs;
CREATE TRIGGER trg_bill_pedro_turn_log
AFTER INSERT ON public.pedro_v2_turn_logs
FOR EACH ROW EXECUTE FUNCTION public.bill_pedro_turn_log();
