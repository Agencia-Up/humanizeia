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
import { PLANS } from '../_shared/checkout-plans.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, asaas-access-token, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const WEBHOOK_TOKEN =
  Deno.env.get('CHECKOUT_ASAAS_WEBHOOK_TOKEN') ||
  Deno.env.get('ASAAS_WEBHOOK_SECRET') ||
  '';

// ── Entitlement liberado por um pagamento confirmado do checkout publico ─────
// O plano contratado vem de `checkout_pending.plan_type` (pro|basico), gravado
// pela checkout-create-subscription. `tokens_included` conta ATENDIMENTOS do
// ciclo (pro = 300, basico = 150). Linhas antigas sem plan_type caem em basico
// (compatibilidade). NAO mexe no gating de agentes por plano (frente separada).
function resolveEntitlement(planType: string | null | undefined): { planId: string; atendimentos: number } {
  if (planType === 'pro') return { planId: 'pro', atendimentos: PLANS.pro.atendimentos };
  return { planId: 'basico', atendimentos: PLANS.basico.atendimentos };
}

// Renovacao do ciclo a partir do `plano` do checkout (mensal/anual).
function computeRenewalISO(plano: string | null | undefined): string {
  const d = new Date();
  if (String(plano) === 'anual') d.setDate(d.getDate() + 365);
  else d.setDate(d.getDate() + 30);
  return d.toISOString();
}

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

    // ── RECARGA DE ATENDIMENTOS (credito avulso) ───────────────────────
    // externalReference = `recarga_<atendimentos>_<userId>`. Tratado AQUI pra
    // que um UNICO webhook registrado no Asaas cubra assinatura + recarga.
    // Credito idempotente (a RPC guarda por payment_id) — re-entrega nao duplica.
    const recExtRef: string | undefined = payment?.externalReference;
    if (recExtRef && recExtRef.startsWith('recarga_')) {
      if (eventName === 'PAYMENT_RECEIVED' || eventName === 'PAYMENT_CONFIRMED') {
        const parts = recExtRef.split('_');            // ['recarga','<atend>','<userId...>']
        const atend = parseInt(parts[1], 10);
        const recUserId = parts.slice(2).join('_');
        if (!Number.isFinite(atend) || atend <= 0 || !recUserId) {
          console.warn(`[checkout-asaas-webhook] recarga ref invalido: ${recExtRef}`);
        } else {
          const { data: credit, error: credErr } = await supabase.rpc('credit_atendimentos_recarga', {
            p_user_id: recUserId,
            p_atendimentos: atend,
            p_payment_id: payment.id,
            p_product_id: recExtRef,
            p_price_paid: payment.value ?? null,
            p_description: `Recarga avulsa — ${atend} atendimentos`,
          });
          if (credErr) {
            console.error(`[checkout-asaas-webhook] erro ao creditar recarga: ${credErr.message}`);
            throw credErr;
          }
          console.log(`[checkout-asaas-webhook] RECARGA creditada — user=${recUserId} +${atend} atend`, credit);
        }
      } else {
        console.log(`[checkout-asaas-webhook] recarga: evento ${eventName} ignorado`);
      }
      return new Response(JSON.stringify({ received: true, recarga: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

            // ENVIA o e-mail de acesso (definir senha). FIX: antes usava
            // admin.generateLink(type:'recovery'), que SO GERA o link e NAO dispara
            // e-mail nenhum (o link era descartado) -> cliente pagava e ficava trancado
            // pra fora. A function send-email (type:'reset_password') gera o recovery
            // link E despacha o e-mail via Resend. Best-effort: nao derruba o webhook.
            try {
              const { error: mailErr } = await supabase.functions.invoke('send-email', {
                body: { type: 'reset_password', email: pending.email, name: pending.full_name },
              });
              if (mailErr) console.warn(`[checkout-asaas-webhook] falha ao enviar e-mail de acesso: ${mailErr.message}`);
              else console.log(`[checkout-asaas-webhook] e-mail de acesso (definir senha) enviado para ${pending.email}`);
            } catch (mailEx) {
              console.warn(`[checkout-asaas-webhook] excecao ao enviar e-mail de acesso: ${(mailEx as any)?.message || mailEx}`);
            }
          }
        }

        // ── Liberar acesso: provisionar user_subscriptions ─────────────────
        // SEGURANÇA: em conta que JÁ EXISTE, só atualizamos plano/cota/status/
        // renovação. NÃO mexemos em tokens_used/tokens_purchased pra não zerar o
        // saldo de atendimentos do ciclo corrente nem recargas avulsas.
        // Em conta NOVA, inicializamos a linha zerada.
        // Feito ANTES de marcar pending='paid' pra que, se houver crash/redelivery,
        // o re-processamento ainda provisione (idempotente) antes do guard cortar.
        if (userId) {
          const renewalISO = computeRenewalISO(pending.plano);
          const { planId, atendimentos } = resolveEntitlement(pending.plan_type);
          const { data: existingSub } = await supabase
            .from('user_subscriptions')
            .select('id')
            .eq('user_id', userId)
            .maybeSingle();

          if (existingSub) {
            const { error: updErr } = await supabase
              .from('user_subscriptions')
              .update({
                plan_id: planId,
                status: 'active',
                tokens_included: atendimentos,
                renewal_date: renewalISO,
                updated_at: new Date().toISOString(),
              })
              .eq('user_id', userId);
            if (updErr) {
              console.error(`[checkout-asaas-webhook] erro ao atualizar user_subscriptions: ${updErr.message}`);
              throw updErr;
            }
            console.log(`[checkout-asaas-webhook] assinatura ATUALIZADA — user=${userId} plan=${planId} cota=${atendimentos}`);
          } else {
            const { error: insErr } = await supabase
              .from('user_subscriptions')
              .insert({
                user_id: userId,
                plan_id: planId,
                status: 'active',
                tokens_included: atendimentos,
                tokens_used: 0,
                tokens_purchased: 0,
                renewal_date: renewalISO,
              });
            if (insErr) {
              console.error(`[checkout-asaas-webhook] erro ao inserir user_subscriptions: ${insErr.message}`);
              throw insErr;
            }
            console.log(`[checkout-asaas-webhook] assinatura CRIADA — user=${userId} plan=${planId} cota=${atendimentos}`);
          }
        } else {
          console.warn(`[checkout-asaas-webhook] sem userId após pagamento — não foi possível provisionar acesso (pending=${pending.id})`);
        }

        // Atualizar pending pra paid
        await supabase.from('checkout_pending').update({
          status: 'paid',
          user_id: userId,
          completed_at: new Date().toISOString(),
        }).eq('id', pending.id);

        console.log(`[checkout-asaas-webhook] ✅ PAGO — pending=${pending.id} user=${userId}`);
        break;
      }

      case 'PAYMENT_OVERDUE': {
        await supabase.from('checkout_pending').update({
          status: 'awaiting_payment',
          error_message: 'Pagamento vencido. Cliente precisa renovar.',
        }).eq('id', pending.id);

        // Suspender acesso enquanto o pagamento estiver vencido.
        // Só mexe em status — preserva cota/plano pra reativar fácil quando pagar.
        if (pending.user_id) {
          const { error: susErr } = await supabase
            .from('user_subscriptions')
            .update({ status: 'suspended', updated_at: new Date().toISOString() })
            .eq('user_id', pending.user_id);
          if (susErr) console.warn(`[checkout-asaas-webhook] falha ao suspender assinatura: ${susErr.message}`);
          else console.log(`[checkout-asaas-webhook] assinatura SUSPENSA — user=${pending.user_id}`);
        }

        console.log(`[checkout-asaas-webhook] ⚠️ VENCIDO — pending=${pending.id}`);
        break;
      }

      case 'SUBSCRIPTION_CANCELLED':
      case 'SUBSCRIPTION_DELETED': {
        await supabase.from('checkout_pending').update({
          status: 'cancelled',
        }).eq('id', pending.id);

        // Bloquear acesso: marca a assinatura como cancelada.
        // Mantém a linha (histórico/cota) — só o status muda; o gating de
        // acesso no frontend checa status='active'.
        if (pending.user_id) {
          const { error: cancErr } = await supabase
            .from('user_subscriptions')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('user_id', pending.user_id);
          if (cancErr) console.warn(`[checkout-asaas-webhook] falha ao cancelar assinatura: ${cancErr.message}`);
          else console.log(`[checkout-asaas-webhook] assinatura CANCELADA — user=${pending.user_id}`);
        }

        console.log(`[checkout-asaas-webhook] ❌ CANCELADO — pending=${pending.id}`);
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
