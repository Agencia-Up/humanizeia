import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCcw, PackageSearch, Loader2, AlertTriangle, Download, CalendarRange, Megaphone, ImageOff, TrendingUp, ScanEye, ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';

// ── Por produto × Tráfego (José) ──────────────────────────────────────────────
// Cruza a QUALIDADE do lead (qualificado / pouco / ruim / nem-é-lead) com o PRODUTO
// que a conversa era (carro, no nicho auto) E com o que o agente José está de fato
// anunciando. Duas fontes:
//   1) feedback_produtos_qualidade  → produto (da conversa) × qualidade do lead.
//   2) jose_criativos_ativos        → criativos do último snapshot do José: nome
//      (que quase sempre É o carro), status (ACTIVE/pausado), gasto, conversas e a
//      thumbnail (imagem do anúncio). Onde o nome é genérico ("05","01"...), o carro
//      só sai LENDO A IMAGEM (edge feedback-criativo-visao) — cache em carrosIa.
// O casamento é pelo MODELO do carro (normalizeModelo), tolerante a acento/versão.
// A tabela é operável estilo Facebook Ads: filtro por status (todos/ativos/anunciados/
// não anunciados) e ordenação clicável em cada coluna (melhor→pior, gasto, leads...).
// Filtros de período: atalho (30/90/365) ou intervalo PERSONALIZADO. Exporta CSV do
// que estiver na tela. SÓ LEITURA — não toca em tráfego/CRM.

interface Row {
  produto: string; total: number;
  qualificados: number; pouco_qualificados: number; ruins: number; nao_lead: number; sem_classe: number;
  pct_qualificado: number;
}
interface Criativo { nome?: string; status?: string; gasto?: number; conversas?: number; thumbnail_url?: string; }
interface JoseAgg { ativo: boolean; gasto: number; conversas: number; criativos: string[]; thumb?: string; }
type Linha = Row & { key: string | null; jose?: JoseAgg };
type SortKey = 'produto' | 'total' | 'qualificados' | 'pouco' | 'ruins' | 'nao_lead' | 'pct' | 'gasto';
type StatusFiltro = 'todos' | 'ativos' | 'anunciados' | 'nao_anunciados';

const PRESETS = [{ v: 30, l: '30 dias' }, { v: 90, l: '90 dias' }, { v: 365, l: '1 ano' }];
const STATUS: { v: StatusFiltro; l: string }[] = [
  { v: 'todos', l: 'Todos' }, { v: 'ativos', l: 'Só ativos' }, { v: 'anunciados', l: 'Anunciados' }, { v: 'nao_anunciados', l: 'Não anunciados' },
];
const hojeISO = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // BRT
const isoMenosDias = (d: number) => new Date(Date.now() - 3 * 3600e3 - d * 86400e3).toISOString().slice(0, 10);
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Dicionário de modelos (BR). Casa "COROLLA CROSS XRE 2024" e "Corolla Cross" no mesmo
// carro; multi-palavra antes das curtas. Se nada casar, cai no fallback (1ª palavra útil).
const MODELOS = [
  'corolla cross', 'corolla', 'onix plus', 'onix', 'hb20s', 'hb20x', 'hb20', 't-cross', 'tcross',
  'compass', 'renegade', 'commander', 'toro', 'fastback', 'pulse', 'argo', 'cronos', 'mobi', 'strada', 'fiorino', 'uno',
  'tracker', 'spin', 'montana', 's10', 'cruze', 'cobalt', 'prisma', 'trailblazer', 'equinox', 'joy',
  'kwid', 'sandero', 'logan', 'duster', 'oroch', 'captur', 'stepway', 'kardian',
  'kicks', 'versa', 'sentra', 'frontier', 'march',
  'ecosport', 'fiesta', 'focus', 'fusion', 'ranger', 'territory', 'maverick', 'bronco', 'ka',
  '2008', '208', '3008', 'partner',
  'polo', 'virtus', 'nivus', 'saveiro', 'voyage', 'gol', 'fox', 'jetta', 'tiguan', 'amarok', 'taos',
  'city', 'hr-v', 'hrv', 'wr-v', 'wrv', 'civic', 'accord', 'cr-v', 'crv', 'fit',
  'yaris', 'hilux', 'sw4', 'etios',
  'creta', 'tucson', 'santa fe', 'ix35', 'azera', 'elantra',
  'tiggo', 'arrizo', 'c3', 'c4', 'aircross', 'clio', 'master',
  'l200', 'triton', 'pajero', 'asx', 'outlander', 'eclipse',
  'cerato', 'sportage', 'sorento', 'picanto', 'stonic', 'seltos',
];
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
function normalizeModelo(raw?: string): string | null {
  if (!raw) return null;
  let s = semAcento(String(raw)).toLowerCase();
  s = s.replace(/\.(png|jpg|jpeg|webp)\b/g, ' ').replace(/—\s*c[óo]pia/g, ' ').replace(/[*()]/g, ' ');
  s = ' ' + s.replace(/[^a-z0-9-]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  for (const m of MODELOS) if (s.includes(' ' + m + ' ')) return m;
  const t = s.trim();
  if (!t || /^\d{1,3}$/.test(t) || t.length < 3) return null;
  const first = t.split(' ').find((w) => w.length >= 3 && !/^\d+$/.test(w));
  return first || null;
}
// asset id estável do fbcdn (1º número grande do path da thumbnail; a URL expira, o id não)
function assetKey(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/\/(\d{6,})_/);
  return m ? m[1] : null;
}

export function FeedbackPorProdutoTab() {
  const [modo, setModo] = useState<'preset' | 'custom'>('preset');
  const [dias, setDias] = useState(30);
  const [ini, setIni] = useState(isoMenosDias(30));
  const [fim, setFim] = useState(hojeISO());
  const [rows, setRows] = useState<Row[]>([]);
  const [jose, setJose] = useState<{ criativos: Criativo[]; computed_at?: string; tem_dados: boolean; carrosIa: Record<string, string> }>({ criativos: [], tem_dados: false, carrosIa: {} });
  const [loading, setLoading] = useState(true);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFiltro>('todos');
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null);
    try {
      const params = modo === 'custom'
        ? { p_dias: null, p_ini: ini, p_fim: fim }
        : { p_dias: dias, p_ini: null, p_fim: null };
      const [q, j] = await Promise.all([
        (supabase as any).rpc('feedback_produtos_qualidade', params),
        (supabase as any).rpc('jose_criativos_ativos'),
      ]);
      if (q.error) throw q.error;
      setRows(Array.isArray(q.data) ? q.data : []);
      const jd = j.error ? null : j.data;
      const carrosIa: Record<string, string> = {};
      if (Array.isArray(jd?.carros_ia)) for (const c of jd.carros_ia) if (c?.asset_key && c?.carro) carrosIa[c.asset_key] = c.carro;
      setJose({
        criativos: Array.isArray(jd?.criativos) ? jd.criativos : [],
        computed_at: jd?.computed_at,
        tem_dados: !!jd?.tem_dados,
        carrosIa,
      });
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar.');
    } finally { setLoading(false); }
  }, [modo, dias, ini, fim]);
  useEffect(() => { carregar(); }, [carregar]);

  // Agrega os criativos do José por modelo de carro.
  const { joseMap, genericos } = useMemo(() => {
    const map = new Map<string, JoseAgg>();
    const gen: Criativo[] = [];
    for (const c of jose.criativos) {
      // 1º tenta o carro pelo NOME; se genérico, tenta o carro lido da IMAGEM (cache de visão)
      let key = normalizeModelo(c.nome);
      if (!key) {
        const ak = assetKey(c.thumbnail_url);
        if (ak && jose.carrosIa[ak]) key = normalizeModelo(jose.carrosIa[ak]) || jose.carrosIa[ak].toLowerCase();
      }
      if (!key) { if ((c.gasto || 0) > 0 || c.status === 'ACTIVE') gen.push(c); continue; }
      const prev = map.get(key) || { ativo: false, gasto: 0, conversas: 0, criativos: [], thumb: undefined };
      prev.ativo = prev.ativo || c.status === 'ACTIVE';
      prev.gasto += c.gasto || 0;
      prev.conversas += c.conversas || 0;
      if (c.nome && !prev.criativos.includes(c.nome)) prev.criativos.push(c.nome);
      if (!prev.thumb && c.thumbnail_url) prev.thumb = c.thumbnail_url;
      map.set(key, prev);
    }
    return { joseMap: map, genericos: gen };
  }, [jose.criativos, jose.carrosIa]);

  const lerImagens = async () => {
    setLendo(true); setErro(null);
    try {
      const payload = genericos
        .map((c) => ({ asset_key: assetKey(c.thumbnail_url), nome: c.nome, thumbnail_url: c.thumbnail_url }))
        .filter((c) => c.asset_key && c.thumbnail_url);
      if (payload.length === 0) return;
      const { error } = await (supabase as any).functions.invoke('feedback-criativo-visao', { body: { criativos: payload } });
      if (error) throw error;
      await carregar();
    } catch (e: any) {
      setErro(e?.message || 'Falha ao ler as imagens.');
    } finally { setLendo(false); }
  };

  // Junta cada produto (conversa) com o José.
  const linhas: Linha[] = useMemo(() => rows.map((r) => {
    const key = normalizeModelo(r.produto);
    return { ...r, key, jose: key ? joseMap.get(key) : undefined };
  }), [rows, joseMap]);

  // Aplica filtro de status + ordenação (o que aparece na tela / vai pro CSV / soma no total).
  const linhasVis = useMemo(() => {
    const filtradas = linhas.filter((l) => {
      if (status === 'ativos') return !!l.jose?.ativo;
      if (status === 'anunciados') return !!l.jose;
      if (status === 'nao_anunciados') return !l.jose;
      return true;
    });
    const val = (l: Linha): number | string => {
      switch (sortKey) {
        case 'produto': return l.produto.toLowerCase();
        case 'total': return l.total;
        case 'qualificados': return l.qualificados;
        case 'pouco': return l.pouco_qualificados;
        case 'ruins': return l.ruins;
        case 'nao_lead': return l.nao_lead;
        case 'pct': return l.pct_qualificado;
        case 'gasto': return l.jose ? l.jose.gasto : -1;
      }
    };
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtradas].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * dir;
      return (va - vb) * dir;
    });
  }, [linhas, status, sortKey, sortDir]);

  // Carros que o José anuncia mas que NÃO aparecem em nenhuma conversa (gasta e não pinga lead).
  const anunciadosSemLead = useMemo(() => {
    const keysProduto = new Set(linhas.map((l) => l.key).filter(Boolean) as string[]);
    const out: { key: string; agg: JoseAgg }[] = [];
    joseMap.forEach((agg, key) => { if (agg.ativo && !keysProduto.has(key)) out.push({ key, agg }); });
    return out.sort((a, b) => b.agg.gasto - a.agg.gasto);
  }, [linhas, joseMap]);

  const tot = linhasVis.reduce((a, r) => ({
    total: a.total + r.total, q: a.q + r.qualificados, p: a.p + r.pouco_qualificados,
    r: a.r + r.ruins, n: a.n + r.nao_lead, g: a.g + (r.jose?.gasto || 0),
  }), { total: 0, q: 0, p: 0, r: 0, n: 0, g: 0 });

  const statusLabel = (l: Linha) =>
    !jose.tem_dados ? '—' : !l.jose ? 'Não anunciado' : l.jose.ativo ? 'Anunciado (ativo)' : 'Pausado';

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'produto' ? 'asc' : 'desc'); }
  };

  const exportarCSV = () => {
    const periodo = modo === 'custom' ? `${ini}_a_${fim}` : `ultimos_${dias}_dias`;
    const head = ['Produto', 'Leads', 'Qualificados', 'Pouco', 'Ruins', 'Nem e lead', 'Sem classe', '% Bom', 'Status trafego', 'Gasto Meta', 'Criativos'];
    const linhasCsv = linhasVis.map((r) => [
      r.produto, r.total, r.qualificados, r.pouco_qualificados, r.ruins, r.nao_lead, r.sem_classe, r.pct_qualificado + '%',
      statusLabel(r), r.jose ? brl(r.jose.gasto) : '', r.jose ? r.jose.criativos.join(' | ') : '',
    ]);
    const esc = (v: any) => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rodape = ['TOTAL', tot.total, tot.q, tot.p, tot.r, tot.n, '', (tot.total ? Math.round(100 * tot.q / tot.total) : 0) + '%', '', tot.g ? brl(tot.g) : '', ''];
    const csv = [head, ...linhasCsv, rodape].map((l) => l.map(esc).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `feedback-por-produto_${periodo}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const Barra = ({ r }: { r: Row }) => {
    const seg = (n: number, cor: string) => n > 0 ? <div className={cor} style={{ width: `${(n / r.total) * 100}%` }} /> : null;
    return (
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {seg(r.qualificados, 'bg-emerald-500')}
        {seg(r.pouco_qualificados, 'bg-amber-400')}
        {seg(r.ruins, 'bg-red-500')}
        {seg(r.nao_lead, 'bg-slate-400')}
        {seg(r.sem_classe, 'bg-muted-foreground/30')}
      </div>
    );
  };
  const StatusPill = ({ l }: { l: Linha }) => {
    if (!jose.tem_dados) return <span className="text-muted-foreground">—</span>;
    if (!l.jose) return <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[11px] text-slate-500">Não anunciado</span>;
    if (l.jose.ativo) return <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">Ativo</span>;
    return <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">Pausado</span>;
  };
  // cabeçalho clicável (ordena). align 'right' pros números.
  const Th = ({ k, children, align = 'right', className = '' }: { k: SortKey; children: any; align?: 'left' | 'right'; className?: string }) => (
    <th className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      <button onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${sortKey === k ? 'text-foreground' : ''} ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {children}
        {sortKey === k
          ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
          : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <PackageSearch className="h-4 w-4 text-primary" /> Qualidade do lead por produto <span className="text-muted-foreground">×</span> tráfego do José
          </h3>
          <p className="text-xs text-muted-foreground">Qual carro anunciado traz lead bom, qual gasta sem converter, e qual traz lead bom sem estar no ar.</p>
        </div>
        <button onClick={exportarCSV} disabled={loading || linhasVis.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent/40 disabled:opacity-50">
          <Download className="h-3.5 w-3.5" /> Exportar CSV
        </button>
      </div>

      {/* filtros de período */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border p-0.5">
          {PRESETS.map((o) => (
            <button key={o.v} onClick={() => { setModo('preset'); setDias(o.v); }}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${modo === 'preset' && dias === o.v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {o.l}
            </button>
          ))}
          <button onClick={() => setModo('custom')}
            className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs transition-colors ${modo === 'custom' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <CalendarRange className="h-3.5 w-3.5" /> Personalizado
          </button>
        </div>
        {modo === 'custom' && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>de</span>
            <input type="date" value={ini} max={fim} onChange={(e) => setIni(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground" />
            <span>até</span>
            <input type="date" value={fim} min={ini} max={hojeISO()} onChange={(e) => setFim(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground" />
          </div>
        )}
        <button onClick={carregar} disabled={loading} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
          <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {/* filtro de status (tráfego) + ordenação rápida */}
      <div className="flex flex-wrap items-center gap-2">
        {jose.tem_dados && (
          <div className="flex rounded-md border border-border p-0.5">
            {STATUS.map((o) => (
              <button key={o.v} onClick={() => setStatus(o.v)}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${status === o.v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {o.l}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Ordenar:</span>
          <button onClick={() => { setSortKey('pct'); setSortDir('desc'); }}
            className={`rounded-md border px-2 py-1 ${sortKey === 'pct' ? 'border-primary text-foreground' : 'border-border hover:text-foreground'}`}>Melhor → pior</button>
          <button onClick={() => { setSortKey('gasto'); setSortDir('desc'); }}
            className={`rounded-md border px-2 py-1 ${sortKey === 'gasto' ? 'border-primary text-foreground' : 'border-border hover:text-foreground'}`}>Mais gasto</button>
          <button onClick={() => { setSortKey('total'); setSortDir('desc'); }}
            className={`rounded-md border px-2 py-1 ${sortKey === 'total' ? 'border-primary text-foreground' : 'border-border hover:text-foreground'}`}>Mais leads</button>
        </div>
        {!loading && <span className="text-[11px] text-muted-foreground">{linhasVis.length} de {linhas.length}</span>}
      </div>

      {/* legenda */}
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Qualificado</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> Pouco qualificado</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> Ruim</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" /> Nem é lead</span>
        {jose.computed_at && <span className="ml-auto">Tráfego (José) atualizado em {new Date(jose.computed_at).toLocaleString('pt-BR')}</span>}
      </div>

      {erro && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-500">
          <AlertTriangle className="h-4 w-4" /> {erro}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border/50 py-10 text-center text-sm text-muted-foreground">
          Sem análises no período. (A área de Feedbacks precisa da "Análise" ligada e conversas avaliadas.)
        </div>
      ) : linhasVis.length === 0 ? (
        <div className="rounded-xl border border-border/50 py-10 text-center text-sm text-muted-foreground">
          Nenhum produto com esse filtro de status.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/50">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30 text-[11px] uppercase text-muted-foreground">
                <Th k="produto" align="left">Produto</Th>
                <Th k="total">Leads</Th>
                <Th k="qualificados">Qualif.</Th>
                <Th k="pouco">Pouco</Th>
                <Th k="ruins">Ruim</Th>
                <Th k="nao_lead">Nem é lead</Th>
                <th className="w-[16%] px-3 py-2 text-left font-medium">Distribuição</th>
                <Th k="pct">% Bom</Th>
                <th className="px-3 py-2 text-left font-medium">Tráfego</th>
                <Th k="gasto">Gasto Meta</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {linhasVis.map((r, i) => (
                <tr key={i} className="hover:bg-accent/30">
                  <td className="max-w-[200px] truncate px-3 py-2 font-medium text-foreground" title={r.produto}>{r.produto}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{r.qualificados || '·'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{r.pouco_qualificados || '·'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-600 dark:text-red-400">{r.ruins || '·'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.nao_lead || '·'}</td>
                  <td className="px-3 py-2"><Barra r={r} /></td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{r.pct_qualificado}%</td>
                  <td className="px-3 py-2"><StatusPill l={r} /></td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.jose && r.jose.gasto > 0 ? brl(r.jose.gasto) : '·'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border/50 bg-muted/20 text-[12px] font-medium">
                <td className="px-3 py-2">Total {status !== 'todos' ? '(filtrado)' : ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{tot.total}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{tot.q}</td>
                <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{tot.p}</td>
                <td className="px-3 py-2 text-right tabular-nums text-red-600 dark:text-red-400">{tot.r}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{tot.n}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular-nums">{tot.total ? Math.round((100 * tot.q) / tot.total) : 0}%</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular-nums">{tot.g ? brl(tot.g) : ''}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Oportunidade: carro anunciado ativo que não pinga lead em conversa nenhuma */}
      {jose.tem_dados && anunciadosSemLead.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            <Megaphone className="h-4 w-4" /> Anunciado ativo, mas sem lead casado nas conversas
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">Estão gastando na Meta e o carro não apareceu em nenhuma conversa do período — vale checar segmentação/criativo.</p>
          <div className="flex flex-wrap gap-2">
            {anunciadosSemLead.map(({ key, agg }) => (
              <span key={key} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1 text-xs">
                <span className="font-medium capitalize text-foreground">{key}</span>
                {agg.gasto > 0 && <span className="tabular-nums text-muted-foreground">{brl(agg.gasto)}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Genéricos: criativos sem carro no nome — precisam da leitura da imagem */}
      {jose.tem_dados && genericos.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-muted/10 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ImageOff className="h-4 w-4 text-muted-foreground" /> Anúncios sem o carro no nome ({genericos.length})
            </div>
            <button onClick={lerImagens} disabled={lendo}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {lendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanEye className="h-3.5 w-3.5" />}
              {lendo ? 'Lendo imagens...' : 'Ler imagens com IA'}
            </button>
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            O nome do criativo é genérico ("{genericos.map((g) => g.nome).filter(Boolean).slice(0, 4).join('", "')}"). O carro está na
            imagem — clique em "Ler imagens com IA" para identificar o carro pela foto e casar esses com o produto.
          </p>
          <div className="flex flex-wrap gap-2">
            {genericos.slice(0, 12).map((g, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1 text-xs">
                {g.thumbnail_url
                  ? <img src={g.thumbnail_url} alt={g.nome || 'criativo'} className="h-8 w-8 rounded object-cover" loading="lazy" />
                  : <span className="flex h-8 w-8 items-center justify-center rounded bg-muted"><ImageOff className="h-3.5 w-3.5 text-muted-foreground" /></span>}
                <span className="text-muted-foreground">{g.nome || '(sem nome)'}</span>
                {(g.gasto || 0) > 0 && <span className="tabular-nums text-muted-foreground">{brl(g.gasto!)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          O produto vem do que a IA identificou na conversa; o lado "Tráfego" vem dos criativos que o José está rodando.
          Clique num cabeçalho pra ordenar; use o filtro de status pra ver só os ativos, os anunciados ou os que não estão no ar.
          "Não anunciado" com muitos leads bons = carro que vende sozinho (avaliar anunciar). "Ativo" com % Bom baixo = gasto trazendo curioso.
        </span>
      </p>
    </div>
  );
}
