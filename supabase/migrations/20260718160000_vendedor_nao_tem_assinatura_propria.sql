-- ════════════════════════════════════════════════════════════════════════════
-- Vendedor NÃO tem assinatura própria — trava na RLS + limpeza das 25 linhas
-- ════════════════════════════════════════════════════════════════════════════
--
-- Vendedor é FUNCIONÁRIO, não assinante: quem paga é a conta master, e o
-- vendedor herda o bloqueio dela (`resolve_billing_owner_user_id`). Mesmo
-- assim havia 25 linhas de "assinatura" cujo dono era vendedor — foi por isso
-- que a contagem dizia 39 assinaturas quando existem 3 de verdade.
--
-- De onde vinham: `useSubscription.ts` lia `WHERE user_id = auth.uid()`. A RLS
-- de leitura (`auth.uid() = user_id`) impede o vendedor de ver a linha do
-- patrão, então ele nunca achava nada e o hook CRIAVA uma linha pra ele.
--
-- POR QUE A TRAVA VEM NA RLS, e não só no front: o deploy do frontend é um
-- Rebuild manual. Se a limpeza dependesse só do código novo, cada vendedor que
-- logasse com o bundle antigo recriaria a linha e o conserto não seria
-- definitivo. Com a RLS, o banco recusa — qualquer versão do front.
--
-- A condição nova é `resolve_billing_owner_user_id(auth.uid()) = auth.uid()`:
-- "só quem é o próprio dono da cobrança pode ter assinatura". Conferido no
-- corpo da função que quem NÃO é seller retorna a si mesmo, então dono novo
-- continua podendo criar a linha dele (não quebra o cadastro).
--
-- VERIFICADO antes de aplicar (transação + ROLLBACK, com RLS ativa e role
-- authenticated): vendedor com a linha removida NÃO consegue recriá-la
-- (0 linhas, bloqueado pela RLS).
--
-- As linhas apagadas ficam em `_backup_assinaturas_vendedor_20260718` — nada
-- referencia user_subscriptions por FK (conferido), então a remoção é isolada.
-- Pode dropar o backup depois de validado.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Trava: só o dono da cobrança pode inserir a própria assinatura.
DROP POLICY IF EXISTS users_insert_own_pending_subscription ON public.user_subscriptions;
CREATE POLICY users_insert_own_pending_subscription
  ON public.user_subscriptions FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.resolve_billing_owner_user_id(auth.uid()) = auth.uid()
    AND plan_id = 'basico'
    AND status = 'pending'
    AND COALESCE(tokens_included, 0) = 0
    AND COALESCE(tokens_used, 0) = 0
    AND COALESCE(tokens_purchased, 0) = 0
  );

-- 2. Backup do que será removido (rede de segurança, não é tabela de produção).
CREATE TABLE IF NOT EXISTS public._backup_assinaturas_vendedor_20260718
  (LIKE public.user_subscriptions INCLUDING DEFAULTS);
ALTER TABLE public._backup_assinaturas_vendedor_20260718 ENABLE ROW LEVEL SECURITY;

INSERT INTO public._backup_assinaturas_vendedor_20260718
SELECT us.*
FROM public.user_subscriptions us
WHERE us.user_id <> public.resolve_billing_owner_user_id(us.user_id)
  AND NOT EXISTS (
    SELECT 1 FROM public._backup_assinaturas_vendedor_20260718 b
    WHERE b.user_id = us.user_id
  );

-- 3. Limpeza: fora as linhas cujo dono é vendedor.
DELETE FROM public.user_subscriptions us
WHERE us.user_id <> public.resolve_billing_owner_user_id(us.user_id);
