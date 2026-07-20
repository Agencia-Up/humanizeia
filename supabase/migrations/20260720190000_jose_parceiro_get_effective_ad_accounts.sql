-- ════════════════════════════════════════════════════════════════════════════
-- Parceiro/vendedor herda a conexão Meta da MASTER (read-only, sem reconectar)
-- ════════════════════════════════════════════════════════════════════════════
-- Problema: o subsistema do José consulta ad_accounts por user_id do CHAMADOR.
-- O parceiro (seller) tem outro user_id → vê vazio → é forçado a "Conectar Meta
-- Ads". O Facebook mora na master (pro tracking/CAPI). Esta RPC devolve as contas
-- Meta do tenant EFETIVO: o próprio user se for dono; a MASTER se for vendedor
-- (via get_seller_master_user_id). NUNCA devolve access_token_encrypted — só as
-- colunas seguras que o front usa. O token fica no servidor (edges usam service
-- role). Mesmo princípio das RPCs get_allowed_lead_* dos leads.
-- ZERO regressão pro dono: quem não é 'seller' recebe as PRÓPRIAS contas, igual hoje.
CREATE OR REPLACE FUNCTION public.get_effective_ad_accounts()
RETURNS TABLE(id uuid, account_id text, account_name text, platform text,
              is_active boolean, last_sync_at timestamptz, currency text, timezone text)
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
  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
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

GRANT EXECUTE ON FUNCTION public.get_effective_ad_accounts() TO authenticated;

COMMENT ON FUNCTION public.get_effective_ad_accounts() IS
  'Contas Meta do tenant efetivo: proprio user se dono; MASTER se vendedor (get_seller_master_user_id). SEM token. Usado por useMetaConnection p/ o parceiro herdar a conexao da master sem reconectar.';
