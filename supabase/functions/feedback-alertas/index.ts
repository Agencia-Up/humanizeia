// deno-lint-ignore-file no-explicit-any
// ============================================================================
// feedback-alertas — Alerta em TEMPO REAL "bom cliente em risco": o cerebro
// considera o cliente BOM (interesse real) mas ele foi mal atendido (score<45)
// e nao vendeu. Avisa o gerente na HORA, SEMPRE pelo numero da IA (nunca de
// vendedor), + grava flag no painel. Anti-flood: uma msg agrupada por rodada,
// cada caso avisa 1x (idempotente via feedback_alertas). Ligado por config
// (feature_flags.alertas + canais_alerta). verify_jwt=false, guard VIEW_KEY.
// Casos de "4_nao_lead" NAO viram alerta — ficam so no relatorio diario.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VIEW_KEY = 'icom-7f3a9c2e';
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

// Formata o telefone do lead em (DD) 9XXXX-XXXX (tira DDI 55).
function fone(raw?: string): string {
  let d = (raw || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  if (d.length >= 10) { const dd = d.slice(0, 2), r = d.slice(2); return `(${dd}) ${r.slice(0, r.length - 4)}-${r.slice(-4)}`; }
  return d;
}
const cap1 = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Formato aprovado pelo dono: alerta forte (so dispara em risco real de perder
// venda) + dados pra AGIR na hora (contato do lead, horario do ultimo contato,
// nome completo do vendedor).
function buildMsg(cases: any[]): string {
  const b = (s: string) => `*${s}*`;
  const veic = (c: any) => (c.veiculo ? ` (${c.veiculo})` : '');
  const tel = (c: any) => (c.telefone ? ` · ${fone(c.telefone)}` : '');
  const hora = (c: any) => (c.ultimo_contato ? ` · último contato ${c.ultimo_contato}` : '');
  if (cases.length === 1) {
    const c = cases[0];
    return [
      `🚨 ${b('ATENÇÃO — cliente bom prestes a ser perdido')}`,
      '',
      `${b(c.lead_nome)}${veic(c)}${tel(c)}`,
      `${cap1(c.motivo)}.`,
      `Atendendo: ${b(c.vendedor_nome || 'sem vendedor')}${hora(c)}`,
      '',
      'Vale entrar nessa conversa antes de perder o cliente.',
      '',
      '_Logos IA_',
    ].join('\n');
  }
  const linhas = cases.map((c) => `• ${b(c.lead_nome)}${veic(c)}${tel(c)} — ${c.motivo}${c.vendedor_nome ? ` · ${c.vendedor_nome}` : ''}`).join('\n');
  return [
    `🚨 ${b('ATENÇÃO — clientes bons prestes a serem perdidos')}`,
    '',
    `${b(cases.length + ' clientes bons')} estão sendo mal atendidos e podem escapar:`,
    linhas,
    '',
    'Vale entrar nessas conversas antes de perder os clientes.',
    '',
    '_Logos IA_',
  ].join('\n');
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
    const body = await req.json().catch(() => ({}));
    if (body?.k !== VIEW_KEY) return json({ ok: false, error: 'forbidden' }, 403);

    const tenant = String(body?.tenant_id || TENANT_DEFAULT);
    const testNumber = body?.test_number ? normNum(String(body.test_number)) : '';
    const isTest = !!testNumber;
    const admin = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Config: flag + canais ativos.
    const { data: cfg } = await admin.from('feedback_config')
      .select('feature_flags, canais_alerta')
      .or(`tenant_id.eq.${tenant},tenant_id.is.null`)
      .order('tenant_id', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    const flagOn = !!(cfg?.feature_flags as any)?.alertas;
    const canais: string[] = Array.isArray((cfg as any)?.canais_alerta) ? (cfg as any).canais_alerta : ['whatsapp', 'painel_flag'];
    if (!isTest && !flagOn) return json({ ok: true, enviados: 0, motivo: 'flag alertas desligada' });

    // Casos "bom cliente em risco" ainda nao avisados.
    const { data: casosRaw, error: cErr } = await admin.rpc('feedback_alertas_pendentes', { p_tenant: tenant });
    if (cErr) return json({ ok: false, error: `casos: ${cErr.message}` }, 200);
    let casos: any[] = casosRaw || [];
    // Teste: se nao ha caso real na janela, manda o exemplo pra visualizar o formato.
    if (isTest && body?.sample && !casos.length) {
      casos = [{ conversa_id: null, lead_nome: 'Marcos', veiculo: 'Toyota Hilux', vendedor_nome: 'João Santos',
        motivo: 'tinha carro na troca e falou de entrada, mas foi mal atendido',
        telefone: '5512997918775', ultimo_contato: '14:20' }];
    }
    if (!casos.length) return json({ ok: true, enviados: 0, motivo: 'nenhum cliente bom em risco' });

    const msg = buildMsg(casos);
    const results: any[] = [];
    let enviados = 0;

    // Canal WhatsApp (sempre pelo numero da IA).
    if (canais.includes('whatsapp')) {
      const { data: instRows } = await admin.rpc('feedback_instancia_ia', { p_tenant: tenant });
      const inst: any = (instRows || [])[0];
      if (inst?.api_url && inst?.token && inst?.provider !== 'meta') {
        let dests: string[];
        if (isTest) dests = [testNumber];
        else {
          const { data: recs } = await admin.from('conta_responsaveis')
            .select('whatsapp').eq('user_id', tenant).eq('recebe_alertas', true).eq('ativo', true);
          dests = [...new Set((recs || []).map((r: any) => normNum(r.whatsapp)).filter((n: string) => n.length >= 12))];
        }
        const base = String(inst.api_url).replace(/\/+$/, '');
        for (const num of dests) {
          try {
            const r = await fetch(`${base}/send/text`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', token: inst.token, apikey: inst.token },
              body: JSON.stringify({ number: num, text: msg }),
            });
            if (r.ok) enviados++;
            results.push({ num, ok: r.ok, status: r.status, err: r.ok ? null : String(await r.text().catch(() => '')).slice(0, 150) });
          } catch (e: any) { results.push({ num, ok: false, err: String(e?.message || e).slice(0, 150) }); }
        }
      } else {
        results.push({ wa: 'sem instancia IA conectada (ou Meta) — WhatsApp pulado' });
      }
    }

    // Registro em feedback_alertas: entrega o canal painel_flag (Realtime) E
    // marca como avisado (idempotencia). No teste NAO grava (nao queima casos reais).
    let registrados = 0;
    if (!isTest) {
      const canalUsado = enviados > 0 ? 'whatsapp' : (canais.includes('painel_flag') ? 'painel_flag' : 'whatsapp');
      const rows = casos.filter((c) => c.conversa_id).map((c) => ({
        tenant_id: tenant, feedback_conversa_id: c.conversa_id, tipo: 'bom_em_risco',
        canal: canalUsado, enviado_em: enviados > 0 ? new Date().toISOString() : null, lido: false,
      }));
      if (rows.length) {
        const { error: insErr } = await admin.from('feedback_alertas').insert(rows);
        if (!insErr) registrados = rows.length; else results.push({ registro: insErr.message });
      }
    }

    return json({ ok: true, enviados, registrados, total: casos.length, canais, teste: isTest, results });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e), stack: String(e?.stack || '').slice(0, 600) }, 200);
  }
});
