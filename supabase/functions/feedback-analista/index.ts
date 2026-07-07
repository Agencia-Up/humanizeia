// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { analisarLead, LlmCall } from '../_shared/feedback/analista.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const MODEL_DEFAULT = Deno.env.get('FEEDBACK_LLM_MODEL') || 'claude-haiku-4-5';
const PRECOS: Record<string, { in: number; out: number }> = {
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

function makeLlm(model: string): LlmCall {
  return async (system, userText) => {
    const key = Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('CLAUDE_API_KEY');
    if (!key) return null;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: 4000,
          temperature: 0.2,
          system,
          messages: [{ role: 'user', content: userText }],
        }),
      });
      if (!res.ok) { console.error('[feedback-analista] anthropic', res.status, await res.text().catch(() => '')); return null; }
      const data = await res.json();
      const text = (data?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      const inTok = data?.usage?.input_tokens || 0;
      const outTok = data?.usage?.output_tokens || 0;
      const p = PRECOS[model] || PRECOS['claude-haiku-4-5'];
      const custo = (inTok * p.in + outTok * p.out) / 1_000_000;
      return { text, tokens: inTok + outTok, custo };
    } catch (e) {
      console.error('[feedback-analista] erro llm', (e as any)?.message);
      return null;
    }
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let role = '';
  try {
    const payload = token.split('.')[1] || '';
    role = ((JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) || {}) as any).role || '';
  } catch { /* token invalido */ }
  if (role !== 'service_role') return json({ error: 'Forbidden' }, 403);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = await req.json().catch(() => ({}));

  if (body?.batch) {
    const limit = Math.min(Number(body?.limit) || 20, 100);
    const horas = Number(Deno.env.get('FEEDBACK_CONVERSA_CONCLUIDA_HORAS')) || 6;
    const { data: pend, error } = await admin.rpc('feedback_leads_pendentes', { p_limit: limit, p_horas: horas });
    if (error) return json({ error: error.message }, 500);
    const llm = makeLlm(String(body?.model || MODEL_DEFAULT));
    const resultados: any[] = [];
    for (const p of (pend || [])) {
      try {
        const r = await analisarLead(admin, llm, p.lead_source, p.lead_id);
        resultados.push({ lead_id: p.lead_id, ...r });
        if (r.status === 'pulado') break;
      } catch (e: any) {
        resultados.push({ lead_id: p.lead_id, status: 'falhou', motivo: e?.message, stack: String(e?.stack||'').slice(0,600) });
      }
    }
    return json({ ok: true, modelo: String(body?.model || MODEL_DEFAULT), processados: resultados.length, resultados });
  }

  const leadId = String(body?.lead_id || '');
  const leadSource = body?.lead_source === 'marcos' ? 'marcos' : 'pedro';
  if (!leadId) return json({ error: 'lead_id obrigatorio (ou batch:true)' }, 400);
  const model = String(body?.model || MODEL_DEFAULT);
  const versaoThread = String(body?.versao_thread || 'v1');

  try {
    const r = await analisarLead(admin, makeLlm(model), leadSource, leadId, versaoThread);
    return json({ ok: r.status !== 'falhou', modelo: model, versao_thread: versaoThread, ...r });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e), stack: String(e?.stack || '').slice(0, 1800) }, 200);
  }
});
