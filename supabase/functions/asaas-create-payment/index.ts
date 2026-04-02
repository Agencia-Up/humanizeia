/**
 * EDGE FUNCTION: asaas-create-payment
 * ──────────────────────────────────────────────────────────────────────────
 * Cria uma cobrança PIX na Asaas para compra de pacote de tokens.
 * Autenticação JWT obrigatória (usuário logado).
 *
 * FLUXO:
 *   Frontend envia { productId }
 *   → Valida usuário autenticado
 *   → Busca/cria customer na Asaas
 *   → Cria cobrança PIX
 *   → Retorna dados do PIX (QR code + copia e cola)
 *
 * BODY (POST):
 *   { "productId": "token_50k" }
 *
 * RESPOSTA:
 *   {
 *     paymentId, value, status, dueDate, invoiceUrl,
 *     pix: { encodedImage, payload, expirationDate },
 *     product: { id, tokens, price, label }
 *   }
 * ──────────────────────────────────────────────────────────────────────────
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Pacotes de tokens disponíveis ───────────────────────────────────────────

const TOKEN_PACKAGES: Record<string, { tokens: number; price: number; label: string }> = {
  token_50k:  { tokens: 50_000,    price: 25.00,  label: '50K Tokens'  },
  token_100k: { tokens: 100_000,   price: 45.00,  label: '100K Tokens' },
  token_200k: { tokens: 200_000,   price: 75.00,  label: '200K Tokens' },
  token_500k: { tokens: 500_000,   price: 170.00, label: '500K Tokens' },
  token_1m:   { tokens: 1_000_000, price: 280.00, label: '1M Tokens'   },
};

// ─── Config Asaas ─────────────────────────────────────────────────────────────

/**
 * URL base da Asaas.
 * ASAAS_ENVIRONMENT=sandbox  → usa ambiente de testes
 * ASAAS_ENVIRONMENT=production → usa ambiente real
 */
function getAsaasBaseUrl(): string {
  const env = Deno.env.get('ASAAS_ENVIRONMENT') ?? 'sandbox';
  return env === 'production'
    ? 'https://api.asaas.com'
    : 'https://sandbox.asaas.com';
}

// ─── CORS ────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Handler principal ────────────────────────────────────────────────────────

serve(async (req) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Autenticação JWT ────────────────────────────────────────────────────

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Não autorizado — header Authorization ausente');
    }

    // Cria cliente com service_role para operações de banco
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Valida token do usuário
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new Error('Token inválido ou expirado');
    }

    console.log(`[asaas-create-payment] Usuário autenticado: ${user.id}`);

    // ── Validar body ────────────────────────────────────────────────────────

    const body = await req.json();
    const { productId } = body;

    if (!productId) {
      throw new Error('Campo obrigatório ausente: productId');
    }

    const tokenPackage = TOKEN_PACKAGES[productId];
    if (!tokenPackage) {
      throw new Error(
        `Produto inválido: "${productId}". ` +
        `Valores aceitos: ${Object.keys(TOKEN_PACKAGES).join(', ')}`
      );
    }

    console.log(`[asaas-create-payment] Produto selecionado: ${productId} (${tokenPackage.label})`);

    // ── Verificar API Key ───────────────────────────────────────────────────

    const apiKey = Deno.env.get('ASAAS_API_KEY');
    if (!apiKey) {
      throw new Error('ASAAS_API_KEY não configurada nas secrets da Edge Function');
    }

    const baseUrl = getAsaasBaseUrl();

    // ── Buscar perfil do usuário ────────────────────────────────────────────

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, asaas_customer_id, full_name, email')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      throw new Error(`Erro ao buscar perfil: ${profileError.message}`);
    }

    let asaasCustomerId = profile?.asaas_customer_id;

    // ── Criar customer na Asaas se ainda não existir ────────────────────────

    if (!asaasCustomerId) {
      console.log(`[asaas-create-payment] Criando customer Asaas para user ${user.id}`);

      const customerName =
        profile?.full_name ||
        user.email?.split('@')[0] ||
        'Cliente';

      const customerRes = await fetch(`${baseUrl}/v3/customers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'access_token': apiKey,
        },
        body: JSON.stringify({
          name: customerName,
          email: user.email,
          externalReference: user.id, // Liga o customer Asaas ao user do Supabase
        }),
      });

      if (!customerRes.ok) {
        const errText = await customerRes.text();
        throw new Error(`Erro ao criar customer na Asaas: ${errText}`);
      }

      const customerData = await customerRes.json();
      asaasCustomerId = customerData.id;

      console.log(`[asaas-create-payment] Customer criado na Asaas: ${asaasCustomerId}`);

      // Salvar o asaas_customer_id no profile para próximas compras
      await supabase
        .from('profiles')
        .update({ asaas_customer_id: asaasCustomerId })
        .eq('id', user.id);
    } else {
      console.log(`[asaas-create-payment] Customer Asaas já existe: ${asaasCustomerId}`);
    }

    // ── Criar cobrança PIX na Asaas ─────────────────────────────────────────

    console.log(`[asaas-create-payment] Criando cobrança PIX — valor: R$${tokenPackage.price}`);

    const paymentRes = await fetch(`${baseUrl}/v3/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access_token': apiKey,
      },
      body: JSON.stringify({
        customer: asaasCustomerId,
        billingType: 'PIX',
        value: tokenPackage.price,
        description: `Compra de ${tokenPackage.label} — Logos IA`,
        externalReference: productId, // Será recebido no webhook para identificar o pacote
        // A Asaas usa dueDate = hoje por padrão para PIX imediato
      }),
    });

    if (!paymentRes.ok) {
      const errText = await paymentRes.text();
      throw new Error(`Erro ao criar pagamento na Asaas: ${errText}`);
    }

    const paymentData = await paymentRes.json();
    console.log(`[asaas-create-payment] Cobrança criada: ${paymentData.id}`);

    // ── Buscar QR Code PIX ──────────────────────────────────────────────────

    let pixData: any = null;

    const pixRes = await fetch(
      `${baseUrl}/v3/payments/${paymentData.id}/pixQrCode`,
      { headers: { 'access_token': apiKey } }
    );

    if (pixRes.ok) {
      pixData = await pixRes.json();
      console.log(`[asaas-create-payment] QR Code PIX obtido para ${paymentData.id}`);
    } else {
      console.warn(`[asaas-create-payment] Não foi possível obter QR Code PIX: ${await pixRes.text()}`);
    }

    // ── Retornar dados para o frontend ──────────────────────────────────────

    return new Response(
      JSON.stringify({
        paymentId:  paymentData.id,
        value:      paymentData.value,
        status:     paymentData.status,
        dueDate:    paymentData.dueDate,
        invoiceUrl: paymentData.invoiceUrl,
        // Dados do PIX para o frontend exibir o QR code
        pix: pixData ? {
          encodedImage:   pixData.encodedImage,   // Imagem base64 do QR code
          payload:        pixData.payload,         // Copia e cola
          expirationDate: pixData.expirationDate,
        } : null,
        // Info do produto comprado
        product: {
          id:     productId,
          tokens: tokenPackage.tokens,
          price:  tokenPackage.price,
          label:  tokenPackage.label,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (err: any) {
    console.error('[asaas-create-payment] Erro:', err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
