import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  RefreshCcw, PackageSearch, Loader2, AlertTriangle, Download, CalendarRange, Megaphone, ImageOff,
  TrendingUp, ScanEye, ArrowUp, ArrowDown, ChevronsUpDown, LayoutGrid, Table2, X, Sparkles, RotateCw,
  ShieldCheck, Lightbulb, Info,
} from 'lucide-react';

// ── Por produto × Tráfego (José) ──────────────────────────────────────────────
// Cruza a QUALIDADE do lead (qualificado/pouco/ruim/nem-é-lead) com o PRODUTO da conversa
// E com o que o José anuncia. Duas visões: GALERIA de veículos (imagem + custos, clica e
// abre a imagem cheia + o cruzamento) e TABELA (produto × qualidade, ordenável/filtrável).
// Fonte do tráfego:
//   • presets 7/30/60 → RPC feedback_jose_trafego_periodo (PRÉ-CALCULADO por robô: gasto por
//     carro correto, batendo com o total da conta, imagem no nosso bucket -> sempre abre). Rápido.
//   • personalizado → edge feedback-jose-trafego (ao vivo na Meta; leva alguns segundos).
// Casa por MODELO do carro (normalizeModelo + cache de visão pros nomes genéricos).
// SÓ LEITURA — não toca em tráfego/CRM.

interface Row {
  produto: string; total: number;
  qualificados: number; pouco_qualificados: number; ruins: number; nao_lead: number; sem_classe: number;
  pct_qualificado: number;
}
interface Criativo { nome?: string; status?: string; gasto?: number; conversas?: number; thumbnail_url?: string; asset_key?: string; carro_key?: string; }
interface JoseAgg { ativo: boolean; gasto: number; conversas: number; criativos: string[]; thumb?: string }
type Linha = Row & { key: string | null; jose?: JoseAgg };
type SortKey = 'produto' | 'total' | 'qualificados' | 'pouco' | 'ruins' | 'nao_lead' | 'pct' | 'gasto';
type StatusFiltro = 'todos' | 'ativos' | 'anunciados' | 'nao_anunciados';

const PRESETS = [{ v: 7, l: '7 dias' }, { v: 30, l: '30 dias' }, { v: 60, l: '60 dias' }];
const MAX_DIAS = 60;
const STATUS: { v: StatusFiltro; l: string }[] = [
  { v: 'todos', l: 'Todos' }, { v: 'ativos', l: 'Só ativos' }, { v: 'anunciados', l: 'Anunciados' }, { v: 'nao_anunciados', l: 'Não anunciados' },
];
const hojeISO = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const isoMenosDias = (d: number) => new Date(Date.now() - 3 * 3600e3 - d * 86400e3).toISOString().slice(0, 10);
const brl = (n: number) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function pct(n: number): string {
  return `${Math.round(Number(n) || 0)}%`;
}
function confiancaProduto(totalProdutos: number, produtosComTrafego: number, joseTemDados: boolean): { label: string; cls: string; desc: string } {
  if (!joseTemDados) {
    return {
      label: 'Sem dados da Meta',
      cls: 'border-amber-500/25 bg-amber-500/10 text-amber-200',
      desc: 'A qualidade dos leads aparece, mas o gasto de campanha ainda nao foi carregado.',
    };
  }
  if (!totalProdutos) {
    return {
      label: 'Sem produtos analisados',
      cls: 'border-muted-foreground/20 bg-muted/30 text-muted-foreground',
      desc: 'Ainda nao ha volume suficiente para cruzar produto, lead e campanha.',
    };
  }
  const cobertura = produtosComTrafego / totalProdutos;
  if (cobertura >= 0.75) {
    return {
      label: 'Dados confiaveis',
      cls: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
      desc: 'A maior parte dos produtos analisados tem vinculo com campanhas do Jose.',
    };
  }
  if (cobertura >= 0.35) {
    return {
      label: 'Dados parciais',
      cls: 'border-sky-500/25 bg-sky-500/10 text-sky-200',
      desc: 'Parte dos produtos foi vinculada a campanhas; use como direcao, nao como fechamento financeiro.',
    };
  }
  return {
    label: 'Baixa cobertura',
    cls: 'border-rose-500/25 bg-rose-500/10 text-rose-200',
    desc: 'Poucos produtos foram encontrados nas campanhas. Pode haver criativo generico, anuncio sem modelo ou divergencia de nome.',
  };
}

const MODELOS = [
  'corolla cross', 'corolla', 'onix plus', 'onix', 'hb20s', 'hb20x', 'hb20', 't-cross', 'tcross',
  'compass', 'renegade', 'commander', 'toro', 'fastback', 'pulse', 'argo', 'cronos', 'mobi', 'strada', 'fiorino', 'uno',
  'tracker', 'spin', 'montana', 's10', 'cruze', 'cobalt', 'prisma', 'trailblazer', 'equinox', 'joy',
  'kwid', 'sandero', 'logan', 'duster', 'oroch', 'captur', 'stepway', 'kardian',
  'kicks', 'versa', 'sentra', 'frontier', 'march',
  'ecosport', 'fiesta', 'focus', 'fusion', 'ranger', 'territory', 'maverick', 'bronco', 'ka', 'golf', 'fox',
  '2008', '208', '3008', 'partner',
  'polo', 'virtus', 'nivus', 'saveiro', 'voyage', 'gol', 'jetta', 'tiguan', 'amarok', 'taos',
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
  s = s.replace(/\.(png|jpg|jpeg|webp)\b/g, ' ').replace(/[—-]\s*c[óo]pia/g, ' ').replace(/[*()]/g, ' ');
  s = ' ' + s.replace(/[^a-z0-9-]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  for (const m of MODELOS) if (s.includes(' ' + m + ' ')) return m;
  const t = s.trim();
  if (!t || /^\d{1,3}$/.test(t) || t.length < 3) return null;
  const first = t.split(' ').find((w) => w.length >= 3 && !/^\d+$/.test(w));
  return first || null;
}

export function FeedbackPorProdutoTab() {
  const [view, setView] = useState<'galeria' | 'tabela'>('galeria');
  const [modo, setModo] = useState<'preset' | 'custom'>('preset');
  const [dias, setDias] = useState(30);
  const [ini, setIni] = useState(isoMenosDias(30));
  const [fim, setFim] = useState(hojeISO());
  const [rows, setRows] = useState<Row[]>([]);
  const [jose, setJose] = useState<{ criativos: Criativo[]; computed_at?: string; tem_dados: boolean; carrosIa: Record<string, string>; gastoTotal: number }>({ criativos: [], tem_dados: false, carrosIa: {}, gastoTotal: 0 });
  const [loading, setLoading] = useState(true);
  const [recalc, setRecalc] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFiltro>('todos');
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [modal, setModal] = useState<Criativo | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null); setAviso(null);
    try {
      const minIso = isoMenosDias(MAX_DIAS);
      const iniClamp = modo === 'custom' && ini < minIso ? minIso : ini;
      const params = modo === 'custom'
        ? { p_dias: null, p_ini: iniClamp, p_fim: fim }
        : { p_dias: dias, p_ini: null, p_fim: null };
      // José: preset lê o PRÉ-CALCULADO (rápido); personalizado vai ao vivo (mais lento).
      const josePromise = modo === 'custom'
        ? (supabase as any).functions.invoke('feedback-jose-trafego', { body: { since: iniClamp, until: fim } }).then((r: any) => ({ data: r.data, error: r.error }))
        : (supabase as any).rpc('feedback_jose_trafego_periodo', { p_dias: dias });
      const [q, j] = await Promise.all([
        (supabase as any).rpc('feedback_produtos_qualidade', params),
        josePromise,
      ]);
      if (q.error) throw q.error;
      setRows(Array.isArray(q.data) ? q.data : []);
      const jd = j.error ? null : j.data;
      const carrosIa: Record<string, string> = {};
      if (Array.isArray(jd?.carros_ia)) for (const c of jd.carros_ia) if (c?.asset_key && c?.carro) carrosIa[c.asset_key] = c.carro;
      setJose({
        criativos: Array.isArray(jd?.criativos) ? jd.criativos : [],
        computed_at: jd?.computed_at, tem_dados: !!jd?.tem_dados, carrosIa,
        gastoTotal: Number(jd?.gasto_total) || 0,
      });
      if (modo !== 'custom' && jd && !jd.tem_dados) setAviso('O tráfego ainda está sendo calculado pela primeira vez. Clique em "Recalcular agora" e volte em ~1 min.');
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar.');
    } finally { setLoading(false); }
  }, [modo, dias, ini, fim]);
  useEffect(() => { carregar(); }, [carregar]);

  // recalcula o tráfego na Meta agora (dispara o robô; volta em ~1 min).
  const recalcular = async () => {
    setRecalc(true); setErro(null);
    try {
      await (supabase as any).functions.invoke('feedback-jose-sync', { body: {} });
      setAviso('Recalculado. Atualizando os números...');
      await carregar();
    } catch (e: any) {
      setErro(e?.message || 'Falha ao recalcular.');
    } finally { setRecalc(false); }
  };

  // modelo do carro de um criativo (nome, ou imagem lida por visão).
  const modeloDoCriativo = useCallback((c: Criativo): string | null => {
    let key = normalizeModelo(c.nome);
    if (!key && c.asset_key && jose.carrosIa[c.asset_key]) key = normalizeModelo(jose.carrosIa[c.asset_key]) || jose.carrosIa[c.asset_key].toLowerCase();
    return key;
  }, [jose.carrosIa]);

  // José agregado por modelo (pra tabela produto×tráfego) + genéricos (sem carro no nome/imagem).
  const { joseMap, genericos } = useMemo(() => {
    const map = new Map<string, JoseAgg>();
    const gen: Criativo[] = [];
    for (const c of jose.criativos) {
      const key = modeloDoCriativo(c);
      if (!key) { if ((c.gasto || 0) > 0 || c.status === 'ACTIVE') gen.push(c); continue; }
      const prev = map.get(key) || { ativo: false, gasto: 0, conversas: 0, criativos: [], thumb: undefined };
      prev.ativo = prev.ativo || c.status === 'ACTIVE';
      prev.gasto += c.gasto || 0; prev.conversas += c.conversas || 0;
      if (c.nome && !prev.criativos.includes(c.nome)) prev.criativos.push(c.nome);
      if (!prev.thumb && c.thumbnail_url) prev.thumb = c.thumbnail_url;
      map.set(key, prev);
    }
    return { joseMap: map, genericos: gen };
  }, [jose.criativos, modeloDoCriativo]);

  // qualidade por modelo (pra mostrar o cruzamento no card/modal da galeria)
  const qualidadePorModelo = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of rows) { const k = normalizeModelo(r.produto); if (k && !m.has(k)) m.set(k, r); }
    return m;
  }, [rows]);

  const lerImagens = async () => {
    setLendo(true); setErro(null);
    try {
      const payload = genericos
        .map((c) => ({ asset_key: c.asset_key, nome: c.nome, thumbnail_url: c.thumbnail_url }))
        .filter((c) => c.asset_key && c.thumbnail_url);
      if (payload.length === 0) return;
      const { error } = await (supabase as any).functions.invoke('feedback-criativo-visao', { body: { criativos: payload } });
      if (error) throw error;
      await carregar();
    } catch (e: any) {
      setErro(e?.message || 'Falha ao ler as imagens.');
    } finally { setLendo(false); }
  };

  // ── galeria: criativos filtrados por status + ordenados ─────────────────────
  const criativosVis = useMemo(() => {
    const f = jose.criativos.filter((c) => {
      if (status === 'ativos') return c.status === 'ACTIVE';
      if (status === 'anunciados') return true;
      if (status === 'nao_anunciados') return c.status !== 'ACTIVE';
      return true;
    });
    return [...f].sort((a, b) => (Number(b.gasto) || 0) - (Number(a.gasto) || 0));
  }, [jose.criativos, status]);
  const somaCriativos = useMemo(() => jose.criativos.reduce((s, c) => s + (Number(c.gasto) || 0), 0), [jose.criativos]);
  const outros = Math.max(0, jose.gastoTotal - somaCriativos);

  // ── tabela produto × tráfego ────────────────────────────────────────────────
  const linhas: Linha[] = useMemo(() => rows.map((r) => {
    const key = normalizeModelo(r.produto);
    return { ...r, key, jose: key ? joseMap.get(key) : undefined };
  }), [rows, joseMap]);
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
  const tot = linhasVis.reduce((a, r) => ({
    total: a.total + r.total, q: a.q + r.qualificados, p: a.p + r.pouco_qualificados,
    r: a.r + r.ruins, n: a.n + r.nao_lead,
  }), { total: 0, q: 0, p: 0, r: 0, n: 0 });
  const produtosComTrafego = useMemo(() => linhas.filter((l) => !!l.jose).length, [linhas]);
  const confianca = useMemo(
    () => confiancaProduto(linhas.length, produtosComTrafego, jose.tem_dados),
    [linhas.length, produtosComTrafego, jose.tem_dados],
  );
  const custoLeadBom = tot.q > 0 ? jose.gastoTotal / tot.q : 0;
  const acaoProduto = useMemo(() => {
    const pior = [...linhas]
      .filter((l) => l.jose && (l.jose.gasto || 0) > 0)
      .sort((a, b) => {
        const ca = a.qualificados > 0 ? (a.jose!.gasto / a.qualificados) : Number.POSITIVE_INFINITY;
        const cb = b.qualificados > 0 ? (b.jose!.gasto / b.qualificados) : Number.POSITIVE_INFINITY;
        return cb - ca;
      })[0];
    const melhor = [...linhas]
      .filter((l) => l.jose && l.qualificados > 0)
      .sort((a, b) => (a.jose!.gasto / a.qualificados) - (b.jose!.gasto / b.qualificados))[0];
    if (pior && !Number.isFinite(pior.qualificados > 0 ? pior.jose!.gasto / pior.qualificados : Number.POSITIVE_INFINITY)) {
      return `Revisar ${pior.produto}: existe gasto, mas nenhum lead bom identificado no periodo.`;
    }
    if (pior && pior.jose && pior.qualificados > 0 && (pior.jose.gasto / pior.qualificados) > 150) {
      return `Revisar ${pior.produto}: custo por lead bom esta alto (${brl(pior.jose.gasto / pior.qualificados)}).`;
    }
    if (melhor && melhor.jose) {
      return `Escalar ou estudar ${melhor.produto}: melhor custo por lead bom (${brl(melhor.jose.gasto / melhor.qualificados)}).`;
    }
    return 'Ainda nao ha volume suficiente para sugerir acao por produto com seguranca.';
  }, [linhas]);
  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'produto' ? 'asc' : 'desc'); }
  };

  const exportarCSV = () => {
    const periodo = modo === 'custom' ? `${ini}_a_${fim}` : `ultimos_${dias}_dias`;
    const esc = (v: any) => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    let head: any[], linhasCsv: any[][];
    if (view === 'galeria') {
      head = ['Veiculo', 'Gasto Meta', 'Status', 'Conversas', 'Qualificados', 'Pouco', 'Ruins'];
      linhasCsv = criativosVis.map((c) => {
        const q = qualidadePorModelo.get(modeloDoCriativo(c) || '');
        return [c.nome, brl(c.gasto || 0), c.status === 'ACTIVE' ? 'Ativo' : 'Pausado', c.conversas || 0,
          q?.qualificados ?? '', q?.pouco_qualificados ?? '', q?.ruins ?? ''];
      });
      linhasCsv.push(['OUTROS (cauda)', brl(outros), '', '', '', '', '']);
      linhasCsv.push(['TOTAL DA CONTA', brl(jose.gastoTotal), '', '', '', '', '']);
    } else {
      head = ['Produto', 'Leads', 'Qualificados', 'Pouco', 'Ruins', 'Nem e lead', '% Bom', 'Status trafego', 'Gasto Meta'];
      linhasCsv = linhasVis.map((r) => [r.produto, r.total, r.qualificados, r.pouco_qualificados, r.ruins, r.nao_lead,
        r.pct_qualificado + '%', !jose.tem_dados ? '' : !r.jose ? 'Nao anunciado' : r.jose.ativo ? 'Ativo' : 'Pausado', r.jose ? brl(r.jose.gasto) : '']);
    }
    const csv = [head, ...linhasCsv].map((l) => l.map(esc).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `feedback-por-produto_${view}_${periodo}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const StatusPillC = ({ s }: { s?: string }) => s === 'ACTIVE'
    ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Ativo</span>
    : <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">Pausado</span>;
  const Th = ({ k, children, align = 'right' }: { k: SortKey; children: any; align?: 'left' | 'right' }) => (
    <th className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-foreground ${sortKey === k ? 'text-foreground' : ''} ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {children}
        {sortKey === k ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <PackageSearch className="h-4 w-4 text-primary" /> Veículos anunciados <span className="text-muted-foreground">×</span> qualidade do lead
          </h3>
          <p className="text-xs text-muted-foreground">A galeria do José aqui dentro: cada carro com o gasto real e a qualidade do lead que ele traz. Clique pra ver a arte e os custos.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-md border border-border p-0.5">
            <button onClick={() => setView('galeria')} className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${view === 'galeria' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}><LayoutGrid className="h-3.5 w-3.5" /> Galeria</button>
            <button onClick={() => setView('tabela')} className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${view === 'tabela' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}><Table2 className="h-3.5 w-3.5" /> Tabela</button>
          </div>
          <button onClick={exportarCSV} disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent/40 disabled:opacity-50">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      {/* período */}
      <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Resumo para decisao</h4>
              <p className="text-xs text-muted-foreground">Meta mostra o gasto; Logos mostra a qualidade real do lead.</p>
            </div>
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${confianca.cls}`}>
              <ShieldCheck className="h-3.5 w-3.5" />
              {confianca.label}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
              <div className="text-[11px] text-muted-foreground">Investido Meta</div>
              <div className="mt-1 text-lg font-semibold text-foreground">{brl(jose.gastoTotal)}</div>
            </div>
            <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
              <div className="text-[11px] text-muted-foreground">Leads Logos</div>
              <div className="mt-1 text-lg font-semibold text-foreground">{tot.total}</div>
            </div>
            <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
              <div className="text-[11px] text-muted-foreground">Leads bons</div>
              <div className="mt-1 text-lg font-semibold text-emerald-300">{tot.q}</div>
            </div>
            <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
              <div className="text-[11px] text-muted-foreground">Custo/lead bom</div>
              <div className="mt-1 text-lg font-semibold text-foreground">{tot.q ? brl(custoLeadBom) : '-'}</div>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-primary/20 bg-primary/10 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-primary">
              <Lightbulb className="h-3.5 w-3.5" /> Acao recomendada
            </div>
            <p className="mt-1 text-sm text-foreground/90">{acaoProduto}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Info className="h-4 w-4 text-sky-300" />
            Como ler estes numeros
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{confianca.desc}</p>
          <div className="mt-3 space-y-2 text-xs text-muted-foreground">
            <div className="flex justify-between gap-3"><span>Produtos com vinculo de campanha</span><b className="text-foreground">{produtosComTrafego}/{linhas.length || 0}</b></div>
            <div className="flex justify-between gap-3"><span>Cobertura do cruzamento</span><b className="text-foreground">{linhas.length ? pct((produtosComTrafego / linhas.length) * 100) : '0%'}</b></div>
            <div className="flex justify-between gap-3"><span>Sem classe de qualidade</span><b className="text-foreground">{tot.total ? pct(((tot.total - tot.q - tot.p - tot.r - tot.n) / tot.total) * 100) : '0%'}</b></div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border p-0.5">
          {PRESETS.map((o) => (
            <button key={o.v} onClick={() => { setModo('preset'); setDias(o.v); }}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${modo === 'preset' && dias === o.v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{o.l}</button>
          ))}
          <button onClick={() => setModo('custom')} className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs transition-colors ${modo === 'custom' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <CalendarRange className="h-3.5 w-3.5" /> Personalizado
          </button>
        </div>
        {modo === 'custom' && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>de</span>
            <input type="date" value={ini} min={isoMenosDias(MAX_DIAS)} max={fim} onChange={(e) => setIni(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground" />
            <span>até</span>
            <input type="date" value={fim} min={ini} max={hojeISO()} onChange={(e) => setFim(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground" />
            <span className="text-[10px] opacity-70">(máx. 60 dias · ao vivo, ~alguns seg)</span>
          </div>
        )}
        <button onClick={carregar} disabled={loading} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
          <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
        {modo !== 'custom' && (
          <button onClick={recalcular} disabled={recalc} className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 px-2.5 py-1 text-xs text-primary hover:bg-primary/10 disabled:opacity-50" title="Puxa da Meta agora (leva ~1 min)">
            <RotateCw className={`h-3.5 w-3.5 ${recalc ? 'animate-spin' : ''}`} /> {recalc ? 'Recalculando...' : 'Recalcular da Meta'}
          </button>
        )}
      </div>

      {/* status filter */}
      {jose.tem_dados && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            {STATUS.map((o) => (
              <button key={o.v} onClick={() => setStatus(o.v)} className={`rounded px-2.5 py-1 text-xs transition-colors ${status === o.v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{o.l}</button>
            ))}
          </div>
          {jose.computed_at && <span className="text-[11px] text-muted-foreground">Tráfego calculado em {new Date(jose.computed_at).toLocaleString('pt-BR')}</span>}
        </div>
      )}

      {aviso && <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-400"><AlertTriangle className="h-4 w-4 shrink-0" /> {aviso}</div>}
      {erro && <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-500"><AlertTriangle className="h-4 w-4" /> {erro}</div>}

      {/* resumo do investimento (bate com o José/Meta) */}
      {jose.tem_dados && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border/60 bg-muted/20 px-4 py-2.5 text-sm">
          <span><span className="text-muted-foreground">Investido no período: </span><b className="tabular-nums text-foreground">{brl(jose.gastoTotal)}</b></span>
          <span className="text-muted-foreground">·</span>
          <span><span className="text-muted-foreground">Nos veículos abaixo: </span><b className="tabular-nums text-foreground">{brl(somaCriativos)}</b></span>
          {outros > 0 && <><span className="text-muted-foreground">·</span><span className="text-muted-foreground">Outros (anúncios menores): {brl(outros)}</span></>}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando...</div>
      ) : view === 'galeria' ? (
        /* ── GALERIA ─────────────────────────────────────────────────────────── */
        criativosVis.length === 0 ? (
          <div className="rounded-xl border border-border/50 py-12 text-center text-sm text-muted-foreground">
            {jose.tem_dados ? 'Nenhum veículo com esse filtro.' : 'Tráfego ainda não calculado. Clique em "Recalcular da Meta" e volte em ~1 min.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {criativosVis.map((c, i) => {
              const q = qualidadePorModelo.get(modeloDoCriativo(c) || '');
              return (
                <button key={i} onClick={() => setModal(c)} className="group overflow-hidden rounded-xl border border-border/60 bg-card text-left shadow-sm transition-shadow hover:shadow-md">
                  <div className="relative h-28 w-full bg-muted">
                    {c.thumbnail_url
                      ? <img src={c.thumbnail_url} alt={c.nome} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                      : <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground"><ImageOff className="h-4 w-4" /></div>}
                    <div className="absolute left-1.5 top-1.5"><StatusPillC s={c.status} /></div>
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-xs font-semibold text-foreground" title={c.nome}>{c.nome}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{brl(c.gasto || 0)} · {c.conversas || 0} conv</p>
                    {q && (
                      <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
                        {q.qualificados > 0 && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-600 dark:text-emerald-400">{q.qualificados} bom</span>}
                        {q.ruins > 0 && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-600 dark:text-red-400">{q.ruins} ruim</span>}
                        {q.nao_lead > 0 && <span className="rounded bg-slate-500/15 px-1.5 py-0.5 text-slate-500">{q.nao_lead} nem-é-lead</span>}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : (
        /* ── TABELA ──────────────────────────────────────────────────────────── */
        rows.length === 0 ? (
          <div className="rounded-xl border border-border/50 py-10 text-center text-sm text-muted-foreground">Sem análises no período.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/50">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30 text-[11px] uppercase text-muted-foreground">
                  <Th k="produto" align="left">Produto</Th><Th k="total">Leads</Th><Th k="qualificados">Qualif.</Th>
                  <Th k="pouco">Pouco</Th><Th k="ruins">Ruim</Th><Th k="nao_lead">Nem é lead</Th><Th k="pct">% Bom</Th>
                  <th className="px-3 py-2 text-left font-medium">Tráfego</th><Th k="gasto">Gasto Meta</Th>
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
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{r.pct_qualificado}%</td>
                    <td className="px-3 py-2">{!jose.tem_dados ? <span className="text-muted-foreground">—</span> : !r.jose ? <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[11px] text-slate-500">Não anunciado</span> : <StatusPillC s={r.jose.ativo ? 'ACTIVE' : 'PAUSED'} />}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.jose && r.jose.gasto > 0 ? brl(r.jose.gasto) : '·'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border/50 bg-muted/20 text-[12px] font-medium">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{tot.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{tot.q}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{tot.p}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-600 dark:text-red-400">{tot.r}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{tot.n}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{tot.total ? Math.round((100 * tot.q) / tot.total) : 0}%</td>
                  <td className="px-3 py-2" /><td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}

      {/* Genéricos (nome sem carro) — botão de ler imagem */}
      {jose.tem_dados && genericos.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-muted/10 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground"><ImageOff className="h-4 w-4 text-muted-foreground" /> {genericos.length} anúncio(s) sem o carro no nome</div>
            <button onClick={lerImagens} disabled={lendo} className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {lendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanEye className="h-3.5 w-3.5" />} {lendo ? 'Lendo imagens...' : 'Ler imagens com IA'}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">O carro está na imagem — a IA lê e casa esses com o produto/qualidade.</p>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Gasto por veículo puxado da Meta e calculado por um robô (bate com o total da conta). "Investido no período" = total real; "Outros" = anúncios pequenos da cauda. As imagens ficam no nosso armazenamento — sempre abrem.</span>
      </p>

      {/* MODAL do veículo: imagem cheia + custos + cruzamento */}
      {modal && (() => {
        const q = qualidadePorModelo.get(modeloDoCriativo(modal) || '');
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={() => setModal(null)}>
            <div className="my-8 w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <h3 className="flex items-center gap-2 text-sm font-bold text-foreground"><Sparkles className="h-4 w-4 text-amber-400" /> {modal.nome}</h3>
                <button onClick={() => setModal(null)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>
              {modal.thumbnail_url && <img src={modal.thumbnail_url} alt={modal.nome} className="max-h-[50vh] w-full bg-muted object-contain" />}
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
                <div><div className="text-[11px] text-muted-foreground">Status</div><div className="mt-0.5"><StatusPillC s={modal.status} /></div></div>
                <div><div className="text-[11px] text-muted-foreground">Investido</div><div className="text-sm font-bold tabular-nums text-foreground">{brl(modal.gasto || 0)}</div></div>
                <div><div className="text-[11px] text-muted-foreground">Conversas</div><div className="text-sm font-bold tabular-nums text-foreground">{modal.conversas || 0}</div></div>
                <div><div className="text-[11px] text-muted-foreground">Custo/conversa</div><div className="text-sm font-bold tabular-nums text-foreground">{modal.conversas ? brl((modal.gasto || 0) / modal.conversas) : '—'}</div></div>
              </div>
              <div className="border-t border-border/60 px-4 py-3">
                <div className="mb-1.5 text-xs font-semibold text-foreground">Qualidade do lead deste carro</div>
                {q ? (
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-lg bg-emerald-500/15 px-2 py-1 font-semibold text-emerald-600 dark:text-emerald-400">{q.qualificados} qualificado(s)</span>
                    <span className="rounded-lg bg-amber-500/15 px-2 py-1 text-amber-600 dark:text-amber-400">{q.pouco_qualificados} pouco</span>
                    <span className="rounded-lg bg-red-500/15 px-2 py-1 text-red-600 dark:text-red-400">{q.ruins} ruim</span>
                    <span className="rounded-lg bg-slate-500/15 px-2 py-1 text-slate-500">{q.nao_lead} nem-é-lead</span>
                    <span className="rounded-lg border border-border px-2 py-1 font-semibold text-foreground">{q.pct_qualificado}% bom</span>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Ainda sem lead deste carro atendido no período (ou o carro não foi identificado na conversa).</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
