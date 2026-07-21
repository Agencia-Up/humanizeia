-- BUG (conexão Meta mostrava "Não conectado" mesmo conectado):
-- get_effective_ad_accounts() declara RETURNS TABLE(id uuid, ...), então "id" vira
-- variável de saída do plpgsql. A linha "SELECT role ... WHERE id = v_uid" ficava
-- AMBÍGUA (id = coluna de saída OU profiles.id) e o Postgres lançava
-- "column reference \"id\" is ambiguous" em TODA chamada. Resultado: o front
-- (useMetaConnection -> fetchConnectedAccount) recebia erro, zerava connectedAccount e
-- mostrava "Não conectado" mesmo com as contas salvas e ativas. Afetava tanto o selo de
-- Integrações quanto o painel do José (ApolloDashboard usa o mesmo hook).
-- FIX definitivo: qualificar a referência como p.id (alias explícito da tabela profiles).
-- Aplicada em prod via MCP em 21/07/2026.
CREATE OR REPLACE FUNCTION public.get_effective_ad_accounts()
 RETURNS TABLE(id uuid, account_id text, account_name text, platform text, is_active boolean, last_sync_at timestamp with time zone, currency text, timezone text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = v_uid;
  IF coalesce(v_role,'') = 'seller' THEN
    v_tenant := public.get_seller_master_user_id();  -- master do vendedor
  ELSE
    v_tenant := v_uid;                                -- dono: ele mesmo
  END IF;
  IF v_tenant IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT a.id, a.account_id, a.account_name, a.platform::text, a.is_active,
         a.last_sync_at, a.currency, a.timezone
  FROM public.ad_accounts a
  WHERE a.user_id = v_tenant AND a.platform::text = 'meta' AND a.is_active = true
  ORDER BY a.created_at ASC;
END
$function$;
