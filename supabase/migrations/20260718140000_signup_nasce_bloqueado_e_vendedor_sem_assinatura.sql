-- ════════════════════════════════════════════════════════════════════════════
-- Conta nova NASCE BLOQUEADA; vendedor NÃO tem assinatura própria
-- ════════════════════════════════════════════════════════════════════════════
--
-- PROBLEMA 1 — todo cadastro novo liberava 30 dias de graça sem pagar.
-- O trigger VIVO `create_default_subscription` inseria `status='active'` +
-- `renewal_date = now() + 30 dias` incondicionalmente.
--
-- POR QUE ISSO VOLTOU (importante, pra não repetir): a correção já existia em
-- `20260603150000_paywall_lock_new_accounts` e consta APLICADA em
-- supabase_migrations.schema_migrations. Só que a migration ANTERIOR
-- `20260602130000_fix_subscription_atendimento_scale` também redefine esta
-- mesma função (com 'active') — ela trata de escala de atendimento e não
-- deveria tocar no gatilho de cadastro. Rodar aquele arquivo DEPOIS do de 03/06
-- desfez a trava; o corpo vivo era byte a byte o dela. Um replay em ORDEM de
-- timestamp termina certo (este arquivo é o mais novo); o que quebra é rodar
-- um arquivo antigo à mão. Se precisar reaplicar o 20260602130000, rode ESTE
-- depois.
--
-- PROBLEMA 2 — vendedor ganhava linha própria em user_subscriptions (25 hoje).
-- Vendedor é FUNCIONÁRIO, não assinante: quem paga é a conta master, e o
-- vendedor herda o bloqueio dela. Medido: `get_effective_subscription_status`
-- lê a linha do DONO (`where user_id = v_owner_id`, resolvido por
-- `resolve_billing_owner_user_id`), então a linha própria do vendedor NUNCA é
-- lida pelo paywall — é peso morto que só polui contagem de assinatura e faz o
-- vendedor ver um plano que não é o dele.
--
-- COMPORTAMENTO NOVO:
--   • dono (owner)  -> nasce 'pending'  => get_effective_subscription_status
--                      devolve is_blocked=true / 'payment_pending' (conferido
--                      no corpo da RPC). Só o checkout-asaas-webhook, após o
--                      pagamento CONFIRMADO, muda pra 'active' (ele faz
--                      update/insert com status='active' — conferido).
--   • vendedor      -> NENHUMA linha. Herda o master via resolve_billing_owner.
--
-- Critério de vendedor: `raw_user_meta_data->>'role' = 'seller'` (mesmo do
-- handle_new_user). MEDIDO antes de confiar: 25 de 25 vendedores existentes têm
-- role='seller' no metadata.
--
-- renewal_date = now() (e não now()+30d): a conta não pagou nada, então não há
-- período pago à frente. Evita a data mentirosa que dizia "renova em 30 dias"
-- pra quem nunca pagou, mantém aritmética de data segura (não é NULL) e falha
-- FECHADO se alguém ativar o status na mão sem definir a data.
--
-- NÃO afeta contas existentes: trigger só roda em INSERT de auth.users novo.
-- ════════════════════════════════════════════════════════════════════════════

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

  -- Funcionário não assina nada: quem paga é a conta master.
  IF v_is_seller THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_subscriptions (
    user_id, plan_id, status,
    tokens_included, tokens_used, tokens_purchased,
    renewal_date, token_cycle_at
  )
  VALUES (
    NEW.id, 'basico', 'pending',
    0, 0, 0,
    now(), now()
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'create_default_subscription error (nao critico): %', SQLERRM;
    RETURN NEW;
END;
$function$;
