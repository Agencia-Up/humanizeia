// ══════════════════════════════════════════════════════════════════════════
// subscription-invoice — devolve a FATURA DA MENSALIDADE do cliente logado.
//
// POR QUE EXISTE (risco financeiro real, achado 17/07): quando um cliente que JÁ
// PAGOU a implantação ficava bloqueado por atraso, o app mandava ele pro
// /checkout — que é endpoint de VENDA NOVA e sempre cobra
// `setup (R$1.497,90) + mensalidade`. Ou seja: o cliente pagaria a implantação
// DE NOVO em cima do que já pagou. Esta edge dá o caminho certo: a invoiceUrl da
// mensalidade que o Asaas já emitiu (a MESMA que vai no e-mail de cobrança).
//
// SOMENTE LEITURA no Asaas (GET /payments). NUNCA cria cobrança — por isso é
// seguro o próprio cliente chamar.
//
// Isolamento: resolve o DONO DA COBRANÇA a partir do JWT de quem chamou
// (vendedor cai no master). Ninguém consegue ver fatura de outro tenant.
// ══════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') || 'https://sandbox.asaas.com/api/v3';
const ASAAS_API_KEY = Deno.env.get('ASAAS_API_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Fatura da mensalidade no Asaas. Vencida primeiro; senão a próxima em aberto. */
async function buscarFatura(subId: string): Promise<
  { invoiceUrl: string; value: number | null; dueDate: string | null; status: string } | null
> {
  if (!ASAAS_API_KEY || !subId) return null;
  for (const st of ['OVERDUE', 'PENDING']) {
    try {
      const r = await fetch(`${ASAAS_BASE_URL}/payments?subscription=${subId}&status=${st}&limit=1`, {
        headers: { access_token: ASAAS_API_KEY, 'Content-Type': 'application/json' },
      });
      const j = await r.json().catch(() => ({}));
      const p = j?.data?.[0];
      if (p?.invoiceUrl) {
        return {
          invoiceUrl: String(p.invoiceUrl),
          value: typeof p.value === 'number' ? p.value : null,
          dueDate: p.dueDate ? String(p.dueDate) : null,
          status: st,
        };
      }
    } catch (_e) { /* tenta o próximo status */ }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Não autorizado' }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Não autorizado' }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Dono da cobrança: vendedor resolve pro master (mesma regra do paywall).
    const { data: ownerId } = await admin.rpc('resolve_billing_owner_user_id', { p_user_id: user.id });
    const donoId = (ownerId as string) || user.id;

    // Assinatura do Asaas desse cliente (existe só se ele comprou de verdade).
    const { data: pend } = await admin
      .from('checkout_pending')
      .select('asaas_subscription_id, recurrence_value')
      .eq('user_id', donoId)
      .not('asaas_subscription_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const subId = pend?.asaas_subscription_id as string | undefined;

    // Sem assinatura no Asaas = nunca comprou. O front manda pro checkout (venda
    // nova), que aí SIM é o caminho certo pra essa pessoa.
    if (!subId) {
      return json({ ok: true, is_customer: false, invoice_url: null });
    }

    const fatura = await buscarFatura(subId);

    // É cliente, mas não achei fatura em aberto (ex.: Asaas ainda não emitiu).
    // Não invento link nem mando pro checkout — devolve sem URL e o front mostra
    // o caminho de falar com o suporte.
    return json({
      ok: true,
      is_customer: true,
      invoice_url: fatura?.invoiceUrl ?? null,
      value: fatura?.value ?? null,
      due_date: fatura?.dueDate ?? null,
      invoice_status: fatura?.status ?? null,
    });
  } catch (e: any) {
    console.error('subscription-invoice: fatal', e);
    return json({ error: 'Erro ao buscar a fatura.' }, 500);
  }
});
