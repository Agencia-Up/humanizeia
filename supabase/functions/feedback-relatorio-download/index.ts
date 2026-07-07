// deno-lint-ignore-file no-explicit-any
// ============================================================================
// feedback-relatorio-download — Devolve uma URL assinada (temporaria) do PDF de
// um relatorio do historico. verify_jwt=true. A autorizacao usa a RLS: le a
// linha em feedback_relatorios COM O TOKEN DO CHAMADOR (so vê se for da conta
// dele); se viu, assina a URL do bucket privado com service_role.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  try {
    const auth = req.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return json({ ok: false, error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const relatorioId = String(body?.relatorio_id || '');
    if (!relatorioId) return json({ ok: false, error: 'relatorio_id obrigatorio' }, 400);

    // Le a linha COM O TOKEN DO CHAMADOR (RLS decide se ele pode ver).
    const asCaller = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: row, error: rErr } = await asCaller
      .from('feedback_relatorios')
      .select('id, storage_path')
      .eq('id', relatorioId)
      .maybeSingle();
    if (rErr) return json({ ok: false, error: rErr.message }, 200);
    if (!row || !row.storage_path) return json({ ok: false, error: 'relatorio nao encontrado ou sem arquivo' }, 404);

    // Assina a URL do bucket privado com service_role.
    const admin = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: signed, error: sErr } = await admin.storage
      .from('feedback-relatorios').createSignedUrl(row.storage_path, 300);
    if (sErr || !signed?.signedUrl) return json({ ok: false, error: `falha ao assinar: ${sErr?.message || 'sem url'}` }, 200);

    return json({ ok: true, url: signed.signedUrl });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, 200);
  }
});
