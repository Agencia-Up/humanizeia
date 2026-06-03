/**
 * checkout-pricing — endpoint PUBLICO (sem JWT)
 *
 * Devolve a tabela de precos ao vivo pro frontend, ja resolvendo se o PRO
 * esta no preco de FUNDADOR (1o-10o pago) ou NORMAL (11o em diante).
 * A tela usa isso pra mostrar exatamente o que vai ser cobrado.
 *
 * Resposta:
 * {
 *   pro:    { tier, foundersLeft, atendimentos, mensal:{setup,recurrence}, anual:{setup,recurrence} },
 *   basico: { atendimentos, mensal:{setup,recurrence}, anual:{setup,recurrence} }
 * }
 */

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PLANS, FOUNDERS_LIMIT, quote } from '../_shared/checkout-plans.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Conta quantos PRO ja foram efetivamente pagos (define a faixa fundador/normal)
    const { count } = await supabase
      .from('checkout_pending')
      .select('id', { count: 'exact', head: true })
      .eq('plan_type', 'pro')
      .eq('status', 'paid');

    const paidPro = count || 0;
    const foundersLeft = Math.max(0, FOUNDERS_LIMIT - paidPro);

    const proMensal = quote('pro', 'mensal', paidPro);
    const proAnual = quote('pro', 'anual', paidPro);
    const basMensal = quote('basico', 'mensal', paidPro);
    const basAnual = quote('basico', 'anual', paidPro);

    const body = {
      pro: {
        tier: proMensal.tier,
        foundersLeft,
        atendimentos: PLANS.pro.atendimentos,
        mensal: { setup: proMensal.setup, recurrence: proMensal.recurrence },
        anual: { setup: proAnual.setup, recurrence: proAnual.recurrence },
      },
      basico: {
        atendimentos: PLANS.basico.atendimentos,
        mensal: { setup: basMensal.setup, recurrence: basMensal.recurrence },
        anual: { setup: basAnual.setup, recurrence: basAnual.recurrence },
      },
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[checkout-pricing] erro:', err?.message);
    return new Response(JSON.stringify({ error: err?.message || 'erro' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
