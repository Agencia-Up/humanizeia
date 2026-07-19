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

// Guard interno das funcoes de feedback: secret FEEDBACK_VIEW_KEY (setado no
// dashboard). Sem literal no codigo — se o secret faltar, falha fechado.
const VIEW_KEY = Deno.env.get('FEEDBACK_VIEW_KEY') || '';
// Sem tenant padrao: alerta NUNCA pode rodar para conta errada. tenant_id e
// obrigatorio e validado por UUID (mesmo padrao do feedback-relatorio-enviar).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPA_URL = Deno.env.get('SUPABASE_URL')!;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

function normNum(s?: string | null): string {
  let d = (s || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11 && !d.startsWith('55')) d = '55' + d;
  return d;
}

// Formato EXATO aprovado pelo dono (09/07): alerta chamativo (só dispara em risco
// real de perder venda) com checklist. Um bloco por cliente em risco.
function bloco(c: any): string {
  const L: string[] = [];
  L.push('🚨🚨🚨 ALERTA DE PERDA DE VENDA 🚨🚨🚨');
  L.push('');
  L.push('💸 Cliente QUENTE prestes a desistir.');
  L.push('');
  L.push(`Nome: ${c.lead_nome}`);
  if (c.veiculo) L.push(`Interesse: ${c.veiculo}`);
  L.push('');
  if (c.tem_entrada) L.push('✔️ Possui entrada');
  if (c.tem_troca) L.push('✔️ Tem carro na troca');
  if (!c.tem_entrada && !c.tem_troca) L.push('✔️ Demonstrou interesse real de compra');
  L.push('❌ Atendimento ruim');
  L.push('');
  L.push('⚠️ Intervenha AGORA antes que ele feche com outra concessionária.');
  L.push('');
  L.push(`👤 Responsável: ${c.vendedor_nome || 'sem vendedor'}`);
  if (c.ultimo_contato) L.push(`🕑 Último contato: ${c.ultimo_contato}`);
  L.push('');
  L.push('👉 Toque para abrir a conversa.');
  return L.join('\n');
}

function buildMsg(cases: any[]): string {
  const blocos = cases.slice(0, 5).map(bloco);
  let msg = blocos.join('\n\n━━━━━━━━━━━━\n\n');
  if (cases.length > 5) msg += `\n\n(+ ${cases.length - 5} outros clientes em risco — veja o relatório do dia)`;
  return msg;
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
        motivo: 'Alerta bloqueado: chamada sem conta master explicita. Nao existe fallback para tenant padrao.',
      }, 400);
    }
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
        tem_entrada: true, tem_troca: true, ultimo_contato: '14:20' }];
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

    // Registro em feedback_alertas (idempotencia SEM queimar retry):
    //   - enviado_em PREENCHIDO = entrega efetivada -> a RPC feedback_alertas_pendentes
    //     nao devolve mais o caso (queimado de verdade).
    //   - enviado_em NULL = apenas sinal de painel durante falha de WhatsApp -> a RPC
    //     CONTINUA devolvendo o caso, permitindo retry do WhatsApp na proxima rodada.
    // Regras:
    //   1) WhatsApp enviado com sucesso -> canal 'whatsapp' + enviado_em (queima).
    //   2) WhatsApp falhou/sem instancia + painel_flag ativo:
    //      - se whatsapp NEM esta configurado -> painel e o canal final: 'painel_flag'
    //        com enviado_em (queima).
    //      - se whatsapp esta configurado -> 'painel_flag' com enviado_em NULL
    //        (painel acende via Realtime; retry do WhatsApp segue aberto). Anti-flood:
    //        insere painel_flag no maximo 1x por conversa.
    //   3) So whatsapp configurado e falhou -> nao grava nada (retry na proxima rodada).
    // No teste (test_number) NAO grava nada — teste nunca queima casos reais.
    let registrados = 0;
    if (!isTest) {
      const now = new Date().toISOString();
      const ids = casos.filter((c) => c.conversa_id).map((c) => c.conversa_id);
      if (ids.length) {
        if (enviados > 0) {
          // Entrega efetivada por WhatsApp.
          const rows = ids.map((id) => ({
            tenant_id: tenant, feedback_conversa_id: id, tipo: 'bom_em_risco',
            canal: 'whatsapp', enviado_em: now, lido: false,
          }));
          const { error: insErr } = await admin.from('feedback_alertas').insert(rows);
          if (!insErr) registrados = rows.length; else results.push({ registro: insErr.message });
        } else if (canais.includes('painel_flag')) {
          const painelEhCanalFinal = !canais.includes('whatsapp');
          // Anti-duplicata: so insere painel_flag para conversas que ainda nao tem.
          const { data: existentes } = await admin.from('feedback_alertas')
            .select('feedback_conversa_id').eq('tenant_id', tenant)
            .eq('canal', 'painel_flag').in('feedback_conversa_id', ids);
          const jaTem = new Set((existentes || []).map((r: any) => r.feedback_conversa_id));
          const rows = ids.filter((id) => !jaTem.has(id)).map((id) => ({
            tenant_id: tenant, feedback_conversa_id: id, tipo: 'bom_em_risco',
            canal: 'painel_flag',
            // painel como canal FINAL queima; painel como fallback de falha nao queima
            enviado_em: painelEhCanalFinal ? now : null,
            lido: false,
          }));
          if (rows.length) {
            const { error: insErr } = await admin.from('feedback_alertas').insert(rows);
            if (!insErr) registrados = rows.length; else results.push({ registro: insErr.message });
          }
          if (!painelEhCanalFinal) results.push({ retry: 'WhatsApp falhou; painel sinalizado sem queimar retry futuro' });
        }
        // else: so whatsapp configurado e falhou -> nada gravado, retry aberto.
      }
    }

    return json({ ok: true, enviados, registrados, total: casos.length, canais, teste: isTest, results });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e), stack: String(e?.stack || '').slice(0, 600) }, 200);
  }
});
