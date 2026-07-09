// deno-lint-ignore-file no-explicit-any
// ============================================================================
// feedback-relatorio-diario-pdf — Relatorio DIARIO simplificado (2 paginas):
//   Pagina 1: "ontem em numeros" + funil dos ultimos 7 dias + o GARGALO
//             (entrada/atendimento/fechamento — onde mais se perde).
//   Pagina 2: por vendedor (frase em PT, sem nota abstrata) + qualidade dos leads.
// Le a RPC feedback_relatorio_diario_dados. Sobe no bucket privado feedback-relatorios.
// verify_jwt=false, guardado por VIEW_KEY. O completo (conversa por conversa) e o
// feedback-relatorio-pdf, usado sob demanda na area de Feedbacks.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { jsPDF } from 'https://esm.sh/jspdf@2.5.1';

const VIEW_KEY = 'icom-7f3a9c2e';
const TENANT_DEFAULT = 'f49fd48a-4386-4009-95f3-26a5100b84f7';

const NAVY = [11, 30, 58], GOLD = [224, 168, 46], INK = [29, 36, 48], MUTED = [107, 116, 130];
const LINE = [230, 233, 239], GREEN = [31, 157, 85], GREEN_BG = [231, 245, 238];
const AMBER = [224, 142, 11], AMBER_BG = [253, 241, 220], RED = [208, 64, 46], RED_BG = [251, 233, 230];
const BLUE = [46, 107, 176], BLUE_BG = [238, 244, 251], WHITE = [255, 255, 255];
const GREY = [154, 163, 178], GREY_BG = [238, 240, 244];

const PW = 595.28, PH = 841.89, ML = 48, CW = PW - 96;

function S(v: any): string {
  let t = String(v ?? '');
  try { t = t.normalize('NFC'); } catch { /* ok */ }
  t = t.replace(/→/g, '->').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, '...').replace(/[–—]/g, '-').replace(/ /g, ' ');
  t = t.replace(/[^\x20-\x7E\xA1-\xFF]/g, '');
  return t.replace(/\s+/g, ' ').trim();
}
const cap = (t: string, n: number) => (t.length > n ? t.slice(0, n - 3).trimEnd() + '...' : t);
const pl = (n: number, s: string, p: string) => (n === 1 ? s : p);
const firstName = (n: string) => (S(n).split(' ')[0] || '');

const DIAS_SEM = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
function dataExtenso(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${DIAS_SEM[d.getUTCDay()]}, ${dd}/${mm}/${d.getUTCFullYear()}`;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return new Response('POST only', { status: 405 });
    const body = await req.json().catch(() => ({}));
    if (body?.k !== VIEW_KEY) return new Response(JSON.stringify({ ok: false, error: 'forbidden' }), { status: 403 });
    const tenant = String(body?.tenant_id || TENANT_DEFAULT);
    const uploadNome = String(body?.upload_nome || 'relatorio-diario.pdf');
    const loja = String(body?.loja || 'Sua loja');
    const dias = Number(body?.dias) || 7;

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data, error } = await admin.rpc('feedback_relatorio_diario_dados', { p_tenant: tenant, p_dias: dias });
    if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 200 });
    const dados: any = data || {};
    const ontem = dados.ontem || {}; const f = dados.funil || {}; const vends: any[] = dados.vendedores || [];
    const refDate = String(dados.ref_date || new Date().toISOString().slice(0, 10));

    // ---------- diagnostico do gargalo ----------
    const cheg = Number(f.chegaram) || 0, qual = Number(f.qualificados) || 0;
    const bem = Number(f.bem_atendidos) || 0, vend = Number(f.vendas) || 0;
    const convE = cheg ? qual / cheg : 0;   // entrada -> interesse
    const convA = qual ? bem / qual : 0;    // interesse -> bem atendido
    const convF = bem ? vend / bem : 0;     // bem atendido -> venda
    let gargalo: 'entrada' | 'atendimento' | 'fechamento' | 'ok' = 'ok';
    if (cheg >= 5 && convE < 0.30) gargalo = 'entrada';
    else if (qual >= 3 && convA < 0.5) gargalo = 'atendimento';
    else if (bem >= 3 && convF < 0.34) gargalo = 'fechamento';
    else if (cheg >= 5 && convE < 0.30) gargalo = 'entrada';
    else gargalo = qual === 0 ? 'entrada' : (bem < qual ? 'atendimento' : (vend === 0 && bem > 0 ? 'fechamento' : 'ok'));

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const F = (c: number[]) => doc.setFillColor(c[0], c[1], c[2]);
    const D = (c: number[]) => doc.setDrawColor(c[0], c[1], c[2]);
    const T = (size: number, style: string, c: number[]) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(c[0], c[1], c[2]); };
    let y = 0;

    function kicker(txt: string, yy: number) {
      T(8.5, 'bold', MUTED);
      doc.text(S(txt).toUpperCase(), ML, yy, { charSpace: 1.3 } as any);
    }
    function wrap(txt: string, x: number, maxW: number, size: number, style: string, c: number[], lh: number): number {
      T(size, style, c);
      const lines = doc.splitTextToSize(S(txt), maxW);
      doc.text(lines, x, y);
      y += lines.length * lh;
      return lines.length;
    }
    function pill(x: number, yy: number, label: string, c: number[], bg: number[]): number {
      T(8, 'bold', c);
      const w = doc.getTextWidth(S(label)) + 16;
      F(bg); doc.roundedRect(x, yy, w, 16, 8, 8, 'F');
      T(8, 'bold', c); doc.text(S(label), x + 8, yy + 11);
      return w;
    }
    function footer(pageLabel: string) {
      D(LINE); doc.setLineWidth(0.7); doc.line(ML, PH - 42, PW - 48, PH - 42);
      T(7.5, 'bold', NAVY); doc.text('LOGOS IA', ML, PH - 30);
      const bw = doc.getTextWidth('LOGOS IA');
      T(7.5, 'normal', MUTED); doc.text(` · ${pageLabel}`, ML + bw, PH - 30);
    }

    // ======================= PAGINA 1 =======================
    // Header band
    F(NAVY); doc.rect(0, 0, PW, 104, 'F');
    T(9, 'bold', GOLD); doc.text('LOGOS IA', ML, 40, { charSpace: 2.6 } as any);
    doc.setFont('times', 'bold'); doc.setFontSize(26); doc.setTextColor(WHITE[0], WHITE[1], WHITE[2]);
    doc.text('Como foi ontem', ML, 72);
    T(9.5, 'normal', [195, 203, 219]); doc.text(`${S(loja)} · ${dataExtenso(refDate)}`, ML, 92);
    // tag
    T(8.5, 'bold', NAVY); const tagW = doc.getTextWidth('Relatorio diario') + 20;
    F(GOLD); doc.roundedRect(PW - 48 - tagW, 30, tagW, 20, 10, 10, 'F');
    T(8.5, 'bold', NAVY); doc.text('Relatorio diario', PW - 48 - tagW + 10, 43);
    F(GOLD); doc.rect(0, 104, 210, 4, 'F');

    // Ontem em numeros — 4 tiles
    y = 134; kicker('Ontem em números', y); y += 16;
    const tiles = [
      { n: ontem.chegaram ?? 0, l: 'clientes chegaram', c: NAVY },
      { n: ontem.qualificados ?? 0, l: 'com interesse real de compra', c: BLUE },
      { n: ontem.bem_atendidos ?? 0, l: pl(ontem.bem_atendidos ?? 0, 'bem atendido', 'bem atendidos'), c: AMBER },
      { n: ontem.vendas ?? 0, l: pl(ontem.vendas ?? 0, 'venda', 'vendas'), c: (ontem.vendas ?? 0) > 0 ? GREEN : RED },
    ];
    const tw = (CW - 33) / 4;
    tiles.forEach((t, i) => {
      const tx = ML + i * (tw + 11);
      F(WHITE); D(LINE); doc.setLineWidth(0.8); doc.roundedRect(tx, y, tw, 62, 8, 8, 'FD');
      T(25, 'bold', t.c); doc.text(String(t.n), tx + 13, y + 30);
      T(8, 'normal', MUTED);
      const ll = doc.splitTextToSize(t.l, tw - 20);
      doc.text(ll, tx + 13, y + 45);
    });
    y += 62 + 24;

    // Funil
    kicker('O funil dos últimos 7 dias — onde os clientes escapam', y); y += 18;
    const stages = [
      { nm: 'Chegaram', sub: 'todos os leads', n: cheg, w: 1, c: NAVY },
      { nm: 'Interesse real', sub: 'querem mesmo comprar', n: qual, w: cheg ? Math.max(qual / cheg, 0.12) : 0.12, c: BLUE },
      { nm: 'Bem atendidos', sub: 'vendedor foi bem', n: bem, w: cheg ? Math.max(bem / cheg, 0.08) : 0.08, c: AMBER },
      { nm: 'Venderam', sub: 'negócio fechado', n: vend, w: cheg ? Math.max(vend / cheg, 0.05) : 0.05, c: vend > 0 ? GREEN : GREY },
    ];
    const trackX = ML + 150, trackW = CW - 150 - 60;
    const drops = [
      { txt: `só ${qual} ${pl(qual, 'segue', 'seguem')} — ${cheg ? Math.round(convE * 100) : 0}% do total`, stage: 'entrada' },
      { txt: `${bem} de ${qual} bem ${pl(bem, 'atendido', 'atendidos')}`, stage: 'atendimento' },
      { txt: vend > 0 ? `${vend} ${pl(vend, 'venda', 'vendas')}` : 'nenhum fechou ainda', stage: 'fechamento' },
    ];
    stages.forEach((st, i) => {
      const barH = 30;
      // label
      T(12.5, 'bold', INK); doc.text(st.nm, ML, y + 15);
      T(8.5, 'normal', MUTED); doc.text(S(st.sub), ML, y + 26);
      // track + bar
      F([241, 243, 247]); doc.roundedRect(trackX, y, trackW, barH, 5, 5, 'F');
      const bw = Math.max(trackW * st.w, 42);
      F(st.c); doc.roundedRect(trackX, y, bw, barH, 5, 5, 'F');
      T(13, 'bold', st.n === 0 && st.c === GREY ? MUTED : WHITE); doc.text(String(st.n), trackX + 11, y + 20);
      // num column
      T(18, 'bold', INK); doc.text(String(st.n), PW - 48, y + 15, { align: 'right' });
      T(8.5, 'normal', MUTED);
      const pct = cheg ? Math.round((st.n / cheg) * 100) : 0;
      doc.text(i === 0 ? '100%' : `${pct}% do total`, PW - 48, y + 27, { align: 'right' });
      y += barH + 6;
      // drop connector
      if (i < 3) {
        const dp = drops[i];
        const isGarg = dp.stage === gargalo;
        const dc = isGarg ? RED : (i === 0 ? AMBER : MUTED);
        T(8, 'bold', GREY); doc.text('v', trackX, y + 8);
        T(9.5, isGarg ? 'bold' : 'normal', dc);
        doc.text(S(dp.txt), trackX + 12, y + 9);
        if (isGarg) { const w = doc.getTextWidth(S(dp.txt)); const tagx = trackX + 12 + w + 8; pill(tagx, y, 'maior vazamento', RED, RED_BG); }
        y += 18;
      }
    });
    y += 8;

    // Gargalo box
    const G: Record<string, any> = {
      entrada: {
        c: RED, bg: RED_BG, titulo: 'O gargalo está na ENTRADA (qualidade do lead)',
        corpo: `De cada 100 pessoas que o anúncio traz, só ~${cheg ? Math.round(convE * 100) : 0} têm interesse real de compra — o resto some depois de um "oi" ou nem responde. É aí que mais se perde. Antes de cobrar fechamento do vendedor, o ponto é o tráfego (José): o anúncio está atraindo muito curioso.`,
        on: 'entrada',
      },
      atendimento: {
        c: AMBER, bg: AMBER_BG, titulo: 'O gargalo está no ATENDIMENTO',
        corpo: `Os leads bons até chegam, mas se perdem no atendimento: dos ${qual} com interesse real, só ${bem} ${pl(bem, 'foi', 'foram')} bem ${pl(bem, 'atendido', 'atendidos')}. O ponto agora é treinar os vendedores — resposta rápida, qualificação e puxar a visita.`,
        on: 'atendimento',
      },
      fechamento: {
        c: BLUE, bg: BLUE_BG, titulo: 'O gargalo está no FECHAMENTO',
        corpo: `Os clientes chegam bons e são bem atendidos, mas não fecham: ${bem} bem ${pl(bem, 'atendido', 'atendidos')} e ${vend} ${pl(vend, 'venda', 'vendas')}. O foco é técnica de fechamento — proposta clara, senso de urgência e retorno.`,
        on: 'fechamento',
      },
      ok: {
        c: GREEN, bg: GREEN_BG, titulo: 'Funil saudável',
        corpo: 'Os clientes estão avançando bem em cada etapa. Siga acompanhando o ritmo e mantendo a resposta rápida.',
        on: '',
      },
    };
    const g = G[gargalo];
    T(9.5, 'normal', INK);
    const corpoLines = doc.splitTextToSize(S(g.corpo), CW - 40);
    const boxH = 30 + corpoLines.length * 13 + 34;
    F(g.bg); D(g.c === GREEN ? GREEN : g.c); doc.setLineWidth(0.8);
    doc.roundedRect(ML, y, CW, boxH, 10, 10, 'FD');
    F(g.c); doc.circle(ML + 18, y + 20, 5, 'F');
    T(13.5, 'bold', g.c); doc.text(S(g.titulo), ML + 30, y + 24);
    T(9.5, 'normal', INK); doc.text(corpoLines, ML + 20, y + 42);
    // chips
    let chx = ML + 20; const chy = y + boxH - 24;
    const chips = [
      { k: 'entrada', label: 'Entrada / lead' },
      { k: 'atendimento', label: 'Atendimento' },
      { k: 'fechamento', label: 'Fechamento' },
    ];
    for (const ch of chips) {
      const on = ch.k === g.on;
      T(8.5, 'bold', on ? g.c : GREY);
      const w = doc.getTextWidth(S(ch.label)) + 22;
      F(WHITE); D(on ? g.c : LINE); doc.setLineWidth(on ? 1.3 : 0.8);
      doc.roundedRect(chx, chy, w, 18, 6, 6, 'FD');
      F(on ? g.c : [205, 211, 221]); doc.circle(chx + 9, chy + 9, 3.4, 'F');
      T(8.5, 'bold', on ? g.c : GREY); doc.text(S(ch.label), chx + 16, chy + 12);
      chx += w + 8;
    }
    footer('relatório diário automático · página 1 de 2');

    // ======================= PAGINA 2 =======================
    doc.addPage(); y = 56;
    kicker('Seus vendedores · últimos 7 dias', y); y += 18;

    // classifica vendedores
    const clas = vends.map((v) => {
      const rec = Number(v.recebeu) || 0, ci = Number(v.com_interesse) || 0;
      const ba = Number(v.bem_atendidos) || 0, vd = Number(v.vendas) || 0, sc = Number(v.score_medio) || 0;
      let st: string, badge: string, frase: string, dot: number[], bc: number[], bg: number[];
      if (vd > 0) {
        st = 'vendeu'; badge = 'Vendeu'; dot = GREEN; bc = GREEN; bg = GREEN_BG;
        frase = `Fechou ${vd} ${pl(vd, 'venda', 'vendas')} ${pl(vd, 'esse', 'essas')} semana. Parabéns.`;
      } else if (ci > 0 && ba < ci) {
        st = 'perdeu'; badge = 'Perdeu chance boa'; dot = RED; bc = RED; bg = RED_BG;
        frase = `Teve ${ci} ${pl(ci, 'cliente', 'clientes')} com interesse real, ${ba === 0 ? 'não atendeu bem nenhum deles' : `atendeu bem só ${ba}`} e não fechou. Vale ouvir as conversas dele.`;
      } else if (ci > 0) {
        st = 'atendeu'; badge = 'Atendeu bem'; dot = AMBER; bc = AMBER; bg = AMBER_BG;
        frase = `Atendeu bem ${ci === 1 ? 'o cliente' : `os ${ci} clientes`} com interesse, mas ainda sem fechar.`;
      } else {
        st = 'sem_lead'; badge = 'Sem lead bom'; dot = GREY; bc = MUTED; bg = GREY_BG;
        frase = sc >= 50 && rec > 0
          ? `Recebeu ${rec} ${pl(rec, 'cliente', 'clientes')} e atendeu bem, mas ${pl(rec, 'não era', 'nenhum era')} comprador de verdade.`
          : `Recebeu ${rec} ${pl(rec, 'cliente', 'clientes')} — ${rec === 1 ? 'não tinha' : 'nenhum com'} interesse real de compra.`;
      }
      const prio = st === 'vendeu' ? 0 : st === 'perdeu' ? 1 : st === 'atendeu' ? 2 : 3;
      return { v, st, badge, frase, dot, bc, bg, prio, rec, ci };
    }).sort((a, b) => (a.prio - b.prio) || (b.rec - a.rec));

    // resumo — muda conforme quantos vendedores pegaram lead bom
    const comChance = clas.filter((c) => c.ci > 0);
    const bemN = clas.filter((c) => (Number(c.v.bem_atendidos) || 0) > 0).length;
    let resumo: string;
    if (!clas.length) resumo = 'Ainda sem atendimentos analisados nesta janela.';
    else if (comChance.length === 0)
      resumo = 'Nenhum vendedor pegou cliente com interesse real de compra esta semana. Os leads que chegaram foram fracos — o foco é melhorar o lead que chega, não cobrar venda deles.';
    else if (comChance.length >= Math.ceil(clas.length / 2))
      resumo = `A maioria dos vendedores recebeu clientes com interesse real de compra esta semana, mas só ${bemN} ${pl(bemN, 'foi', 'foram')} bem ${pl(bemN, 'atendido', 'atendidos')}. O problema não é o lead — é o atendimento. Foco em resposta rápida, qualificação e puxar a visita.`;
    else {
      const nomes = comChance.map((c) => firstName(c.v.nome)).join(', ').replace(/, ([^,]*)$/, ' e $1');
      resumo = `Esta semana ${comChance.length === 1 ? 'só o' : 'apenas'} ${nomes} ${pl(comChance.length, 'pegou', 'pegaram')} cliente com interesse real de compra. Os outros receberam leads fracos — o foco é melhorar o lead que chega.`;
    }
    T(9.5, 'normal', INK);
    const rLines = doc.splitTextToSize(S(resumo), CW - 30);
    const rH = 14 + rLines.length * 13 + 8;
    F(BLUE_BG); doc.roundedRect(ML, y, CW, rH, 8, 8, 'F');
    F(BLUE); doc.rect(ML, y + 6, 3.2, rH - 12, 'F');
    T(9.5, 'normal', [42, 53, 71]); doc.text(rLines, ML + 15, y + 18);
    y += rH + 10;

    // rows (max 7)
    const show = clas.slice(0, 7);
    for (const c of show) {
      T(9, 'normal', MUTED);
      const fLines = doc.splitTextToSize(S(c.frase), CW - 40);
      const rowH = Math.max(34, 18 + fLines.length * 12);
      F(c.dot); doc.circle(ML + 5, y + 6, 5, 'F');
      T(13.5, 'bold', INK); doc.text(cap(S(c.v.nome), 26), ML + 18, y + 9);
      const nmW = doc.getTextWidth(cap(S(c.v.nome), 26));
      pill(ML + 18 + nmW + 10, y - 3, c.badge, c.bc, c.bg);
      T(9.5, 'normal', [90, 100, 116]); doc.text(fLines, ML + 18, y + 24);
      y += rowH;
      D(LINE); doc.setLineWidth(0.6); doc.line(ML, y, ML + CW, y);
      y += 8;
    }
    if (clas.length > 7) { T(8.5, 'normal', MUTED); doc.text(`e mais ${clas.length - 7} ${pl(clas.length - 7, 'vendedor', 'vendedores')}.`, ML + 18, y + 4); y += 16; }
    y += 12;

    // Qualidade
    kicker('A qualidade de quem chegou · 7 dias', y); y += 16;
    const segs = [
      { n: qual, c: GREEN, lab: `${qual} com interesse real` },
      { n: Number(f.dificeis) || 0, c: AMBER, lab: `${Number(f.dificeis) || 0} ${pl(Number(f.dificeis) || 0, 'difícil', 'difíceis')}` },
      { n: Number(f.nao_eram) || 0, c: RED, lab: `${Number(f.nao_eram) || 0} não ${pl(Number(f.nao_eram) || 0, 'era cliente', 'eram cliente')}` },
      { n: Number(f.sem_dados) || 0, c: GREY, lab: `${Number(f.sem_dados) || 0} conversa fraca (sumiu cedo)` },
    ];
    const total = Math.max(cheg, 1);
    let bx = ML; const barW = CW, barH = 30;
    D(LINE); doc.setLineWidth(0.8); doc.roundedRect(ML, y, barW, barH, 7, 7, 'S');
    segs.forEach((s) => {
      const w = (s.n / total) * barW;
      if (w <= 0) return;
      F(s.c); doc.rect(bx, y + 1, w, barH - 2, 'F');
      if (w > 26) { T(11, 'bold', WHITE); doc.text(String(s.n), bx + 6, y + 20); }
      bx += w;
    });
    y += barH + 16;
    // legenda 2x2
    const half = CW / 2;
    segs.forEach((s, i) => {
      const lx = ML + (i % 2) * half, ly = y + Math.floor(i / 2) * 20;
      F(s.c); doc.roundedRect(lx, ly - 8, 11, 11, 3, 3, 'F');
      T(9.5, 'normal', [75, 85, 99]); doc.text(S(s.lab), lx + 17, ly + 1);
    });
    y += 46;

    // rodape com CTA pro completo
    F(NAVY); doc.roundedRect(ML, y, CW, 34, 8, 8, 'F');
    T(9.5, 'bold', WHITE); doc.text('Relatório completo, conversa por conversa e por vendedor:', ML + 15, y + 15);
    T(9, 'normal', GOLD); doc.text('na área de Feedbacks da plataforma Logos.', ML + 15, y + 27);
    footer('relatório diário automático · página 2 de 2');

    const ab = doc.output('arraybuffer') as ArrayBuffer;
    const bytes = new Uint8Array(ab);
    const up = await admin.storage.from('feedback-relatorios')
      .upload(uploadNome, new Blob([bytes], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf' } as any);
    if ((up as any).error) return new Response(JSON.stringify({ ok: false, error: (up as any).error.message }), { status: 200 });

    return new Response(JSON.stringify({ ok: true, arquivo: uploadNome, paginas: 2, gargalo, bytes: bytes.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e), stack: String(e?.stack || '').slice(0, 1500) }), { status: 200 });
  }
});
