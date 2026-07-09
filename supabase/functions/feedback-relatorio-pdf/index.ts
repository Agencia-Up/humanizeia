// deno-lint-ignore-file no-explicit-any
// ============================================================================
// feedback-relatorio-pdf — Relatório do gerente em PDF. v8: capa de jornal na
// página 1 (resumo completo + referência de páginas), detalhe nas páginas 2+.
// NOTA: snapshot de produção (v9) resgatado para versionamento. verify_jwt=false,
// guardado por VIEW_KEY. Diff-verificar antes de qualquer redeploy.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { jsPDF } from 'https://esm.sh/jspdf@2.5.1';

const VIEW_KEY = 'icom-7f3a9c2e';
const TENANT_DEFAULT = 'f49fd48a-4386-4009-95f3-26a5100b84f7';

const NAVY = [11, 30, 58], GOLD = [198, 161, 91], INK = [29, 36, 48], MUTED = [107, 116, 130];
const LINE = [230, 233, 239], GREEN = [31, 157, 85], GREEN_BG = [232, 246, 238];
const AMBER = [224, 142, 11], AMBER_BG = [253, 244, 227], RED = [208, 64, 46], RED_BG = [252, 236, 234];
const BLUE = [46, 107, 176], BLUE_BG = [238, 244, 251], WHITE = [255, 255, 255];
const WA_BG = [234, 230, 223], WA_OUT = [217, 253, 211], IA_OUT = [222, 235, 247];
const CHIP_BG = [242, 205, 199], NOTE_BG = [255, 245, 204], NOTE_BD = [240, 220, 178], NOTE_TIT = [165, 48, 31];
const SUB = [203, 210, 222];

const PW = 595.28, ML = 48, CW = PW - 96, FOOT = 792;

function S(v: any): string {
  let t = String(v ?? '');
  try { t = t.normalize('NFC'); } catch { /* ok */ }
  t = t.replace(/→/g, '->').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, '...').replace(/[–—]/g, '-').replace(/ /g, ' ');
  t = t.replace(/[^\x20-\x7E\xA1-\xFF]/g, '');
  return t.replace(/\s+/g, ' ').trim();
}
const maskCpf = (t: string) => t.replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, '***.***.***-**');
const cap = (t: string, n: number) => (t.length > n ? t.slice(0, n - 3).trimEnd() + '...' : t);
function fmtMin(mRaw: number): string {
  const m = Math.round(mRaw);
  if (m >= 2880) return `${Math.round(m / 1440)} dias`; // acima de 48h fala em dias, nao "350 horas"
  if (m >= 60) { const h = Math.floor(m / 60), mm = m % 60; return mm ? `${h}h${String(mm).padStart(2, '0')}` : `${h}h`; }
  return `${m} min`;
}
function hhmm(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 3600e3);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function ddmm(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 3600e3);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function fone(jid: string): string {
  const d = (jid || '').split('@')[0].replace(/\D/g, '');
  const n = d.startsWith('55') ? d.slice(2) : d;
  if (n.length >= 10) return `(${n.slice(0, 2)}) ${n.slice(2, n.length - 4)}-${n.slice(-4)}`;
  return n || '';
}
function modeloCurto(vi: any, words = 3): string {
  let m = S(vi || '').split(' ').slice(0, words).join(' ');
  if ((m.match(/\(/g) || []).length !== (m.match(/\)/g) || []).length) m = m.split('(')[0].trim();
  return m.replace(/[\-,;:.]+$/, '').trim();
}
const firstName = (n: string) => (S(n).split(' ')[0] || '');
const nomeGenerico = (n: string) => !n || /^\(?sem/i.test(n) || /^lead$/i.test(n.trim());

const VENDA_RE = /(acabei de fechar|fechei neg[o\xf3]cio|fechamos neg[o\xf3]cio|j[a\xe1] comprei|acabei de comprar|neg[o\xf3]cio fechado)/i;
const RUIM_RE = /(n[a\xe3]o vai trocar|n[a\xe3]o vamos trocar|s[o\xf3] especulando|s[o\xf3] curiosidade|sem inten[c\xe7][a\xe3]o de comprar|n[a\xe3]o vou comprar)/i;

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return new Response('POST only', { status: 405 });
    const body = await req.json().catch(() => ({}));
    if (body?.k !== VIEW_KEY) return new Response(JSON.stringify({ ok: false, error: 'forbidden' }), { status: 403 });
    const tenant = String(body?.tenant_id || TENANT_DEFAULT);
    const uploadNome = String(body?.upload_nome || 'icom-julho-teste.pdf');
    const loja = String(body?.loja || 'Icom Motors');
    const periodoLabel = String(body?.periodo_label || 'Julho de 2026 (até domingo, dia 06)');

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: rows, error } = await admin.rpc('feedback_relatorio_dados', { p_tenant: tenant });
    if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 200 });
    const leadsRaw: any[] = Array.isArray(rows) ? rows : [];
    if (!leadsRaw.length) return new Response(JSON.stringify({ ok: false, error: 'sem dados' }), { status: 200 });

    const leads = leadsRaw.map((l) => {
      const inc = String(l.incoming_txt || '');
      const venda = l.houve_venda === 'true' || VENDA_RE.test(inc);
      const ruim = RUIM_RE.test(inc);
      const q = l.qualidade_lead;
      let pot = q === '1_alto' ? 'forte' : q === '2_medio' ? 'bom' : q === '3_baixo' ? 'dificil' : q === '4_nao_lead' ? 'nao' : '';
      // Regua do especialista (potencial_compra, exige sinal concreto de compra).
      if (!pot) {
        const pc = String(l.potencial_compra || '').toLowerCase();
        pot = pc === 'alto' ? 'forte' : pc === 'medio' ? 'bom' : pc === 'baixo' ? 'dificil' : pc === 'nao_lead' ? 'nao' : '';
      }
      // Temperatura do Pedro so quando explicita. SEM evidencia => 'sem'
      // (antes caia em 'bom' por padrao — lead virava "bom" so por responder).
      if (!pot) { const t = String(l.temperature || '').toLowerCase(); pot = t === 'quente' ? 'bom' : t === 'frio' ? 'dificil' : 'sem'; }
      if (ruim) pot = 'nao';
      const score = Number(l.score) || 0;
      const msgs = Array.isArray(l.ultimas_msgs) ? l.ultimas_msgs : [];
      const tempo = Number(l.tempo_resposta_min) || 0;
      return { ...l, venda, ruim, pot, score, msgs, tempo, nome: S(l.lead_name) || '(sem nome)', vend: S(l.vendedor_nome) || '(sem vendedor)' };
    });

    const byVend = new Map<string, any>();
    for (const l of leads) {
      const g = byVend.get(l.vend) || { nome: l.vend, leads: [] };
      g.leads.push(l); byVend.set(l.vend, g);
    }
    const vends: any[] = [];
    for (const g of byVend.values()) {
      const n = g.leads.length;
      const avg = Math.round(g.leads.reduce((s: number, l: any) => s + l.score, 0) / n);
      const vendas = g.leads.filter((l: any) => l.venda).length;
      const semResp = g.leads.filter((l: any) => !l.tem_outgoing).length;
      const bonsPerd = g.leads.filter((l: any) => !l.venda && (l.pot === 'bom' || l.pot === 'forte') && l.score < 45).length;
      let status: any;
      if (vendas > 0) status = { label: 'Fechou venda', c: GREEN, bg: GREEN_BG, tier: 2 };
      else if (avg >= 65) status = { label: 'Ótimo atendimento', c: GREEN, bg: GREEN_BG, tier: 2 };
      else if (avg >= 40) status = { label: 'Pode melhorar', c: AMBER, bg: AMBER_BG, tier: 1 };
      else status = { label: 'Precisa de atenção', c: RED, bg: RED_BG, tier: 0 };
      vends.push({ ...g, n, avg, vendas, semResp, bonsPerd, status });
    }
    vends.sort((a, b) => (a.status.tier - b.status.tier) || (a.avg - b.avg));
    const reds = vends.filter((v) => v.status.tier === 0);
    const destaque = vends.find((v) => v.vendas > 0) || [...vends].sort((a, b) => b.avg - a.avg)[0];

    const nLeads = leads.length;
    const nNao = leads.filter((l) => l.pot === 'nao').length;
    const nVendas = leads.filter((l) => l.venda).length;
    const nPerfil = leads.filter((l) => l.pot === 'forte' || l.pot === 'bom').length;
    const nSem = nLeads - nPerfil;

    const QUAL: Record<string, any> = {
      forte: { label: 'Lead forte', c: GREEN, bg: GREEN_BG },
      bom: { label: 'Lead bom', c: BLUE, bg: BLUE_BG },
      dificil: { label: 'Lead difícil', c: AMBER, bg: AMBER_BG },
      nao: { label: 'Não era lead', c: RED, bg: RED_BG },
      sem: { label: 'Sem dados', c: MUTED, bg: [240, 242, 245] },
    };

    const byAd = new Map<string, any>();
    for (const l of leads) {
      const k = S(l.ad_name || l.campaign_name || '') || '(sem origem identificada)';
      const g = byAd.get(k) || { nome: k, n: 0, fortes: 0, bons: 0, difs: 0, nao: 0, modelos: new Set<string>() };
      g.n++;
      if (l.pot === 'forte') g.fortes++; else if (l.pot === 'bom') g.bons++;
      else if (l.pot === 'dificil') g.difs++; else if (l.pot === 'nao') g.nao++;
      const mod = modeloCurto(l.vehicle_interest, 2);
      if (mod) g.modelos.add(mod);
      byAd.set(k, g);
    }

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    let y = 0;
    const F = (c: number[]) => doc.setFillColor(c[0], c[1], c[2]);
    const D = (c: number[]) => doc.setDrawColor(c[0], c[1], c[2]);
    const T = (size: number, style: string, c: number[]) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(c[0], c[1], c[2]); };
    const pageBreak = (need: number) => { if (y + need > FOOT) { doc.addPage(); y = 60; } };

    function rich(x: number, maxW: number, segs: { t: string; b?: boolean; c?: number[] }[], size: number, lh: number): void {
      let cx = x;
      for (const sg of segs) {
        const words = S(sg.t).split(' ').filter(Boolean);
        for (const wRaw of words) {
          const word = wRaw + ' ';
          T(size, sg.b ? 'bold' : 'normal', sg.c || INK);
          const w = doc.getTextWidth(word);
          if (cx + w > x + maxW) { y += lh; cx = x; }
          doc.text(word, cx, y);
          cx += w;
        }
      }
      y += lh;
    }

    function letterHead(txt: string) {
      T(8, 'bold', MUTED);
      doc.text(txt.toUpperCase(), ML, y, { charSpace: 1.4 } as any);
      y += 16;
    }

    function pill(x: number, yy: number, label: string, c: number[], bg: number[]): number {
      T(8.5, 'bold', c);
      const w = doc.getTextWidth(label) + 18;
      F(bg); doc.roundedRect(x, yy, w, 17, 8.5, 8.5, 'F');
      T(8.5, 'bold', c); doc.text(label, x + 9, yy + 11.5);
      return w;
    }

    function calloutBox(title: string, bodyTxt: string, c: number[], bg: number[], leftBar = false, italic = false) {
      T(9.5, italic ? 'italic' : 'normal', INK);
      const lines = doc.splitTextToSize(S(bodyTxt), CW - 30);
      const h = 24 + lines.length * 12 + 10;
      pageBreak(h + 10);
      F(bg); doc.roundedRect(ML, y, CW, h, 7, 7, 'F');
      if (leftBar) { F(c); doc.rect(ML, y + 6, 3.2, h - 12, 'F'); }
      T(10.5, 'bold', c); doc.text(S(title), ML + 15, y + 18);
      T(9.5, italic ? 'italic' : 'normal', INK); doc.text(lines, ML + 15, y + 33);
      y += h + 11;
    }

    const iconOk = (cx: number, cy: number) => {
      F(GREEN); doc.circle(cx, cy, 5, 'F');
      D(WHITE); doc.setLineWidth(1.2); (doc as any).setLineCap('round');
      doc.line(cx - 2.1, cy + 0.2, cx - 0.7, cy + 1.8); doc.line(cx - 0.7, cy + 1.8, cx + 2.4, cy - 1.9);
    };
    const iconNo = (cx: number, cy: number) => {
      F(RED); doc.circle(cx, cy, 5, 'F');
      D(WHITE); doc.setLineWidth(1.2); (doc as any).setLineCap('round');
      doc.line(cx - 1.9, cy - 1.9, cx + 1.9, cy + 1.9); doc.line(cx + 1.9, cy - 1.9, cx - 1.9, cy + 1.9);
    };

    function bubbleText(m: any): string {
      if (m._run && m._n > 1) return m._mixed ? `(${m._n} arquivos)` : `(${m._n} fotos)`;
      const mt = String(m.message_type || 'text');
      if (mt === 'audio') return m.transcricao ? `Áudio: "${cap(S(m.transcricao), 220)}"` : '(áudio antigo, sem gravação)';
      if (mt === 'image') return '(foto)';
      if (mt === 'video') return '(vídeo)';
      if (mt === 'document') return '(documento)';
      let c = S(m.content || '');
      if (/^\[/.test(c) && /recebid/.test(c)) return '(mídia)';
      if (/^https?:\/\//i.test(c)) return cap(c, 70);
      return cap(maskCpf(c), 190) || '(mídia)';
    }

    function chatCard(lead: any): boolean {
      const isMedia = (x: string) => ['image', 'video', 'document', 'sticker'].includes(x);
      const collapsed: any[] = [];
      for (const m of (lead.msgs || [])) {
        const prev = collapsed[collapsed.length - 1];
        if (prev && prev._run && prev.direction === m.direction && isMedia(String(m.message_type))) {
          prev._n++; if (String(m.message_type) !== 'image') prev._mixed = true; prev.created_at = m.created_at; continue;
        }
        if (isMedia(String(m.message_type))) collapsed.push({ ...m, _run: true, _n: 1, _mixed: String(m.message_type) !== 'image' });
        else collapsed.push({ ...m });
      }
      let msgs = collapsed.slice(-8);
      if (!msgs.length) return false;
      const maxBW = CW * 0.66;
      const vendFirst = firstName(lead.vend) || 'Vendedor';

      const build = (list: any[]) => {
        const items: any[] = [];
        let h = 26 + 12;
        let chipDone = false;
        for (let i = 0; i < list.length; i++) {
          const m = list[i];
          if (!chipDone && m.direction === 'outgoing' && i > 0 && list[i - 1].direction === 'incoming') {
            const gap = (new Date(m.created_at).getTime() - new Date(list[i - 1].created_at).getTime()) / 60000;
            if (gap >= 45) { items.push({ chip: `o cliente esperou ${fmtMin(gap)} pela resposta` }); h += 24; chipDone = true; }
          }
          const txt = bubbleText(m);
          T(9, 'normal', INK);
          const lines = doc.splitTextToSize(txt, maxBW - 20);
          const tw = Math.max(...lines.map((ln: string) => doc.getTextWidth(ln)), 46);
          const bw = Math.min(maxBW, Math.max(tw + 22, 78));
          const bh = 13 + lines.length * 10.5 + 13;
          items.push({ m, lines, bw, bh });
          h += bh + 7;
        }
        const last = list[list.length - 1];
        let note: string[] | null = null;
        if (last && last.direction === 'incoming' && !lead.venda && lead.pot !== 'nao') {
          const hint = lead.oportunidades_perdidas?.[0]?.texto ? cap(S(lead.oportunidades_perdidas[0].texto), 110) : 'era o momento de responder e puxar a venda.';
          T(8.8, 'normal', INK);
          note = doc.splitTextToSize('Aqui o cliente ficou sem resposta. ' + hint, CW - 130);
          h += note.length * 11 + 24;
        }
        h += 10;
        return { items, h, note };
      };

      let plan = build(msgs);
      while (plan.h > 620 && msgs.length > 2) { msgs = msgs.slice(1); plan = build(msgs); }
      pageBreak(plan.h + 8);

      const x0 = ML, w0 = CW, y0 = y;
      F(WA_BG); D(LINE); doc.setLineWidth(0.8);
      doc.roundedRect(x0, y0, w0, plan.h, 8, 8, 'FD');
      F(NAVY); doc.roundedRect(x0, y0, w0, 26, 8, 8, 'F'); doc.rect(x0, y0 + 13, w0, 13, 'F');
      T(9.5, 'bold', WHITE);
      const interesse = modeloCurto(lead.vehicle_interest, 3);
      doc.text(`Conversa com o cliente${interesse ? ` (${cap(interesse, 28)})` : ''}`, x0 + 12, y0 + 17);
      T(9, 'bold', GOLD);
      doc.text(ddmm(msgs[msgs.length - 1]?.created_at || lead.lead_created_at || new Date().toISOString()), x0 + w0 - 12, y0 + 17, { align: 'right' });

      let cy = y0 + 26 + 12;
      for (const it of plan.items) {
        if (it.chip) {
          T(7.5, 'bold', RED);
          const cwid = doc.getTextWidth(it.chip) + 18;
          F(CHIP_BG); doc.roundedRect(x0 + (w0 - cwid) / 2, cy, cwid, 15, 7.5, 7.5, 'F');
          T(7.5, 'bold', RED); doc.text(it.chip, x0 + (w0 - cwid) / 2 + 9, cy + 10.5);
          cy += 24; continue;
        }
        const m = it.m; const isIn = m.direction === 'incoming';
        const bx = isIn ? x0 + 12 : x0 + w0 - 12 - it.bw;
        if (isIn) { F(WHITE); D(LINE); doc.roundedRect(bx, cy, it.bw, it.bh, 6, 6, 'FD'); }
        else { F(m.from_ia ? IA_OUT : WA_OUT); doc.roundedRect(bx, cy, it.bw, it.bh, 6, 6, 'F'); }
        T(7.5, 'bold', isIn ? BLUE : (m.from_ia ? MUTED : [21, 128, 61]));
        doc.text(isIn ? 'Cliente' : (m.from_ia ? 'Assistente' : vendFirst), bx + 9, cy + 11);
        T(9, 'normal', INK); doc.text(it.lines, bx + 9, cy + 23);
        T(6.8, 'normal', MUTED); doc.text(hhmm(m.created_at), bx + it.bw - 7, cy + it.bh - 5.5, { align: 'right' });
        cy += it.bh + 7;
      }
      if (plan.note) {
        const nw = CW - 100, nx = x0 + 50;
        const nh = plan.note.length * 11 + 18;
        F(NOTE_BG); D(NOTE_BD); doc.setLineWidth(1); (doc as any).setLineDashPattern([2.5, 2], 0);
        doc.roundedRect(nx, cy, nw, nh, 5, 5, 'FD');
        (doc as any).setLineDashPattern([], 0);
        T(8.8, 'bold', NOTE_TIT); doc.text('X', nx + 10, cy + 13);
        T(8.8, 'normal', INK); doc.text(plan.note, nx + 22, cy + 13);
      }
      y = y0 + plan.h + 14;
      return true;
    }

    function leadCard(l: any) {
      pageBreak(130);
      const nomeL = nomeGenerico(l.nome) ? 'Cliente' : cap(S(l.nome), 26);
      T(11.5, 'bold', INK); doc.text(nomeL, ML, y);
      let px = ML + doc.getTextWidth(nomeL) + 10;
      const qp = QUAL[l.pot] || QUAL.bom;
      px += pill(px, y - 12, qp.label, qp.c, qp.bg) + 6;
      if (l.venda) px += pill(px, y - 12, 'Venda', GREEN, GREEN_BG) + 6;
      const modelo = modeloCurto(l.vehicle_interest, 3);
      if (modelo) { T(8.5, 'normal', MUTED); doc.text(cap(modelo, 32), ML + CW, y, { align: 'right' }); }
      y += 14;
      T(8.5, 'normal', MUTED);
      const tel = fone(l.remote_jid || '');
      doc.text(`Campanha: ${cap(S(l.ad_name || l.campaign_name || 'sem origem identificada'), 58)}${tel ? `  ·  ${tel}` : ''}`, ML, y);
      y += 14;
      const drew = chatCard(l);
      if (!drew) {
        // Honestidade: vendedor com numero DESCONECTADO pode ter respondido pelo
        // celular sem a plataforma enxergar — nao afirmar que ele nao respondeu.
        const semAcompanhamento = l.instancia_conectada === false;
        const txtVazio = semAcompanhamento
          ? 'O número deste vendedor está desconectado da plataforma — a conversa com este cliente não pôde ser acompanhada.'
          : 'O cliente chamou e a conversa ficou sem nenhuma resposta do vendedor.';
        T(9.5, 'normal', INK);
        const bl = doc.splitTextToSize(txtVazio, CW - 30);
        const h = 16 + bl.length * 12 + 10;
        pageBreak(h + 8);
        F(semAcompanhamento ? AMBER_BG : RED_BG); doc.roundedRect(ML, y, CW, h, 7, 7, 'F');
        T(9.5, 'normal', INK); doc.text(bl, ML + 15, y + 17);
        y += h + 12;
      }
      if (!l.venda && l.score < 45 && (l.pot === 'bom' || l.pot === 'forte') && l.frase_coaching) {
        calloutBox(`O que conversar com ${firstName(l.vend) || 'o vendedor'}`, `"${cap(S(maskCpf(l.frase_coaching)), 380)}"`, BLUE, BLUE_BG, true, true);
      }
      y += 6;
    }

    // ================= PÁGINAS 2+ (detalhe) =================
    const vendPage = new Map<string, number>();

    for (const v of vends) {
      doc.addPage(); y = 66;
      vendPage.set(v.nome, (doc as any).getNumberOfPages());
      F(v.status.c); doc.circle(ML + 6, y - 4, 5.5, 'F');
      T(16, 'bold', INK); doc.text(cap(S(v.nome), 30), ML + 20, y);
      const nw = doc.getTextWidth(cap(S(v.nome), 30));
      pill(ML + 20 + nw + 12, y - 13, v.status.label, v.status.c, v.status.bg);
      y += 22;

      // Vendedor com numero desconectado: nao da pra afirmar que ele nao atendeu.
      const desconectado = v.leads.length > 0 && v.leads.every((l: any) => l.instancia_conectada === false);
      if (v.status.tier === 0) {
        if (desconectado && v.semResp === v.n) {
          rich(ML, CW, [
            { t: 'O número deste vendedor está desconectado da plataforma', b: true },
            { t: '- as conversas dele não puderam ser acompanhadas. Peça pra ele reconectar o WhatsApp no painel pra voltar a aparecer nos relatórios.' },
          ], 10, 14);
        } else if (v.semResp === v.n) {
          rich(ML, CW, [
            { t: 'Recebeu' }, { t: `${v.n} cliente${v.n > 1 ? 's' : ''}`, b: true },
            { t: 'e não respondeu nenhum - o cliente chamou e ficou no vácuo.' },
          ], 10, 14);
        } else if (v.bonsPerd > 0) {
          rich(ML, CW, [
            { t: 'Perdeu' }, { t: `${v.bonsPerd} cliente${v.bonsPerd > 1 ? 's' : ''} bo${v.bonsPerd > 1 ? 'ns' : 'm'}`, b: true },
            { t: 'no período. O motivo não foi o cliente - foi a forma como foram atendidos: resposta vazia e sem retorno depois.' },
          ], 10, 14);
        } else {
          rich(ML, CW, [{ t: 'Respondeu os clientes, mas não puxou a venda - faltou pergunta, proposta e retorno.' }], 10, 14);
        }
      } else if (v.vendas > 0) {
        rich(ML, CW, [{ t: `Fechou ${v.vendas} venda${v.vendas > 1 ? 's' : ''} no período. Abaixo, as conversas dele com cada cliente.` }], 10, 14);
      } else {
        rich(ML, CW, [{ t: 'Respondeu os clientes, mas dá pra melhorar: mais pergunta, proposta e retorno. Abaixo, as conversas.' }], 10, 14);
      }
      y += 8;

      if (v.status.tier === 0) {
        const sorted0 = [...v.leads].sort((a: any, b: any) => a.score - b.score);
        const worst = sorted0.find((l: any) => l.msgs.length >= 3 && (l.pot === 'bom' || l.pot === 'forte'))
          || sorted0.find((l: any) => l.msgs.length >= 3)
          || sorted0.find((l: any) => l.msgs.length)
          || sorted0[0];
        let waitMin = worst?.tempo || 0;
        if (!waitMin && worst?.msgs?.length) {
          for (let i = 1; i < worst.msgs.length; i++) {
            if (worst.msgs[i].direction === 'outgoing' && worst.msgs[i - 1].direction === 'incoming') {
              const gap = (new Date(worst.msgs[i].created_at).getTime() - new Date(worst.msgs[i - 1].created_at).getTime()) / 60000;
              if (gap > waitMin) waitMin = gap;
            }
          }
        }
        if (v.semResp === v.n && !desconectado) {
          pageBreak(56);
          F(RED_BG); doc.roundedRect(ML, y, CW, 48, 7, 7, 'F');
          T(22, 'bold', RED); doc.text('0 respostas', ML + 16, y + 31);
          T(9.5, 'normal', INK);
          const bl = doc.splitTextToSize('foi o que o cliente recebeu. Cliente de carro decide rápido - sem resposta, ele compra na concorrência.', CW - 170);
          doc.text(bl, ML + 155, y + 20);
          y += 60;
        } else if (waitMin >= 45) {
          pageBreak(56);
          F(RED_BG); doc.roundedRect(ML, y, CW, 48, 7, 7, 'F');
          T(22, 'bold', RED); doc.text(fmtMin(waitMin), ML + 16, y + 31);
          T(9.5, 'normal', INK);
          const bl = doc.splitTextToSize('foi quanto o cliente esperou pela resposta. Cliente de carro decide rápido - nesse tempo ele já foi na concorrência.', CW - 130);
          doc.text(bl, ML + 110, y + 20);
          y += 60;
        }
        letterHead('Como foi o atendimento');
        const fortes = (worst?.pontos_fortes || []).slice(0, 2);
        const ops = (worst?.oportunidades_perdidas || []).slice(0, 3);
        const items: { ok: boolean; t: string }[] = [];
        for (const f of fortes) items.push({ ok: true, t: cap(S(f), 105) });
        if (!fortes.length && worst?.tem_outgoing) items.push({ ok: true, t: 'Entrou em contato com o cliente.' });
        for (const o of ops) items.push({ ok: false, t: cap(S(o?.texto || o), 105) });
        if (!items.length) items.push({ ok: false, t: 'Não respondeu o cliente.' });
        for (const it of items) {
          T(9.5, 'normal', INK);
          const lines = doc.splitTextToSize(it.t, CW - 26);
          pageBreak(lines.length * 12 + 8);
          if (it.ok) iconOk(ML + 6, y - 3); else iconNo(ML + 6, y - 3);
          doc.text(lines, ML + 20, y);
          y += lines.length * 12 + 6;
        }
        y += 8;
      }

      letterHead('As conversas com os clientes');
      const sorted = [...v.leads].sort((a: any, b: any) => a.score - b.score);
      for (const l of sorted) leadCard(l);
    }

    // ================= QUALIDADE =================
    doc.addPage(); y = 70;
    const qualPage = (doc as any).getNumberOfPages();
    doc.setFont('times', 'bold'); doc.setFontSize(18); doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.text('A qualidade dos clientes do período', ML, y); y += 20;
    rich(ML, CW, [
      { t: 'Aqui você vê se o anúncio está trazendo' },
      { t: 'gente com perfil de comprar', b: true },
      { t: '- ou clique à toa. É o que ajuda a acertar as campanhas.' },
    ], 10, 14);
    y += 12;
    letterHead('Que tipo de cliente chegou');
    const cats = [
      { k: 'forte', label: 'Clientes fortes', c: GREEN, desc: 'Têm carro pra dar na troca e boa entrada. Venda quase certa.' },
      { k: 'bom', label: 'Clientes bons', c: BLUE, desc: 'Mostraram interesse real. Fecham com um bom atendimento.' },
      { k: 'dificil', label: 'Clientes difíceis', c: AMBER, desc: 'Esfriaram ou têm restrição. Dá trabalho e nem sempre fecha.' },
      { k: 'nao', label: 'Nem eram clientes', c: RED, desc: 'Clique por engano ou sem intenção. Não é falha da equipe.' },
      { k: 'sem', label: 'Sem dados pra avaliar', c: MUTED, desc: 'Conversa curta demais pra julgar. Não é bom nem ruim.' },
    ];
    for (const cat of cats) {
      const n = leads.filter((l) => l.pot === cat.k).length;
      pageBreak(52);
      F(WHITE); D(LINE); doc.setLineWidth(0.8);
      doc.roundedRect(ML, y, CW, 44, 7, 7, 'FD');
      F(cat.c); doc.roundedRect(ML + 12, y + 10, 25, 25, 5, 5, 'F');
      T(12, 'bold', WHITE); doc.text(String(n), ML + 24.5, y + 26.5, { align: 'center' });
      T(11, 'bold', INK); doc.text(cat.label, ML + 48, y + 26);
      T(8.5, 'normal', MUTED);
      const dl = doc.splitTextToSize(cat.desc, 210);
      doc.text(dl, ML + CW - 12, y + (dl.length > 1 ? 19 : 26), { align: 'right' });
      y += 52;
    }
    y += 10;

    const naoLeads = leads.filter((l) => l.pot === 'nao');
    if (naoLeads.length) {
      const motivos: { t: string; sub: string; n: number }[] = [];
      const cnt = (k: string) => naoLeads.filter((l) => l.sinais && l.sinais[k] === true).length;
      const mm = [
        { k: 'clique_sem_querer', t: 'Clicaram sem querer', sub: 'Abriram o anúncio por engano.' },
        { k: 'produto_errado', t: 'Procuravam outra coisa', sub: 'Queriam algo que a loja não vende.' },
        { k: 'fora_idade', t: 'Fora da idade de comprar', sub: 'Perfil fora do público do anúncio.' },
        { k: 'sem_intencao', t: 'Sem intenção de compra', sub: 'Só curiosidade, sem plano de comprar agora.' },
      ];
      for (const m of mm) { const n = cnt(m.k); if (n > 0) motivos.push({ t: m.t, sub: m.sub, n }); }
      if (!motivos.length) motivos.push({ t: 'Sem intenção de compra', sub: 'Disseram na conversa que não pretendem comprar.', n: naoLeads.length });
      letterHead('Por que alguns não eram clientes de verdade');
      for (const m of motivos) {
        pageBreak(38);
        T(10, 'bold', INK); doc.text(m.t, ML + 4, y);
        T(8.5, 'normal', MUTED); doc.text(m.sub, ML + 4, y + 13);
        T(10.5, 'bold', RED); doc.text(`${m.n} pessoa${m.n > 1 ? 's' : ''}`, ML + CW - 4, y + 4, { align: 'right' });
        y += 24; D(LINE); doc.setLineWidth(0.6); doc.line(ML, y, ML + CW, y); y += 16;
      }
    }

    // ================= DE ONDE VIERAM =================
    doc.addPage(); y = 70;
    const adsPage = (doc as any).getNumberOfPages();
    doc.setFont('times', 'bold'); doc.setFontSize(18); doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.text('De onde vieram os clientes', ML, y); y += 20;
    rich(ML, CW, [
      { t: 'Cada campanha/anúncio e o tipo de gente que trouxe. Esta página serve pro' },
      { t: 'gestor de tráfego', b: true },
      { t: 'saber onde investir mais e o que rever.' },
    ], 10, 14);
    y += 12;

    const ads = [...byAd.values()].sort((a, b) => b.n - a.n).slice(0, 6);
    for (const ad of ads) {
      const bonsTot = ad.fortes + ad.bons;
      let pl: any; let resumo: string;
      if (ad.n < 3) {
        pl = { label: 'Acompanhar', c: BLUE, bg: BLUE_BG };
        resumo = bonsTot > 0
          ? `Trouxe ${ad.n} cliente${ad.n > 1 ? 's' : ''} com perfil de comprar. Volume ainda pequeno pra avaliar.`
          : `Trouxe ${ad.n} cliente${ad.n > 1 ? 's' : ''}, ainda sem perfil claro de compra. Volume pequeno pra avaliar.`;
      } else if (ad.nao / ad.n >= 0.4) {
        pl = { label: 'Rever', c: RED, bg: RED_BG };
        resumo = `Trouxe ${ad.nao} pessoa${ad.nao > 1 ? 's' : ''} sem intenção de comprar - vale apertar o público desse anúncio.`;
      } else if (bonsTot / ad.n >= 0.7) {
        pl = { label: 'Investir mais', c: GREEN, bg: GREEN_BG };
        resumo = `${bonsTot} de ${ad.n} vieram com perfil de comprar - é o anúncio que mais traz cliente de verdade.`;
      } else {
        pl = { label: 'Manter', c: BLUE, bg: BLUE_BG };
        resumo = `Trouxe de tudo um pouco (${bonsTot} de ${ad.n} com perfil de comprar). Está num ritmo ok, vale continuar acompanhando.`;
      }
      T(9.5, 'normal', INK);
      const rl = doc.splitTextToSize(resumo, CW - 30);
      const comp = `Fortes ${ad.fortes} · Bons ${ad.bons} · Difíceis ${ad.difs} · Não eram ${ad.nao}`;
      const mods = [...ad.modelos].slice(0, 4).join(', ');
      const h = 30 + rl.length * 12 + 16 + (mods ? 13 : 0) + 8;
      pageBreak(h + 10);
      F(WHITE); D(LINE); doc.setLineWidth(0.8);
      doc.roundedRect(ML, y, CW, h, 7, 7, 'FD');
      T(11, 'bold', INK); doc.text(cap(ad.nome, 40), ML + 15, y + 20);
      const adw = doc.getTextWidth(cap(ad.nome, 40));
      T(9, 'normal', MUTED); doc.text(`· ${ad.n} cliente${ad.n > 1 ? 's' : ''}`, ML + 15 + adw + 8, y + 20);
      T(8.5, 'bold', pl.c);
      const pw2 = doc.getTextWidth(pl.label) + 18;
      pill(ML + CW - 15 - pw2, y + 8, pl.label, pl.c, pl.bg);
      T(9.5, 'normal', INK); doc.text(rl, ML + 15, y + 38);
      let yy = y + 38 + rl.length * 12 + 2;
      T(8.3, 'normal', MUTED); doc.text(comp, ML + 15, yy);
      if (mods) { yy += 13; doc.text(cap(`Modelos procurados: ${mods}`, 95), ML + 15, yy); }
      y += h + 10;
    }
    y += 6;
    calloutBox('O que o José faz com isso',
      'A qualidade de cada cliente já fica gravada no cadastro do lead e alimenta o José automaticamente - ele cruza campanha, anúncio e modelo do carro pra saber onde investir. Este relatório também pode ser encaminhado direto pro seu gestor de tráfego.',
      GREEN, GREEN_BG);

    // ================= CAPA (página 1, desenhada por último) =================
    doc.setPage(1);
    F(NAVY); doc.rect(0, 0, PW, 168, 'F');
    T(9, 'bold', GOLD); doc.text('LOGOS IA', ML, 54, { charSpace: 3 } as any);
    doc.setFont('times', 'bold'); doc.setFontSize(25); doc.setTextColor(255, 255, 255);
    doc.text('Como foi o atendimento', ML, 92);
    T(9.5, 'normal', SUB); doc.text('O resumo está nesta página. As conversas completas vêm nas seguintes.', ML, 116);
    T(10, 'bold', WHITE); doc.text(`${loja} · ${S(periodoLabel)}`, ML, 140);
    F(GOLD); doc.rect(0, 168, 225, 4, 'F');

    const tiles = [
      { n: String(nLeads), lab: 'clientes atendidos', c: NAVY },
      { n: String(nVendas), lab: nVendas === 1 ? 'venda fechada' : 'vendas fechadas', c: GREEN },
      { n: String(nPerfil), lab: 'com perfil de comprar', c: BLUE },
      { n: String(nSem), lab: 'sem perfil / sem dados', c: RED },
    ];
    const tw2 = (CW - 30) / 4; let tx = ML; const ty = 192;
    for (const t of tiles) {
      F(WHITE); D(LINE); doc.setLineWidth(0.8); doc.roundedRect(tx, ty, tw2, 54, 7, 7, 'FD');
      T(20, 'bold', t.c); doc.text(t.n, tx + 12, ty + 28);
      T(7.2, 'normal', MUTED);
      const ll = doc.splitTextToSize(t.lab, tw2 - 20);
      doc.text(ll, tx + 12, ty + 40);
      tx += tw2 + 10;
    }
    y = ty + 54 + 26;

    letterHead('A equipe');
    const nG = vends.filter((v) => v.status.tier === 2).length;
    const nA = vends.filter((v) => v.status.tier === 1).length;
    const nR = reds.length;
    rich(ML, CW, [
      { t: `${nG} atendeu${nG === 1 ? '' : 'ram'} bem`, b: true, c: GREEN }, { t: '·' },
      { t: `${nA} pode${nA === 1 ? '' : 'm'} melhorar`, b: true, c: AMBER }, { t: '·' },
      { t: `${nR} precisa${nR === 1 ? '' : 'm'} de atenção`, b: true, c: RED },
    ], 9.5, 13);
    y += 5;
    for (const v of vends.slice(0, 10)) {
      F(v.status.c); doc.circle(ML + 5, y - 3, 3.5, 'F');
      T(9.5, 'bold', INK); doc.text(cap(S(v.nome), 20), ML + 16, y);
      T(8, 'normal', MUTED); doc.text(`${v.n} atendimento${v.n > 1 ? 's' : ''}`, ML + 158, y);
      T(8.5, 'bold', v.status.c); doc.text(v.status.label, ML + 250, y);
      T(8, 'normal', MUTED); doc.text(`pág. ${vendPage.get(v.nome) || 2}`, ML + CW, y, { align: 'right' });
      y += 19;
    }
    if (vends.length > 10) { T(8, 'normal', MUTED); doc.text(`e mais ${vends.length - 10} vendedor(es) nas páginas internas.`, ML + 16, y); y += 16; }
    y += 8;

    letterHead('A qualidade dos clientes que chegaram');
    let qx = ML;
    for (const cat of [
      { k: 'forte', lab: 'fortes', c: GREEN }, { k: 'bom', lab: 'bons', c: BLUE },
      { k: 'dificil', lab: 'difíceis', c: AMBER }, { k: 'nao', lab: 'não eram leads', c: RED },
      { k: 'sem', lab: 'sem dados', c: MUTED },
    ]) {
      const n = leads.filter((l) => l.pot === cat.k).length;
      F(cat.c); doc.roundedRect(qx, y - 11.5, 17, 16, 3, 3, 'F');
      T(9, 'bold', WHITE); doc.text(String(n), qx + 8.5, y, { align: 'center' });
      T(8.5, 'normal', INK); doc.text(cat.lab, qx + 22, y);
      qx += 22 + doc.getTextWidth(cat.lab) + 16;
    }
    T(8, 'normal', MUTED); doc.text(`detalhe na pág. ${qualPage}`, ML + CW, y, { align: 'right' });
    y += 26;

    letterHead('As campanhas');
    const adsTop = [...byAd.values()].sort((a, b) => b.n - a.n);
    const melhor = [...adsTop].filter((a) => a.n >= 3).sort((a, b) => ((b.fortes + b.bons) / b.n) - ((a.fortes + a.bons) / a.n))[0] || adsTop[0];
    if (melhor) {
      F(GREEN); doc.circle(ML + 5, y - 3, 3.5, 'F');
      T(9, 'normal', INK);
      doc.text(`Melhor: ${cap(melhor.nome, 42)} - ${melhor.fortes + melhor.bons} de ${melhor.n} com perfil de comprar`, ML + 16, y);
      T(8, 'normal', MUTED); doc.text(`pág. ${adsPage}`, ML + CW, y, { align: 'right' });
      y += 17;
    }
    const alerta = adsTop.filter((a) => a.nao > 0 && a !== melhor).sort((a, b) => b.nao - a.nao)[0]
      || (melhor && melhor.nao > 0 ? melhor : null);
    if (alerta) {
      F(AMBER); doc.circle(ML + 5, y - 3, 3.5, 'F');
      T(9, 'normal', INK);
      doc.text(`De olho: ${cap(alerta.nome, 42)} - ${alerta.nao} contato${alerta.nao > 1 ? 's' : ''} sem intenção de comprar`, ML + 16, y);
      y += 17;
    }
    y += 8;

    if (destaque) {
      const dtxt = destaque.vendas > 0 ? `Destaque: ${destaque.nome} - fechou venda no período.` : `Destaque: ${destaque.nome} - melhor atendimento do período.`;
      F(GREEN_BG); doc.roundedRect(ML, y, CW, 30, 7, 7, 'F');
      T(9.5, 'bold', GREEN); doc.text(cap(dtxt, 95), ML + 14, y + 19);
      y += 38;
    }
    if (reds.length) {
      const nomes = reds.map((v: any) => firstName(v.nome) || v.nome).join(', ').replace(/, ([^,]*)$/, ' e $1');
      T(9.5, 'normal', INK);
      const at = doc.splitTextToSize('Clientes bons ficaram sem resposta - as conversas e o que falar com cada um estão nas páginas indicadas acima.', CW - 28);
      const h = 18 + 13 + at.length * 12 + 6;
      F(RED_BG); doc.roundedRect(ML, y, CW, h, 7, 7, 'F');
      T(9.5, 'bold', RED); doc.text(cap(`Precisa de atenção: ${nomes}.`, 95), ML + 14, y + 17);
      T(9.5, 'normal', INK); doc.text(at, ML + 14, y + 31);
      y += h + 8;
    }

    // ================= RODAPÉ =================
    const nPages = (doc as any).getNumberOfPages();
    for (let i = 1; i <= nPages; i++) {
      doc.setPage(i);
      D(LINE); doc.setLineWidth(0.7); doc.line(ML, 806, PW - 48, 806);
      T(7.5, 'bold', INK); doc.text('LOGOS IA', ML, 818);
      const bw2 = doc.getTextWidth('LOGOS IA');
      T(7.5, 'normal', MUTED); doc.text(' · suporte@logosiabrasil.com', ML + bw2, 818);
      doc.text(`Página ${i} de ${nPages}`, PW - 48, 818, { align: 'right' });
    }

    const ab = doc.output('arraybuffer') as ArrayBuffer;
    const bytes = new Uint8Array(ab);
    const up = await admin.storage.from('feedback-relatorios').upload(uploadNome, new Blob([bytes], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf' } as any);
    if ((up as any).error) return new Response(JSON.stringify({ ok: false, error: (up as any).error.message }), { status: 200 });

    return new Response(JSON.stringify({ ok: true, arquivo: uploadNome, paginas: nPages, bytes: bytes.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e), stack: String(e?.stack || '').slice(0, 1500) }), { status: 200 });
  }
});
