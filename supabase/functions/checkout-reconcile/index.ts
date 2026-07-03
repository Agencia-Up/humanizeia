/**
 * checkout-reconcile — REDE DE SEGURANÇA do checkout de assinatura.
 *
 * PROBLEMA que resolve: o provisionamento (criar conta + assinatura + e-mail de
 * acesso) depende 100% do `checkout-asaas-webhook` disparar e completar. Se o
 * webhook do Asaas não é entregue (falha de entrega, indisponibilidade momentânea)
 * ou erra no meio, o cliente PAGA e fica com NADA — sem conta, sem e-mail, sem
 * retry. Aconteceu com o lead Mônaco (03/07).
 *
 * SOLUÇÃO: este cron acha `checkout_pending` presos em `awaiting_payment`,
 * CONFIRMA o pagamento DIRETO no Asaas (GET /payments) e, se estiver pago,
 * provisiona igual ao webhook — de forma idempotente. Assim, mesmo que o webhook
 * falhe, o sistema se auto-corrige em minutos.
 *
 * Segurança: só quem tem o SERVICE ROLE KEY chama (o cron manda no Bearer).
 * Só LÊ do Asaas (GET) — nunca cria cobrança. Nunca provisiona sem o Asaas
 * confirmar RECEBIDO/CONFIRMADO.
 *
 * NOTA: a lógica de provisionamento espelha o bloco PAYMENT_CONFIRMED do
 * checkout-asaas-webhook. Mantido replicado de propósito para NÃO tocar no webhook
 * de produção que já funciona; unificar num _shared é um follow-up opcional.
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// Config Asaas — MESMO padrão do checkout-create-subscription (base URL de PRODUÇÃO via env).
const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') || 'https://sandbox.asaas.com/api/v3';
const ASAAS_API_KEY = Deno.env.get('ASAAS_API_KEY') || '';
const UNLIMITED_ATENDIMENTOS = 999999;
const DEFAULT_OPENAI_BALANCE_USD = 20;
const PAID_STATUSES = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];

async function asaasGet(path: string): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const r = await fetch(`${ASAAS_BASE_URL}${path}`, {
      headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' },
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: (e as any)?.message } };
  }
}

function resolveEntitlement(planType: string | null | undefined): { planId: string; atendimentos: number } {
  if (planType === 'pro') return { planId: 'pro', atendimentos: UNLIMITED_ATENDIMENTOS };
  if (planType === 'enterprise') return { planId: 'enterprise', atendimentos: UNLIMITED_ATENDIMENTOS };
  return { planId: 'basico', atendimentos: UNLIMITED_ATENDIMENTOS };
}
function computeRenewalISO(plano: string | null | undefined): string {
  const d = new Date();
  if (String(plano) === 'anual') d.setDate(d.getDate() + 365);
  else d.setDate(d.getDate() + 30);
  return d.toISOString();
}

// Confirma no Asaas se o checkout foi realmente pago (setup payment OU alguma fatura da assinatura).
async function isPaidInAsaas(pending: any): Promise<boolean> {
  if (pending.asaas_setup_payment_id) {
    const pay = await asaasGet(`/payments/${pending.asaas_setup_payment_id}`);
    if (pay.ok && PAID_STATUSES.includes(String(pay.data?.status))) return true;
  }
  if (pending.asaas_subscription_id) {
    const subPays = await asaasGet(`/payments?subscription=${pending.asaas_subscription_id}&limit=20`);
    const list: any[] = subPays.data?.data || [];
    if (list.some((p) => PAID_STATUSES.includes(String(p.status)))) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Auth: verify_jwt=true já garante um JWT válido e assinado; aqui exigimos o PAPEL
  // service_role (o cron manda a service key). Checar por role é robusto a rotação de
  // chave / diferença entre o env e o Vault (comparar a chave crua dava 403 falso).
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let role = '';
  try {
    const payload = token.split('.')[1] || '';
    role = ((JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) || {}) as any).role || '';
  } catch { /* token inválido */ }
  if (role !== 'service_role') return json({ error: 'Forbidden' }, 403);
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!ASAAS_API_KEY) return json({ error: 'ASAAS_API_KEY não configurada' }, 500);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body?.limit) || 50, 100);

  // Checkouts presos: aguardando pagamento, com cobrança criada, sem conta, recentes.
  // Só os com >2min de vida (dá ao webhook normal a chance de processar primeiro).
  const { data: pendings, error } = await supabase
    .from('checkout_pending')
    .select('*')
    .eq('status', 'awaiting_payment')
    .is('user_id', null)
    .not('asaas_setup_payment_id', 'is', null)
    .lt('created_at', new Date(Date.now() - 2 * 60 * 1000).toISOString())
    .gte('created_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) return json({ error: error.message }, 500);

  const results: any[] = [];
  for (const pending of (pendings || [])) {
    const paid = await isPaidInAsaas(pending);
    if (!paid) { results.push({ pending: pending.id, skip: 'nao pago no Asaas' }); continue; }

    try {
      // ── 1) Conta ────────────────────────────────────────────────────────────
      let userId: string | null = null;
      let createdNew = false;
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existing = existingUsers?.users?.find((u: any) => u.email === pending.email);
      if (existing) {
        userId = existing.id;
      } else {
        const { data: created, error: createErr } = await supabase.auth.admin.createUser({
          email: pending.email,
          password: crypto.randomUUID(),
          email_confirm: true,
          user_metadata: {
            full_name: pending.full_name, phone: pending.phone, document: pending.document,
            source: 'checkout_reconcile', plano: pending.plano,
          },
        });
        if (createErr) throw createErr;
        userId = created.user?.id || null;
        createdNew = true;
        // e-mail de acesso ("compra confirmada + criar senha"), MESMO type do webhook. Best-effort.
        try {
          await supabase.functions.invoke('send-email', {
            body: { type: 'checkout_welcome', email: pending.email, name: pending.full_name },
          });
        } catch (_e) { /* best-effort: não derruba a reconciliação */ }
      }
      if (!userId) throw new Error('sem userId após criar/achar conta');

      // ── 2) Assinatura (idempotente) ─────────────────────────────────────────
      const renewalISO = computeRenewalISO(pending.plano);
      const { data: existingSub } = await supabase
        .from('user_subscriptions').select('id, plan_id, tokens_included').eq('user_id', userId).maybeSingle();
      const ent = resolveEntitlement(pending.plan_type);
      const hasExplicit = pending.plan_type === 'pro' || pending.plan_type === 'enterprise' || pending.plan_type === 'basico';
      const planId = hasExplicit ? ent.planId : (existingSub?.plan_id || ent.planId);
      const atend = hasExplicit ? ent.atendimentos : (existingSub?.tokens_included ?? ent.atendimentos);
      if (existingSub) {
        await supabase.from('user_subscriptions').update({
          plan_id: planId, status: 'active', tokens_included: atend, renewal_date: renewalISO, updated_at: new Date().toISOString(),
        }).eq('user_id', userId);
      } else {
        await supabase.from('user_subscriptions').insert({
          user_id: userId, plan_id: planId, status: 'active', tokens_included: atend, tokens_used: 0, tokens_purchased: 0, renewal_date: renewalISO,
        });
      }

      // ── 3) Saldo de IA inicial (só se ainda nulo) ───────────────────────────
      const { data: prof } = await supabase.from('profiles').select('openai_balance_usd').eq('id', userId).maybeSingle();
      if (prof && prof.openai_balance_usd == null) {
        await supabase.from('profiles').update({ openai_balance_usd: DEFAULT_OPENAI_BALANCE_USD }).eq('id', userId);
      }

      // ── 4) Marca o pending como pago ────────────────────────────────────────
      await supabase.from('checkout_pending').update({
        status: 'paid', user_id: userId, completed_at: new Date().toISOString(),
      }).eq('id', pending.id);

      console.log(`[checkout-reconcile] PROVISIONADO pending=${pending.id} email=${pending.email} user=${userId} novo=${createdNew}`);
      results.push({ pending: pending.id, email: pending.email, provisioned: true, user_id: userId, conta_criada: createdNew });
    } catch (e: any) {
      console.error(`[checkout-reconcile] erro pending=${pending.id}: ${e?.message || e}`);
      results.push({ pending: pending.id, error: e?.message || String(e) });
    }
  }

  return json({ ok: true, verificados: (pendings || []).length, results });
});
