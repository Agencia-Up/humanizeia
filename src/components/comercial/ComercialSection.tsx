// ============================================================================
// ComercialSection — bloco de Gestão Comercial integrado ao Painel Geral.
// ----------------------------------------------------------------------------
// Estado inicial: visão GERAL (loja inteira). Gestor pode escolher um vendedor
// (dropdown) ou clicar numa linha da tabela -> DRILL-DOWN: KPIs/tabela/gráficos
// passam a refletir só aquele vendedor. Botão "Ver geral" limpa o filtro.
// Vendedor (papel seller) só vê a própria visão (RLS no back + sem dropdown).
// Período e drill-down recalculam tudo a partir das vendas do ano carregadas.
// ============================================================================
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  TrendingUp, DollarSign, Target, Trophy, Users, Plus, ArrowLeft, Loader2, Radio, Ticket, Pencil, Check, X,
} from 'lucide-react';
import { useComercialData } from '@/hooks/useComercialData';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { LancarVendaDialog } from './LancarVendaDialog';
import { ComercialCharts } from './ComercialCharts';
import {
  ORIGENS, ORIGEM_LABEL, type OrigemVenda, type DesempenhoVendedor, type VendaComercial,
} from '@/types/comercial';

const ZERO_ORIGEM = (): Record<OrigemVenda, number> => ({ trafego: 0, portais: 0, porta: 0, particular: 0 });
function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function fmtData(ymdStr: string) { const [y, m, d] = (ymdStr || '').split('-'); return d ? `${d}/${m}/${y.slice(2)}` : (ymdStr || '—'); }
function brl(n: number) { return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function pctColor(p: number) { return p >= 100 ? 'text-emerald-400' : p >= 70 ? 'text-amber-400' : 'text-red-400'; }
function pctBg(p: number) { return p >= 100 ? 'bg-emerald-500' : p >= 70 ? 'bg-amber-500' : 'bg-red-500'; }

interface Props {
  periodStart: string;     // ISO
  periodEnd: string;       // ISO
  periodLabel: string;
  isSeller: boolean;
  ownerUserId: string;     // effectiveUserId (gestor = próprio; vendedor = master)
  currentSellerId: string | null;
  currentSellerName?: string;
  /** Filtro de vendedor CONTROLADO pelo pai (filtro global do Painel Geral).
   *  undefined = bloco usa seu próprio dropdown; null/id = controlado (esconde o dropdown). */
  externalSellerId?: string | null;
}

function Kpi({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string; sub?: string; icon: React.ElementType; accent: string;
}) {
  return (
    <Card className="bg-card border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`h-7 w-7 rounded-lg flex items-center justify-center ${accent}`}><Icon className="h-4 w-4" /></span>
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
        </div>
        <p className="text-2xl font-black tabular-nums leading-none">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-1.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function ComercialSection({
  periodStart, periodEnd, periodLabel, isSeller, ownerUserId, currentSellerId, currentSellerName, externalSellerId,
}: Props) {
  const refDate = useMemo(() => new Date(periodEnd), [periodEnd]);
  const { vendasAno, metas, sellers, loading, refresh, monthRef } = useComercialData({ ownerUserId, refDate, isSeller });

  const [addOpen, setAddOpen] = useState(false);
  // Edição de uma venda já lançada (corrigir data/valor/origem, ou excluir).
  const [editVenda, setEditVenda] = useState<VendaComercial | null>(null);
  // Edição da meta individual: vendedor na própria visão; gestor na tabela/drill-down.
  const [editMetaFor, setEditMetaFor] = useState<string | null>(null);
  const [metaInput, setMetaInput] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  // Drill-down: vendedor selecionado (gestor). Vendedor logado fica fixo nele mesmo.
  // Se o pai mandar externalSellerId (filtro global do Painel Geral), ele manda —
  // e o dropdown próprio some, pra não ter dois filtros brigando.
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);
  const controlledByParent = !isSeller && externalSellerId !== undefined;
  const activeSellerId = isSeller
    ? (currentSellerId || null)
    : (controlledByParent ? (externalSellerId ?? null) : selectedSellerId);

  const startKey = useMemo(() => ymd(new Date(periodStart)), [periodStart]);
  const endKey = useMemo(() => ymd(new Date(periodEnd)), [periodEnd]);

  // Vendas do período (recorte de data) e da visão (vendedor ativo, se houver).
  const vendasPeriodo = useMemo<VendaComercial[]>(() =>
    vendasAno.filter(v => v.data_venda >= startKey && v.data_venda <= endKey
      && (!activeSellerId || v.seller_id === activeSellerId)),
    [vendasAno, startKey, endKey, activeSellerId]);

  const vendasAnoView = useMemo<VendaComercial[]>(() =>
    activeSellerId ? vendasAno.filter(v => v.seller_id === activeSellerId) : vendasAno,
    [vendasAno, activeSellerId]);

  const metaLoja = useMemo(() => metas.find(m => m.tipo === 'loja')?.valor_meta || 0, [metas]);
  const metaDoVendedor = (sid: string) => metas.find(m => m.tipo === 'individual' && m.seller_id === sid)?.valor_meta || 0;
  const metaRef = activeSellerId ? metaDoVendedor(activeSellerId) : metaLoja;

  // KPIs do recorte ativo
  const kpis = useMemo(() => {
    const vendasTotais = vendasPeriodo.length;
    const faturamento = vendasPeriodo.reduce((a, v) => a + v.valor, 0);
    // Ticket médio só sobre vendas COM valor — fechamentos derivados do CRM
    // entram com valor 0 (contam na quantidade/meta, mas não puxam o ticket).
    const comValor = vendasPeriodo.filter(v => v.valor > 0).length;
    const ticket = comValor > 0 ? faturamento / comValor : 0;
    const pct = metaRef > 0 ? Math.round((vendasTotais / metaRef) * 100) : 0;

    // melhor canal (recorte)
    const porCanal = ORIGENS.map(o => ({ origem: o.value as OrigemVenda, n: vendasPeriodo.filter(v => v.origem === o.value).length }))
      .sort((a, b) => b.n - a.n);
    const melhorCanal = porCanal[0] && porCanal[0].n > 0 ? porCanal[0] : null;

    return { vendasTotais, faturamento, ticket, pct, melhorCanal };
  }, [vendasPeriodo, metaRef]);

  // Tabela de desempenho por vendedor (só geral + gestor)
  const desempenho = useMemo<DesempenhoVendedor[]>(() => {
    if (isSeller) return [];
    const map = new Map<string, DesempenhoVendedor>();
    for (const s of sellers) {
      map.set(s.id, { sellerId: s.id, nome: s.nome, meta: metaDoVendedor(s.id), vendas: 0, pctMeta: 0, faturamento: 0, porOrigem: ZERO_ORIGEM() });
    }
    for (const v of vendasPeriodo) {
      let row = map.get(v.seller_id);
      if (!row) { row = { sellerId: v.seller_id, nome: 'Vendedor', meta: metaDoVendedor(v.seller_id), vendas: 0, pctMeta: 0, faturamento: 0, porOrigem: ZERO_ORIGEM() }; map.set(v.seller_id, row); }
      row.vendas += 1;
      row.faturamento += v.valor;
      row.porOrigem[v.origem] += 1;
    }
    const rows = Array.from(map.values());
    rows.forEach(r => { r.pctMeta = r.meta > 0 ? Math.round((r.vendas / r.meta) * 100) : 0; });
    return rows.sort((a, b) => (b.pctMeta - a.pctMeta) || (b.vendas - a.vendas));
  }, [sellers, vendasPeriodo, isSeller, metas]);

  const melhorVendedor = useMemo(() => {
    if (isSeller) return null;
    const top = [...desempenho].sort((a, b) => b.vendas - a.vendas)[0];
    return top && top.vendas > 0 ? { nome: top.nome, vendas: top.vendas } : null;
  }, [desempenho, isSeller]);

  const nomeAtivo = activeSellerId
    ? (sellers.find(s => s.id === activeSellerId)?.nome || currentSellerName || 'Vendedor')
    : null;

  // Salva a meta individual (upsert manual: update se já existe a do mês, senão insert).
  const saveMeta = async (sellerId: string, n: number) => {
    if (!sellerId || isNaN(n) || n < 0) { setEditMetaFor(null); return; }
    setSavingMeta(true);
    try {
      const existing = metas.find(m => m.tipo === 'individual' && m.seller_id === sellerId);
      if (existing?.id) {
        const { error } = await (supabase as any).from('comercial_metas')
          .update({ valor_meta: n, updated_at: new Date().toISOString() }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('comercial_metas')
          .insert({ user_id: ownerUserId, seller_id: sellerId, tipo: 'individual', mes_referencia: monthRef, valor_meta: n });
        if (error) throw error;
      }
      setEditMetaFor(null);
      toast.success('Meta salva.');
      refresh();
    } catch (e: any) {
      toast.error('Não foi possível salvar a meta', { description: e?.message });
    } finally {
      setSavingMeta(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header do bloco comercial */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <TrendingUp className="h-5 w-5 text-emerald-400" />
          <h2 className="text-lg font-bold">Gestão Comercial</h2>
          <span className="text-xs text-muted-foreground">{periodLabel}</span>
          {nomeAtivo && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              {nomeAtivo}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isSeller && !controlledByParent && activeSellerId && (
            <Button variant="outline" size="sm" onClick={() => setSelectedSellerId(null)} className="gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" /> Ver geral
            </Button>
          )}
          {!isSeller && !controlledByParent && (
            <Select value={activeSellerId || '__all__'} onValueChange={(v) => setSelectedSellerId(v === '__all__' ? null : v)}>
              <SelectTrigger className="h-9 w-[200px]"><SelectValue placeholder="Vendedor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos (geral)</SelectItem>
                {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" onClick={() => { setEditVenda(null); setAddOpen(true); }} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Lançar venda
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="h-40 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-emerald-400" /></div>
      ) : (
        <>
          {/* KPIs — Faturamento e Ticket médio removidos (sem valor de venda ainda).
              "Meta do mês" puxa de comercial_metas (loja), a MESMA do Painel ao Vivo. */}
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Vendas" value={String(kpis.vendasTotais)} icon={TrendingUp} accent="bg-emerald-500/15 text-emerald-300" sub={`no período`} />
            <Kpi label={`Meta do mês (${activeSellerId ? 'vendedor' : 'loja'})`}
                 value={metaRef > 0 ? `${kpis.vendasTotais}/${metaRef}` : '—'} icon={Target}
                 accent="bg-amber-500/15 text-amber-300"
                 sub={metaRef > 0 ? `${kpis.pct}% da meta` : 'defina no Painel ao Vivo'} />
            <Kpi label={activeSellerId ? 'Vendedor' : 'Melhor vendedor'}
                 value={activeSellerId ? (nomeAtivo || '—') : (melhorVendedor?.nome || '—')}
                 icon={Trophy} accent="bg-yellow-500/15 text-yellow-300"
                 sub={!activeSellerId && melhorVendedor ? `${melhorVendedor.vendas} vendas` : undefined} />
            <Kpi label="Melhor canal" value={kpis.melhorCanal ? ORIGEM_LABEL[kpis.melhorCanal.origem] : '—'} icon={Radio}
                 accent="bg-cyan-500/15 text-cyan-300" sub={kpis.melhorCanal ? `${kpis.melhorCanal.n} vendas` : undefined} />
          </div>

          {/* Definir/editar a meta individual — vendedor na visão dele; gestor no drill-down */}
          {activeSellerId && (
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <Target className="h-4 w-4 text-amber-400 shrink-0" />
              <span className="text-muted-foreground">{isSeller ? 'Sua meta do mês:' : `Meta de ${nomeAtivo}:`}</span>
              {editMetaFor === activeSellerId ? (
                <span className="inline-flex items-center gap-1">
                  <input type="number" min={0} value={metaInput} autoFocus
                    onChange={e => setMetaInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveMeta(activeSellerId, parseInt(metaInput, 10) || 0); if (e.key === 'Escape') setEditMetaFor(null); }}
                    className="h-7 w-20 rounded-md border border-border/50 bg-background px-2 text-sm" />
                  <span className="text-xs text-muted-foreground">vendas</span>
                  <Button size="sm" className="h-7 px-2 bg-emerald-600 hover:bg-emerald-700" disabled={savingMeta}
                    onClick={() => saveMeta(activeSellerId, parseInt(metaInput, 10) || 0)}>
                    {savingMeta ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditMetaFor(null)}><X className="h-3.5 w-3.5" /></Button>
                </span>
              ) : (
                <button onClick={() => { setMetaInput(String(metaRef || '')); setEditMetaFor(activeSellerId); }}
                  className="inline-flex items-center gap-1.5 font-semibold text-foreground hover:text-amber-300 transition-colors">
                  {metaRef > 0 ? `${metaRef} vendas` : 'definir'}
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
            </div>
          )}

          {/* Tabela de desempenho (só geral + gestor) */}
          {!isSeller && !activeSellerId && (
            <Card className="bg-card border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-400" /> Desempenho por vendedor
                  <span className="text-[11px] text-muted-foreground font-normal">· clique numa linha pra ver só ele</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border/50">
                      <th className="py-2 pr-2">Vendedor</th>
                      <th className="py-2 px-2 text-center">Meta</th>
                      <th className="py-2 px-2 text-center">Vendas</th>
                      <th className="py-2 px-2 text-center">% Meta</th>
                      <th className="py-2 px-2 text-center">Tráfego</th>
                      <th className="py-2 px-2 text-center">Portais</th>
                      <th className="py-2 px-2 text-center">Porta</th>
                      <th className="py-2 pl-2 text-center">Particular</th>
                    </tr>
                  </thead>
                  <tbody>
                    {desempenho.length === 0 && (
                      <tr><td colSpan={8} className="py-6 text-center text-muted-foreground text-xs">Nenhuma venda no período.</td></tr>
                    )}
                    {desempenho.map(r => (
                      <tr key={r.sellerId} onClick={() => setSelectedSellerId(r.sellerId)}
                          className="border-b border-border/30 hover:bg-muted/40 cursor-pointer transition-colors">
                        <td className="py-2 pr-2 font-medium">{r.nome}</td>
                        <td className="py-2 px-2 text-center tabular-nums" onClick={(e) => e.stopPropagation()}>
                          {editMetaFor === r.sellerId ? (
                            <span className="inline-flex items-center gap-1">
                              <input type="number" min={0} value={metaInput} autoFocus
                                onChange={e => setMetaInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveMeta(r.sellerId, parseInt(metaInput, 10) || 0); if (e.key === 'Escape') setEditMetaFor(null); }}
                                className="h-7 w-16 rounded border border-border/50 bg-background px-1 text-center text-sm" />
                              <button disabled={savingMeta} onClick={() => saveMeta(r.sellerId, parseInt(metaInput, 10) || 0)} className="inline-flex items-center gap-1 font-semibold text-emerald-400" title="Salvar"><Check className="h-3.5 w-3.5" /> Salvar</button>
                              <button onClick={() => setEditMetaFor(null)} className="inline-flex items-center gap-1 text-muted-foreground" title="Cancelar"><X className="h-3.5 w-3.5" /> Cancelar</button>
                            </span>
                          ) : (
                            <button onClick={() => { setMetaInput(String(r.meta || '')); setEditMetaFor(r.sellerId); }}
                              className="inline-flex items-center gap-1 hover:text-amber-300 transition-colors" title="Definir a meta deste vendedor">
                              {r.meta || '—'} <Pencil className="h-3 w-3 text-muted-foreground/60" />
                            </button>
                          )}
                        </td>
                        <td className="py-2 px-2 text-center tabular-nums font-semibold">{r.vendas}</td>
                        <td className="py-2 px-2 text-center">
                          {r.meta > 0 ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className={`tabular-nums font-bold ${pctColor(r.pctMeta)}`}>{r.pctMeta}%</span>
                              <span className="h-1.5 w-10 rounded-full bg-muted overflow-hidden inline-block">
                                <span className={`h-full block ${pctBg(r.pctMeta)}`} style={{ width: `${Math.min(r.pctMeta, 100)}%` }} />
                              </span>
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-2 px-2 text-center tabular-nums">{r.porOrigem.trafego}</td>
                        <td className="py-2 px-2 text-center tabular-nums">{r.porOrigem.portais}</td>
                        <td className="py-2 px-2 text-center tabular-nums">{r.porOrigem.porta}</td>
                        <td className="py-2 pl-2 text-center tabular-nums">{r.porOrigem.particular}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Vendas do período — lista individual, editável (corrigir data/valor/origem ou excluir) */}
          {vendasPeriodo.length > 0 && (
            <Card className="bg-card border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-emerald-400" /> Vendas do período
                  <span className="text-[11px] text-muted-foreground font-normal">· {vendasPeriodo.length} · clique no lápis pra corrigir a data{!isSeller ? ' ou excluir' : ''}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border/50">
                      <th className="py-2 pr-2">Data</th>
                      {!activeSellerId && <th className="py-2 px-2">Vendedor</th>}
                      <th className="py-2 px-2">Origem</th>
                      <th className="py-2 px-2">Veículo</th>
                      <th className="py-2 px-2 text-right">Valor</th>
                      <th className="py-2 pl-2 text-right">Editar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...vendasPeriodo].sort((a, b) => b.data_venda.localeCompare(a.data_venda)).map(v => (
                      <tr key={v.id} className="border-b border-border/30 hover:bg-muted/40">
                        <td className="py-2 pr-2 tabular-nums">{fmtData(v.data_venda)}</td>
                        {!activeSellerId && <td className="py-2 px-2">{sellers.find(s => s.id === v.seller_id)?.nome || 'Vendedor'}</td>}
                        <td className="py-2 px-2">{ORIGEM_LABEL[v.origem]}</td>
                        <td className="py-2 px-2 text-muted-foreground">{v.veiculo || '—'}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{v.valor > 0 ? brl(v.valor) : '—'}</td>
                        <td className="py-2 pl-2 text-right">
                          <button onClick={() => setEditVenda(v)} title="Corrigir/excluir esta venda"
                            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-amber-300 hover:bg-muted/60 transition-colors">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Gráficos */}
          <ComercialCharts vendasPeriodo={vendasPeriodo} vendasAno={vendasAnoView} metaRef={metaRef} refDate={refDate} />
        </>
      )}

      <LancarVendaDialog
        open={addOpen || !!editVenda}
        onOpenChange={(o) => { if (!o) { setAddOpen(false); setEditVenda(null); } }}
        ownerUserId={ownerUserId}
        isSeller={isSeller}
        currentSellerId={currentSellerId}
        currentSellerName={currentSellerName}
        sellers={sellers}
        venda={editVenda}
        onSaved={refresh}
      />
    </div>
  );
}
