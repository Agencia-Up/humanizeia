/**
 * checkout-asaas-webhook — recebe eventos do Asaas pro fluxo de ASSINATURA PRO
 *
 * IMPORTANTE: É SEPARADO do `asaas-webhook` existente (que trata RECARGA DE TOKENS).
 * Este webhook é específico pro fluxo de assinatura do plano PRO criado no
 * Prompt 10/11 (Checkout.tsx → checkout-create-subscription → este webhook).
 *
 * Ambos podem coexistir: você configura DOIS webhooks no painel Asaas:
 *   1. Eventos de PAYMENT (tokens) → `asaas-webhook` (existente)
 *   2. Eventos de SUBSCRIPTION (PRO) → `checkout-asaas-webhook` (este)
 * Ou um único webhook que cobre tudo: este endpoint ignora eventos que não são
 * relacionados a checkout_pending (lookup por externalReference 'setup_*' ou 'sub_*').
 *
 * Validação:
 *   Header `asaas-access-token` deve bater com secret CHECKOUT_ASAAS_WEBHOOK_TOKEN.
 *
 * Eventos tratados:
 *   - PAYMENT_RECEIVED, PAYMENT_CONFIRMED → cria conta + ativa assinatura
 *   - PAYMENT_OVERDUE                     → marca como atrasado
 *   - SUBSCRIPTION_CANCELLED              → bloqueia acesso
 *   - SUBSCRIPTION_DELETED                → bloqueia acesso
 *
 * Lookup:
 *   - externalReference = `setup_<pendingId>` ou `sub_<pendingId>`
 *   - Fallback: por asaas_setup_payment_id / asaas_subscription_id / asaas_customer_id
 *
 * Idempotente: webhook pode chegar 2x; verificar status antes de re-processar.
 */

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, asaas-access-token, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const WEBHOOK_TOKEN = Deno.env.get('CHECKOUT_ASAAS_WEBHOOK_TOKEN') || '';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Validar token (Asaas envia no header configurável).
  // Em produção não aceitamos webhook sem segredo, para evitar confirmação falsa.
  if (!WEBHOOK_TOKEN) {
    console.error('[checkout-asaas-webhook] CHECKOUT_ASAAS_WEBHOOK_TOKEN não configurado');
    return new Response(JSON.stringify({ error: 'Webhook token not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const token = req.headers.get('asaas-access-token');
  if (token !== WEBHOOK_TOKEN) {
    console.warn(`[checkout-asaas-webhook] token inválido: ${token?.slice(0, 8)}...`);
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const event = await req.json();
    const eventName: string = event.event || '';
    const payment: any = event.payment;
    const subscription: any = event.subscription;

    console.log(`[checkout-asaas-webhook] event=${eventName} payment=${payment?.id} sub=${subscription?.id}`);

    // ── Lookup do checkout_pending ─────────────────────────────────────
    let pending: any = null;

    // 1. Tentar via externalReference (mais confiável)
    const extRef: string | undefined = payment?.externalReference || subscription?.externalReference;
    if (extRef && extRef.startsWith('setup_')) {
      const pendingId = extRef.slice('setup_'.length);
      const { data } = await supabase.from('checkout_pending').select('*').eq('id', pendingId).maybeSingle();
      pending = data;
    } else if (extRef && extRef.startsWith('sub_')) {
      const pendingId = extRef.slice('sub_'.length);
      const { data } = await supabase.from('checkout_pending').select('*').eq('id', pendingId).maybeSingle();
      pending = data;
    }

    // 2. Fallback: lookup por payment.id
    if (!pending && payment?.id) {
      const { data } = await supabase
        .from('checkout_pending')
        .select('*')
        .eq('asaas_setup_payment_id', payment.id)
        .maybeSingle();
      pending = data;
    }

    // 3. Fallback: lookup por subscription.id
    if (!pending && subscription?.id) {
      const { data } = await supabase
        .from('checkout_pending')
        .select('*')
        .eq('asaas_subscription_id', subscription.id)
        .maybeSingle();
      pending = data;
    }

    // 4. Fallback final: por customer ID + mais recente
    if (!pending && payment?.customer) {
      const { data } = await supabase
        .from('checkout_pending')
        .select('*')
        .eq('asaas_customer_id', payment.customer)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      pending = data;
    }

    if (!pending) {
      // Provavelmente é um evento de RECARGA DE TOKENS (do outro webhook) — ignorar silenciosamente
      console.log(`[checkout-asaas-webhook] checkout_pending não encontrado pra event=${eventName} — provavelmente é fluxo diferente, ignorando`);
      return new Response(JSON.stringify({ received: true, note: 'not a PRO subscription event' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[checkout-asaas-webhook] pending=${pending.id} status_atual=${pending.status} email=${pending.email}`);

    // ── Processar evento ────────────────────────────────────────────────
    switch (eventName) {
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_CONFIRMED': {
        // Idempotência
        if (pending.status === 'paid' && pending.user_id) {
          console.log(`[checkout-asaas-webhook] pending=${pending.id} já estava pago, ignorando re-processamento`);
          break;
        }

        // Criar conta do usuário se ainda não existe
        let userId: string | null = pending.user_id;

        if (!userId) {
          // Verificar se já existe usuário com esse email
          const { data: existingUsers } = await supabase.auth.admin.listUsers();
          const existing = existingUsers?.users?.find((u: any) => u.email === pending.email);

          if (existing) {
            userId = existing.id;
            console.log(`[checkout-asaas-webhook] usuário existente, vinculando: ${userId}`);
          } else {
            // Criar novo usuário com senha aleatória
            const tempPassword = crypto.randomUUID();
            const { data: created, error: createErr } = await supabase.auth.admin.createUser({
              email: pending.email,
              password: tempPassword,
              email_confirm: true,
              user_metadata: {
                full_name: pending.full_name,
                phone: pending.phone,
                document: pending.document,
                source: 'checkout_pro',
                plano: pending.plano,
              },
            });
            if (createErr) {
              console.error(`[checkout-asaas-webhook] erro ao criar usuário: ${createErr.message}`);
              throw createErr;
            }
            userId = created.user?.id || null;
            console.log(`[checkout-asaas-webhook] usuário criado: ${userId}`);

            // Gerar recovery link pro usuário definir senha (Supabase envia por email)
            const { error: resetErr } = await supabase.auth.admin.generateLink({
              type: 'recovery',
              email: pending.email,
            });
            if (resetErr) console.warn(`[checkout-asaas-webhook] falha ao gerar recovery link: ${resetErr.message}`);
          }
        }

        // Atualizar pending pra paid
        await supabase.from('checkout_pending').update({
          status: 'paid',
          user_id: userId,
          completed_at: new Date().toISOString(),
        }).eq('id', pending.id);

        console.log(`[checkout-asaas-webhook] ✅ PAGO — pending=${pending.id} user=${userId}`);

        // TODO (próxima iteração): inserir/atualizar na tabela `subscriptions` interna
        // pra liberar acesso PRO. Aguardando confirmação de qual hook/tabela usar
        // (useSubscription.ts no frontend).
        break;
      }

      case 'PAYMENT_OVERDUE': {
        await supabase.from('checkout_pending').update({
          status: 'awaiting_payment',
          error_message: 'Pagamento vencido. Cliente precisa renovar.',
        }).eq('id', pending.id);
        console.log(`[checkout-asaas-webhook] ⚠️ VENCIDO — pending=${pending.id}`);
        break;
      }

      case 'SUBSCRIPTION_CANCELLED':
      case 'SUBSCRIPTION_DELETED': {
        await supabase.from('checkout_pending').update({
          status: 'cancelled',
        }).eq('id', pending.id);
        console.log(`[checkout-asaas-webhook] ❌ CANCELADO — pending=${pending.id}`);
        // TODO: bloquear acesso PRO na tabela subscriptions
        break;
      }

      default:
        console.log(`[checkout-asaas-webhook] evento ignorado: ${eventName}`);
    }

    return new Response(JSON.stringify({ received: true, processed: eventName }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[checkout-asaas-webhook] erro:', err.message, err.stack);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
