// deno-lint-ignore-file no-explicit-any
// ============================================================================
// feedback-ingestor — FASE 1 do Cérebro de Feedback (transporte HTTP).
// Wrapper fino sobre _shared/feedback/ingestor.buildLeadThread — dado um lead,
// devolve o thread unificado (Pedro + vendedor) já ordenado. Read-only.
// Só service_role chama (é usado pelo cérebro/Fase 2 e para testar isolado).
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildLeadThread } from '../_shared/feedback/ingestor.ts';

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

  // Auth: exige o papel service_role no JWT (mesmo padrão do checkout-reconcile).
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let role = '';
  try {
    const payload = token.split('.')[1] || '';
    role = ((JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) || {}) as any).role || '';
  } catch { /* token inválido */ }
  if (role !== 'service_role') return json({ error: 'Forbidden' }, 403);

  const body = await req.json().catch(() => ({}));
  const leadId = String(body?.lead_id || '');
  const leadSource = body?.lead_source === 'marcos' ? 'marcos' : 'pedro';
  if (!leadId) return json({ error: 'lead_id obrigatório' }, 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const thread = await buildLeadThread(admin, leadSource, leadId);
  if (!thread) return json({ error: 'lead não encontrado' }, 404);
  return json({ ok: true, ...thread, total_mensagens: thread.thread.length });
});
