-- ════════════════════════════════════════════════════════════════════════
-- TRAVA DE PAGAMENTO (pagar primeiro, depois liberar) — contas novas
-- ════════════════════════════════════════════════════════════════════════
-- Contexto: hoje o gatilho on_auth_user_created_subscription da plano
-- 'basico' ATIVO pra TODA conta nova — o que mantem o sistema destravado.
--
-- Mudanca: o cliente (owner) passa a nascer com assinatura 'pending'
-- (travada). So o webhook do checkout (checkout-asaas-webhook), apos
-- confirmar o pagamento na Asaas, atualiza para status='active' + plano pago.
--
-- O funcionario (seller) continua nascendo 'active': ele NAO paga, usa o
-- plano do patrao. A deteccao usa raw_user_meta_data->>'role' (mesmo criterio
-- do handle_new_user).
--
-- Contas que JA EXISTEM nao sao afetadas: este gatilho so roda em INSERT de
-- novos usuarios. As 18 contas atuais permanecem 'active'. O frontend
-- (ProtectedRoute) ainda aplica um "grandfather" por data de criacao como
-- camada extra de seguranca, garantindo que ninguem existente seja travado.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_default_subscription()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_seller boolean;
BEGIN
  v_is_seller := (NEW.raw_user_meta_data->>'role' = 'seller');

  INSERT INTO public.user_subscriptions (
    user_id, plan_id, status,
    tokens_included, tokens_used, tokens_purchased,
    renewal_date
  )
  VALUES (
    NEW.id,
    'basico',
    -- Funcionario entra ATIVO (usa o plano do patrao).
    -- Cliente (owner) entra PENDENTE: so libera apos pagamento confirmado.
    CASE WHEN v_is_seller THEN 'active' ELSE 'pending' END,
    CASE WHEN v_is_seller THEN public.plan_atendimentos('basico') ELSE 0 END,
    0, 0,
    now() + interval '30 days'
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'create_default_subscription error (nao critico): %', SQLERRM;
    RETURN NEW;
END;
$function$;
