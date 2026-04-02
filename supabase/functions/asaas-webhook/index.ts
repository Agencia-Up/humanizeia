/**
 * EDGE FUNCTION: asaas-webhook
 * ──────────────────────────────────────────────────────────────────────────
 * Recebe notificações de pagamento da Asaas e credita tokens na conta
 * do usuário automaticamente após confirmação.
 *
 * FLUXO:
 *   Asaas confirma pagamento
 *   → POST /functions/v1/asaas-webhook
 *   → Valida payload
 *   → Verifica duplicidade (idempotência)
 *   → Busca usuário pelo asaas_customer_id
 *   → Adiciona tokens atomicamente
 *   → Registra transação
 *   → Retorna 200
 *
 * EVENTOS PROCESSADOS:
 *   PAYMENT_CONFIRMED  — pagamento aprovado
 *   PAYMENT_RECEIVED   — pagamento recebido (redundância)
 * ──────────────────────────────────────────────────────────────────────────
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Mapeamento de pacotes de tokens ─────────────────────────────────────────

const TOKEN_PACKAGES: Record<string, { tokens: number; price: number; label: string }> = {
  token_50k:  { tokens: 50_000,    price: 25.00,  label: '50K Tokens'  },
  token_100k: { tokens: 100_000,   price: 45.00,  label: '100K Tokens' },
  token_200k: { tokens: 200_000,   price: 75.00,  label: '200K Tokens' },
  token_500k: { tokens: 500_000,   price: 170.00, label: '500K Tokens' },
  token_1m:   { tokens: 1_000_000, price: 280.00, label: '1M Tokens'   },
};

// Eventos da Asaas que indicam pagamento concluído
const PAYMENT_EVENTS = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'];

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

  // Supabase com service_role para ter permissão de escrever em qualquer tabela
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let body: any;

  try {
    body = await req.json();
  } catch {
    console.error('[asaas-webhook] Payload JSON inválido');
    return new Response(
      JSON.stringify({ error: 'Payload inválido — JSON esperado' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  console.log('[asaas-webhook] Evento recebido:', JSON.stringify(body));

  // ── Validação básica do payload ──────────────────────────────────────────

  const { event, payment } = body;

  if (!event || !payment) {
    console.error('[asaas-webhook] Payload sem event ou payment');
    return new Response(
      JSON.stringify({ error: 'Campos obrigatórios ausentes: event, payment' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!payment.id || !payment.customer || !payment.externalReference) {
    console.error('[asaas-webhook] payment incompleto:', payment);
    return new Response(
      JSON.stringify({ error: 'payment deve conter: id, customer, externalReference' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ── Ignorar eventos que não são de confirmação de pagamento ──────────────

  if (!PAYMENT_EVENTS.includes(event)) {
    console.log(`[asaas-webhook] Evento "${event}" ignorado (não é confirmação de pagamento)`);
    return new Response(
      JSON.stringify({ ok: true, message: `Evento ${event} ignorado` }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ── Processar pagamento ──────────────────────────────────────────────────

  try {
    await processPayment(supabase, payment);

    console.log(`[asaas-webhook] ✅ Pagamento ${payment.id} processado com sucesso`);
    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('[asaas-webhook] Erro ao processar pagamento:', err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ─── Funções auxiliares ───────────────────────────────────────────────────────

/**
 * Retorna os dados do pacote de tokens a partir do productId.
 * Exemplo: getTokenPackage('token_50k') → { tokens: 50000, price: 25, label: '50K Tokens' }
 */
function getTokenPackage(productId: string) {
  return TOKEN_PACKAGES[productId] ?? null;
}

/**
 * Processa um pagamento confirmado pela Asaas:
 * 1. Verifica duplicidade (idempotência)
 * 2. Identifica o pacote de tokens
 * 3. Busca o usuário pelo asaas_customer_id
 * 4. Credita tokens atomicamente via função SQL
 * 5. Registra a transação
 */
async function processPayment(supabase: any, payment: any): Promise<void> {
  const {
    id: paymentId,
    customer: asaasCustomerId,
    externalReference: productId,
    value: pricePaid,
  } = payment;

  console.log(`[processPayment] Iniciando — paymentId=${paymentId}, productId=${productId}, customer=${asaasCustomerId}`);

  // ── 1. Verificar se esse pagamento já foi processado (idempotência) ──────

  const { data: existingTx } = await supabase
    .from('token_transactions')
    .select('id')
    .eq('payment_id', paymentId)
    .maybeSingle();

  if (existingTx) {
    console.log(`[processPayment] ⚠️ Pagamento ${paymentId} já processado anteriormente. Ignorando.`);
    return; // Retorna sem erro — webhook duplicado é comportamento normal da Asaas
  }

  // ── 2. Identificar pacote de tokens pelo externalReference ───────────────

  const tokenPackage = getTokenPackage(productId);

  if (!tokenPackage) {
    throw new Error(`Produto desconhecido: "${productId}". Verifique os pacotes em TOKEN_PACKAGES.`);
  }

  console.log(`[processPayment] Pacote identificado: ${tokenPackage.label} (${tokenPackage.tokens.toLocaleString()} tokens)`);

  // ── 3. Buscar usuário pelo asaas_customer_id ─────────────────────────────

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, tokens')
    .eq('asaas_customer_id', asaasCustomerId)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Erro ao buscar usuário: ${profileError.message}`);
  }

  if (!profile) {
    throw new Error(`Usuário não encontrado para asaas_customer_id="${asaasCustomerId}"`);
  }

  console.log(`[processPayment] Usuário encontrado: ${profile.id} — saldo atual: ${profile.tokens} tokens`);

  // ── 4. Adicionar tokens e registrar transação (operação atômica via SQL) ──

  const { error: fnError } = await supabase.rpc('add_tokens_to_user', {
    p_user_id:    profile.id,
    p_tokens:     tokenPackage.tokens,
    p_payment_id: paymentId,
    p_product_id: productId,
    p_price_paid: pricePaid,
  });

  if (fnError) {
    throw new Error(`Erro ao creditar tokens: ${fnError.message}`);
  }

  const newTotal = profile.tokens + tokenPackage.tokens;
  console.log(
    `[processPayment] ✅ Crédito concluído — user=${profile.id}, ` +
    `+${tokenPackage.tokens.toLocaleString()} tokens, ` +
    `novo saldo=${newTotal.toLocaleString()} tokens`
  );
}
