// deno-lint-ignore-file no-explicit-any
// ============================================================================
// feedback-analista — FASE 2 do Cérebro de Feedback (o especialista).
// Analisa a conversa de um lead com o Claude e persiste a análise.
// Modos: { lead_id, lead_source }  ->  1 lead
//        { batch:true, limit }     ->  lote (leads pendentes de tenants com a flag on)
// Custo protegido pelo cost gate (Fase 0). Só service_role chama.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { analisarLead, LlmCall } from '../_shared/feedback/analista.ts';
import { callAiGateway } from '../_shared/jose-v2/aiGateway.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Auth: exige service_role no JWT.
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let role = '';
  try {
    const payload = token.split('.')[1] || '';
    role = ((JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) || {}) as any).role || '';
  } catch { /* token inválido */ }
  if (role !== 'service_role') return json({ error: 'Forbidden' }, 403);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // LLM real: Claude via gateway do José (BYOK + fallback + custo). ref_tipo='feedback'.
  const llm: LlmCall = async (system, userText, userId) => {
    const res = await callAiGateway(admin, {
      user_id: userId,
      capability: 'llm',
      input: {
        system,
        messages: [{ role: 'user', content: userText }],
        max_tokens: 2000,
        temperature: 0.2,
      },
      ref_tipo: 'feedback',
    });
    if (!res.ok || !res.text) return null;
    return {
      text: res.text,
      tokens: (res.usage?.tokens_in || 0) + (res.usage?.tokens_out || 0),
      custo: res.cost_usd || 0,
    };
  };

  const body = await req.json().catch(() => ({}));

  // ── Lote (cron): leads pendentes dos tenants com feature_flag 'analise' on ──
  if (body?.batch) {
    const limit = Math.min(Number(body?.limit) || 20, 100);
    const horas = Number(Deno.env.get('FEEDBACK_CONVERSA_CONCLUIDA_HORAS')) || 6;
    const { data: pend, error } = await admin.rpc('feedback_leads_pendentes', { p_limit: limit, p_horas: horas });
    if (error) return json({ error: error.message }, 500);
    const resultados: any[] = [];
    for (const p of (pend || [])) {
      try {
        const r = await analisarLead(admin, llm, p.lead_source, p.lead_id);
        resultados.push({ lead_id: p.lead_id, ...r });
        if (r.status === 'pulado') break; // cap batido -> para o lote
      } catch (e: any) {
        resultados.push({ lead_id: p.lead_id, status: 'falhou', motivo: e?.message });
      }
    }
    return json({ ok: true, processados: resultados.length, resultados });
  }

  // ── Lead único ──────────────────────────────────────────────────────────
  const leadId = String(body?.lead_id || '');
  const leadSource = body?.lead_source === 'marcos' ? 'marcos' : 'pedro';
  if (!leadId) return json({ error: 'lead_id obrigatório (ou batch:true)' }, 400);

  const r = await analisarLead(admin, llm, leadSource, leadId);
  return json({ ok: r.status !== 'falhou', ...r });
});
