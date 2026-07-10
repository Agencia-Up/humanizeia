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
    const pulados: any[] = [];
    const falhas: any[] = [];
    // Item 4: um lead 'pulado' (teto de custo do tenant) NAO pode parar o lote
    // inteiro. Marca o tenant como esgotado e pula so os DELE; outros tenants
    // continuam sendo analisados.
    const tenantsEsgotados = new Set<string>();
    for (const p of (pend || [])) {
      const t = (p as any).tenant_id ? String((p as any).tenant_id) : '';
      if (t && tenantsEsgotados.has(t)) { pulados.push({ lead_id: p.lead_id, motivo: 'tenant no teto' }); continue; }
      try {
        const r = await analisarLead(admin, llm, p.lead_source, p.lead_id);
        resultados.push({ lead_id: p.lead_id, ...r });
        if (r.status === 'pulado') {
          if (t) tenantsEsgotados.add(t);
          pulados.push({ lead_id: p.lead_id, tenant_id: t, motivo: r.motivo || 'cap' });
          console.warn(`[feedback-analista] tenant ${t || '?'} no teto (${r.motivo}); pulando os leads dele, o lote continua`);
          continue;
        }
        if (r.status === 'falhou') falhas.push({ lead_id: p.lead_id, motivo: r.motivo });
      } catch (e: any) {
        const item = { lead_id: p.lead_id, status: 'falhou', motivo: e?.message, stack: String(e?.stack || '').slice(0, 600) };
        resultados.push(item); falhas.push({ lead_id: p.lead_id, motivo: e?.message });
        console.error(`[feedback-analista] excecao no lead ${p.lead_id}:`, e?.message);
      }
    }
    // Item 10: registra o resumo da rodada num log rastreavel (best-effort).
    try {
      await admin.from('feedback_job_log').insert({
        funcao: 'feedback-analista:batch',
        status: falhas.length ? 'parcial' : 'ok',
        detalhe: { total: (pend || []).length, processados: resultados.length, pulados, falhas, tenants_esgotados: [...tenantsEsgotados] },
      });
    } catch (_e) { /* log e best-effort, nao quebra o batch */ }
    return json({ ok: true, modelo: String(body?.model || MODEL_DEFAULT), processados: resultados.length, pulados: pulados.length, falhas: falhas.length, resultados });
  }

  // Reprocesso SEGURO das falhas LEGADAS: conversas com status='falhou' cujo `erro`
  // e o marcador antigo "reprocessar: escopo mudou..." (setado por uma versao anterior
  // do ingestor, que HOJE ja separa IA x vendedor por instancia). Essas linhas NAO sao
  // repescadas pelo batch normal porque feedback_leads_pendentes so olha o mes atual.
  // Aqui reanalisamos DIRETO por lead_id, reusando analisarLead: respeita o teto de
  // custo (feedback_cost_gate -> status 'pulado') e e idempotente (a analise sobrescreve
  // a linha 'falhou' via upsert). dry_run lista os alvos sem gastar nada.
  if (body?.reprocessar_falhas) {
    const limit = Math.min(Number(body?.limit) || 30, 100);
    const tenant = body?.tenant_id ? String(body.tenant_id) : null;
    const marcador = String(body?.marcador || 'reprocessar: escopo mudou%');
    let q = admin.from('feedback_conversas')
      .select('lead_source, lead_id, tenant_id, erro, versao_thread')
      .eq('status', 'falhou').ilike('erro', marcador)
      .order('created_at', { ascending: true }).limit(limit);
    if (tenant) q = q.eq('tenant_id', tenant);
    const { data: falhadas, error } = await q;
    if (error) return json({ error: error.message }, 500);
    const alvo = falhadas || [];
    if (body?.dry_run) return json({ ok: true, dry_run: true, encontrados: alvo.length, alvo: alvo.map((f: any) => f.lead_id) });

    const llm = makeLlm(String(body?.model || MODEL_DEFAULT));
    const esgotados = new Set<string>();
    let concluidos = 0, pulados = 0, aindaFalhou = 0;
    const resultados: any[] = [];
    for (const f of alvo) {
      const t = (f as any).tenant_id ? String((f as any).tenant_id) : '';
      if (t && esgotados.has(t)) { pulados++; resultados.push({ lead_id: (f as any).lead_id, status: 'pulado', motivo: 'tenant no teto' }); continue; }
      try {
        const r = await analisarLead(admin, llm, (f as any).lead_source === 'marcos' ? 'marcos' : 'pedro', (f as any).lead_id, String((f as any).versao_thread || 'v1'));
        resultados.push({ lead_id: (f as any).lead_id, status: r.status, motivo: (r as any).motivo });
        if (r.status === 'pulado') { if (t) esgotados.add(t); pulados++; }
        else if (r.status === 'falhou') aindaFalhou++;
        else concluidos++;
      } catch (e: any) {
        aindaFalhou++; resultados.push({ lead_id: (f as any).lead_id, status: 'falhou', motivo: e?.message });
      }
    }
    try {
      await admin.from('feedback_job_log').insert({
        funcao: 'feedback-analista:reprocessar_falhas', tenant_id: tenant,
        status: aindaFalhou ? 'parcial' : 'ok',
        detalhe: { encontrados: alvo.length, concluidos, pulados, ainda_falhou: aindaFalhou },
      });
    } catch (_e) { /* log best-effort */ }
    return json({ ok: true, encontrados: alvo.length, concluidos, pulados, ainda_falhou: aindaFalhou, resultados });
  }

  const leadId = String(body?.lead_id || '');
  const leadSource = body?.lead_source === 'marcos' ? 'marcos' : 'pedro';
  if (!leadId) return json({ error: 'lead_id obrigatorio (ou batch:true / reprocessar_falhas:true)' }, 400);
  const model = String(body?.model || MODEL_DEFAULT);
  const versaoThread = String(body?.versao_thread || 'v1');

  try {
    const r = await analisarLead(admin, makeLlm(model), leadSource, leadId, versaoThread);
    return json({ ok: r.status !== 'falhou', modelo: model, versao_thread: versaoThread, ...r });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e), stack: String(e?.stack || '').slice(0, 1800) }, 200);
  }
});
