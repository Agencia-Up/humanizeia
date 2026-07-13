// deno-lint-ignore-file no-explicit-any
// ============================================================================
// subscription-dunning — dispara os e-mails de cobrança (aviso 2 dias antes +
// atraso na carência) SÓ pro MASTER, com o link CERTO: a fatura da MENSALIDADE
// (invoiceUrl do Asaas, R$497), não o /checkout (que refaz a implementação).
// Alvos vêm da RPC subscription_dunning_targets (owner-only, pula ADM/interna).
// Guard: service_role. Chamado pelo cron subscription-dunning-emails (4x/dia).
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') || 'https://sandbox.asaas.com/api/v3';
const ASAAS_API_KEY = Deno.env.get('ASAAS_API_KEY') || '';
const APP_URL = 'https://logosiabrasil.com';
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

// Busca a URL da fatura da mensalidade no Asaas (GET, read-only — nunca cobra).
async function invoiceUrlDaMensalidade(subId: string | null, tipo: string): Promise<string | null> {
  if (!ASAAS_API_KEY || !subId) return null;
  // Overdue -> a fatura VENCIDA; senão a próxima PENDENTE. Fallback entre as duas.
  const ordem = tipo === 'overdue' ? ['OVERDUE', 'PENDING'] : ['PENDING', 'OVERDUE'];
  for (const st of ordem) {
    try {
      const r = await fetch(`${ASAAS_BASE_URL}/payments?subscription=${subId}&status=${st}&limit=1`, {
        headers: { access_token: ASAAS_API_KEY, 'Content-Type': 'application/json' },
      });
      const j = await r.json().catch(() => ({}));
      const url = j?.data?.[0]?.invoiceUrl || null;
      if (url) return url;
    } catch (_e) { /* tenta o próximo status */ }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  // Guard: só service_role (o cron passa o service key).
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let role = '';
  try { role = (JSON.parse(atob((token.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/'))) || {}).role || ''; } catch { /* */ }
  if (role !== 'service_role') return json({ error: 'Forbidden' }, 403);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Probe (diagnóstico): resolve a invoiceUrl de uma assinatura SEM enviar e-mail.
  const body = await req.json().catch(() => ({} as any));
  if (body?.probe_subscription) {
    const url = await invoiceUrlDaMensalidade(String(body.probe_subscription), String(body.tipo || 'pending'));
    return json({ ok: true, probe: true, base: ASAAS_BASE_URL, tem_key: !!ASAAS_API_KEY, invoiceUrl: url });
  }

  const { data: targets, error } = await admin.rpc('subscription_dunning_targets');
  if (error) return json({ error: error.message }, 200);
  const lista: any[] = Array.isArray(targets) ? targets : [];

  const results: any[] = [];
  for (const t of lista) {
    try {
      const link = (await invoiceUrlDaMensalidade(t.asaas_subscription_id, t.tipo)) || `${APP_URL}/meu-plano`;
      const tipoEmail = t.tipo === 'overdue' ? 'subscription_overdue' : 'subscription_expiring';
      const { error: mailErr } = await admin.functions.invoke('send-email', {
        body: {
          type: tipoEmail, email: t.email, name: t.name,
          dias: t.dias, venc: t.venc, bloqueio: t.bloqueio, plano: t.plano, url: link,
        },
      });
      // Aviso "2 dias antes" só 1x por ciclo — marca após enviar.
      if (!mailErr && t.tipo === 'expiring') {
        await admin.from('user_subscriptions').update({ expiring_notified_at: new Date().toISOString() }).eq('user_id', t.user_id);
      }
      results.push({ user: String(t.user_id).slice(0, 8), tipo: t.tipo, ok: !mailErr, tem_fatura: link.includes('asaas') });
    } catch (e: any) {
      results.push({ user: String(t.user_id).slice(0, 8), tipo: t.tipo, ok: false, err: String(e?.message || e).slice(0, 120) });
    }
  }
  return json({ ok: true, enviados: results.filter((r) => r.ok).length, total: lista.length, results });
});
