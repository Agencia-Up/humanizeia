// deno-lint-ignore-file no-explicit-any
// ============================================================================
// feedback-relatorio-enviar — Envia o relatorio de atendimento (Cerebro) no
// WhatsApp de quem tem "Atendimento" ligado em conta_responsaveis. Gera o PDF
// (feedback-relatorio-pdf), assina a URL do bucket privado e manda por /send/media
// SEMPRE pelo numero da IA (feedback_instancia_ia) — nunca de vendedor.
// verify_jwt=false, guardado por VIEW_KEY. 1 chamada por tenant (o cron itera).
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VIEW_KEY = 'icom-7f3a9c2e';
const TENANT_DEFAULT = 'f49fd48a-4386-4009-95f3-26a5100b84f7';
const SUPA_URL = Deno.env.get('SUPABASE_URL')!;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

// Normaliza pra formato UAZAPI (digitos com DDI 55).
function normNum(s?: string | null): string {
  let d = (s || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11 && !d.startsWith('55')) d = '55' + d;
  return d;
}

// Data de hoje em BRT (UTC-3), formato dd/mm/aaaa.
function dataBRT(): string {
  const d = new Date(Date.now() - 3 * 3600e3);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

// Mensagem padrão que vai junto do PDF todo dia.
function captionPadrao(): string {
  return [
    `Relatório de atendimento - ${dataBRT()}`,
    ``,
    `Segue o resumo do dia: o feedback dos atendimentos dos vendedores e a qualidade dos leads que chegaram.`,
    ``,
    `Logos IA`,
  ].join('\n');
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
    const body = await req.json().catch(() => ({}));
    if (body?.k !== VIEW_KEY) return json({ ok: false, error: 'forbidden' }, 403);

    const tenant = String(body?.tenant_id || TENANT_DEFAULT);
    const admin = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 1) Destinatarios: quem tem "Atendimento" ligado nos Responsaveis.
    const { data: recs, error: rErr } = await admin
      .from('conta_responsaveis')
      .select('nome, whatsapp')
      .eq('user_id', tenant)
      .eq('recebe_atendimento', true)
      .eq('ativo', true);
    if (rErr) return json({ ok: false, error: `destinatarios: ${rErr.message}` }, 200);
    const dests = (recs || [])
      .map((r: any) => ({ nome: r.nome, num: normNum(r.whatsapp) }))
      .filter((r: any) => r.num.length >= 12);
    if (!dests.length) return json({ ok: true, enviados: 0, motivo: 'nenhum responsavel com Atendimento ligado' });

    // 2) Instancia da IA (nunca numero de vendedor).
    const { data: instRows, error: iErr } = await admin.rpc('feedback_instancia_ia', { p_tenant: tenant });
    if (iErr) return json({ ok: false, error: `instancia: ${iErr.message}` }, 200);
    const inst: any = (instRows || [])[0];
    if (!inst || !inst.api_url || !inst.token) {
      return json({ ok: false, error: 'sem instancia da IA conectada para disparar' }, 200);
    }
    if (inst.provider === 'meta') {
      return json({ ok: false, error: 'a instancia da IA e Meta (2a via) — envio de documento por aqui ainda nao suportado; use uma instancia UAZAPI' }, 200);
    }

    // 3) Gera o PDF do periodo (sobe no bucket privado feedback-relatorios).
    const uploadNome = `relatorio-atendimento-${tenant.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.pdf`;
    const genRes = await fetch(`${SUPA_URL}/functions/v1/feedback-relatorio-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        k: VIEW_KEY, tenant_id: tenant, upload_nome: uploadNome,
        loja: body?.loja, periodo_label: body?.periodo_label,
      }),
    });
    const gen = await genRes.json().catch(() => ({}));
    if (!gen?.ok) return json({ ok: false, error: `falha ao gerar o PDF: ${gen?.error || genRes.status}` }, 200);

    // 4) URL assinada (o bucket e privado; a UAZAPI baixa por essa URL).
    const { data: signed, error: sErr } = await admin.storage
      .from('feedback-relatorios').createSignedUrl(uploadNome, 3600);
    if (sErr || !signed?.signedUrl) return json({ ok: false, error: `falha ao assinar URL: ${sErr?.message || 'sem url'}` }, 200);

    // 5) Envia o documento a cada destinatario, pelo numero da IA.
    const caption = String(body?.caption || captionPadrao());
    const base = String(inst.api_url).replace(/\/+$/, '');
    const results: any[] = [];
    for (const d of dests) {
      try {
        const r = await fetch(`${base}/send/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', token: inst.token, apikey: inst.token },
          body: JSON.stringify({ number: d.num, file: signed.signedUrl, type: 'document', caption }),
        });
        results.push({ num: d.num, ok: r.ok, status: r.status, err: r.ok ? null : String(await r.text().catch(() => '')).slice(0, 200) });
      } catch (e: any) {
        results.push({ num: d.num, ok: false, err: String(e?.message || e).slice(0, 200) });
      }
    }
    const enviados = results.filter((x) => x.ok).length;
    return json({ ok: enviados > 0, enviados, total: dests.length, arquivo: uploadNome, paginas: gen.paginas, results });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e), stack: String(e?.stack || '').slice(0, 800) }, 200);
  }
});
