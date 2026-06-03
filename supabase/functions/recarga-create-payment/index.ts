/**
 * recarga-create-payment — cria a cobranca de RECARGA AVULSA de atendimentos.
 *
 * Fluxo: o DONO da conta (nao vendedor) entra em "Meu Plano -> Recarregar",
 * escolhe um pacote e paga. Mesma logica do checkout de assinatura (Asaas),
 * mas avulso. Se ja existe cartao salvo, a recarga e 1-clique (usa o token).
 *
 * Autenticacao: JWT obrigatorio (Bearer do usuario logado).
 *
 * Body esperado:
 * {
 *   pacote: 150 | 300 | 500,                 // numero de atendimentos
 *   paymentMethod: 'pix' | 'cartao' | 'cartao_salvo',
 *   cardData?: { number, expiry, cvv, holderName },  // so quando paymentMethod=cartao
 *   document?: string,    // CPF/CNPJ (so digitos) — necessario p/ criar customer/cartao
 *   saveCard?: boolean    // salvar o cartao tokenizado p/ recargas futuras (default true)
 * }
 *
 * Resposta:
 * {
 *   success: true,
 *   atendimentos, value, paymentMethod,
 *   paymentId, status,
 *   credited: boolean,         // true se ja creditou (cartao aprovado na hora)
 *   balanceAfter?: number,
 *   pix?: { payload, qrCode, expirationDate },
 *   savedCard?: { last4, brand }
 * }
 *
 * Credito:
 *   - Cartao aprovado (CONFIRMED/RECEIVED) -> credita JA aqui via RPC idempotente
 *     credit_atendimentos_recarga (UX 1-clique instantanea).
 *   - PIX -> credita depois, quando o webhook (checkout-asaas-webhook) recebe
 *     PAYMENT_RECEIVED. externalReference = `recarga_<atend>_<userId>`.
 *   Idempotencia garantida pela RPC (por payment_id) — webhook nao duplica.
 */

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Config Asaas (sandbox por default; trocar via ASAAS_BASE_URL) ──────────
const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') || 'https://sandbox.asaas.com/api/v3';
const ASAAS_API_KEY = Deno.env.get('ASAAS_API_KEY') || '';

// ── Pacotes de recarga: FONTE UNICA no servidor (nunca confiar no preco do client) ──
//    Espelha ATENDIMENTO_PACKAGES do frontend (src/hooks/useSubscription.ts).
const RECARGA_PACKAGES: Record<number, number> = {
  150: 388.50,
  300: 687.00,
  500: 745.00,
};

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

  try {
    // ── 1. Autenticacao (JWT do dono) ─────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Não autorizado');
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !user) throw new Error('Token inválido');
    const userId = user.id;

    // ── 2. Parse + validacao do body ──────────────────────────────────────
    const body = await req.json();
    const pacote = parseInt(String(body.pacote), 10);
    const paymentMethod: string = body.paymentMethod;
    const cardData = body.cardData;
    const docFromBody: string | undefined = body.document ? String(body.document).replace(/\D/g, '') : undefined;
    const saveCard: boolean = body.saveCard !== false; // default true

    if (!RECARGA_PACKAGES[pacote]) throw new Error('pacote inválido (use 150, 300 ou 500)');
    if (!paymentMethod || !['pix', 'cartao', 'cartao_salvo'].includes(paymentMethod)) {
      throw new Error('paymentMethod inválido (use pix, cartao ou cartao_salvo)');
    }
    if (paymentMethod === 'cartao' && !cardData) throw new Error('cardData obrigatório quando paymentMethod=cartao');

    const atendimentos = pacote;
    const value = RECARGA_PACKAGES[pacote];

    // ── 3. Perfil do usuario (dono) ───────────────────────────────────────
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('id, full_name, phone, role, asaas_customer_id, asaas_card_token, asaas_card_last4, asaas_card_brand')
      .eq('id', userId)
      .maybeSingle();
    if (profErr) throw new Error(`Falha ao carregar perfil: ${profErr.message}`);

    // Vendedor (conta vinculada) nao tem plano/credito proprio — bloqueia.
    if (profile?.role === 'seller') {
      throw new Error('Vendedores não possuem plano próprio. A recarga é feita na conta master.');
    }

    // Recarga de cartao salvo: precisa do token guardado.
    if (paymentMethod === 'cartao_salvo' && !profile?.asaas_card_token) {
      throw new Error('Nenhum cartão salvo encontrado. Use um cartão novo ou PIX.');
    }

    const fullName = profile?.full_name || user.user_metadata?.full_name || user.email || 'Cliente LOGOS|IA';
    const phone = (profile?.phone || user.user_metadata?.phone || '').replace(/\D/g, '');
    const email = user.email || '';

    // ── 4. Resolver CPF/CNPJ (necessario p/ criar customer / novo cartao) ──
    //    Ordem: body -> user_metadata -> ultimo checkout_pending pago do email.
    let document = docFromBody || (user.user_metadata?.document
      ? String(user.user_metadata.document).replace(/\D/g, '') : '');
    if (!document && email) {
      const { data: lastPending } = await supabase
        .from('checkout_pending')
        .select('document')
        .eq('email', email)
        .eq('status', 'paid')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastPending?.document) document = String(lastPending.document).replace(/\D/g, '');
    }

    // ── 5. Garantir customer no Asaas (reusa asaas_customer_id do perfil) ──
    let customerId: string | null = profile?.asaas_customer_id || null;

    if (!customerId) {
      // tenta achar por email antes de criar (Asaas rejeita email duplicado)
      if (email) {
        try {
          const search = await asaas(`/customers?email=${encodeURIComponent(email)}`);
          if (search?.data?.[0]?.id) customerId = search.data[0].id;
        } catch (e) {
          console.warn(`[recarga] search customer falhou (não fatal): ${(e as Error).message}`);
        }
      }
      if (!customerId) {
        if (!document) throw new Error('CPF/CNPJ obrigatório para a primeira recarga (informe o documento).');
        const customer = await asaas('/customers', {
          method: 'POST',
          body: JSON.stringify({
            name: fullName,
            email,
            cpfCnpj: document,
            mobilePhone: phone || undefined,
            notificationDisabled: false,
          }),
        });
        customerId = customer.id;
      }
      // grava no perfil pra proximas recargas
      if (customerId) {
        await supabase.from('profiles').update({ asaas_customer_id: customerId }).eq('id', userId);
      }
    }

    // ── 6. Criar a cobranca avulsa no Asaas ───────────────────────────────
    const dueDate = new Date().toISOString().slice(0, 10); // hoje
    const billingTypeMap: Record<string, string> = {
      pix: 'PIX',
      cartao: 'CREDIT_CARD',
      cartao_salvo: 'CREDIT_CARD',
    };

    const paymentBody: any = {
      customer: customerId,
      billingType: billingTypeMap[paymentMethod],
      value,
      dueDate,
      description: `LOGOS|IA — Recarga de ${atendimentos} atendimentos`,
      externalReference: `recarga_${atendimentos}_${userId}`,
    };

    if (paymentMethod === 'cartao' && cardData) {
      paymentBody.creditCard = {
        holderName: cardData.holderName,
        number: String(cardData.number).replace(/\D/g, ''),
        expiryMonth: String(cardData.expiry).split('/')[0],
        expiryYear: '20' + String(cardData.expiry).split('/')[1],
        ccv: cardData.cvv,
      };
      paymentBody.creditCardHolderInfo = {
        name: fullName,
        email,
        cpfCnpj: document || undefined,
        postalCode: '00000000',
        addressNumber: '0',
        phone: phone || undefined,
      };
    } else if (paymentMethod === 'cartao_salvo') {
      paymentBody.creditCardToken = profile!.asaas_card_token;
    }

    const payment = await asaas('/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
    });
    console.log(`[recarga] payment criado: ${payment.id} status=${payment.status} method=${paymentMethod} user=${userId} +${atendimentos}`);

    // ── 7. PIX: buscar QR ─────────────────────────────────────────────────
    let pixData: any = null;
    if (paymentMethod === 'pix') {
      try {
        const pix = await asaas(`/payments/${payment.id}/pixQrCode`);
        pixData = {
          payload: pix.payload,
          qrCode: pix.encodedImage, // base64
          expirationDate: pix.expirationDate,
        };
      } catch (e) {
        console.warn(`[recarga] falha ao buscar pixQrCode (não fatal): ${(e as Error).message}`);
      }
    }

    // ── 8. Cartao: salvar token p/ 1-clique futuro ────────────────────────
    let savedCard: any = null;
    if (paymentMethod === 'cartao' && saveCard && payment.creditCard?.creditCardToken) {
      const last4 = payment.creditCard.creditCardNumber || null;
      const brand = payment.creditCard.creditCardBrand || null;
      await supabase.from('profiles').update({
        asaas_card_token: payment.creditCard.creditCardToken,
        asaas_card_last4: last4,
        asaas_card_brand: brand,
      }).eq('id', userId);
      savedCard = { last4, brand };
      console.log(`[recarga] cartão salvo p/ 1-clique — user=${userId} brand=${brand} last4=${last4}`);
    } else if (paymentMethod === 'cartao_salvo') {
      savedCard = { last4: profile?.asaas_card_last4 || null, brand: profile?.asaas_card_brand || null };
    }

    // ── 9. Cartao aprovado na hora -> credita JA (idempotente) ────────────
    let credited = false;
    let balanceAfter: number | null = null;
    const approvedNow = payment.status === 'CONFIRMED' || payment.status === 'RECEIVED';
    if ((paymentMethod === 'cartao' || paymentMethod === 'cartao_salvo') && approvedNow) {
      const { data: credit, error: credErr } = await supabase.rpc('credit_atendimentos_recarga', {
        p_user_id: userId,
        p_atendimentos: atendimentos,
        p_payment_id: payment.id,
        p_product_id: `recarga_${atendimentos}`,
        p_price_paid: value,
        p_description: `Recarga avulsa — ${atendimentos} atendimentos`,
      });
      if (credErr) {
        console.error(`[recarga] erro ao creditar (cartão aprovado): ${credErr.message}`);
        throw credErr;
      }
      credited = true;
      balanceAfter = (credit as any)?.balance_after ?? null;
      console.log(`[recarga] CREDITADO na hora — user=${userId} +${atendimentos} saldo=${balanceAfter}`);
    }

    return new Response(JSON.stringify({
      success: true,
      atendimentos,
      value,
      paymentMethod,
      paymentId: payment.id,
      status: payment.status,
      credited,
      balanceAfter,
      pix: pixData,
      savedCard,
      invoiceUrl: payment.invoiceUrl || null,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[recarga] erro:', err.message, err.stack);
    return new Response(JSON.stringify({
      success: false,
      error: err.message || 'Erro desconhecido na recarga',
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
