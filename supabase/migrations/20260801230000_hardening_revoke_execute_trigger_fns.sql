-- ============================================================================
-- HARDENING: revoga EXECUTE das 3 funcoes-de-gatilho de PUBLIC/anon/authenticated
--
-- ai_conv_index_reconcile_trg / ai_conv_index_link_pedro_lead /
-- ai_conv_index_link_marcos_lead sao RETURNS trigger: NAO sao invocaveis via
-- PostgREST nem por chamada direta (o Postgres so as executa no contexto de um
-- gatilho, sem verificar o privilegio EXECUTE do usuario que disparou o evento).
-- O grant PUBLIC default e, portanto, inocuo — mas este REVOKE uniformiza a
-- superficie de permissoes e remove qualquer EXECUTE para anon/authenticated.
--
-- NAO altera a logica das funcoes. Os gatilhos que as utilizam continuam
-- habilitados e disparando normalmente (a execucao via trigger independe de
-- GRANT EXECUTE ao papel do usuario).
-- ============================================================================
REVOKE ALL ON FUNCTION public.ai_conv_index_reconcile_trg()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_conv_index_link_pedro_lead()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_conv_index_link_marcos_lead() FROM PUBLIC, anon, authenticated;
