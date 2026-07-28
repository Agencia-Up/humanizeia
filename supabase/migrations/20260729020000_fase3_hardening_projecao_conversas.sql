-- =============================================================================
-- FASE 3 (hardening) — fecha os avisos do linter de segurança nos objetos da
-- projeção de Conversas IA:
--   1. as 5 funções de TRIGGER (SECURITY DEFINER) + o repair estavam com
--      EXECUTE para anon/authenticated, ou seja, expostas em /rest/v1/rpc/.
--      Elas só devem rodar como trigger (dono/service_role);
--   2. search_path mutável nas funções auxiliares novas.
--
-- O aviso rls_enabled_no_policy nas 3 tabelas (ai_conversation_index,
-- ai_conv_index_deadletter, ai_conv_index_backfill_runs) é INTENCIONAL:
-- RLS fechada, leitura só pelas RPCs SECURITY DEFINER da F4.
--
-- Verificado em prod com ROLLBACK depois de aplicar:
--   * INSERT em wa_inbox (service_role) continua alimentando a projeção
--     (269 -> 270, message_count=1, deadletter=0);
--   * INSERT como role `authenticated` também alimenta (revogar EXECUTE de uma
--     função de trigger não impede o trigger de disparar);
--   * linha com instance_id NULL continua sendo ignorada (guarda da 20260728220000).
-- =============================================================================
REVOKE ALL ON FUNCTION public.ai_conv_index_from_wa_inbox()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_conv_index_from_v3_inbox()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_conv_index_from_v3_outbox()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_conv_index_link_pedro_lead()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_conv_index_link_marcos_lead()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_conv_index_repair(integer)      FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.logos_phone_canonical(text)   SET search_path = pg_catalog, public;
ALTER FUNCTION public.logos_phone_plausible(text)   SET search_path = pg_catalog, public;
ALTER FUNCTION public.ai_conv_index_lock(uuid,text) SET search_path = pg_catalog, public;
