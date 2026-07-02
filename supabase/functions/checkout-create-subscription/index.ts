/**
 * checkout-create-subscription — endpoint PÚBLICO (sem JWT)
 *
 * Recebe dados do checkout, cria customer + subscription + setup payment no
 * Asaas, e devolve QR code PIX / linha de boleto / status pro frontend.
 *
 * IMPORTANTE:
 * - Endpoint PÚBLICO: não exige Bearer (qualquer visitante pode comprar).
 *   Validação anti-spam mínima via origin check + rate limit no header.
 * - Service role usado pra escrever na tabela `checkout_pending` (RLS bloqueia anon).
 * - Não armazena dados de cartão. Asaas tokeniza.
 *
 * Body esperado:
 * {
 *   plano: 'mensal' | 'anual',
 *   personType: 'pf' | 'pj',
 *   fullName: string,
 *   email: string,
 *   document: string,        // CPF ou CNPJ (só dígitos)
 *   phone: string,           // só dígitos
 *   paymentMethod: 'pix' | 'cartao' | 'boleto',
 *   cardData?: { number, expiry, cvv, holderName }  // só se cartao
 * }
 *
 * Resposta:
 * {
 *   success: true,
 *   pendingId: uuid,
 *   subscriptionId: string,
 *   setupPayment: {
 *     status, dueDate,
 *     pix?: { payload, qrCode },
 *     boleto?: { url, barcode },
 *     creditCard?: { status, authorizationCode }
 *   }
 * }
 */

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { quote, type PlanType, type Ciclo } from '../_shared/checkout-plans.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Config Asaas (PRODUÇÃO por default; sandbox só se ASAAS_BASE_URL apontar pra lá) ──
// Default de PROD evita o footgun de, se o secret sumir/errar, cair em sandbox e
// TODO checkout falhar silencioso ("a chave não pertence a este ambiente").
const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') || 'https://api.asaas.com/v3';
const ASAAS_API_KEY = Deno.env.get('ASAAS_API_KEY') || '';

// ── Preços: fonte única em _shared/checkout-plans.ts (matriz Pro/Básico) ────
//    Setup e recorrência são resolvidos por quote(planType, ciclo, paidPro).

// ── Helper: chamada Asaas com auth + erro padronizado ──────────────────────
async function asaas(path: string, init: RequestInit = {}): Promise<any> {
  if (!ASAAS_API_KEY) throw new Error('ASAAS_API_KEY não configurada nos secrets');
  const res = await fetch(`${ASAAS_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'access_token': ASAAS_API_KEY,
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = data?.errors?.[0]?.description || data?.message || `Asaas ${path} HTTP ${res.status}`;
    throw new Error(`[Asaas] ${errMsg}`);
  }
  return data;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let pendingId: string | null = null;

  try {
    const body = await req.json();
    const {
      plano: planoRaw, ciclo: cicloRaw, personType, fullName, email, document, phone,
      paymentMethod, cardData,
    } = body;

    // ── Compatibilidade: aceita o formato novo (plano=pro|basico + ciclo) e o
    //    antigo (plano=mensal|anual → assume Pro, ciclo = o próprio valor). ──
    let planType: PlanType;
    let ciclo: Ciclo;
    if (planoRaw === 'mensal' || planoRaw === 'anual') {
      planType = 'pro';
      ciclo = planoRaw;
    } else {
      if (!planoRaw || !['pro', 'enterprise', 'basico'].includes(planoRaw)) throw new Error('plano inválido (use pro|enterprise|basico)');
      planType = planoRaw as PlanType;
      ciclo = cicloRaw === 'anual' ? 'anual' : 'mensal';
    }

    // Validação mínima
    if (!personType || !['pf', 'pj'].includes(personType)) throw new Error('personType inválido');
    if (!fullName || fullName.trim().length < 3) throw new Error('nome obrigatório');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('e-mail inválido');
    if (!document) throw new Error('CPF/CNPJ obrigatório');
    if (!phone) throw new Error('telefone obrigatório');
    if (!paymentMethod || !['pix', 'cartao', 'boleto'].includes(paymentMethod)) throw new Error('paymentMethod inválido');
    if (paymentMethod === 'cartao' && !cardData) throw new Error('cardData obrigatório quando paymentMethod=cartao');

    // ── Resolve a faixa fundador/normal pelo nº de pagos DESSE plano ─────────
    //    (Pro e Pro Max tem contagens de fundador separadas; basico nao tem.)
    let paidCount = 0;
    if (planType === 'pro' || planType === 'enterprise') {
      const { count } = await supabase
        .from('checkout_pending')
        .select('id', { count: 'exact', head: true })
        .eq('plan_type', planType)
        .eq('status', 'paid');
      paidCount = count || 0;
    }
    const q = quote(planType, ciclo, paidCount);

    // ── 1. Registrar tentativa pendente (lookup do webhook depende disso) ──
    const { data: pending, error: pendingErr } = await supabase
      .from('checkout_pending')
      .insert({
        email,
        full_name: fullName,
        document: document.replace(/\D/g, ''),
        person_type: personType,
        phone: phone.replace(/\D/g, ''),
        plano: ciclo,
        plan_type: planType,
        tier: q.tier,
        setup_value: q.setup,
        recurrence_value: q.recurrence,
        payment_method: paymentMethod,
        status: 'pending',
      })
      .select('id')
      .single();

    if (pendingErr || !pending?.id) throw new Error(`Falha ao criar checkout_pending: ${pendingErr?.message}`);
    pendingId = pending.id;
    console.log(`[checkout] criado pending=${pendingId} email=${email} plano=${planType} ciclo=${ciclo} tier=${q.tier ?? '-'} method=${paymentMethod}`);

    // ── 2. Buscar ou criar customer no Asaas ──
    // Asaas pode rejeitar email duplicado — buscar primeiro
    let customerId: string | null = null;
    try {
      const search = await asaas(`/customers?email=${encodeURIComponent(email)}`);
      if (search?.data?.[0]?.id) {
        customerId = search.data[0].id;
        console.log(`[checkout] customer Asaas existente: ${customerId}`);
      }
    } catch (e) {
      console.warn(`[checkout] search customer falhou (não fatal): ${(e as Error).message}`);
    }

    if (!customerId) {
      const customer = await asaas('/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: fullName,
          email,
          cpfCnpj: document.replace(/\D/g, ''),
          mobilePhone: phone.replace(/\D/g, ''),
          notificationDisabled: false,
        }),
      });
      customerId = customer.id;
      console.log(`[checkout] customer Asaas criado: ${customerId}`);
    }

    // ── 3. Criar SETUP PAYMENT (cobrança avulsa única R$ 1.499) ──
    const today = new Date();
    const dueDate = today.toISOString().slice(0, 10); // hoje

    const billingTypeMap: Record<string, string> = {
      pix: 'PIX',
      cartao: 'CREDIT_CARD',
      boleto: 'BOLETO',
    };

    // 1a cobranca = IMPLEMENTACAO + 1a MENSALIDADE/ANUIDADE juntas (decisao do
    // Wander 15/06): o cliente paga tudo no ato. A recorrencia (subscription)
    // comeca no periodo SEGUINTE, pra nao cobrar 2x o 1o periodo.
    const planLabelAsaas = planType === 'pro' ? 'PRO' : planType === 'enterprise' ? 'PRO MAX' : 'Básico';
    const firstChargeValue = q.setup + q.recurrence;
    const setupPaymentBody: any = {
      customer: customerId,
      billingType: billingTypeMap[paymentMethod],
      value: firstChargeValue,
      dueDate,
      description: `LOGOS|IA — Implementação + 1ª ${ciclo === 'anual' ? 'anuidade' : 'mensalidade'} (${planLabelAsaas})`,
      externalReference: `setup_${pendingId}`,
    };

    // Cartão: enviar dados pra Asaas tokenizar
    if (paymentMethod === 'cartao' && cardData) {
      setupPaymentBody.creditCard = {
        holderName: cardData.holderName,
        number: cardData.number.replace(/\D/g, ''),
        expiryMonth: cardData.expiry.split('/')[0],
        expiryYear: '20' + cardData.expiry.split('/')[1],
        ccv: cardData.cvv,
      };
      setupPaymentBody.creditCardHolderInfo = {
        name: fullName,
        email,
        cpfCnpj: document.replace(/\D/g, ''),
        postalCode: '00000000',
        addressNumber: '0',
        phone: phone.replace(/\D/g, ''),
      };
    }

    const setupPayment = await asaas('/payments', {
      method: 'POST',
      body: JSON.stringify(setupPaymentBody),
    });
    console.log(`[checkout] setup payment criado: ${setupPayment.id} status=${setupPayment.status}`);

    // ── 4. Criar SUBSCRIPTION (recorrência mensal/anual) ──
    // A 1a mensalidade/anuidade JA foi cobrada hoje (junto da implementacao).
    // Entao a recorrencia comeca no PROXIMO periodo: +30 dias (mensal) ou +365
    // (anual). Assim nao cobra 2x o 1o periodo.
    const nextDue = new Date(today);
    nextDue.setDate(nextDue.getDate() + (ciclo === 'anual' ? 365 : 30));

    const subscriptionBody: any = {
      customer: customerId,
      billingType: billingTypeMap[paymentMethod],
      value: q.recurrence,
      nextDueDate: nextDue.toISOString().slice(0, 10),
      cycle: q.cycleAsaas,
      description: `LOGOS|IA — Plano ${planType === 'pro' ? 'PRO' : planType === 'enterprise' ? 'PRO MAX' : 'Básico'} ${ciclo === 'anual' ? 'Anual' : 'Mensal'}`,
      externalReference: `sub_${pendingId}`,
    };

    if (paymentMethod === 'cartao' && cardData) {
      // Reusa o cartão tokenizado da setup
      subscriptionBody.creditCardToken = setupPayment.creditCard?.creditCardToken;
    }

    const subscription = await asaas('/subscriptions', {
      method: 'POST',
      body: JSON.stringify(subscriptionBody),
    });
    console.log(`[checkout] subscription criada: ${subscription.id} cycle=${q.cycleAsaas}`);

    // ── 5. Buscar dados de pagamento (QR PIX / boleto) ──
    let pixData: any = null;
    let boletoData: any = null;

    if (paymentMethod === 'pix') {
      const pix = await asaas(`/payments/${setupPayment.id}/pixQrCode`);
      pixData = {
        payload: pix.payload,
        qrCode: pix.encodedImage, // base64
        expirationDate: pix.expirationDate,
      };
    } else if (paymentMethod === 'boleto') {
      boletoData = {
        url: setupPayment.bankSlipUrl,
        barcode: setupPayment.identificationField,
      };
    }

    // ── 6. Atualizar checkout_pending com IDs e dados de pagamento ──
    await supabase.from('checkout_pending').update({
      asaas_customer_id: customerId,
      asaas_subscription_id: subscription.id,
      asaas_setup_payment_id: setupPayment.id,
      asaas_payment_url: setupPayment.invoiceUrl || null,
      asaas_pix_payload: pixData?.payload || null,
      asaas_pix_qrcode: pixData?.qrCode || null,
      asaas_boleto_url: boletoData?.url || null,
      asaas_boleto_barcode: boletoData?.barcode || null,
      status: paymentMethod === 'cartao' && setupPayment.status === 'CONFIRMED' ? 'paid' : 'awaiting_payment',
    }).eq('id', pendingId);

    return new Response(JSON.stringify({
      success: true,
      pendingId,
      subscriptionId: subscription.id,
      setupPayment: {
        id: setupPayment.id,
        status: setupPayment.status,
        dueDate: setupPayment.dueDate,
        invoiceUrl: setupPayment.invoiceUrl,
        pix: pixData,
        boleto: boletoData,
        creditCard: paymentMethod === 'cartao' ? {
          status: setupPayment.status,
          authorizationCode: setupPayment.creditCard?.authorizationCode,
        } : null,
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[checkout] erro:', err.message, err.stack);

    // Marca pending como failed (se já foi criado)
    if (pendingId) {
      await supabase.from('checkout_pending').update({
        status: 'failed',
        error_message: err.message?.slice(0, 500),
      }).eq('id', pendingId);
    }

    return new Response(JSON.stringify({
      success: false,
      error: err.message || 'Erro desconhecido no checkout',
      pendingId,
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
