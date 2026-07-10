// deno-lint-ignore-file no-explicit-any
// ============================================================================
// feedback-nepq-diario — Fechamento diário do NEPQ. Manda no WhatsApp do gestor
// (quem tem "Atendimento" ligado em conta_responsaveis) um resumo do atendimento
// do DIA ANTERIOR por vendedor (semáforo + nota + 1 frase de coaching), SEMPRE
// pelo número da IA (feedback_instancia_ia) — nunca de vendedor. O detalhe
// completo (radar, conversa a conversa) fica no painel → Feedbacks. verify_jwt=
// false, guardado por VIEW_KEY. 1 chamada por tenant (o cron itera).
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Guard interno das funcoes de feedback: secret FEEDBACK_VIEW_KEY (setado no
// dashboard). Sem literal no codigo — se o secret faltar, falha fechado.
const VIEW_KEY = Deno.env.get('FEEDBACK_VIEW_KEY') || '';
const TENANT_DEFAULT = 'f49fd48a-4386-4009-95f3-26a5100b84f7';
const SUPA_URL = Deno.env.get('SUPABASE_URL')!;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

function normNum(s?: string | null): string {
  let d = (s || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11 && !d.startsWith('55')) d = '55' + d;
  return d;
}

// Data de ontem em BRT (UTC-3), objeto {iso: 'aaaa-mm-dd', br: 'dd/mm'}.
function ontemBRT(): { iso: string; br: string } {
  const d = new Date(Date.now() - 3 * 3600e3 - 24 * 3600e3);
  const iso = d.toISOString().slice(0, 10);
  const [y, m, dd] = iso.split('-');
  return { iso, br: `${dd}/${m}` };
}

const primeiroNome = (n?: string | null) => String(n || '').trim().split(/\s+/)[0] || '';
const cap = (t: string, n: number) => (t && t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);

// Monta a mensagem de gestor (linguagem simples, semáforo, coaching curto).
function montarTexto(dataBr: string, dados: any[]): string {
  const comNota = dados.filter((d) => d.nepq_score != null);
  const media = comNota.length ? Math.round(comNota.reduce((a, d) => a + Number(d.nepq_score), 0) / comNota.length) : null;
  const reds = comNota.filter((d) => Number(d.nepq_score) < 45).sort((a, b) => a.nepq_score - b.nepq_score);
  const yellows = comNota.filter((d) => Number(d.nepq_score) >= 45 && Number(d.nepq_score) < 70).sort((a, b) => a.nepq_score - b.nepq_score);
  const greens = comNota.filter((d) => Number(d.nepq_score) >= 70);

  const linha = (d: any) => `• ${primeiroNome(d.vendedor_nome) || 'Vendedor'} · ${cap(String(d.lead_name || 'lead'), 22)} (${d.nepq_score}): ${cap(String(d.frase_coaching || '').replace(/\s+/g, ' ').trim(), 150)}`;

  const L: string[] = [];
  L.push(`🧭 Feedback de atendimento — ${dataBr}`);
  L.push('');
  L.push(`${comNota.length} atendimento(s) avaliado(s) pelo método NEPQ.${media != null ? ` Nota média: ${media}/100.` : ''}`);
  if (reds.length) {
    L.push('');
    L.push('🔴 Precisam de atenção:');
    for (const d of reds.slice(0, 6)) L.push(linha(d));
    if (reds.length > 6) L.push(`…e mais ${reds.length - 6}.`);
  }
  if (yellows.length) {
    L.push('');
    L.push('🟡 Quase lá:');
    for (const d of yellows.slice(0, 4)) L.push(linha(d));
    if (yellows.length > 4) L.push(`…e mais ${yellows.length - 4}.`);
  }
  if (greens.length) {
    L.push('');
    L.push(`🟢 Bem atendidos: ${greens.length}.`);
  }
  L.push('');
  L.push('Detalhe por vendedor (radar + conversa a conversa) no painel → Feedbacks → NEPQ.');
  L.push('Logos IA');
  return L.join('\n');
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
    const body = await req.json().catch(() => ({}));
    if (body?.k !== VIEW_KEY) return json({ ok: false, error: 'forbidden' }, 403);

    const tenant = String(body?.tenant_id || TENANT_DEFAULT);
    const ref = body?.data_ref ? String(body.data_ref) : ontemBRT().iso;
    const dataBr = (ref.split('-')[2] || '') + '/' + (ref.split('-')[1] || '');
    const admin = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 1) Dados NEPQ do dia (atendimentos daquele dia, já analisados).
    const { data: dados, error: dErr } = await admin.rpc('feedback_nepq_diario_dados', { p_tenant: tenant, p_ref: ref });
    if (dErr) return json({ ok: false, error: `dados: ${dErr.message}` }, 200);
    const lista: any[] = Array.isArray(dados) ? dados : [];
    if (!lista.length) return json({ ok: true, enviados: 0, motivo: 'sem atendimento NEPQ nesse dia' });

    // 2) Destinatarios (Atendimento ligado) + instancia da IA.
    const { data: recs } = await admin.from('conta_responsaveis')
      .select('nome, whatsapp').eq('user_id', tenant).eq('recebe_atendimento', true).eq('ativo', true);
    const dests = (recs || []).map((r: any) => ({ nome: r.nome, num: normNum(r.whatsapp) })).filter((r: any) => r.num.length >= 12);
    // Override de teste: manda pra um número específico sem tocar nos responsáveis.
    const alvo = body?.teste_num ? [{ nome: 'teste', num: normNum(body.teste_num) }] : dests;
    if (!alvo.length) return json({ ok: true, enviados: 0, motivo: 'nenhum responsavel com Atendimento ligado' });

    const { data: instRows, error: iErr } = await admin.rpc('feedback_instancia_ia', { p_tenant: tenant });
    if (iErr) return json({ ok: false, error: `instancia: ${iErr.message}` }, 200);
    const inst: any = (instRows || [])[0];
    if (!inst || !inst.api_url || !inst.token) return json({ ok: false, error: 'sem instancia da IA conectada' }, 200);
    if (inst.provider === 'meta') return json({ ok: false, error: 'instancia da IA e Meta — use UAZAPI p/ este envio' }, 200);

    // 3) Texto + envio (/send/text) pela IA.
    const texto = montarTexto(dataBr, lista);
    // Dry-run: valida o texto sem enviar nada (teste seguro).
    if (body?.dry_run) return json({ ok: true, dry_run: true, atendimentos: lista.length, texto });
    const base = String(inst.api_url).replace(/\/+$/, '');
    const results: any[] = [];
    for (const d of alvo) {
      try {
        const r = await fetch(`${base}/send/text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', token: inst.token, apikey: inst.token },
          body: JSON.stringify({ number: d.num, text: texto }),
        });
        results.push({ num: d.num, ok: r.ok, status: r.status, err: r.ok ? null : String(await r.text().catch(() => '')).slice(0, 200) });
      } catch (e: any) {
        results.push({ num: d.num, ok: false, err: String(e?.message || e).slice(0, 200) });
      }
    }
    const enviados = results.filter((x) => x.ok).length;
    return json({ ok: enviados > 0, enviados, total: alvo.length, atendimentos: lista.length, results, previa: texto.slice(0, 400) });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e), stack: String(e?.stack || '').slice(0, 800) }, 200);
  }
});
