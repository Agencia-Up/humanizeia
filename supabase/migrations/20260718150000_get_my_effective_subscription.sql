-- ════════════════════════════════════════════════════════════════════════════
-- get_my_effective_subscription() — a assinatura que VALE pra quem está logado
-- ════════════════════════════════════════════════════════════════════════════
--
-- PROBLEMA QUE ISTO RESOLVE: `useSubscription.ts` lia
-- `user_subscriptions WHERE user_id = auth.uid()`. Como a RLS
-- (`users_read_own_subscription`: `auth.uid() = user_id`) impede o vendedor de
-- enxergar a linha do master, o vendedor NUNCA achava nada — e o hook então
-- CRIAVA uma linha própria pra ele. Duas consequências:
--   1. 25 linhas de "assinatura" que na verdade são funcionários (inflavam a
--      contagem de assinantes; o dono contava 3 e o banco dizia 39);
--   2. o vendedor via um plano FALSO (o dele, 'basico'), não o plano do patrão
--      — o que também decide o que aparece no menu (showMarcos/showJose) e o
--      acesso a integrações.
--
-- Apagar as linhas sem isto não adianta: o hook as recria no próximo login.
--
-- SEGURANÇA: não recebe parâmetro. Resolve SEMPRE a partir de `auth.uid()` e
-- devolve só a linha do dono de cobrança DAQUELE chamador — não dá pra pedir a
-- assinatura de outro tenant. É SECURITY DEFINER porque precisa justamente
-- furar a RLS de leitura pra entregar ao funcionário o plano do patrão (e só).
--
-- `is_owner` existe pra o front saber quem PODE ter linha própria: só o dono.
-- Vendedor sem assinatura do master não deve criar linha nenhuma.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_effective_subscription()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_owner uuid;
  v_sub   public.user_subscriptions%rowtype;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'is_owner', false,
                              'owner_user_id', null, 'subscription', null);
  END IF;

  v_owner := public.resolve_billing_owner_user_id(v_uid);

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'is_owner', false,
                              'owner_user_id', null, 'subscription', null);
  END IF;

  -- Mesma escolha de linha do get_effective_subscription_status (a mais nova),
  -- pra painel e paywall nunca discordarem sobre qual assinatura vale.
  SELECT * INTO v_sub
  FROM public.user_subscriptions
  WHERE user_id = v_owner
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'is_owner', (v_owner = v_uid),
    'owner_user_id', v_owner,
    'subscription', CASE WHEN v_sub.user_id IS NULL THEN NULL ELSE to_jsonb(v_sub) END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_effective_subscription() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_effective_subscription() TO authenticated;
