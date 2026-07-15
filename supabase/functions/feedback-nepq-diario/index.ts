// deno-lint-ignore-file no-explicit-any
// ============================================================================
// feedback-nepq-diario
//
// Endpoint mantido apenas para diagnostico/dry-run do texto NEPQ diario.
// O envio oficial ao WhatsApp e feito pelo PDF diario tenant-scoped em
// feedback-relatorio-enviar. Este endpoint NAO envia WhatsApp.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VIEW_KEY = Deno.env.get('FEEDBACK_VIEW_KEY') || '';
const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

function ontemBRT(): { iso: string; br: string } {
  const d = new Date(Date.now() - 3 * 3600e3 - 24 * 3600e3);
  const iso = d.toISOString().slice(0, 10);
  const [y, m, dd] = iso.split('-');
  void y;
  return { iso, br: `${dd}/${m}` };
}

const primeiroNome = (n?: string | null) => String(n || '').trim().split(/\s+/)[0] || '';
const cap = (t: string, n: number) => (t && t.length > n ? t.slice(0, n - 1).trimEnd() + '...' : t);

function montarTexto(dataBr: string, dados: any[]): string {
  const comNota = dados.filter((d) => d.nepq_score != null);
  const media = comNota.length ? Math.round(comNota.reduce((a, d) => a + Number(d.nepq_score), 0) / comNota.length) : null;
  const reds = comNota.filter((d) => Number(d.nepq_score) < 45).sort((a, b) => a.nepq_score - b.nepq_score);
  const yellows = comNota.filter((d) => Number(d.nepq_score) >= 45 && Number(d.nepq_score) < 70).sort((a, b) => a.nepq_score - b.nepq_score);
  const greens = comNota.filter((d) => Number(d.nepq_score) >= 70);

  const linha = (d: any) =>
    `- ${primeiroNome(d.vendedor_nome) || 'Vendedor'} · ${cap(String(d.lead_name || 'lead'), 22)} (${d.nepq_score}): ${cap(String(d.frase_coaching || '').replace(/\s+/g, ' ').trim(), 150)}`;

  const L: string[] = [];
  L.push(`Feedback de atendimento — ${dataBr}`);
  L.push('');
  L.push(`${comNota.length} atendimento(s) avaliado(s) pelo metodo NEPQ.${media != null ? ` Nota media: ${media}/100.` : ''}`);
  if (reds.length) {
    L.push('');
    L.push('Precisam de atencao:');
    for (const d of reds.slice(0, 6)) L.push(linha(d));
    if (reds.length > 6) L.push(`...e mais ${reds.length - 6}.`);
  }
  if (yellows.length) {
    L.push('');
    L.push('Quase la:');
    for (const d of yellows.slice(0, 4)) L.push(linha(d));
    if (yellows.length > 4) L.push(`...e mais ${yellows.length - 4}.`);
  }
  if (greens.length) {
    L.push('');
    L.push(`Bem atendidos: ${greens.length}.`);
  }
  L.push('');
  L.push('Detalhe por vendedor no painel -> Feedbacks -> NEPQ.');
  L.push('Logos IA');
  return L.join('\n');
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
    const body = await req.json().catch(() => ({}));
    if (body?.k !== VIEW_KEY) return json({ ok: false, error: 'forbidden' }, 403);

    const tenant = String(body?.tenant_id || '').trim();
    if (!UUID_RE.test(tenant)) {
      return json({
        ok: false,
        error: 'tenant_id obrigatorio',
        motivo: 'NEPQ bloqueado: chamada sem conta master explicita. Nao existe fallback para tenant padrao.',
      }, 400);
    }
    if (body?.teste_num && !body?.dry_run) {
      return json({
        ok: false,
        error: 'teste_num permitido apenas em dry_run',
        motivo: 'Bloqueado para impedir envio de dados de uma conta para numero fora dos responsaveis dela.',
      }, 400);
    }

    const ref = body?.data_ref ? String(body.data_ref) : ontemBRT().iso;
    const dataBr = (ref.split('-')[2] || '') + '/' + (ref.split('-')[1] || '');
    const admin = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: dados, error: dErr } = await admin.rpc('feedback_nepq_diario_dados', { p_tenant: tenant, p_ref: ref });
    if (dErr) return json({ ok: false, error: `dados: ${dErr.message}` }, 200);
    const lista: any[] = Array.isArray(dados) ? dados : [];
    if (!lista.length) return json({ ok: true, enviados: 0, motivo: 'sem atendimento NEPQ nesse dia' });

    const texto = montarTexto(dataBr, lista);
    if (body?.dry_run) return json({ ok: true, dry_run: true, atendimentos: lista.length, texto });

    return json({
      ok: true,
      enviados: 0,
      atendimentos: lista.length,
      motivo: 'envio_texto_nepq_desativado_pdf_only',
    });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e), stack: String(e?.stack || '').slice(0, 800) }, 200);
  }
});
